-- =====================================================================
--  Samgau Flights — seed data
--  Flights are generated relative to CURRENT_DATE, so the site always has
--  upcoming flights no matter when you run it:
--    domestic Kazakhstan: 7 days back … 35 days ahead
--    international:       1 day back  … 30 days ahead
--  Times are stored as LOCAL time at each airport (departure_time / arrival_time)
--  and also in UTC (departure_utc / arrival_utc) for durations and "has it left yet".
-- =====================================================================

-- ---------- airports ----------
-- utc_offset = standard (winter) time offset in hours.
INSERT INTO AIRPORT (code, name, city, country, region, latitude, longitude, utc_offset) VALUES
('NQZ', 'Nursultan Nazarbayev International', 'Astana',      'Kazakhstan',     'Kazakhstan',   51.02220,   71.46690,  5),
('ALA', 'Almaty International',               'Almaty',      'Kazakhstan',     'Kazakhstan',   43.35210,   77.04050,  5),
('CIT', 'Shymkent International',             'Shymkent',    'Kazakhstan',     'Kazakhstan',   42.36420,   69.47890,  5),
('AKX', 'Aliya Moldagulova International',    'Aktobe',      'Kazakhstan',     'Kazakhstan',   50.24580,   57.20690,  5),
('GUW', 'Atyrau International',               'Atyrau',      'Kazakhstan',     'Kazakhstan',   47.12190,   51.82140,  5),
('KGF', 'Sary-Arka Airport',                  'Karaganda',   'Kazakhstan',     'Kazakhstan',   49.67080,   73.33440,  5),
('UKK', 'Oskemen International',              'Oskemen',     'Kazakhstan',     'Kazakhstan',   50.03660,   82.49420,  5),
('SCO', 'Aktau International',                'Aktau',       'Kazakhstan',     'Kazakhstan',   43.86010,   51.09190,  5),
('IST', 'Istanbul Airport',                   'Istanbul',    'Turkey',         'Europe',       41.26190,   28.74190,  3),
('LHR', 'London Heathrow',                    'London',      'United Kingdom', 'Europe',       51.47000,   -0.45430,  0),
('CDG', 'Paris Charles de Gaulle',            'Paris',       'France',         'Europe',       49.00970,    2.54790,  1),
('FRA', 'Frankfurt Airport',                  'Frankfurt',   'Germany',        'Europe',       50.03790,    8.56220,  1),
('AMS', 'Amsterdam Schiphol',                 'Amsterdam',   'Netherlands',    'Europe',       52.31050,    4.76830,  1),
('MAD', 'Adolfo Suárez Madrid–Barajas',       'Madrid',      'Spain',          'Europe',       40.49830,   -3.56760,  1),
('SVO', 'Moscow Sheremetyevo',                'Moscow',      'Russia',         'Europe',       55.97260,   37.41460,  3),
('DXB', 'Dubai International',                'Dubai',       'UAE',            'Middle East',  25.25320,   55.36570,  4),
('DOH', 'Hamad International',                'Doha',        'Qatar',          'Middle East',  25.27310,   51.60810,  3),
('TAS', 'Tashkent International',             'Tashkent',    'Uzbekistan',     'Asia',         41.25790,   69.28120,  5),
('DEL', 'Indira Gandhi International',        'Delhi',       'India',          'Asia',         28.55620,   77.10000,  5.5),
('PEK', 'Beijing Capital International',      'Beijing',     'China',          'Asia',         40.07990,  116.60310,  8),
('ICN', 'Incheon International',              'Seoul',       'South Korea',    'Asia',         37.46020,  126.44070,  9),
('HND', 'Tokyo Haneda',                       'Tokyo',       'Japan',          'Asia',         35.54940,  139.77980,  9),
('BKK', 'Suvarnabhumi Airport',               'Bangkok',     'Thailand',       'Asia',         13.69000,  100.75010,  7),
('SIN', 'Singapore Changi',                   'Singapore',   'Singapore',      'Asia',          1.36440,  103.99150,  8),
('SYD', 'Sydney Kingsford Smith',             'Sydney',      'Australia',      'Oceania',     -33.93990,  151.17530, 11),
('JFK', 'John F. Kennedy International',      'New York',    'United States',  'Americas',     40.64130,  -73.77810, -5),
('LAX', 'Los Angeles International',          'Los Angeles', 'United States',  'Americas',     33.94160, -118.40850, -8);

-- ---------- airlines (each world airline flies from its hub) ----------
INSERT INTO AIRLINE (airline_code, name, country, hub) VALUES
('KC', 'Air Astana',          'Kazakhstan',     'NQZ'),
('FS', 'FlyArystan',          'Kazakhstan',     'ALA'),
('DV', 'SCAT',                'Kazakhstan',     'CIT'),
('IQ', 'Qazaq Air',           'Kazakhstan',     'KGF'),
('TK', 'Turkish Airlines',    'Turkey',         'IST'),
('BA', 'British Airways',     'United Kingdom', 'LHR'),
('AF', 'Air France',          'France',         'CDG'),
('LH', 'Lufthansa',           'Germany',        'FRA'),
('KL', 'KLM',                 'Netherlands',    'AMS'),
('IB', 'Iberia',              'Spain',          'MAD'),
('SU', 'Aeroflot',            'Russia',         'SVO'),
('EK', 'Emirates',            'UAE',            'DXB'),
('QR', 'Qatar Airways',       'Qatar',          'DOH'),
('HY', 'Uzbekistan Airways',  'Uzbekistan',     'TAS'),
('AI', 'Air India',           'India',          'DEL'),
('CA', 'Air China',           'China',          'PEK'),
('KE', 'Korean Air',          'South Korea',    'ICN'),
('JL', 'Japan Airlines',      'Japan',          'HND'),
('TG', 'Thai Airways',        'Thailand',       'BKK'),
('SQ', 'Singapore Airlines',  'Singapore',      'SIN'),
('QF', 'Qantas',              'Australia',      'SYD'),
('AA', 'American Airlines',   'United States',  'JFK'),
('UA', 'United Airlines',     'United States',  'LAX');

-- ---------- gates: A1–A4 in Terminal 1, B1–B4 in Terminal 2 at every airport ----------
INSERT INTO GATE (gate_number, terminal, airport_code)
SELECT t.letter || n, 'Terminal ' || t.term, a.code
FROM AIRPORT a
CROSS JOIN (VALUES ('A', 1), ('B', 2)) t(letter, term)
CROSS JOIN generate_series(1, 4) n
ORDER BY a.code, t.letter, n;

-- ---------- fleet ----------
-- seat_letters: 'ACDF' = 2-2, 'ABCDEF' = 3-3, 'ABCDEFGH' = 2-4-2, 'ABCDEFGHK' = 3-3-3, 'ABCDEFGHJK' = 3-4-3
INSERT INTO AIRCRAFT (registration, model, manufacturer, airline, seat_rows, seat_letters, business_rows) VALUES
-- Kazakhstan
('P4-KDA',   'A320neo',     'Airbus',              'Air Astana',         30, 'ABCDEF',     2),
('P4-KDB',   'A320neo',     'Airbus',              'Air Astana',         30, 'ABCDEF',     2),
('P4-KBA',   'A321neo',     'Airbus',              'Air Astana',         35, 'ABCDEF',     3),
('P4-KBB',   'A321neo',     'Airbus',              'Air Astana',         35, 'ABCDEF',     3),
('P4-KHA',   'E190-E2',     'Embraer',             'Air Astana',         27, 'ACDF',       3),
('P4-BDL',   '787-9',       'Boeing',              'Air Astana',         32, 'ABCDEFGHK',  5),
('P4-BDM',   '787-9',       'Boeing',              'Air Astana',         32, 'ABCDEFGHK',  5),
('P4-FAA',   'A320neo',     'Airbus',              'FlyArystan',         30, 'ABCDEF',     0),
('P4-FAB',   'A320neo',     'Airbus',              'FlyArystan',         30, 'ABCDEF',     0),
('P4-FAC',   'A320neo',     'Airbus',              'FlyArystan',         30, 'ABCDEF',     0),
('UP-B3701', '737-800',     'Boeing',              'SCAT',               31, 'ABCDEF',     2),
('UP-B3702', '737-800',     'Boeing',              'SCAT',               31, 'ABCDEF',     2),
('UP-B3721', '737 MAX 8',   'Boeing',              'SCAT',               31, 'ABCDEF',     2),
('UP-DH001', 'Dash 8-400',  'De Havilland Canada', 'Qazaq Air',          19, 'ACDF',       0),
('UP-DH002', 'Dash 8-400',  'De Havilland Canada', 'Qazaq Air',          19, 'ACDF',       0),
-- World
('TC-JSA',   'A321neo',     'Airbus',              'Turkish Airlines',   35, 'ABCDEF',     4),
('TC-LGA',   'A350-900',    'Airbus',              'Turkish Airlines',   34, 'ABCDEFGHK',  5),
('TC-JJA',   '777-300ER',   'Boeing',              'Turkish Airlines',   38, 'ABCDEFGHJK', 5),
('G-EUYA',   'A320neo',     'Airbus',              'British Airways',    30, 'ABCDEF',     4),
('G-STBA',   '777-300ER',   'Boeing',              'British Airways',    38, 'ABCDEFGHJK', 6),
('G-XWBA',   'A350-1000',   'Airbus',              'British Airways',    37, 'ABCDEFGHK',  6),
('F-HEPA',   'A320neo',     'Airbus',              'Air France',         30, 'ABCDEF',     3),
('F-HTYA',   'A350-900',    'Airbus',              'Air France',         34, 'ABCDEFGHK',  5),
('F-GSQA',   '777-300ER',   'Boeing',              'Air France',         38, 'ABCDEFGHJK', 5),
('D-AINA',   'A320neo',     'Airbus',              'Lufthansa',          30, 'ABCDEF',     3),
('D-AIXA',   'A350-900',    'Airbus',              'Lufthansa',          34, 'ABCDEFGHK',  6),
('D-ABYA',   '747-8',       'Boeing',              'Lufthansa',          40, 'ABCDEFGHJK', 6),
('PH-BXA',   '737-800',     'Boeing',              'KLM',                31, 'ABCDEF',     3),
('PH-BHA',   '787-10',      'Boeing',              'KLM',                36, 'ABCDEFGHK',  5),
('PH-AKA',   'A330-300',    'Airbus',              'KLM',                33, 'ABCDEFGH',   5),
('EC-NIA',   'A321neo',     'Airbus',              'Iberia',             35, 'ABCDEF',     3),
('EC-MXV',   'A350-900',    'Airbus',              'Iberia',             34, 'ABCDEFGHK',  6),
('EC-LUB',   'A330-300',    'Airbus',              'Iberia',             33, 'ABCDEFGH',   5),
('RA-73181', 'A321neo',     'Airbus',              'Aeroflot',           35, 'ABCDEF',     4),
('RA-73140', 'A350-900',    'Airbus',              'Aeroflot',           34, 'ABCDEFGHK',  5),
('RA-73120', '777-300ER',   'Boeing',              'Aeroflot',           38, 'ABCDEFGHJK', 6),
('A6-EUA',   'A380-800',    'Airbus',              'Emirates',           46, 'ABCDEFGHJK', 6),
('A6-EGA',   '777-300ER',   'Boeing',              'Emirates',           38, 'ABCDEFGHJK', 6),
('A6-EPA',   '777-300ER',   'Boeing',              'Emirates',           38, 'ABCDEFGHJK', 6),
('A7-AHA',   'A320neo',     'Airbus',              'Qatar Airways',      30, 'ABCDEF',     3),
('A7-BHA',   '787-9',       'Boeing',              'Qatar Airways',      32, 'ABCDEFGHK',  6),
('A7-ANA',   'A350-1000',   'Airbus',              'Qatar Airways',      37, 'ABCDEFGHK',  6),
('UK-32101', 'A320neo',     'Airbus',              'Uzbekistan Airways', 30, 'ABCDEF',     3),
('UK-78701', '787-8',       'Boeing',              'Uzbekistan Airways', 30, 'ABCDEFGHK',  4),
('VT-RTA',   'A320neo',     'Airbus',              'Air India',          30, 'ABCDEF',     2),
('VT-ANA',   '787-8',       'Boeing',              'Air India',          30, 'ABCDEFGHK',  4),
('VT-ALA',   '777-300ER',   'Boeing',              'Air India',          38, 'ABCDEFGHJK', 6),
('B-30AA',   'A321neo',     'Airbus',              'Air China',          35, 'ABCDEF',     3),
('B-1083',   'A350-900',    'Airbus',              'Air China',          34, 'ABCDEFGHK',  5),
('B-2035',   '777-300ER',   'Boeing',              'Air China',          38, 'ABCDEFGHJK', 6),
('HL8505',   'A321neo',     'Airbus',              'Korean Air',         35, 'ABCDEF',     3),
('HL8082',   '787-9',       'Boeing',              'Korean Air',         32, 'ABCDEFGHK',  5),
('HL8008',   '777-300ER',   'Boeing',              'Korean Air',         38, 'ABCDEFGHJK', 6),
('JA301J',   '737-800',     'Boeing',              'Japan Airlines',     31, 'ABCDEF',     3),
('JA01WJ',   'A350-1000',   'Airbus',              'Japan Airlines',     37, 'ABCDEFGHK',  6),
('JA861J',   '787-9',       'Boeing',              'Japan Airlines',     32, 'ABCDEFGHK',  5),
('HS-TBA',   'A320neo',     'Airbus',              'Thai Airways',       30, 'ABCDEF',     3),
('HS-THB',   'A350-900',    'Airbus',              'Thai Airways',       34, 'ABCDEFGHK',  5),
('HS-TKK',   '777-300ER',   'Boeing',              'Thai Airways',       38, 'ABCDEFGHJK', 6),
('9V-MBA',   '737 MAX 8',   'Boeing',              'Singapore Airlines', 31, 'ABCDEF',     2),
('9V-SMA',   'A350-900',    'Airbus',              'Singapore Airlines', 34, 'ABCDEFGHK',  6),
('9V-SKA',   'A380-800',    'Airbus',              'Singapore Airlines', 46, 'ABCDEFGHJK', 6),
('VH-XZA',   '737-800',     'Boeing',              'Qantas',             31, 'ABCDEF',     2),
('VH-ZNA',   '787-9',       'Boeing',              'Qantas',             32, 'ABCDEFGHK',  6),
('VH-QPA',   'A330-300',    'Airbus',              'Qantas',             33, 'ABCDEFGH',   5),
('N101NN',   'A321neo',     'Airbus',              'American Airlines',  35, 'ABCDEF',     3),
('N717AN',   '777-300ER',   'Boeing',              'American Airlines',  38, 'ABCDEFGHJK', 6),
('N820AL',   '787-9',       'Boeing',              'American Airlines',  32, 'ABCDEFGHK',  5),
('N37502',   '737 MAX 8',   'Boeing',              'United Airlines',    31, 'ABCDEF',     2),
('N2331U',   '777-300ER',   'Boeing',              'United Airlines',    38, 'ABCDEFGHJK', 6),
('N24976',   '787-10',      'Boeing',              'United Airlines',    36, 'ABCDEFGHK',  5);

-- ---------- seats: one row per physical seat ----------
INSERT INTO SEAT (seat_number, class, status, aircraft_id)
SELECT r || l,
       CASE WHEN r <= a.business_rows THEN 'Business' ELSE 'Economy' END,
       CASE WHEN r = a.seat_rows AND l = 'A' AND a.aircraft_id % 4 = 0 THEN 'Blocked' ELSE 'Available' END,
       a.aircraft_id
FROM AIRCRAFT a
CROSS JOIN generate_series(1, a.seat_rows) r
CROSS JOIN LATERAL unnest(string_to_array(a.seat_letters, NULL)) l
ORDER BY a.aircraft_id, r, l;

-- ---------- payment methods ----------
INSERT INTO PAYMENT_METHOD (method_name, description) VALUES
('Bank card',       'Visa / Mastercard'),
('Kaspi Pay',       'Payment using Kaspi'),
('Apple Pay',       'Payment using Apple Pay'),
('Google Pay',      'Payment using Google Pay'),
('Cash at airport', 'Pay at the airline desk before check-in');

-- ---------- passengers (500) ----------
INSERT INTO PASSENGER (first_name, last_name, email, phone, document_number) VALUES
('Aruzhan', 'Ospan',  'aruzhan@gmail.com', '+77001234567', '041234567'),
('Amina',   'Kairat', 'amina@gmail.com',   '+77007654321', '045551234'),
('Dana',    'Samat',  'dana@gmail.com',    '+77005555555', NULL);

INSERT INTO PASSENGER (first_name, last_name, email, phone)
SELECT (ARRAY['Aruzhan','Amina','Dana','Ali','Sanzhar','Dias','Madina','Aibar','Kairat','Nurlan'])[1 + ((i - 1) % 10)],
       (ARRAY['Ospan','Kairat','Samat','Nurpeis','Alim'])[1 + ((i - 1) % 5)],
       'passenger' || i || '@gmail.com',
       '+7700' || LPAD(i::text, 7, '0')
FROM generate_series(4, 500) AS i;

-- ---------- demo login: aruzhan@gmail.com / demo1234 ----------
INSERT INTO APP_USER (email, password_hash, passenger_id) VALUES
('aruzhan@gmail.com',
 'scrypt$16384$3e9d83675aa88b07ea1d881fa121b05a$f9ed2a4e7a1ff1aae047566b8ee8b557b672b300c931780686122b9dbc583b54e30dcb76c379c920b805bcc461e4257171a71b27a2ccc152531a4fc1aa46acd3',
 1);

-- =====================================================================
--  DOMESTIC schedule (Kazakhstan): every pair that touches Astana or Almaty
-- =====================================================================
WITH routes AS (
    SELECT o.code AS origin, d.code AS destination,
           row_number() OVER (ORDER BY o.code, d.code)::int AS route_no,
           round(6371 * 2 * asin(sqrt(
               power(sin(radians(d.latitude - o.latitude) / 2), 2) +
               cos(radians(o.latitude)) * cos(radians(d.latitude)) *
               power(sin(radians(d.longitude - o.longitude) / 2), 2))))::int AS km,
           CASE WHEN o.code IN ('NQZ','ALA') AND d.code IN ('NQZ','ALA') THEN 4 ELSE 2 END AS freq
    FROM AIRPORT o JOIN AIRPORT d ON o.code <> d.code
    WHERE o.region = 'Kazakhstan' AND d.region = 'Kazakhstan'
      AND (o.code IN ('NQZ','ALA') OR d.code IN ('NQZ','ALA'))
),
slots AS (
    SELECT r.*, s.slot,
           -- Qazaq Air's turboprops only fly the shorter routes
           CASE WHEN (r.route_no * 7 + s.slot * 3) % 4 = 3 AND r.km > 1100 THEN 2
                ELSE (r.route_no * 7 + s.slot * 3) % 4 END AS al_idx
    FROM routes r CROSS JOIN generate_series(1, 4) s(slot)
    WHERE s.slot <= r.freq
),
airlines AS (
    SELECT * FROM (VALUES (0, 'Air Astana', 'KC', 1.15),
                          (1, 'FlyArystan', 'FS', 0.75),
                          (2, 'SCAT',       'DV', 0.85),
                          (3, 'Qazaq Air',  'IQ', 1.00)) v(idx, name, code, factor)
),
-- domestic flights use narrow-body planes only
fleet AS (SELECT airline, array_agg(aircraft_id ORDER BY aircraft_id) AS ids FROM AIRCRAFT
          WHERE length(seat_letters) <= 6 GROUP BY airline),
gates AS (SELECT airport_code, array_agg(gate_id ORDER BY gate_id) AS ids FROM GATE GROUP BY airport_code),
plan AS (
    SELECT sl.*, al.name AS airline, al.code AS al_code, al.factor, day::date AS day,
           abs(hashtext(sl.route_no || '-' || sl.slot || '-' || day::date)) AS h,
           (day::date
              + make_interval(hours => 6 + ((sl.slot - 1) * 16) / sl.freq + sl.route_no % 3,
                              mins  => ((sl.route_no * 13 + sl.slot * 7) % 4) * 15)) AS dep,
           (round((25 + sl.km / 11.0) / 5) * 5)::int AS minutes
    FROM slots sl
    JOIN airlines al ON al.idx = sl.al_idx
    CROSS JOIN generate_series(CURRENT_DATE - 7, CURRENT_DATE + 35, interval '1 day') day
),
priced AS (
    SELECT p.*,
           round((9000 + p.km * 20) * p.factor
                 * CASE WHEN extract(dow FROM p.day) IN (5, 0) THEN 1.12 ELSE 1 END
                 * (0.90 + (p.h % 25) / 100.0)
                 * CASE WHEN p.day - CURRENT_DATE < 3  THEN 1.30
                        WHEN p.day - CURRENT_DATE < 10 THEN 1.12 ELSE 1 END
                 / 100) * 100 AS eco
    FROM plan p
)
INSERT INTO FLIGHT (flight_number, airline, origin, destination, departure_time, arrival_time,
                    departure_utc, arrival_utc, price, business_price, status, gate_id, aircraft_id)
SELECT pr.al_code || '-' || (100 + pr.route_no * 5 + pr.slot),
       pr.airline, pr.origin, pr.destination,
       pr.dep, pr.dep + make_interval(mins => pr.minutes),
       pr.dep - interval '5 hours', pr.dep - interval '5 hours' + make_interval(mins => pr.minutes),
       pr.eco, round(pr.eco * 2.4 / 100) * 100,
       CASE WHEN pr.dep - interval '5 hours' + make_interval(mins => pr.minutes) < (now() AT TIME ZONE 'UTC') THEN 'Arrived'
            WHEN pr.h % 37 = 0 THEN 'Delayed' ELSE 'Scheduled' END,
       g.ids[1 + pr.h % cardinality(g.ids)],
       fl.ids[1 + (pr.h / 7) % cardinality(fl.ids)]
FROM priced pr
JOIN fleet fl ON fl.airline = pr.airline
JOIN gates g  ON g.airport_code = pr.origin
ORDER BY pr.dep, pr.origin;

-- =====================================================================
--  INTERNATIONAL schedule: every pair of world hubs + Astana/Almaty.
--  The origin's home airline flies it (daily, or about every other day on
--  very long routes); the destination's airline adds ~2–3 flights a week.
--  Local arrival time = departure (UTC) + flight time + destination offset.
-- =====================================================================
WITH intl AS (
    SELECT a.code, a.latitude, a.longitude, a.utc_offset, l.name AS airline, l.airline_code AS al_code
    FROM AIRPORT a JOIN AIRLINE l ON l.hub = a.code WHERE a.region <> 'Kazakhstan'
    UNION ALL
    SELECT a.code, a.latitude, a.longitude, a.utc_offset, 'Air Astana', 'KC' FROM AIRPORT a WHERE a.code IN ('NQZ','ALA')
),
pairs AS (
    SELECT o.code AS origin, d.code AS destination, o.utc_offset AS o_off, d.utc_offset AS d_off,
           o.airline AS o_al, o.al_code AS o_code, d.airline AS d_al, d.al_code AS d_code,
           row_number() OVER (ORDER BY o.code, d.code)::int AS rn,
           round(6371 * 2 * asin(sqrt(
               power(sin(radians(d.latitude - o.latitude) / 2), 2) +
               cos(radians(o.latitude)) * cos(radians(d.latitude)) *
               power(sin(radians(d.longitude - o.longitude) / 2), 2))))::int AS km
    FROM intl o JOIN intl d ON o.code <> d.code
    WHERE NOT (o.code IN ('NQZ','ALA') AND d.code IN ('NQZ','ALA'))
),
ops AS (
    SELECT p.*, 0 AS side, p.o_al AS airline, p.o_code AS al_code FROM pairs p
    UNION ALL
    SELECT p.*, 1, p.d_al, p.d_code FROM pairs p WHERE p.d_al <> p.o_al
),
factor AS (
    SELECT * FROM (VALUES ('EK', 1.15), ('QR', 1.15), ('SQ', 1.15), ('BA', 1.10), ('AF', 1.08), ('LH', 1.08),
                          ('JL', 1.10), ('AA', 1.05), ('UA', 1.05), ('QF', 1.08), ('KL', 1.02), ('IB', 1.00),
                          ('TK', 0.98), ('KE', 1.02), ('KC', 1.00), ('SU', 0.92), ('HY', 0.88), ('AI', 0.90),
                          ('CA', 0.92), ('TG', 0.95)) v(code, f)
),
fleet AS (
    SELECT airline,
           array_agg(aircraft_id ORDER BY aircraft_id) FILTER (WHERE length(seat_letters) <= 6) AS narrow,
           array_agg(aircraft_id ORDER BY aircraft_id) FILTER (WHERE length(seat_letters) > 6)  AS wide
    FROM AIRCRAFT GROUP BY airline
),
gates AS (SELECT airport_code, array_agg(gate_id ORDER BY gate_id) AS ids FROM GATE GROUP BY airport_code),
plan AS (
    SELECT o.*, day::date AS day,
           abs(hashtext(o.rn || '-' || o.side || '-' || day::date)) AS h,
           day::date + make_interval(hours => 6 + (o.rn * 5 + o.side * 7) % 17,
                                     mins  => ((o.rn * 7 + o.side * 2) % 4) * 15) AS dep_local,
           (round((35 + o.km / 13.5) / 5) * 5)::int AS minutes
    FROM ops o
    CROSS JOIN generate_series(CURRENT_DATE - 1, CURRENT_DATE + 30, interval '1 day') day
    WHERE (o.side = 0 AND (o.km < 7000 OR (extract(doy FROM day)::int + o.rn) % 2 = 0))
       OR (o.side = 1 AND (extract(doy FROM day)::int + o.rn) % 3 = 0)
),
timed AS (
    SELECT p.*,
           p.dep_local - make_interval(secs => p.o_off * 3600) AS dep_utc,
           p.dep_local - make_interval(secs => p.o_off * 3600) + make_interval(mins => p.minutes) AS arr_utc,
           round((14000 + p.km * 34) * COALESCE(f.f, 1)
                 * CASE WHEN extract(dow FROM p.day) IN (5, 0) THEN 1.10 ELSE 1 END
                 * (0.88 + (p.h % 25) / 100.0)
                 * CASE WHEN p.day - CURRENT_DATE < 3  THEN 1.30
                        WHEN p.day - CURRENT_DATE < 10 THEN 1.12 ELSE 1 END
                 / 100) * 100 AS eco
    FROM plan p LEFT JOIN factor f ON f.code = p.al_code
)
INSERT INTO FLIGHT (flight_number, airline, origin, destination, departure_time, arrival_time,
                    departure_utc, arrival_utc, price, business_price, status, gate_id, aircraft_id)
SELECT t.al_code || '-' || (300 + t.rn + t.side * 500),
       t.airline, t.origin, t.destination,
       t.dep_local, t.arr_utc + make_interval(secs => t.d_off * 3600),
       t.dep_utc, t.arr_utc,
       t.eco, round(t.eco * CASE WHEN t.km > 3500 THEN 3.4 ELSE 2.5 END / 100) * 100,
       CASE WHEN t.arr_utc < (now() AT TIME ZONE 'UTC') THEN 'Arrived'
            WHEN t.h % 41 = 0 THEN 'Delayed' ELSE 'Scheduled' END,
       g.ids[1 + t.h % cardinality(g.ids)],
       CASE WHEN t.km < 3500 AND fl.narrow IS NOT NULL THEN fl.narrow[1 + t.h % cardinality(fl.narrow)]
            ELSE (COALESCE(fl.wide, fl.narrow))[1 + t.h % cardinality(COALESCE(fl.wide, fl.narrow))] END
FROM timed t
JOIN fleet fl ON fl.airline = t.airline
JOIN gates g  ON g.airport_code = t.origin
ORDER BY t.dep_utc, t.origin;

-- =====================================================================
--  Demo account's bookings (inserted first so their seats are guaranteed)
-- =====================================================================
-- Upcoming: Astana -> Almaty in 5 days, two travellers on one booking reference.
WITH f AS (SELECT flight_id, aircraft_id, price FROM FLIGHT
           WHERE origin = 'NQZ' AND destination = 'ALA' AND departure_time::date = CURRENT_DATE + 5
           ORDER BY departure_time LIMIT 1)
INSERT INTO BOOKING (booking_ref, booking_date, status, passenger_id, flight_id, seat_id, user_id, payment_id, fare, total_price)
SELECT 'SMG7K2', CURRENT_DATE - 2, 'Confirmed', t.pid, f.flight_id, s.seat_id, 1, 2, f.price, f.price
FROM f
CROSS JOIN (VALUES (1, '8A'), (2, '8B')) t(pid, seat)
JOIN SEAT s ON s.aircraft_id = f.aircraft_id AND s.seat_number = t.seat;

-- Upcoming: Almaty -> Istanbul in 9 days (international).
WITH f AS (SELECT flight_id, aircraft_id, price FROM FLIGHT
           WHERE origin = 'ALA' AND destination = 'IST' AND departure_time::date = CURRENT_DATE + 9
           ORDER BY departure_time LIMIT 1)
INSERT INTO BOOKING (booking_ref, booking_date, status, passenger_id, flight_id, seat_id, user_id, payment_id, fare, total_price)
SELECT 'SMG2TK', CURRENT_DATE - 1, 'Confirmed', 1, f.flight_id, s.seat_id, 1, 1, f.price, f.price
FROM f JOIN SEAT s ON s.aircraft_id = f.aircraft_id AND s.seat_number = '14A';

-- Upcoming: return Almaty -> Astana in 12 days, Business.
WITH f AS (SELECT flight_id, aircraft_id, business_price FROM FLIGHT
           WHERE origin = 'ALA' AND destination = 'NQZ' AND departure_time::date = CURRENT_DATE + 12
             AND airline IN ('Air Astana','SCAT')
           ORDER BY departure_time LIMIT 1)
INSERT INTO BOOKING (booking_ref, booking_date, status, passenger_id, flight_id, seat_id, user_id, payment_id, fare, total_price)
SELECT 'SMG9QX', CURRENT_DATE - 2, 'Confirmed', 1, f.flight_id, s.seat_id, 1, 1, f.business_price, f.business_price
FROM f JOIN SEAT s ON s.aircraft_id = f.aircraft_id AND s.seat_number = '1C';

-- Past trip: Astana -> Shymkent 5 days ago.
WITH f AS (SELECT flight_id, aircraft_id, price FROM FLIGHT
           WHERE origin = 'NQZ' AND destination = 'CIT' AND departure_time::date = CURRENT_DATE - 5
           ORDER BY departure_time LIMIT 1)
INSERT INTO BOOKING (booking_ref, booking_date, status, passenger_id, flight_id, seat_id, user_id, payment_id, fare, total_price)
SELECT 'SMG3PL', CURRENT_DATE - 20, 'Confirmed', 1, f.flight_id, s.seat_id, 1, 2, f.price, f.price
FROM f JOIN SEAT s ON s.aircraft_id = f.aircraft_id AND s.seat_number = '12F';

-- Cancelled: Astana -> Aktobe in 20 days.
WITH f AS (SELECT flight_id, aircraft_id, price FROM FLIGHT
           WHERE origin = 'NQZ' AND destination = 'AKX' AND departure_time::date = CURRENT_DATE + 20
           ORDER BY departure_time LIMIT 1)
INSERT INTO BOOKING (booking_ref, booking_date, status, passenger_id, flight_id, seat_id, user_id, payment_id, fare, total_price)
SELECT 'SMG5CN', CURRENT_DATE - 1, 'Cancelled', 1, f.flight_id, s.seat_id, 1, 3, f.price, f.price
FROM f JOIN SEAT s ON s.aircraft_id = f.aircraft_id AND s.seat_number = '10C';

-- Bag on the first demo booking (20 kg at 500 ₸/kg).
INSERT INTO BAGGAGE (weight_kg, price, booking_id, payment_id)
SELECT 20, 10000, booking_id, 2 FROM BOOKING WHERE booking_ref = 'SMG7K2' AND passenger_id = 1;
UPDATE BOOKING SET total_price = fare + 10000 WHERE booking_ref = 'SMG7K2' AND passenger_id = 1;

-- Payments for the demo account (one per booking reference).
INSERT INTO PAYMENT (booking_ref, user_id, payment_id, amount, status, card_brand, card_last4, payer_phone, auth_code, created_at)
SELECT b.booking_ref, 1, MIN(b.payment_id), SUM(b.total_price),
       CASE WHEN bool_and(b.status = 'Cancelled') THEN 'Refunded' ELSE 'Paid' END,
       CASE WHEN MIN(b.payment_id) = 1 THEN 'Visa' END, CASE WHEN MIN(b.payment_id) = 1 THEN '4242' END,
       CASE WHEN MIN(b.payment_id) = 2 THEN '+77001234567' END,
       upper(substr(md5(b.booking_ref), 1, 6)), MIN(b.booking_date)::timestamptz + interval '10 hours'
FROM BOOKING b WHERE b.user_id = 1 GROUP BY b.booking_ref;

-- =====================================================================
--  Other customers' bookings
--  Domestic planes fill up as departure gets closer; international flights
--  only get bookings in the next ~6 days (keeps the database small).
--  ON CONFLICT skips any seat that is already sold (ux_booking_flight_seat).
-- =====================================================================
-- The seat trigger is switched off just for this bulk insert: every row joins
-- SEAT on the flight's own aircraft, so the rule it checks already holds.
ALTER TABLE BOOKING DISABLE TRIGGER trg_booking_seat;

INSERT INTO BOOKING (booking_ref, booking_date, status, passenger_id, flight_id, seat_id, payment_id, fare, total_price)
SELECT upper(substr(md5(f.flight_id || ':' || s.seat_id), 1, 6)),
       LEAST(CURRENT_DATE, f.departure_time::date - 1 - (x.h % 30)),
       CASE WHEN x.h % 23 = 0 THEN 'Cancelled' WHEN x.h % 17 = 0 THEN 'Pending' ELSE 'Confirmed' END,
       1 + x.h % 500,
       f.flight_id, s.seat_id,
       1 + x.h % 5,
       x.fare,
       x.fare + CASE WHEN x.h % 3 = 0 THEN (ARRAY[10, 15, 20, 23])[1 + x.h % 4] * 500 ELSE 0 END   -- a third check a bag
FROM FLIGHT f
JOIN AIRPORT oa ON oa.code = f.origin
JOIN AIRPORT da ON da.code = f.destination
JOIN SEAT s ON s.aircraft_id = f.aircraft_id AND s.status = 'Available'
CROSS JOIN LATERAL (SELECT abs(hashtext(f.flight_id || ':' || s.seat_id)) AS h,
                           (oa.region = 'Kazakhstan' AND da.region = 'Kazakhstan') AS domestic,
                           f.departure_time::date - CURRENT_DATE AS days,
                           CASE WHEN s.class = 'Business' THEN f.business_price ELSE f.price END AS fare) x
WHERE (x.domestic OR f.departure_time::date <= CURRENT_DATE + 6)
  AND x.h % 100 < CASE WHEN x.domestic THEN GREATEST(4, 50 - x.days * 1.6)
                       ELSE GREATEST(0, LEAST(18, 16 - x.days * 2.5)) END
ON CONFLICT DO NOTHING;

ALTER TABLE BOOKING ENABLE TRIGGER trg_booking_seat;

-- The checked bags behind those prices (500 ₸ per kg).
INSERT INTO BAGGAGE (weight_kg, price, booking_id, payment_id)
SELECT (total_price - fare) / 500, total_price - fare, booking_id, payment_id
FROM BOOKING WHERE user_id IS NULL AND total_price > fare;

ANALYZE;
