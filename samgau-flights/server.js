/* =====================================================================
   Samgau Flights — backend (Express + PostgreSQL)
   Start:  npm start         → http://localhost:3000
   Needs:  a .env file (copy .env.example) and `npm run db:setup` once.
   ===================================================================== */
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');

// Load .env (works on every Node version: uses process.loadEnvFile when available)
try {
  if (process.loadEnvFile) process.loadEnvFile(path.join(__dirname, '.env'));
  else require('fs').readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach(l => {
    const m = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch { /* no .env file: use real environment variables */ }

const express = require('express');
const { Pool, types } = require('pg');

// Return NUMERIC and COUNT(*) as JS numbers instead of strings.
types.setTypeParser(1700, v => (v === null ? null : parseFloat(v)));
types.setTypeParser(20, v => (v === null ? null : parseInt(v, 10)));

// pg reads PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE from the environment,
// or DATABASE_URL if you prefer one connection string.
const pool = new Pool(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});

const PORT = Number(process.env.PORT) || 3000;
const SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.TOKEN_SECRET) console.warn('⚠  TOKEN_SECRET not set in .env — everyone is signed out when the server restarts.');

// Business rules shared with the front end through GET /api/config
const CONFIG = { currency: '₸', bag_price_per_kg: 500, max_bag_kg: 40, max_passengers: 9 };

/* ---------- passwords (scrypt) and login tokens (HMAC-signed) ---------- */
const scrypt = promisify(crypto.scrypt);
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$${salt.toString('hex')}$${key.toString('hex')}`;
}
async function checkPassword(pw, stored) {
  const [alg, n, saltHex, keyHex] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const key = await scrypt(pw, Buffer.from(saltHex, 'hex'), 64, { N: Number(n), r: 8, p: 1 });
  return crypto.timingSafeEqual(key, Buffer.from(keyHex, 'hex'));
}
const b64 = s => Buffer.from(s).toString('base64url');
function signToken(user) {
  const body = b64(JSON.stringify({ uid: user.user_id, pid: user.passenger_id, exp: Date.now() + 7 * 864e5 }));
  return body + '.' + crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
}
function readToken(token) {
  const [body, sig] = String(token).split('.');
  if (!body || !sig) return null;
  const good = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  const data = JSON.parse(Buffer.from(body, 'base64url').toString());
  return data.exp > Date.now() ? data : null;
}

/* ---------- helpers ---------- */
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };

// Wrap async route handlers: known errors → their status, everything else → 500.
const h = fn => (req, res) => fn(req, res).catch(e => {
  if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
  console.error(e);
  res.status(500).json({ error: 'Server error — check the server console' });
});

const auth = (req, res, next) => {
  const t = (req.headers.authorization || '').replace(/^Bearer /, '');
  const u = t && readToken(t);
  if (!u) return res.status(401).json({ error: 'Please sign in' });
  req.u = u; next();
};

// Only for staff accounts (APP_USER.role = 'admin').
const adminOnly = (req, res, next) => pool.query('SELECT role FROM APP_USER WHERE user_id = $1', [req.u.uid])
  .then(r => (r.rows[0] && r.rows[0].role === 'admin' ? next() : res.status(403).json({ error: 'Admins only' })))
  .catch(() => res.status(500).json({ error: 'Server error' }));

// Run several queries in one transaction; rolls back on any error.
async function tx(fn) {
  const c = await pool.connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
  finally { c.release(); }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[\d\s()-]{7,20}$/;
const clean = v => String(v ?? '').trim();
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');

async function profile(pid) {
  const { rows } = await pool.query(`
    SELECT p.passenger_id, p.first_name, p.last_name, p.email, p.phone, p.document_number, u.role,
           to_char(u.created_at, 'YYYY-MM-DD') AS member_since
    FROM PASSENGER p JOIN APP_USER u ON u.passenger_id = p.passenger_id
    WHERE p.passenger_id = $1`, [pid]);
  return rows[0];
}

/* ---------- app ---------- */
const app = express();
app.use(express.json({ limit: '100kb' }));
// no-cache = the browser must check for a newer file every time, so updates show up immediately
app.use(express.static(path.join(__dirname, 'public'), { setHeaders: res => res.setHeader('Cache-Control', 'no-cache') }));

app.get('/api/health', h(async (_req, res) => {
  const { rows } = await pool.query(`SELECT current_database() AS db,
    (SELECT COUNT(*) FROM FLIGHT) AS flights, (SELECT COUNT(*) FROM BOOKING) AS bookings`);
  res.json({ ok: true, ...rows[0] });
}));

app.get('/api/config', (_req, res) => res.json(CONFIG));

/* ----- auth ----- */
app.post('/api/register', h(async (req, res) => {
  const first = clean(req.body.first_name), last = clean(req.body.last_name);
  const email = clean(req.body.email).toLowerCase(), phone = clean(req.body.phone);
  const password = String(req.body.password || '');
  if (!first || !last) fail(400, 'Enter your first and last name');
  if (!EMAIL.test(email)) fail(400, 'Enter a valid email');
  if (phone && !PHONE.test(phone)) fail(400, 'Enter a valid phone number');
  if (password.length < 8) fail(400, 'Password needs at least 8 characters');

  const hash = await hashPassword(password);
  try {
    const user = await tx(async c => {
      const p = await c.query(
        `INSERT INTO PASSENGER (first_name, last_name, email, phone) VALUES ($1,$2,$3,$4) RETURNING passenger_id`,
        [first, last, email, phone || null]);
      const u = await c.query(
        `INSERT INTO APP_USER (email, password_hash, passenger_id) VALUES ($1,$2,$3) RETURNING user_id, passenger_id`,
        [email, hash, p.rows[0].passenger_id]);
      return u.rows[0];
    });
    res.status(201).json({ token: signToken(user), user: await profile(user.passenger_id) });
  } catch (e) {
    if (e.code === '23505') fail(409, 'This email is already registered — sign in instead');
    throw e;
  }
}));

app.post('/api/login', h(async (req, res) => {
  const email = clean(req.body.email).toLowerCase();
  const { rows } = await pool.query('SELECT user_id, passenger_id, password_hash FROM APP_USER WHERE email = $1', [email]);
  const u = rows[0];
  if (!u || !(await checkPassword(String(req.body.password || ''), u.password_hash))) fail(401, 'Wrong email or password');
  res.json({ token: signToken(u), user: await profile(u.passenger_id) });
}));

/* ----- profile ----- */
app.get('/api/me', auth, h(async (req, res) => {
  const user = await profile(req.u.pid);
  if (!user) fail(401, 'Please sign in');
  const { rows } = await pool.query(`
    SELECT COUNT(DISTINCT b.booking_ref) FILTER (WHERE f.departure_utc >  (now() AT TIME ZONE 'UTC')) AS upcoming,
           COUNT(DISTINCT b.booking_ref) FILTER (WHERE f.departure_utc <= (now() AT TIME ZONE 'UTC')) AS completed,
           COALESCE(SUM(b.total_price), 0) AS spent,
           COUNT(DISTINCT f.destination) AS cities
    FROM BOOKING b JOIN FLIGHT f ON f.flight_id = b.flight_id
    WHERE b.user_id = $1 AND b.status <> 'Cancelled'`, [req.u.uid]);
  res.json({ ...user, stats: rows[0] });
}));

app.put('/api/me', auth, h(async (req, res) => {
  const first = clean(req.body.first_name), last = clean(req.body.last_name);
  const phone = clean(req.body.phone), doc = clean(req.body.document_number);
  if (!first || !last) fail(400, 'Enter your first and last name');
  if (phone && !PHONE.test(phone)) fail(400, 'Enter a valid phone number');
  if (doc.length > 20) fail(400, 'Document number is too long');
  await pool.query(
    `UPDATE PASSENGER SET first_name = $1, last_name = $2, phone = $3, document_number = $4 WHERE passenger_id = $5`,
    [first, last, phone || null, doc || null, req.u.pid]);
  res.json(await profile(req.u.pid));
}));

app.post('/api/me/password', auth, h(async (req, res) => {
  const { current_password, new_password } = req.body;
  if (String(new_password || '').length < 8) fail(400, 'New password needs at least 8 characters');
  const { rows } = await pool.query('SELECT password_hash FROM APP_USER WHERE user_id = $1', [req.u.uid]);
  if (!rows[0] || !(await checkPassword(String(current_password || ''), rows[0].password_hash))) fail(400, 'Current password is wrong');
  await pool.query('UPDATE APP_USER SET password_hash = $1 WHERE user_id = $2', [await hashPassword(new_password), req.u.uid]);
  res.json({ ok: true });
}));

/* ----- reference data ----- */
app.get('/api/airports', h(async (_req, res) =>
  res.json((await pool.query('SELECT code, city, name, country, region, latitude, longitude, utc_offset FROM AIRPORT ORDER BY region <> \'Kazakhstan\', region, city')).rows)));

// Every route we fly in the next 30 days, with its cheapest fare — drives the globe and destination list.
app.get('/api/routes', h(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT f.origin AS "from", f.destination AS "to",
           MIN(f.price) AS min_price,
           COUNT(*) FILTER (WHERE f.departure_utc < (now() AT TIME ZONE 'UTC') + interval '7 days') AS flights_week,
           ROUND(AVG(EXTRACT(EPOCH FROM f.arrival_utc - f.departure_utc) / 60))::int AS minutes,
           array_agg(DISTINCT f.airline ORDER BY f.airline) AS airlines
    FROM FLIGHT f
    WHERE f.departure_utc > (now() AT TIME ZONE 'UTC') AND f.departure_utc < (now() AT TIME ZONE 'UTC') + interval '30 days'
      AND f.status <> 'Cancelled'
    GROUP BY f.origin, f.destination
    ORDER BY f.origin, min_price`);
  res.json(rows);
}));

app.get('/api/payment-methods', h(async (_req, res) =>
  res.json((await pool.query(
    'SELECT payment_id AS payment_method_id, method_name, description FROM PAYMENT_METHOD ORDER BY payment_id')).rows)));

/* ----- flights ----- */
// Seats left per class, counted live from BOOKING (cancelled bookings free the seat).
const AVAILABILITY = `
  CROSS JOIN LATERAL (
    SELECT COUNT(*) FILTER (WHERE s.class = 'Economy')  AS eco_total,
           COUNT(*) FILTER (WHERE s.class = 'Business') AS biz_total,
           COUNT(*) FILTER (WHERE s.class = 'Economy'  AND NOT EXISTS (SELECT 1 FROM BOOKING b
               WHERE b.flight_id = f.flight_id AND b.seat_id = s.seat_id AND b.status <> 'Cancelled')) AS eco_left,
           COUNT(*) FILTER (WHERE s.class = 'Business' AND NOT EXISTS (SELECT 1 FROM BOOKING b
               WHERE b.flight_id = f.flight_id AND b.seat_id = s.seat_id AND b.status <> 'Cancelled')) AS biz_left
    FROM SEAT s WHERE s.aircraft_id = f.aircraft_id AND s.status = 'Available'
  ) av`;

app.get('/api/flights', auth, h(async (req, res) => {
  const { from, to, date } = req.query;
  const cabin = req.query.cabin === 'Business' ? 'Business' : 'Economy';
  if (!from || !to || !isDate(date)) fail(400, 'Choose where from, where to and a date');
  if (from === to) fail(400, 'Departure and arrival airports must differ');

  const { rows } = await pool.query(`
    SELECT f.flight_id, f.flight_number, f.airline, f.origin, f.destination, f.status,
           to_char(f.departure_time, 'HH24:MI') AS departure_time,
           to_char(f.arrival_time,   'HH24:MI') AS arrival_time,
           (f.arrival_time::date - f.departure_time::date) AS day_offset,
           (EXTRACT(EPOCH FROM f.arrival_utc - f.departure_utc) / 60)::int AS minutes,
           f.price, f.business_price, a.model, a.manufacturer, g.gate_number, g.terminal, l.airline_code,
           (oa.region <> 'Kazakhstan' OR da.region <> 'Kazakhstan') AS international, av.*
    FROM FLIGHT f
    JOIN AIRCRAFT a  ON a.aircraft_id = f.aircraft_id
    JOIN AIRLINE l   ON l.name = f.airline
    JOIN AIRPORT oa  ON oa.code = f.origin
    JOIN AIRPORT da  ON da.code = f.destination
    LEFT JOIN GATE g ON g.gate_id = f.gate_id
    ${AVAILABILITY}
    WHERE f.origin = $1 AND f.destination = $2 AND f.departure_time::date = $3::date
      AND f.departure_utc > (now() AT TIME ZONE 'UTC') AND f.status <> 'Cancelled'
    ORDER BY f.departure_time`, [from, to, date]);

  res.json(rows
    .filter(r => cabin === 'Economy' || r.biz_total > 0)          // hide planes without a Business cabin
    .map(r => ({
      flight_id: r.flight_id, flight_number: r.flight_number, airline: r.airline, airline_code: r.airline_code, international: r.international,
      origin: r.origin, destination: r.destination, status: r.status,
      departure_time: r.departure_time, arrival_time: r.arrival_time, day_offset: r.day_offset,
      minutes: r.minutes, duration: r.minutes >= 60 ? `${Math.floor(r.minutes / 60)}h ${String(r.minutes % 60).padStart(2, '0')}m` : `${r.minutes}m`,
      aircraft: { model: r.model, manufacturer: r.manufacturer },
      gate: { gate_number: r.gate_number || 'TBA', terminal: r.terminal || '' },
      cabin, price: cabin === 'Business' ? r.business_price : r.price,
      prices: { Economy: r.price, Business: r.biz_total > 0 ? r.business_price : null },
      seats_left: cabin === 'Business' ? r.biz_left : r.eco_left,
      // free checked baggage included in the fare
      bag_allowance: cabin === 'Business' ? (r.model === 'A380-800' ? 40 : 32) : r.airline === 'FlyArystan' ? 0 : r.international ? 23 : 20
    })));
}));

// Cheapest fare for each day around the chosen date (the date strip above results).
app.get('/api/flights/calendar', auth, h(async (req, res) => {
  const { from, to, date } = req.query;
  if (!from || !to || !isDate(date)) fail(400, 'Missing route or date');
  const biz = req.query.cabin === 'Business';
  const { rows } = await pool.query(`
    SELECT to_char(d, 'YYYY-MM-DD') AS date, MIN(${biz ? 'f.business_price' : 'f.price'}) AS min_price, COUNT(f.flight_id) AS flights
    FROM generate_series($3::date - 3, $3::date + 3, interval '1 day') d
    LEFT JOIN FLIGHT f ON f.origin = $1 AND f.destination = $2 AND f.departure_time::date = d::date
         AND f.departure_utc > (now() AT TIME ZONE 'UTC') AND f.status <> 'Cancelled'
         ${biz ? `AND EXISTS (SELECT 1 FROM SEAT s WHERE s.aircraft_id = f.aircraft_id AND s.class = 'Business')` : ''}
    GROUP BY d ORDER BY d`, [from, to, date]);
  res.json(rows);
}));

app.get('/api/flights/:id/seats', auth, h(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) fail(400, 'Bad flight id');
  const f = await pool.query(`
    SELECT f.flight_id, f.price, f.business_price, a.seat_letters, a.seat_rows, a.business_rows, a.model, a.manufacturer
    FROM FLIGHT f JOIN AIRCRAFT a ON a.aircraft_id = f.aircraft_id WHERE f.flight_id = $1`, [id]);
  if (!f.rowCount) fail(404, 'Flight not found');
  const { rows } = await pool.query(`
    SELECT s.seat_id, s.seat_number, s.class,
           substring(s.seat_number FROM '^\\d+')::int AS row, substring(s.seat_number FROM '[A-Z]$') AS letter,
           CASE WHEN s.status = 'Blocked' THEN 'BLOCKED'
                WHEN EXISTS (SELECT 1 FROM BOOKING b WHERE b.flight_id = $1 AND b.seat_id = s.seat_id AND b.status <> 'Cancelled')
                THEN 'TAKEN' ELSE 'FREE' END AS status
    FROM SEAT s JOIN FLIGHT f ON f.aircraft_id = s.aircraft_id
    WHERE f.flight_id = $1
    ORDER BY row, letter`, [id]);
  res.json({ ...f.rows[0], seats: rows });
}));

/* ----- payments ----- */
// Created automatically on start, so an existing database gets the table without re-running setup.
const PAYMENT_DDL = `
CREATE TABLE IF NOT EXISTS PAYMENT (
    transaction_id INT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    booking_ref    CHAR(6)       NOT NULL,
    user_id        INT REFERENCES APP_USER(user_id) ON DELETE SET NULL,
    payment_id     INT REFERENCES PAYMENT_METHOD(payment_id),
    amount         NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    currency       CHAR(3)       NOT NULL DEFAULT 'KZT',
    status         VARCHAR(20)   NOT NULL CHECK (status IN ('Paid','Pending','Refunded','Cancelled')),
    card_brand     VARCHAR(20),
    card_last4     CHAR(4),
    payer_phone    VARCHAR(20),
    auth_code      VARCHAR(12),
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_payment_ref  ON PAYMENT (booking_ref);
CREATE INDEX IF NOT EXISTS ix_payment_user ON PAYMENT (user_id);`;

const kindOf = name => (/card/i.test(name) ? 'card' : /kaspi/i.test(name) ? 'kaspi' : /cash/i.test(name) ? 'cash' : 'wallet');
const luhn = num => { let sum = 0; [...num].reverse().forEach((d, i) => { let n = +d; if (i % 2) { n *= 2; if (n > 9) n -= 9; } sum += n; }); return sum % 10 === 0; };
const cardBrand = n => (/^4/.test(n) ? 'Visa' : /^220[0-4]/.test(n) ? 'Mir' : /^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(n) ? 'Mastercard' : /^3[47]/.test(n) ? 'Amex' : 'Card');
const authCode = () => Array.from(crypto.randomBytes(6), b => REF_CHARS[b % REF_CHARS.length]).join('');

// Checks the payment details for the chosen method. This is a demo checkout: no money moves,
// and only the card brand + last 4 digits are ever stored (never the full number or CVC).
function checkPayment(kind, p = {}) {
  if (kind === 'card') {
    const c = p.card || {}, num = String(c.number || '').replace(/\D/g, '');
    if (num.length < 13 || num.length > 19 || !luhn(num)) fail(400, 'Card number is not valid');
    if (clean(c.name).length < 2) fail(400, 'Enter the name on the card');
    const m = String(c.exp || '').match(/^(\d{2})\s*\/\s*(\d{2})$/);
    if (!m || +m[1] < 1 || +m[1] > 12) fail(400, 'Expiry must look like MM/YY');
    if (new Date(2000 + +m[2], +m[1], 1) <= new Date()) fail(400, 'This card has expired');
    if (!/^\d{3,4}$/.test(String(c.cvc || ''))) fail(400, 'CVC must be 3 or 4 digits');
    if (num === '4000000000000002') fail(402, 'Your card was declined (test card). Try another card.');
    return { card_brand: cardBrand(num), card_last4: num.slice(-4), payer_phone: null, status: 'Paid' };
  }
  if (kind === 'kaspi') {
    const phone = clean(p.phone);
    if (!PHONE.test(phone)) fail(400, 'Enter the phone number linked to your Kaspi account');
    return { card_brand: null, card_last4: null, payer_phone: phone, status: 'Paid' };
  }
  if (kind === 'cash') return { card_brand: null, card_last4: null, payer_phone: null, status: 'Pending' };
  return { card_brand: null, card_last4: null, payer_phone: null, status: 'Paid' };   // Apple Pay / Google Pay
}

app.get('/api/payments', auth, h(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT p.transaction_id, p.booking_ref, p.amount, p.currency, p.status, p.card_brand, p.card_last4, p.payer_phone, p.auth_code, p.promo_code, p.discount,
           pm.method_name, to_char(p.created_at, 'YYYY-MM-DD HH24:MI') AS created,
           (SELECT f.origin || ' → ' || f.destination FROM BOOKING b JOIN FLIGHT f ON f.flight_id = b.flight_id
             WHERE b.booking_ref = p.booking_ref LIMIT 1) AS route
    FROM PAYMENT p LEFT JOIN PAYMENT_METHOD pm ON pm.payment_id = p.payment_id
    WHERE p.user_id = $1 ORDER BY p.created_at DESC`, [req.u.uid]);
  res.json(rows);
}));

/* ----- promo codes (tables + fn_promo_check live in db/promo_codes.sql) ----- */
const PROMO_SQL = require('fs').readFileSync(path.join(__dirname, 'db', 'promo_codes.sql'), 'utf8');
const promoCode = v => clean(v).toUpperCase();

// "Apply" button: is the code valid for this user and this total? (nothing is used up yet)
app.post('/api/promo/check', auth, h(async (req, res) => {
  const code = promoCode(req.body.code), total = Number(req.body.total);
  if (!code) fail(400, 'Enter a promo code');
  if (!(total >= 0)) fail(400, 'Bad total');
  const { rows } = await pool.query('SELECT * FROM fn_promo_check($1, $2, $3)', [code, req.u.uid, total]);
  const r = rows[0];
  if (!r.ok) fail(400, r.message);
  res.json({ code, message: r.message, discount: r.discount, total_after: total - r.discount });
}));

// ---- admin: manage promo codes ----
app.get('/api/admin/promos', auth, adminOnly, h(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT pc.code, pc.description, pc.discount_percent, pc.discount_amount, pc.min_total,
           to_char(pc.valid_from, 'YYYY-MM-DD') AS valid_from, to_char(pc.valid_until, 'YYYY-MM-DD') AS valid_until,
           pc.max_uses, pc.used_count, pc.per_user_limit, pc.active,
           CASE WHEN NOT pc.active THEN 'Off'
                WHEN CURRENT_DATE > pc.valid_until THEN 'Expired'
                WHEN CURRENT_DATE < pc.valid_from THEN 'Scheduled'
                WHEN pc.max_uses IS NOT NULL AND pc.used_count >= pc.max_uses THEN 'Used up'
                ELSE 'Active' END AS state,
           COALESCE((SELECT SUM(r.discount) FROM PROMO_REDEMPTION r WHERE r.code = pc.code), 0) AS total_discount
    FROM PROMO_CODE pc ORDER BY pc.created_at DESC, pc.code`);
  res.json(rows);
}));

app.post('/api/admin/promos', auth, adminOnly, h(async (req, res) => {
  const b = req.body, code = promoCode(b.code), value = Number(b.value);
  if (!/^[A-Z0-9_-]{3,20}$/.test(code)) fail(400, 'Code: 3–20 letters, digits, - or _');
  if (!(value > 0)) fail(400, 'Enter the discount value');
  if (b.type === 'percent' && !(value >= 1 && value <= 90)) fail(400, 'Percent must be 1–90');
  if (!isDate(b.valid_until)) fail(400, 'Choose an expiry date');
  const maxUses = b.max_uses === '' || b.max_uses == null ? null : Number(b.max_uses);
  if (maxUses !== null && !(Number.isInteger(maxUses) && maxUses > 0)) fail(400, 'Usage limit must be a whole number (or empty = unlimited)');
  try {
    const { rows } = await pool.query(`
      INSERT INTO PROMO_CODE (code, description, discount_percent, discount_amount, min_total, valid_from, valid_until, max_uses, per_user_limit, created_by)
      VALUES ($1, $2, $3, $4, $5, COALESCE($6::date, CURRENT_DATE), $7, $8, $9, $10) RETURNING code`,
      [code, clean(b.description) || null, b.type === 'percent' ? value : null, b.type === 'percent' ? null : value,
       Number(b.min_total) || 0, isDate(b.valid_from) ? b.valid_from : null, b.valid_until, maxUses,
       Math.max(1, parseInt(b.per_user_limit, 10) || 1), req.u.uid]);
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') fail(409, `Code ${code} already exists`);
    if (e.code === '23514') fail(400, 'Check the values (expiry must be after the start date)');
    throw e;
  }
}));

app.patch('/api/admin/promos/:code', auth, adminOnly, h(async (req, res) => {
  const r = await pool.query('UPDATE PROMO_CODE SET active = $1 WHERE code = $2 RETURNING code, active',
    [!!req.body.active, promoCode(req.params.code)]);
  if (!r.rowCount) fail(404, 'Promo code not found');
  res.json(r.rows[0]);
}));

app.get('/api/admin/redemptions', auth, adminOnly, h(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT r.code, r.booking_ref, r.discount, to_char(r.redeemed_at, 'YYYY-MM-DD HH24:MI') AS redeemed, u.email
    FROM PROMO_REDEMPTION r LEFT JOIN APP_USER u ON u.user_id = r.user_id
    ORDER BY r.redeemed_at DESC LIMIT 30`);
  res.json(rows);
}));

/* ----- bookings ----- */
const REF_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newRef = () => Array.from(crypto.randomBytes(6), b => REF_CHARS[b % REF_CHARS.length]).join('');

app.post('/api/bookings', auth, h(async (req, res) => {
  const flightId = Number(req.body.flight_id);
  const paymentId = Number(req.body.payment_method_id);
  const travelers = Array.isArray(req.body.travelers) ? req.body.travelers : [];

  if (!Number.isInteger(flightId)) fail(400, 'Choose a flight');
  if (!Number.isInteger(paymentId)) fail(400, 'Choose a payment method');
  if (!travelers.length || travelers.length > CONFIG.max_passengers) fail(400, `Book 1–${CONFIG.max_passengers} passengers`);
  const seatIds = travelers.map(t => Number(t.seat_id));
  if (seatIds.some(s => !Number.isInteger(s))) fail(400, 'Choose a seat for every passenger');
  if (new Set(seatIds).size !== seatIds.length) fail(400, 'Each passenger needs a different seat');
  travelers.forEach((t, i) => {
    const n = `Passenger ${i + 1}: `;
    if (!clean(t.first_name) || !clean(t.last_name)) fail(400, n + 'enter first and last name');
    if (t.email && !EMAIL.test(clean(t.email))) fail(400, n + 'email looks wrong');
    if (t.phone && !PHONE.test(clean(t.phone))) fail(400, n + 'phone looks wrong');
    const kg = Number(t.baggage_kg || 0);
    if (!(kg >= 0 && kg <= CONFIG.max_bag_kg)) fail(400, n + `baggage must be 0–${CONFIG.max_bag_kg} kg`);
  });

  const pmRow = (await pool.query('SELECT payment_id, method_name FROM PAYMENT_METHOD WHERE payment_id = $1', [paymentId])).rows[0];
  if (!pmRow) fail(400, 'Unknown payment method');
  const kind = kindOf(pmRow.method_name);
  const pay = checkPayment(kind, req.body.payment);
  const promoIn = promoCode(req.body.promo_code) || null;
  const bookingStatus = kind === 'cash' ? 'Pending' : 'Confirmed';     // cash: seat is held, pay at the airport

  const me = await profile(req.u.pid);
  try {
    const result = await tx(async c => {
      // Lock the flight row so two people can't book its last seats at the same moment.
      const f = await c.query(`SELECT flight_id, aircraft_id, price, business_price, status,
                                      departure_utc > (now() AT TIME ZONE 'UTC') AS open
                               FROM FLIGHT WHERE flight_id = $1 FOR UPDATE`, [flightId]);
      if (!f.rowCount) fail(404, 'Flight not found');
      const flight = f.rows[0];
      if (!flight.open || flight.status === 'Cancelled') fail(400, 'This flight is no longer open for booking');

      const s = await c.query(`
        SELECT s.seat_id, s.seat_number, s.class,
               EXISTS (SELECT 1 FROM BOOKING b WHERE b.flight_id = $1 AND b.seat_id = s.seat_id AND b.status <> 'Cancelled') AS taken
        FROM SEAT s WHERE s.seat_id = ANY($2::int[]) AND s.aircraft_id = $3 AND s.status = 'Available'`,
        [flightId, seatIds, flight.aircraft_id]);
      const seats = new Map(s.rows.map(r => [r.seat_id, r]));
      if (seats.size !== seatIds.length) fail(400, 'One of the seats does not exist on this aircraft');
      const taken = s.rows.filter(r => r.taken).map(r => r.seat_number);
      if (taken.length) fail(409, `Seat ${taken.join(', ')} was just taken — please pick another`);

      let ref;
      do { ref = newRef(); } while ((await c.query('SELECT 1 FROM BOOKING WHERE booking_ref = $1', [ref])).rowCount);

      let total = 0;
      const items = [];
      for (const t of travelers) {
        const first = clean(t.first_name), last = clean(t.last_name);
        // The account holder flies under their own passenger profile; companions get a new one.
        let pid;
        if (first.toLowerCase() === me.first_name.toLowerCase() && last.toLowerCase() === me.last_name.toLowerCase()) {
          pid = me.passenger_id;
        } else {
          pid = (await c.query(
            `INSERT INTO PASSENGER (first_name, last_name, email, phone, document_number) VALUES ($1,$2,$3,$4,$5) RETURNING passenger_id`,
            [first, last, clean(t.email) || null, clean(t.phone) || null, clean(t.document_number) || null])).rows[0].passenger_id;
        }
        const seat = seats.get(Number(t.seat_id));
        const fare = seat.class === 'Business' ? flight.business_price : flight.price;
        const kg = Math.round(Number(t.baggage_kg || 0));
        const bag = kg * CONFIG.bag_price_per_kg;
        const b = await c.query(`
          INSERT INTO BOOKING (booking_ref, status, passenger_id, flight_id, seat_id, user_id, payment_id, fare, total_price)
          VALUES ($1, $9, $2, $3, $4, $5, $6, $7, $8) RETURNING booking_id`,
          [ref, pid, flightId, seat.seat_id, req.u.uid, paymentId, fare, fare + bag, bookingStatus]);
        if (kg > 0) await c.query(
          'INSERT INTO BAGGAGE (weight_kg, price, booking_id, payment_id) VALUES ($1,$2,$3,$4)',
          [kg, bag, b.rows[0].booking_id, paymentId]);
        total += fare + bag;
        items.push({ booking_id: b.rows[0].booking_id, name: `${first} ${last}`, seat: seat.seat_number, class: seat.class, fare, baggage_kg: kg, bag_price: bag });
      }
      // Promo code: lock the code's row so two people can't take its last use at the same moment,
      // let the database function decide, then count the use and remember who used it.
      let discount = 0, promo = null;
      if (promoIn) {
        await c.query('SELECT 1 FROM PROMO_CODE WHERE code = $1 FOR UPDATE', [promoIn]);
        const chk = (await c.query('SELECT * FROM fn_promo_check($1, $2, $3)', [promoIn, req.u.uid, total])).rows[0];
        if (!chk.ok) fail(400, chk.message);
        discount = chk.discount; promo = promoIn;
        await c.query('UPDATE PROMO_CODE SET used_count = used_count + 1 WHERE code = $1', [promo]);
        await c.query('INSERT INTO PROMO_REDEMPTION (code, user_id, booking_ref, discount) VALUES ($1,$2,$3,$4)', [promo, req.u.uid, ref, discount]);
      }
      const code = pay.status === 'Paid' ? authCode() : null;
      await c.query(`INSERT INTO PAYMENT (booking_ref, user_id, payment_id, amount, status, card_brand, card_last4, payer_phone, auth_code, promo_code, discount)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [ref, req.u.uid, paymentId, total - discount, pay.status, pay.card_brand, pay.card_last4, pay.payer_phone, code, promo, discount]);
      return { booking_ref: ref, status: bookingStatus.toUpperCase(), total, discount, promo_code: promo, paid: total - discount, items,
               payment: { method: pmRow.method_name, kind, status: pay.status, card_brand: pay.card_brand, card_last4: pay.card_last4, auth_code: code } };
    });
    res.status(201).json(result);
  } catch (e) {
    if (e.code === '23505') fail(409, 'Someone just took one of those seats — please pick another');
    if (e.code === '23514') fail(400, 'That seat is not available on this flight');
    throw e;
  }
}));

// The signed-in user's bookings, one entry per booking reference.
app.get('/api/bookings', auth, h(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT b.booking_ref,
           to_char(MIN(b.booking_date), 'YYYY-MM-DD') AS booking_date,
           f.flight_id, f.flight_number, f.airline, f.status AS flight_status,
           f.origin, oa.city AS origin_city, f.destination, da.city AS destination_city,
           to_char(f.departure_time, 'YYYY-MM-DD') AS date,
           to_char(f.departure_time, 'HH24:MI') AS departure_time,
           to_char(f.arrival_time,   'HH24:MI') AS arrival_time,
           to_char(f.departure_utc, 'YYYY-MM-DD"T"HH24:MI"Z"') AS departure_iso,
           to_char(f.arrival_time, 'YYYY-MM-DD') AS arrival_date, l.airline_code,
           f.departure_utc <= (now() AT TIME ZONE 'UTC') AS is_past,
           g.gate_number, g.terminal, a.manufacturer, a.model,
           MAX(pm.method_name) AS payment_method,
           (SELECT row_to_json(x) FROM (SELECT p2.status, p2.card_brand, p2.card_last4, p2.payer_phone, p2.auth_code, p2.amount, p2.promo_code, p2.discount, pm2.method_name
              FROM PAYMENT p2 LEFT JOIN PAYMENT_METHOD pm2 ON pm2.payment_id = p2.payment_id
              WHERE p2.booking_ref = b.booking_ref ORDER BY p2.transaction_id DESC LIMIT 1) x) AS payment,
           CASE WHEN bool_and(b.status = 'Cancelled') THEN 'CANCELLED'
                WHEN bool_or(b.status = 'Pending') THEN 'PENDING' ELSE 'CONFIRMED' END AS status,
           SUM(b.total_price) AS total,
           json_agg(json_build_object(
             'booking_id', b.booking_id, 'first_name', p.first_name, 'last_name', p.last_name,
             'seat', s.seat_number, 'class', s.class, 'status', upper(b.status), 'price', b.total_price,
             'baggage_kg', COALESCE((SELECT SUM(weight_kg) FROM BAGGAGE bg WHERE bg.booking_id = b.booking_id), 0)
           ) ORDER BY s.seat_number) AS travelers
    FROM BOOKING b
    JOIN FLIGHT f    ON f.flight_id = b.flight_id
    JOIN AIRPORT oa  ON oa.code = f.origin
    JOIN AIRPORT da  ON da.code = f.destination
    JOIN PASSENGER p ON p.passenger_id = b.passenger_id
    LEFT JOIN SEAT s ON s.seat_id = b.seat_id
    LEFT JOIN GATE g ON g.gate_id = f.gate_id
    LEFT JOIN AIRCRAFT a ON a.aircraft_id = f.aircraft_id
    LEFT JOIN PAYMENT_METHOD pm ON pm.payment_id = b.payment_id
    LEFT JOIN AIRLINE l ON l.name = f.airline
    WHERE b.user_id = $1
    GROUP BY b.booking_ref, f.flight_id, oa.city, da.city, g.gate_number, g.terminal, a.manufacturer, a.model, l.airline_code
    ORDER BY f.departure_utc DESC`, [req.u.uid]);
  res.json(rows);
}));

app.post('/api/bookings/:ref/cancel', auth, h(async (req, res) => {
  const ref = clean(req.params.ref).toUpperCase();
  const r = await pool.query(`
    UPDATE BOOKING b SET status = 'Cancelled'
    FROM FLIGHT f
    WHERE f.flight_id = b.flight_id AND b.booking_ref = $1 AND b.user_id = $2
      AND b.status <> 'Cancelled' AND f.departure_utc > (now() AT TIME ZONE 'UTC')
    RETURNING b.booking_id`, [ref, req.u.uid]);
  if (!r.rowCount) {
    const exists = await pool.query('SELECT 1 FROM BOOKING WHERE booking_ref = $1 AND user_id = $2', [ref, req.u.uid]);
    fail(exists.rowCount ? 400 : 404, exists.rowCount ? 'This booking is already cancelled or the flight has departed' : 'Booking not found');
  }
  // money back for paid bookings; a cash reservation is simply cancelled
  const p = await pool.query(`
    UPDATE PAYMENT SET status = CASE WHEN status = 'Paid' THEN 'Refunded' ELSE 'Cancelled' END, updated_at = now()
    WHERE booking_ref = $1 AND user_id = $2 AND status IN ('Paid', 'Pending') RETURNING status, amount`, [ref, req.u.uid]);
  const refunded = p.rows.filter(x => x.status === 'Refunded').reduce((a, x) => a + x.amount, 0);
  // a cancelled booking gives its promo code back (the use no longer counts)
  const back = await pool.query('DELETE FROM PROMO_REDEMPTION WHERE booking_ref = $1 RETURNING code', [ref]);
  for (const r of back.rows) await pool.query('UPDATE PROMO_CODE SET used_count = GREATEST(used_count - 1, 0) WHERE code = $1', [r.code]);
  res.json({ booking_ref: ref, status: 'CANCELLED', cancelled: r.rowCount, refunded });
}));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API route' }));
app.use((err, _req, res, _next) => {            // bad JSON bodies etc.
  res.status(err.status || 500).json({ error: err.status === 400 ? 'Request body is not valid JSON' : 'Server error' });
});

/* ---------- start ---------- */
pool.query(PAYMENT_DDL)
  .then(() => pool.query(PROMO_SQL))                    // promo tables, fn_promo_check, starter codes, admin account
  .then(() => pool.query('SELECT current_database() AS db, (SELECT COUNT(*) FROM FLIGHT) AS flights'))
  .then(({ rows }) => {
    app.listen(PORT, () => {
      console.log(`✈  Samgau Flights → http://localhost:${PORT}`);
      console.log(`   Connected to database "${rows[0].db}" (${rows[0].flights} flights)`);
    });
  })
  .catch(e => {
    console.error('✖  Could not connect to PostgreSQL:', e.message);
    if (e.code === '28P01') console.error('   Wrong password — check PGPASSWORD in .env');
    if (e.code === '3D000') console.error('   Database does not exist — run:  npm run db:setup');
    if (e.code === '42P01') console.error('   Tables are missing — run:  npm run db:setup');
    if (e.code === 'ECONNREFUSED') console.error('   Is PostgreSQL running? Check PGHOST / PGPORT in .env');
    process.exit(1);
  });
