/* =====================================================================
   Samgau Earth — full-screen photo-realistic globe (WebGL, no libraries)
   - WebGL draws the planet: NASA Blue Marble texture, sunlight, ocean
     shine and a blue atmosphere glow.
   - A 2D canvas on top draws airports, flight arcs and the moving plane.
   - Falls back to the vector globe (globe.js) if WebGL is not available.

   const e = makeEarth(container, { onPick, onHover });
   e.set({ airports, routes, origin, hl, visited, spin });
   e.flyTo(lon, lat, zoom); e.focusRoute('IST', 'LHR'); e.home(); e.worldView();
   ===================================================================== */
(function () {
  const RAD = Math.PI / 180;
  const C = { cyan: '#38bdf8', cyan2: '#22d3ee', text: '#e2e8f0', dim: 'rgba(56,189,248,0.32)', faint: 'rgba(148,163,184,0.14)' };
  const KZ = { lon: 67, lat: 47, zoom: 2.3 };
  const vec = (lon, lat) => { const l = lon * RAD, p = lat * RAD, c = Math.cos(p); return [c * Math.cos(l), c * Math.sin(l), Math.sin(p)]; };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const toLL = v => [Math.atan2(v[1], v[0]) / RAD, Math.asin(Math.max(-1, Math.min(1, v[2]))) / RAD];
  const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(vec(a.longitude, a.latitude), vec(b.longitude, b.latitude)))));

  const VS = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
  const FS = `
precision highp float;
uniform vec2 u_center; uniform float u_radius;
uniform vec3 u_rx, u_ry, u_rz; uniform vec3 u_sun;
uniform sampler2D u_tex, u_water; uniform float u_ready;
const float PI = 3.141592653589793;
void main() {
  vec2 p = (gl_FragCoord.xy - u_center) / u_radius;
  float r2 = dot(p, p);
  if (r2 > 1.0) {                                   // atmosphere halo outside the planet
    float d = sqrt(r2) - 1.0;
    float a = exp(-d * 18.0) * 0.55 + exp(-d * 5.0) * 0.12;
    gl_FragColor = vec4(vec3(0.33, 0.62, 1.0) * a, a);
    return;
  }
  float z = sqrt(1.0 - r2);
  vec3 n = vec3(p, z);                               // surface normal in view space
  vec3 w = u_rx * n.x + u_ry * n.y + u_rz * n.z;     // same point in world space
  float lon = atan(w.y, w.x), lat = asin(clamp(w.z, -1.0, 1.0));
  vec2 uv = vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI);
  vec3 col = u_ready > 0.5 ? texture2D(u_tex, uv).rgb : vec3(0.05, 0.12, 0.25);
  float water = u_ready > 0.5 ? texture2D(u_water, uv).r : 0.0;
  float diff = max(dot(n, u_sun), 0.0);
  col *= 0.38 + 0.82 * diff;
  vec3 h = normalize(u_sun + vec3(0.0, 0.0, 1.0));
  col += vec3(0.75, 0.85, 1.0) * pow(max(dot(n, h), 0.0), 60.0) * water * 0.55;
  float rim = pow(1.0 - z, 2.6);
  col = mix(col, vec3(0.35, 0.65, 1.0), rim * 0.65);
  gl_FragColor = vec4(col, 1.0);
}`;

  function arcPts(a, b, n = 72) {
    const A = vec(a.longitude, a.latitude), B = vec(b.longitude, b.latitude);
    const w = Math.acos(Math.max(-1, Math.min(1, dot(A, B)))) || 1e-6, s = Math.sin(w);
    const h = Math.min(0.32, 0.025 + w * 0.13), pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, k1 = Math.sin((1 - t) * w) / s, k2 = Math.sin(t * w) / s, lift = 1 + h * Math.sin(Math.PI * t);
      pts.push([(k1 * A[0] + k2 * B[0]) * lift, (k1 * A[1] + k2 * B[1]) * lift, (k1 * A[2] + k2 * B[2]) * lift]);
    }
    return pts;
  }

  class Earth {
    constructor(container, opts = {}) {
      this.box = container; this.o = Object.assign({ minZoom: 0.6, maxZoom: 9 }, opts);
      this.gc = document.createElement('canvas'); this.oc = document.createElement('canvas');
      for (const c of [this.gc, this.oc]) { c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'; container.append(c); }
      this.oc.setAttribute('role', 'img'); this.oc.setAttribute('aria-label', 'Interactive globe with flight routes');
      const gl = this.gc.getContext('webgl', { antialias: true, premultipliedAlpha: true, alpha: true });
      if (!gl) throw new Error('no webgl');
      this.gl = gl; this.ctx = this.oc.getContext('2d');
      this.initGL();
      this.lon = 40; this.lat = 30; this.zoom = 1;
      this.airports = []; this.byCode = {}; this.routes = []; this.origin = null; this.hl = null; this.hover = null; this.visited = null;
      this.arcs = new Map(); this.hits = []; this.spinOn = false; this.spinPause = 0; this.offX = 0; this.offT = 0;
      this.reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      new ResizeObserver(() => this.resize()).observe(container);
      this.bind(); this.resize();
    }

    initGL() {
      const gl = this.gl;
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error('link');
      gl.useProgram(pr); this.pr = pr;
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      this.u = {}; ['u_center', 'u_radius', 'u_rx', 'u_ry', 'u_rz', 'u_sun', 'u_tex', 'u_water', 'u_ready'].forEach(n => this.u[n] = gl.getUniformLocation(pr, n));
      gl.uniform1i(this.u.u_tex, 0); gl.uniform1i(this.u.u_water, 1); gl.uniform1f(this.u.u_ready, 0);
      const s = [-0.35, 0.45, 0.82], m = Math.hypot(...s); gl.uniform3f(this.u.u_sun, s[0] / m, s[1] / m, s[2] / m);
      let loaded = 0;
      const tex = (unit, url) => {
        const t = gl.createTexture(), img = new Image();
        img.onload = () => {
          gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          if (++loaded === 2) { gl.uniform1f(this.u.u_ready, 1); this.kick(); this.o.onReady && this.o.onReady(); }
        };
        img.src = url;
      };
      tex(0, '/img/earth.jpg'); tex(1, '/img/water.jpg');
    }

    /* ----- public API ----- */
    set(d) {
      if (d.airports) { this.airports = d.airports; this.byCode = Object.fromEntries(d.airports.map(a => [a.code, a])); this.arcs.clear(); }
      ['routes', 'origin', 'hl', 'visited'].forEach(k => { if (k in d) this[k] = d[k]; });
      if ('spin' in d) this.spinOn = d.spin && !this.reduce;
      this.kick(); return this;
    }
    setOffset(px) { this.offT = px; this.kick(); }    // move the planet sideways (e.g. away from a wide panel)
    setHover(code) { if (code !== this.hover) { this.hover = code; this.kick(); } }
    flyTo(lon, lat, zoom = this.zoom, dur = 1300) {
      zoom = Math.max(this.o.minZoom, Math.min(this.o.maxZoom, zoom));
      if (this.reduce || !dur) { this.lon = lon; this.lat = lat; this.zoom = zoom; this.fly = null; return this.kick(); }
      this.fly = { t0: performance.now(), dur, lon0: this.lon, lat0: this.lat, z0: this.zoom, dl: ((lon - this.lon + 540) % 360) - 180, lat1: lat, z1: zoom };
      this.kick();
    }
    flyToAirport(code, zoom, dur) { const a = this.byCode[code]; if (a) this.flyTo(+a.longitude, Math.max(-50, Math.min(60, +a.latitude - 6)), zoom ?? Math.max(this.zoom, 1.25), dur); }
    home(dur) { this.flyTo(KZ.lon, KZ.lat, KZ.zoom, dur); }
    worldView(dur) { this.flyTo(this.lon, 25, 1, dur); }
    zoomBy(f) { this.flyTo(this.lon, this.lat, this.zoom * f, 350); }
    focusRoute(from, to, dur) {
      const a = this.byCode[from], b = this.byCode[to]; if (!a || !b) return;
      const A = vec(+a.longitude, +a.latitude), B = vec(+b.longitude, +b.latitude);
      const m = [A[0] + B[0], A[1] + B[1], A[2] + B[2]], n = Math.hypot(...m) || 1;
      const [lon, lat] = toLL(m.map(x => x / n)), w = angle(a, b);
      this.flyTo(lon, lat - 4, Math.max(1, Math.min(4.2, 1.05 / (w + 0.08))), dur);
    }

    /* ----- loop ----- */
    resize() {
      const r = this.box.getBoundingClientRect(); if (!r.width || !r.height) return;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2); this.w = r.width; this.h = r.height;
      for (const c of [this.gc, this.oc]) { c.width = Math.round(r.width * this.dpr); c.height = Math.round(r.height * this.dpr); }
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.gl.viewport(0, 0, this.gc.width, this.gc.height);
      this.frame(performance.now());
    }
    get R() { return Math.min(this.w * 0.42, this.h * 0.45) * this.zoom; }
    kick() { if (!this.raf) this.raf = requestAnimationFrame(t => { this.raf = 0; this.frame(t); }); }
    frame(t) {
      if (!this.w) return;
      const dt = Math.min(64, t - (this.last || t)); this.last = t;
      if (this.fly) {
        const f = this.fly, p = Math.min(1, (t - f.t0) / f.dur), e = ease(p);
        this.lon = f.lon0 + f.dl * e; this.lat = f.lat0 + (f.lat1 - f.lat0) * e; this.zoom = f.z0 + (f.z1 - f.z0) * e;
        if (p >= 1) this.fly = null;
      } else if (this.spinOn && !this.drag && t > this.spinPause) this.lon += dt * 0.004;
      this.offX += (this.offT - this.offX) * Math.min(1, dt / 160);
      this.draw(t);
      if (!document.hidden) this.kick();
    }

    draw(t) {
      const { gl, w, h, dpr } = this, R = this.R, cx = w / 2 + this.offX, cy = h / 2;
      const l0 = this.lon * RAD, p0 = this.lat * RAD, cl = Math.cos(l0), sl = Math.sin(l0), c0 = Math.cos(p0), s0 = Math.sin(p0);
      // rows of the world→view rotation (x right, y up, z towards the viewer)
      gl.uniform3f(this.u.u_rx, -sl, cl, 0); gl.uniform3f(this.u.u_ry, -s0 * cl, -s0 * sl, c0); gl.uniform3f(this.u.u_rz, c0 * cl, c0 * sl, s0);
      gl.uniform2f(this.u.u_center, cx * dpr, (h - cy) * dpr); gl.uniform1f(this.u.u_radius, R * dpr);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES, 0, 6);

      const P = (X, Y, Z) => { const A = X * cl + Y * sl; return [Y * cl - X * sl, c0 * Z - s0 * A, s0 * Z + c0 * A]; };
      const ctx = this.ctx; ctx.clearRect(0, 0, w, h);
      this.drawRoutes(ctx, t, P, R, cx, cy);
      this.drawAirports(ctx, t, P, R, cx, cy);
    }

    scr(v, P, R, cx, cy) { const [x, y, z] = P(v[0], v[1], v[2]); return { x: cx + x * R, y: cy - y * R, vis: z > 0 || Math.hypot(x, y) > 1.0 }; }
    arc(from, to) {
      const k = from + to;
      if (!this.arcs.has(k)) { const a = this.byCode[from], b = this.byCode[to]; this.arcs.set(k, a && b ? arcPts({ longitude: +a.longitude, latitude: +a.latitude }, { longitude: +b.longitude, latitude: +b.latitude }) : null); }
      return this.arcs.get(k);
    }
    stroke(ctx, pts, P, R, cx, cy, from = 0, to = 1) {
      const n = pts.length - 1; let pen = false; ctx.beginPath();
      for (let i = Math.floor(from * n); i <= Math.ceil(to * n); i++) {
        const s = this.scr(pts[i], P, R, cx, cy);
        if (s.vis) { pen ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); pen = true; } else pen = false;
      }
      ctx.stroke();
    }
    drawRoutes(ctx, t, P, R, cx, cy) {
      const hl = this.hl; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const r of this.routes) {
        if (hl && r.from === hl.from && r.to === hl.to) continue;
        const pts = this.arc(r.from, r.to); if (!pts) continue;
        const hot = this.hover && this.origin && r.from === this.origin && r.to === this.hover;
        ctx.strokeStyle = hot ? 'rgba(125,211,252,0.95)' : (this.origin && r.from !== this.origin ? C.faint : C.dim);
        ctx.lineWidth = hot ? 2.2 : 1.2; this.stroke(ctx, pts, P, R, cx, cy);
      }
      if (!hl) return;
      const pts = this.arc(hl.from, hl.to); if (!pts) return;
      ctx.strokeStyle = 'rgba(56,189,248,0.25)'; ctx.lineWidth = 9; this.stroke(ctx, pts, P, R, cx, cy);
      ctx.strokeStyle = C.cyan; ctx.lineWidth = 3; this.stroke(ctx, pts, P, R, cx, cy);
      // a bright comet travels along the arc, the plane rides at its head
      const p = this.reduce ? 0.6 : (t / 5200) % 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2.4; this.stroke(ctx, pts, P, R, cx, cy, Math.max(0, p - 0.12), p);
      const n = pts.length - 1, i = Math.min(n - 1, Math.floor(p * n));
      const a = this.scr(pts[i], P, R, cx, cy), b = this.scr(pts[i + 1], P, R, cx, cy);
      if (a.vis) {
        ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(Math.atan2(b.y - a.y, b.x - a.x)); ctx.scale(1.3, 1.3);
        ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(56,189,248,1)'; ctx.shadowBlur = 14;
        ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(3, -1.6); ctx.lineTo(-1, -8); ctx.lineTo(-3.5, -8); ctx.lineTo(-1, -1.6);
        ctx.lineTo(-6, -1.4); ctx.lineTo(-8, -4.5); ctx.lineTo(-9.5, -4.5); ctx.lineTo(-8.3, 0); ctx.lineTo(-9.5, 4.5); ctx.lineTo(-8, 4.5);
        ctx.lineTo(-6, 1.4); ctx.lineTo(-1, 1.6); ctx.lineTo(-3.5, 8); ctx.lineTo(-1, 8); ctx.lineTo(3, 1.6); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
    drawAirports(ctx, t, P, R, cx, cy) {
      this.hits = [];
      const hl = this.hl || {}, showAll = R > 700, pulse = this.reduce ? 0.5 : (t % 2200) / 2200;
      const placed = [];
      const list = [...this.airports].sort((a, b) => this.rank(b, hl) - this.rank(a, hl));   // key cities get labels first
      for (const a of list) {
        const [x, y, z] = P(...vec(+a.longitude, +a.latitude)); if (z <= 0.05) continue;
        const sx = cx + x * R, sy = cy - y * R;
        const end = a.code === hl.from || a.code === hl.to || a.code === this.origin;
        const hov = a.code === this.hover, vis = this.visited && this.visited.includes(a.code);
        const key = end || hov || vis;
        this.hits.push({ code: a.code, x: sx, y: sy });
        if (end) {
          ctx.strokeStyle = `rgba(56,189,248,${0.8 * (1 - pulse)})`; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(sx, sy, 5 + pulse * 16, 0, 7); ctx.stroke();
        }
        ctx.fillStyle = key ? C.cyan : 'rgba(226,232,240,0.85)';
        ctx.shadowColor = 'rgba(56,189,248,0.9)'; ctx.shadowBlur = key ? 10 : 4;
        ctx.beginPath(); ctx.arc(sx, sy, end ? 5.5 : hov ? 5 : 3.2, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
        if (key) { ctx.strokeStyle = '#0b1220'; ctx.lineWidth = 1.5; ctx.stroke(); }
        if (!key && (z < 0.25 || sy < 70)) continue;                     // no labels squeezed against the horizon
        if (!(showAll || key || R > 420 && a.region !== 'Kazakhstan')) continue;
        ctx.font = `${key ? 600 : 500} ${key ? 13 : 11.5}px Inter, system-ui, sans-serif`;
        const label = key ? `${a.city} · ${a.code}` : a.city, tw = ctx.measureText(label).width;
        let lx = sx + 10, ly = sy + 4;
        const box = () => ({ x: lx - 3, y: ly - 12, w: tw + 6, h: 16 });
        const hit = b => placed.some(q => b.x < q.x + q.w && b.x + b.w > q.x && b.y < q.y + q.h && b.y + b.h > q.y);
        if (hit(box())) { lx = sx - 10 - tw; if (hit(box())) { lx = sx - tw / 2; ly = sy - 12; if (hit(box())) { lx = sx - tw / 2; ly = sy + 20; if (hit(box()) && !key) continue; } } }
        placed.push(box());
        ctx.textAlign = 'left'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(2,6,23,0.85)'; ctx.strokeText(label, lx, ly);
        ctx.fillStyle = key ? '#bae6fd' : C.text; ctx.fillText(label, lx, ly);
      }
    }
    rank(a, hl) { return (a.code === hl.from || a.code === hl.to) * 4 + (a.code === this.origin) * 3 + (a.code === this.hover) * 2 + (this.visited && this.visited.includes(a.code) ? 1 : 0); }

    /* ----- interaction ----- */
    bind() {
      const c = this.oc, pts = new Map();
      c.style.touchAction = 'none'; c.style.cursor = 'grab';
      const near = (x, y) => { let best = null, bd = 18; for (const h of this.hits) { const d = Math.hypot(h.x - x, h.y - y); if (d < bd) { bd = d; best = h.code; } } return best; };
      const loc = e => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
      c.addEventListener('pointerdown', e => { pts.set(e.pointerId, loc(e)); c.setPointerCapture(e.pointerId);
        this.drag = { moved: 0, pinch: null }; this.fly = null; this.spinPause = Infinity; c.style.cursor = 'grabbing'; });
      c.addEventListener('pointermove', e => {
        const p = loc(e);
        if (!this.drag) { const code = near(...p); c.style.cursor = code ? 'pointer' : 'grab';
          if (code !== this.hover) { this.setHover(code); this.o.onHover && this.o.onHover(code); } return; }
        const prev = pts.get(e.pointerId); if (!prev) return; pts.set(e.pointerId, p);
        if (pts.size === 2) { const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
          if (this.drag.pinch) this.zoom = Math.max(this.o.minZoom, Math.min(this.o.maxZoom, this.zoom * d / this.drag.pinch));
          this.drag.pinch = d; this.drag.moved += 10; return; }
        const dx = p[0] - prev[0], dy = p[1] - prev[1]; this.drag.moved += Math.abs(dx) + Math.abs(dy);
        this.lon -= dx / this.R / RAD; this.lat = Math.max(-80, Math.min(80, this.lat + dy / this.R / RAD));
      });
      const up = e => { const p = loc(e); pts.delete(e.pointerId); if (pts.size) return;
        const click = this.drag && this.drag.moved < 6; this.drag = null; c.style.cursor = 'grab'; this.spinPause = performance.now() + 6000;
        if (click) { const code = near(...p); if (code && this.o.onPick) this.o.onPick(code); } };
      c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
      c.addEventListener('pointerleave', () => { if (!this.drag && this.hover) { this.setHover(null); this.o.onHover && this.o.onHover(null); } });
      c.addEventListener('wheel', e => {
        if (this.o.wheelNeedsCtrl && this.o.wheelNeedsCtrl() && !e.ctrlKey) return;
        e.preventDefault(); this.fly = null;
        this.zoom = Math.max(this.o.minZoom, Math.min(this.o.maxZoom, this.zoom * Math.exp(-e.deltaY * 0.0015)));
      }, { passive: false });
    }
  }

  window.makeEarth = function (container, opts) {
    try { return new Earth(container, opts); }
    catch (err) {                                    // no WebGL: use the vector globe instead
      console.warn('WebGL globe unavailable, using vector globe:', err.message);
      container.innerHTML = '';
      const c = document.createElement('canvas'); c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
      container.append(c);
      const g = new window.Globe(c, { onPick: opts.onPick, onHover: opts.onHover, view: { lon: 60, lat: 35, zoom: 1 } });
      g.flyToAirport = (code, zoom, dur) => { const a = g.byCode && g.byCode[code]; if (a) g.flyTo(+a.longitude, +a.latitude - 6, zoom ?? Math.max(g.zoom, 1.25), dur); };
      return g;
    }
  };
  window.distanceKm = (a, b) => Math.round(6371 * angle({ longitude: +a.longitude, latitude: +a.latitude }, { longitude: +b.longitude, latitude: +b.latitude }));
})();
