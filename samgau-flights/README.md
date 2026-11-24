# Samgau Flights — airline booking website

Express (Node.js) backend + PostgreSQL database + single-page front end.

```
samgau-flights/
├── server.js            ← backend: REST API + serves the website
├── public/index.html    ← front end (Flights, Bookings, Trips, Profile)
├── public/earth.js      ← full-screen photo-realistic WebGL Earth + flight arcs (no libraries)
├── public/img/          ← NASA Blue Marble texture + ocean mask (public domain)
├── public/globe.js      ← vector globe, used only if the browser has no WebGL
├── public/world.json    ← country outlines for the vector globe (Natural Earth)
├── setup.bat / start.bat← double-click helpers for Windows
├── db/schema.sql        ← tables, constraints, trigger, indexes, views
├── db/seed.sql          ← 27 airports, 23 airlines, 85 aircraft, ~17,000 flights, bookings
├── db/promo_codes.sql   ← promo code tables, fn_promo_check(), starter codes, admin account (runs on every server start)
├── db/queries.sql       ← JOIN / GROUP BY / HAVING / subquery / window-function examples
├── scripts/setup-db.js  ← creates the database and loads schema + seed
├── .env                 ← your PostgreSQL password etc. (not committed)
└── package.json
```

## Quick start on Windows

1. Copy everything from this folder into your project folder (e.g. `Desktop\database2026\dtabase2026`) and replace `server.js` and `package.json`. Your existing `node_modules` already has express and pg.
2. Check `.env`: `PGPASSWORD` must be your PostgreSQL password.
3. Double-click **setup.bat** once to create the tables and data.
4. Double-click **start.bat**. It opens http://localhost:3000.

"Cannot GET /" means an old `server.js` is running, or `public\index.html` is missing. Stop the server (Ctrl+C) and start the new one.

## Run it (Windows, macOS or Linux)

You need **Node.js 20.12+** and **PostgreSQL** running (pgAdmin installs it).

```bash
npm install          # installs express + pg
# edit .env → PGPASSWORD = your postgres password
npm run db:setup     # creates "flight_booking_system", tables and data (~10 s)
npm start            # → http://localhost:3000
```

Sign in with the demo account **aruzhan@gmail.com / demo1234**, or create a new account.
Admin (adds promo codes): **admin@samgau.kz / admin1234**.

> `npm run db:setup` **drops and recreates** the tables. Run it again any time you want fresh data.
> Flights are generated relative to today (7 days back, 35 ahead), so there are always upcoming flights.

Don't open `index.html` by double-clicking. Always use http://localhost:3000, because the page needs the server.

## World flights

27 airports: 8 in Kazakhstan, plus Istanbul, London, Paris, Frankfurt, Amsterdam, Madrid, Moscow, Dubai, Doha, Tashkent, Delhi, Beijing, Seoul, Tokyo, Bangkok, Singapore, Sydney, New York and Los Angeles.

- Each world hub has its home airline (`AIRLINE.hub`). Every pair of hubs, plus Astana and Almaty, has nonstop flights: daily by the origin's airline, plus 2–3 a week by the destination's airline. For example, Istanbul → London is flown by Turkish Airlines and British Airways.
- Long flights use wide-body planes (A350, 777, 787, A380, 747), with seat maps of 3-3-3 or 3-4-3.
- **Time zones:** `departure_time` and `arrival_time` are local times at each airport, while `departure_utc` and `arrival_utc` hold the same moments in UTC. Durations and "has it departed?" checks use UTC, so London → New York shows 18:15 → 20:40 local time for a flight of about 8 hours.
- **Return trips:** fill in "Return" when searching. You book the outbound flight first, then the app takes you to the return flights.

## Paying

At the Confirm step you choose how to pay:
- **Bank card:** number, name, expiry and CVC. The number is checked with the Luhn algorithm and the expiry must be in the future. Only the brand and last 4 digits are saved, never the full number or CVC. Test card: `4242 4242 4242 4242` (any future date, any CVC). `4000 0000 0000 0002` is always declined, so you can show what an error looks like.
- **Kaspi Pay:** the phone number linked to Kaspi.
- **Apple Pay / Google Pay:** one tap.
- **Cash at airport:** the seats are held and the booking shows as *Pending* until you pay at the desk.

This is a demo checkout, so no real money moves. Cancelling a paid booking marks its payment as *Refunded*. Payment history is under **My Account**.
The server creates the `PAYMENT` table on start if it is missing, so an existing database does not need to be reset.

## Promo codes

- **Where codes live:** the `PROMO_CODE` table, which stores the code, a % or fixed ₸ discount, valid-from and valid-until (expiry) dates, a total usage limit (`max_uses`), uses per customer and a minimum booking total. Each use is recorded in `PROMO_REDEMPTION`.
- **Adding a code:** sign in as **admin@samgau.kz / admin1234** and use the **🛠 Admin** tab, or run an `INSERT INTO PROMO_CODE ...` in pgAdmin (there's an example in `db/promo_codes.sql`). The admin page can also switch a code off or on.
- **Who decides:** the PostgreSQL function `fn_promo_check(code, user, total)`. It checks that the code exists, is active and is within its dates, that the usage limit isn't reached, that this customer hasn't used it up, and that the booking meets the minimum total. It then returns the discount. The **Apply** button and the payment both use it.
- **Safety:** when paying, the code's row is locked (`SELECT ... FOR UPDATE`), so two people can't take its last use at the same moment. `CHECK (used_count <= max_uses)` makes going over the limit impossible even then.
- **Cancelling** a booking refunds the discounted amount and gives the code back (`used_count - 1`).
- **Starter codes:** `STUDENT10` (10%), `WELCOME5000` (5 000 ₸ off bookings of 30 000 ₸ or more), `TURAN20` (20%, 20 uses), `SUMMER15` (expired, to show the error) and `LASTONE` (limit already reached).

## The globe

- A full-screen, photo-realistic Earth (WebGL, with a NASA Blue Marble texture, sunlight, ocean shine and atmosphere) behind glass panels.
- **Sign-in page:** a slowly spinning Earth with the routes from Astana and Almaty.
- **Flights:** an explore map centred on Kazakhstan, plus a list of destinations from your departure city with the cheapest fare, flight time, distance and flights per week (`GET /api/routes`). Hover over a city to see a plane fly the route. Click a city, either on the globe or in the list, to search for flights.
- **Search results:** a route banner that zooms in on your route and shows a plane flying it.
- **Bookings:** a small route map on every booking.
- **Trips:** a map of your next flight. **Profile:** your travel map with every city you've flown to.
- **Controls:** drag to spin; Ctrl + scroll, pinch or the +/− buttons to zoom; the Kazakhstan and World buttons jump between views.

Airport coordinates come from the `AIRPORT` table (`latitude`, `longitude`), so a new airport added there appears on the globe automatically.

## Database design

| Table | Purpose |
|---|---|
| `AIRPORT` | 27 airports (IATA code, city, region, coordinates, UTC offset) |
| `AIRLINE` | 23 airlines (IATA code, country, home hub) |
| `GATE` | Gates per airport and terminal |
| `AIRCRAFT` | Fleet: model, manufacturer, airline, seat layout (rows × letters, business rows); `capacity` is a generated column |
| `SEAT` | Every physical seat of every aircraft (`Blocked` = out of service) |
| `FLIGHT` | Flight number, airline, route, times, Economy + Business fare, status, gate, aircraft |
| `PASSENGER` | People who fly |
| `APP_USER` | Website login (email, scrypt password hash), linked 1-to-1 to a passenger |
| `BOOKING` | One passenger + one seat on one flight. Rows sharing `booking_ref` were bought together |
| `BAGGAGE` | Checked bags per booking |
| `PAYMENT` | One row per checkout: method, amount, status (Paid / Pending / Refunded / Cancelled), card brand + last 4 digits, Kaspi phone, auth code |
| `PAYMENT_METHOD` | Card, Kaspi Pay, Apple Pay, Google Pay, Cash |
| `PROMO_CODE` | Discount codes: % or ₸, dates, usage limits, active flag |
| `PROMO_REDEMPTION` | Who used which code on which booking, and how much it saved |

Integrity rules are enforced **in the database**, not only in JavaScript:
- `ux_booking_flight_seat`: a partial unique index, so a seat can't be sold twice on the same flight (cancelled bookings free it).
- `trg_booking_seat`: a trigger that rejects seats belonging to a different aircraft, or blocked seats.
- CHECK constraints on statuses, prices, baggage weight, arrival after departure, and origin ≠ destination.
- Views: `v_flight_availability` (seats left per class) and `v_booking_details` (everything about a booking).

## API

| Method | Route | |
|---|---|---|
| POST | `/api/register`, `/api/login` | returns a token |
| GET / PUT | `/api/me` | profile + travel stats / update profile |
| POST | `/api/me/password` | change password |
| GET | `/api/airports`, `/api/payment-methods`, `/api/config` | reference data |
| GET | `/api/flights?from=NQZ&to=ALA&date=2026-11-14&cabin=Economy` | search with live seats left |
| GET | `/api/flights/calendar?...` | cheapest fare per day (±3 days) |
| GET | `/api/flights/:id/seats` | seat map with FREE / TAKEN / BLOCKED |
| POST | `/api/bookings` | book 1–9 passengers in one transaction |
| GET | `/api/bookings` | my bookings grouped by reference |
| POST | `/api/bookings/:ref/cancel` | cancel a booking (frees the seats) |
| GET | `/api/health` | DB connection check |

Booking runs in a transaction and locks the flight row (`SELECT … FOR UPDATE`). If two people click the same seat at the same moment, exactly one booking succeeds. Prices are always calculated on the server.
