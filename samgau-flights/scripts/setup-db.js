/* Creates the database (if needed), then runs db/schema.sql and db/seed.sql.
   Usage:  npm run db:setup
   WARNING: drops and recreates the Samgau tables — all bookings are reset. */
const fs = require('fs');
const path = require('path');
// Load .env (works on every Node version: uses process.loadEnvFile when available)
try {
  if (process.loadEnvFile) process.loadEnvFile(path.join(__dirname, '..', '.env'));
  else require('fs').readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/).forEach(l => {
    const m = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch { /* no .env file: use real environment variables */ }
const { Client } = require('pg');

const root = path.join(__dirname, '..');
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const dbName = url ? url.pathname.slice(1) : (process.env.PGDATABASE || 'flight_booking_system');
const conn = db => url ? { connectionString: Object.assign(new URL(url), { pathname: '/' + db }).toString() } : { database: db };

(async () => {
  // 1. create the database if it does not exist (connects to the default "postgres" db)
  const admin = new Client(conn('postgres'));
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (!exists.rowCount) {
    await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '')}"`);
    console.log(`Created database "${dbName}"`);
  }
  await admin.end();

  // 2. build tables and load data
  const db = new Client(conn(dbName));
  await db.connect();
  await db.query('SET client_min_messages = warning');
  for (const file of ['schema.sql', 'seed.sql', 'promo_codes.sql']) {
    const t = Date.now();
    process.stdout.write(`Running db/${file} … `);
    await db.query(fs.readFileSync(path.join(root, 'db', file), 'utf8'));
    console.log(`done in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  }
  const { rows } = await db.query(`SELECT
    (SELECT COUNT(*) FROM AIRPORT) airports, (SELECT COUNT(*) FROM FLIGHT) flights,
    (SELECT COUNT(*) FROM SEAT) seats, (SELECT COUNT(*) FROM PASSENGER) passengers,
    (SELECT COUNT(*) FROM BOOKING) bookings`);
  console.table(rows[0]);
  console.log('Demo login:  aruzhan@gmail.com / demo1234');
  console.log('Admin login: admin@samgau.kz / admin1234');
  console.log('Now run:  npm start');
  await db.end();
})().catch(e => {
  console.error('\n✖ Setup failed:', e.message);
  if (e.code === '28P01') console.error('  Wrong password — check PGPASSWORD in .env');
  if (e.code === 'ECONNREFUSED') console.error('  Is PostgreSQL running? Check PGHOST / PGPORT in .env');
  process.exit(1);
});
