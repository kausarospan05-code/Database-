/* =====================================================================
   Samgau Globe — a small interactive 3D globe drawn on <canvas>.
   No libraries: orthographic projection, land outlines from /world.json
   (Natural Earth, public domain), airports, great-circle flight arcs and
   an animated plane.

   const g = new Globe(canvas, { onPick: code => ..., onHover: code => ... });
   g.set({ airports, routes, origin: 'NQZ', hl: { from: 'NQZ', to: 'ALA' } });
   g.flyTo(lon, lat, zoom);   g.focusRoute('NQZ', 'ALA');   Globe.mini(canvas, a, b, airports)
   ===================================================================== */
(function () {
  const RAD = Math.PI / 180;
  const COLORS = {
    oceanIn: '#17213f', oceanOut: '#0a1022', land: '#1b2646', border: 'rgba(124,134,166,0.28)',
    kz: 'rgba(212,180,90,0.17)', kzLine: '#d4b45a', grid: 'rgba(124,134,166,0.10)', limb: 'rgba(124,134,166,0.35)',
    gold: '#d4b45a', text: '#e8ebf5', mute: '#8a93b3', route: 'rgba(212,180,90,0.30)'
  };
  // Where to put each city's label so close airports (Astana/Karaganda) don't collide.
  const LABEL = { KGF: 'below', NQZ: 'above', CIT: 'left', SCO: 'left', GUW: 'left', AKX: 'above', UKK: 'right', ALA: 'right' };
  const KZ_VIEW = { lon: 67.5, lat: 47.5, zoom: 3.3 };

  const vec = (lon, lat) => { const l = lon * RAD, p = lat * RAD, c = Math.cos(p); return [c * Math.cos(l), c * Math.sin(l), Math.sin(p)]; };
  const toLonLat = v => [Math.atan2(v[1], v[0]) / RAD, Math.asin(Math.max(-1, Math.min(1, v[2]))) / RAD];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  // Turn [[lon,lat],...] into a flat Float64Array of unit vectors, adding points on long edges
  // so polygons stay round when they bend over the horizon.
  function prepRing(r) {
    const out = [];
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      out.push(...vec(a[0], a[1]));
      const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.max(Math.abs(dx), Math.abs(dy));
      if (d > 2 && Math.abs(dx) < 180) { const n = Math.ceil(d / 2); for (let k = 1; k < n; k++) out.push(...vec(a[0] + dx * k / n, a[1] + dy * k / n)); }
    }
    return new Float64Array(out);
  }

  let worldP = null;
  function loadWorld() {
    return worldP || (worldP = fetch('/world.json').then(r => r.json()).then(w => ({
      countries: w.countries.flatMap(c => c.r.map(prepRing)),
      kz: w.kz.map(prepRing),
      lakes: w.lakes.map(prepRing)
    })));
  }

  // Points along the great circle a→b, lifted above the surface in the middle (the "flight arc").
  function arc(a, b, n = 64) {
    const A = vec(a.longitude, a.latitude), B = vec(b.longitude, b.latitude);
    const w = Math.acos(Math.max(-1, Math.min(1, dot(A, B)))) || 1e-6, s = Math.sin(w);
    const h = Math.min(0.22, 0.04 + w * 0.32), pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, k1 = Math.sin((1 - t) * w) / s, k2 = Math.sin(t * w) / s, lift = 1 + h * Math.sin(Math.PI * t);
      pts.push([(k1 * A[0] + k2 * B[0]) * lift, (k1 * A[1] + k2 * B[1]) * lift, (k1 * A[2] + k2 * B[2]) * lift]);
    }
    return { pts, w };
  }

  class Globe {
    constructor(canvas, opts = {}) {
      this.c = canvas; this.ctx = canvas.getContext('2d');
      this.o = Object.assign({ interactive: true, spin: false, labels: true, mini: false, minZoom: 0.85, maxZoom: 9 }, opts);
      const v = this.o.view || KZ_VIEW;
      this.lon = v.lon; this.lat = v.lat; this.zoom = v.zoom;
      this.airports = []; this.routes = []; this.origin = null; this.hl = null; this.hover = null; this.visited = null;
      this.arcs = new Map(); this.hits = []; this.spinOn = !!this.o.spin; this.spinPause = 0;
      this.reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.buf = new Float32Array(4096 * 2);
      this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(canvas);
      if (this.o.interactive) this.bind();
      loadWorld().then(w => { this.world = w; this.kick(); }).catch(() => { this.failed = true; this.kick(); });
    }

    /* ----- public API ----- */
    set(d) {
      if (d.airports) { this.airports = d.airports; this.byCode = Object.fromEntries(d.airports.map(a => [a.code, a])); this.arcs.clear(); }
      ['routes', 'origin', 'hl', 'visited'].forEach(k => { if (k in d) this[k] = d[k]; });
      if ('spin' in d) this.spinOn = d.spin && !this.reduce;
      this.kick(); return this;
    }
    setHover(code) { if (this.hover !== code) { this.hover = code; this.kick(); } }
    flyTo(lon, lat, zoom = this.zoom, dur = 1100) {
      if (this.reduce || dur === 0 || !this.w) { this.lon = lon; this.lat = lat; this.zoom = zoom; this.fly = null; return this.kick(); }
      let dl = ((lon - this.lon + 540) % 360) - 180;
      this.fly = { t0: performance.now(), dur, lon0: this.lon, lat0: this.lat, z0: this.zoom, dl, lat1: lat, z1: zoom };
      this.kick();
    }
    home(dur) { this.flyTo(KZ_VIEW.lon, KZ_VIEW.lat, KZ_VIEW.zoom, dur); }
    worldView(dur) { this.flyTo(this.lon, 25, 1, dur); }
    zoomBy(f) { this.flyTo(this.lon, this.lat, Math.max(this.o.minZoom, Math.min(this.o.maxZoom, this.zoom * f)), 350); }
    focusRoute(from, to, dur) {
      const a = this.byCode && this.byCode[from], b = this.byCode && this.byCode[to]; if (!a || !b) return;
      const A = vec(a.longitude, a.latitude), B = vec(b.longitude, b.latitude);
      const m = [A[0] + B[0], A[1] + B[1], A[2] + B[2]], n = Math.hypot(...m), [lon, lat] = toLonLat(m.map(x => x / n));
      const w = Math.acos(Math.max(-1, Math.min(1, dot(A, B))));
      const aspect = this.w && this.h ? Math.max(1, this.w / this.h) : 1;
      this.flyTo(lon, lat + w * 8, Math.max(2.4, Math.min(7, 0.62 * aspect / (w + 0.05))), dur);
    }

    /* ----- sizing + loop ----- */
    resize() {
      const r = this.c.getBoundingClientRect(); if (!r.width || !r.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.w = r.width; this.h = r.height;
      this.c.width = Math.round(r.width * dpr); this.c.height = Math.round(r.height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.draw(performance.now()); this.kick();
    }
    get R() { return Math.min(this.w, this.h) / 2 * 0.92 * this.zoom; }
    kick() { if (!this.raf) this.raf = requestAnimationFrame(t => { this.raf = 0; this.frame(t); }); }
    frame(t) {
      if (!this.c.isConnected || !this.w) return;            // re-started by ResizeObserver when shown again
      const dt = Math.min(64, t - (this.last || t)); this.last = t;
      if (this.fly) {
        const f = this.fly, p = Math.min(1, (t - f.t0) / f.dur), e = ease(p);
        this.lon = f.lon0 + f.dl * e; this.lat = f.lat0 + (f.lat1 - f.lat0) * e; this.zoom = f.z0 + (f.z1 - f.z0) * e;
        if (p >= 1) this.fly = null;
      } else if (this.spinOn && !this.drag && t > this.spinPause) this.lon += dt * 0.006;
      this.draw(t);
      const moving = this.fly || (this.spinOn && t > this.spinPause) || this.drag;
      if (!this.o.mini && !document.hidden && (moving || (!this.reduce && this.airports.length))) this.kick();
    }

    /* ----- drawing ----- */
    draw(t) {
      const { ctx, w, h } = this; if (!w) return;
      const R = this.R, cx = w / 2, cy = h / 2;
      const l0 = this.lon * RAD, p0 = this.lat * RAD, cl = Math.cos(l0), sl = Math.sin(l0), c0 = Math.cos(p0), s0 = Math.sin(p0);
      // rotate a unit vector into view space: x right, y up, z towards viewer
      const P = (X, Y, Z) => { const A = X * cl + Y * sl; return [Y * cl - X * sl, c0 * Z - s0 * A, s0 * Z + c0 * A]; };
      this.P = P;
      ctx.clearRect(0, 0, w, h);

      if (!this.o.mini) {                                     // atmosphere glow
        const g = ctx.createRadialGradient(cx, cy, R * 0.92, cx, cy, R * 1.22);
        g.addColorStop(0, 'rgba(212,180,90,0.13)'); g.addColorStop(0.4, 'rgba(109,127,196,0.06)'); g.addColorStop(1, 'rgba(109,127,196,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.22, 0, 7); ctx.fill();
      }
      const og = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.05, cx, cy, R);
      og.addColorStop(0, COLORS.oceanIn); og.addColorStop(1, COLORS.oceanOut);
      ctx.fillStyle = og; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();

      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.clip();
      this.graticule(P, R, cx, cy);
      if (this.world) {
        this.rings(this.world.countries, P, R, cx, cy, COLORS.land, COLORS.border, 0.6);
        this.rings(this.world.kz, P, R, cx, cy, COLORS.kz, COLORS.kzLine, this.o.mini ? 1 : 1.3);
        this.rings(this.world.lakes, P, R, cx, cy, '#0e1530', null);
      }
      ctx.restore();
      ctx.strokeStyle = COLORS.limb; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
      if (this.failed && !this.o.mini) { ctx.fillStyle = COLORS.mute; ctx.font = '12px monospace'; ctx.textAlign = 'center'; ctx.fillText('Map outlines could not load', cx, cy); }

      this.drawRoutes(t, P, R, cx, cy);
      this.drawAirports(t, P, R, cx, cy);
    }

    graticule(P, R, cx, cy) {
      const { ctx } = this; ctx.strokeStyle = COLORS.grid; ctx.lineWidth = 0.7; ctx.beginPath();
      const line = pts => { let pen = false; for (const [lo, la] of pts) { const v = vec(lo, la), [x, y, z] = P(...v);
        if (z > 0) { pen ? ctx.lineTo(cx + x * R, cy - y * R) : ctx.moveTo(cx + x * R, cy - y * R); pen = true; } else pen = false; } };
      for (let lo = -180; lo < 180; lo += 15) { const pts = []; for (let la = -80; la <= 80; la += 4) pts.push([lo, la]); line(pts); }
      for (let la = -75; la <= 75; la += 15) { const pts = []; for (let lo = -180; lo <= 180; lo += 4) pts.push([lo, la]); line(pts); }
      ctx.stroke();
    }

    rings(list, P, R, cx, cy, fill, stroke, lw) {
      const { ctx } = this; ctx.beginPath();
      for (const r of list) {
        const n = r.length / 3; if (this.buf.length < n * 2) this.buf = new Float32Array(n * 2);
        let vis = false;
        for (let i = 0; i < n; i++) {
          let [x, y, z] = P(r[i * 3], r[i * 3 + 1], r[i * 3 + 2]);
          if (z > 0) vis = true; else { const m = Math.hypot(x, y) || 1; x /= m; y /= m; }   // hidden points slide to the horizon
          this.buf[i * 2] = cx + x * R; this.buf[i * 2 + 1] = cy - y * R;
        }
        if (!vis) continue;
        ctx.moveTo(this.buf[0], this.buf[1]);
        for (let i = 1; i < n; i++) ctx.lineTo(this.buf[i * 2], this.buf[i * 2 + 1]);
        ctx.closePath();
      }
      ctx.fillStyle = fill; ctx.fill();
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke(); }
    }

    arcFor(from, to) {
      const k = from + to; if (!this.arcs.has(k)) { const a = this.byCode[from], b = this.byCode[to]; this.arcs.set(k, a && b ? arc(a, b) : null); }
      return this.arcs.get(k);
    }
    screen(v, P, R, cx, cy) {
      const [x, y, z] = P(v[0], v[1], v[2]);
      return { x: cx + x * R, y: cy - y * R, vis: z > 0 || Math.hypot(x, y) > 1 };
    }
    strokeArc(a, P, R, cx, cy, upto = 1) {
      const { ctx } = this, last = Math.round((a.pts.length - 1) * upto); let pen = false;
      ctx.beginPath();
      for (let i = 0; i <= last; i++) { const s = this.screen(a.pts[i], P, R, cx, cy);
        if (s.vis) { pen ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); pen = true; } else pen = false; }
      ctx.stroke();
    }

    drawRoutes(t, P, R, cx, cy) {
      if (!this.byCode) return;
      const { ctx } = this, hl = this.hl, hov = this.hover, org = this.origin;
      ctx.lineCap = 'round';
      for (const r of this.routes) {
        if (hl && r.from === hl.from && r.to === hl.to) continue;
        const a = this.arcFor(r.from, r.to); if (!a) continue;
        const hot = (hov && org && r.from === org && r.to === hov);
        ctx.strokeStyle = hot ? 'rgba(232,204,122,0.95)' : (org && r.from !== org ? 'rgba(124,134,166,0.12)' : COLORS.route);
        ctx.lineWidth = hot ? 2 : 1; ctx.setLineDash(hot ? [] : [3, 4]);
        this.strokeArc(a, P, R, cx, cy);
      }
      ctx.setLineDash([]);
      if (!hl) return;
      const a = this.arcFor(hl.from, hl.to); if (!a) return;
      // glow + solid line
      ctx.strokeStyle = 'rgba(212,180,90,0.25)'; ctx.lineWidth = 6; this.strokeArc(a, P, R, cx, cy);
      ctx.strokeStyle = COLORS.gold; ctx.lineWidth = 2; this.strokeArc(a, P, R, cx, cy);
      // the plane
      const p = this.o.mini || this.reduce ? 0.55 : ((t / 4200) % 1);
      const n = a.pts.length - 1, i = Math.min(n - 1, Math.floor(p * n));
      const s1 = this.screen(a.pts[i], P, R, cx, cy), s2 = this.screen(a.pts[i + 1], P, R, cx, cy);
      if (s1.vis) {
        const ang = Math.atan2(s2.y - s1.y, s2.x - s1.x), sc = this.o.mini ? 0.75 : 1.15;
        ctx.save(); ctx.translate(s1.x, s1.y); ctx.rotate(ang); ctx.scale(sc, sc);
        ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(212,180,90,0.9)'; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(3, -1.6); ctx.lineTo(-1, -8); ctx.lineTo(-3.5, -8); ctx.lineTo(-1, -1.6);
        ctx.lineTo(-6, -1.4); ctx.lineTo(-8, -4.5); ctx.lineTo(-9.5, -4.5); ctx.lineTo(-8.3, 0); ctx.lineTo(-9.5, 4.5); ctx.lineTo(-8, 4.5);
        ctx.lineTo(-6, 1.4); ctx.lineTo(-1, 1.6); ctx.lineTo(-3.5, 8); ctx.lineTo(-1, 8); ctx.lineTo(3, 1.6); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }

    drawAirports(t, P, R, cx, cy) {
      const { ctx } = this; this.hits = [];
      const hl = this.hl || {}, showAll = this.o.labels && R > 380;
      const pulse = this.reduce || this.o.mini ? 0.5 : (t % 2000) / 2000;
      for (const a of this.airports) {
        const [x, y, z] = P(...vec(a.longitude, a.latitude)); if (z <= 0.02) continue;
        const sx = cx + x * R, sy = cy - y * R;
        const isOrg = a.code === this.origin || a.code === hl.from, isDst = a.code === hl.to, isHov = a.code === this.hover;
        const visited = this.visited && this.visited.includes(a.code);
        const key = isOrg || isDst || isHov || visited;
        this.hits.push({ code: a.code, x: sx, y: sy });
        if ((isOrg || isDst) && !this.o.mini) {
          ctx.strokeStyle = `rgba(212,180,90,${0.7 * (1 - pulse)})`; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(sx, sy, 5 + pulse * 13, 0, 7); ctx.stroke();
        }
        ctx.fillStyle = key ? COLORS.gold : COLORS.text;
        ctx.beginPath(); ctx.arc(sx, sy, this.o.mini ? 2.5 : (isOrg || isDst ? 5 : isHov ? 4.5 : 3.2), 0, 7); ctx.fill();
        if (key) { ctx.strokeStyle = '#0a0e1a'; ctx.lineWidth = 1.5; ctx.stroke(); }
        if (this.o.mini || !(showAll || key)) continue;
        ctx.font = `${key ? 600 : 500} ${key ? 12.5 : 11.5}px Inter, system-ui, sans-serif`;
        const pos = LABEL[a.code] || 'right', tw = ctx.measureText(a.city).width;
        let lx = sx + 9, ly = sy + 4; ctx.textAlign = 'left';
        if (pos === 'left') { lx = sx - 9; ctx.textAlign = 'right'; }
        if (pos === 'above') { lx = sx; ly = sy - 10; ctx.textAlign = 'center'; }
        if (pos === 'below') { lx = sx; ly = sy + 18; ctx.textAlign = 'center'; }
        ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(10,14,26,0.85)'; ctx.strokeText(a.city, lx, ly);
        ctx.fillStyle = key ? COLORS.gold : COLORS.text; ctx.fillText(a.city, lx, ly);
        void tw;
      }
    }

    /* ----- interaction: drag to rotate, pinch / Ctrl+wheel / buttons to zoom, click a city ----- */
    bind() {
      const c = this.c, pts = new Map();
      c.style.touchAction = 'none'; c.style.cursor = 'grab';
      const near = (x, y) => { let best = null, bd = 16; for (const h of this.hits) { const d = Math.hypot(h.x - x, h.y - y); if (d < bd) { bd = d; best = h.code; } } return best; };
      const local = e => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
      c.addEventListener('pointerdown', e => {
        pts.set(e.pointerId, local(e)); c.setPointerCapture(e.pointerId);
        this.drag = { moved: 0, pinch: pts.size === 2 ? null : undefined }; this.fly = null; this.spinPause = Infinity; c.style.cursor = 'grabbing';
      });
      c.addEventListener('pointermove', e => {
        const p = local(e);
        if (!this.drag) { const code = near(...p); c.style.cursor = code ? 'pointer' : 'grab'; if (code !== this.hover) { this.setHover(code); this.o.onHover && this.o.onHover(code); } return; }
        const prev = pts.get(e.pointerId); if (!prev) return; pts.set(e.pointerId, p);
        if (pts.size === 2) {
          const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
          if (this.drag.pinch) this.zoom = Math.max(this.o.minZoom, Math.min(this.o.maxZoom, this.zoom * d / this.drag.pinch));
          this.drag.pinch = d; this.drag.moved += 10; return this.kick();
        }
        const dx = p[0] - prev[0], dy = p[1] - prev[1]; this.drag.moved += Math.abs(dx) + Math.abs(dy);
        this.lon -= dx / this.R / RAD; this.lat = Math.max(-75, Math.min(80, this.lat + dy / this.R / RAD)); this.kick();
      });
      const up = e => {
        const p = local(e); pts.delete(e.pointerId);
        if (pts.size) return;
        const click = this.drag && this.drag.moved < 6; this.drag = null; c.style.cursor = 'grab';
        this.spinPause = performance.now() + 5000; this.kick();
        if (click) { const code = near(...p); if (code && this.o.onPick) this.o.onPick(code); }
      };
      c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
      c.addEventListener('pointerleave', () => { if (!this.drag && this.hover) { this.setHover(null); this.o.onHover && this.o.onHover(null); } });
      c.addEventListener('wheel', e => {
        if (!(e.ctrlKey || e.metaKey)) { if (this.o.onWheelHint) this.o.onWheelHint(); return; }
        e.preventDefault(); this.fly = null;
        this.zoom = Math.max(this.o.minZoom, Math.min(this.o.maxZoom, this.zoom * Math.exp(-e.deltaY * 0.002))); this.kick();
      }, { passive: false });
    }
  }

  // A small static globe for a booking card: just the route and a plane.
  Globe.mini = function (canvas, from, to, airports) {
    const g = new Globe(canvas, { interactive: false, mini: true, labels: false });
    g.set({ airports: airports.filter(a => a.code === from || a.code === to), hl: { from, to } });
    const ready = () => { g.focusRoute(from, to, 0); g.zoom = Math.min(g.zoom, 5); g.kick(); };
    requestAnimationFrame(ready);
    return g;
  };
  Globe.KZ_VIEW = KZ_VIEW;
  Globe.distanceKm = (a, b) => Math.round(6371 * Math.acos(Math.max(-1, Math.min(1, dot(vec(a.longitude, a.latitude), vec(b.longitude, b.latitude))))));
  window.Globe = Globe;
})();
