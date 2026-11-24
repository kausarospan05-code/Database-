-- =====================================================================
--  Samgau Flights — useful queries (run in pgAdmin / psql)
-- =====================================================================

-- ---------- JOINs (Week 9) ----------

-- LEFT JOIN: every passenger, with their bookings if they have any
SELECT p.first_name, p.last_name, b.booking_id, b.booking_ref, b.status
FROM PASSENGER p
LEFT JOIN BOOKING b ON p.passenger_id = b.passenger_id
ORDER BY p.passenger_id
LIMIT 50;

-- FULL OUTER JOIN: flights and aircraft, including aircraft with no flights
SELECT f.flight_number, f.departure_time, a.model, a.manufacturer
FROM FLIGHT f
FULL OUTER JOIN AIRCRAFT a ON f.aircraft_id = a.aircraft_id
LIMIT 50;

-- RIGHT JOIN: every aircraft and the flights it operates
SELECT a.aircraft_id, a.registration, a.model, a.capacity, f.flight_number
FROM FLIGHT f
RIGHT JOIN AIRCRAFT a ON f.aircraft_id = a.aircraft_id
LIMIT 50;

-- INNER JOIN across 5 tables: full flight board for tomorrow
SELECT f.flight_number, f.airline, o.city AS from_city, d.city AS to_city,
       f.departure_time, f.arrival_time, g.gate_number, g.terminal,
       a.manufacturer || ' ' || a.model AS aircraft
FROM FLIGHT f
JOIN AIRPORT o   ON o.code = f.origin
JOIN AIRPORT d   ON d.code = f.destination
LEFT JOIN GATE g ON g.gate_id = f.gate_id
LEFT JOIN AIRCRAFT a ON a.aircraft_id = f.aircraft_id
WHERE f.departure_time::date = CURRENT_DATE + 1
ORDER BY f.departure_time;

-- ---------- aggregates / reports ----------

-- Revenue and passengers per airline (excluding cancellations)
SELECT f.airline,
       COUNT(*)                       AS passengers,
       SUM(b.total_price)             AS revenue,
       ROUND(AVG(b.total_price))      AS avg_ticket
FROM BOOKING b JOIN FLIGHT f ON f.flight_id = b.flight_id
WHERE b.status <> 'Cancelled'
GROUP BY f.airline
ORDER BY revenue DESC;

-- Most popular routes
SELECT f.origin || ' → ' || f.destination AS route, COUNT(*) AS passengers
FROM BOOKING b JOIN FLIGHT f ON f.flight_id = b.flight_id
WHERE b.status <> 'Cancelled'
GROUP BY route
ORDER BY passengers DESC
LIMIT 10;

-- Load factor (% seats sold) of upcoming flights, fullest first
SELECT f.flight_number, f.origin, f.destination, f.departure_time,
       v.economy_total + v.business_total                         AS seats,
       (v.economy_total + v.business_total) - (v.economy_left + v.business_left) AS sold,
       ROUND(100.0 * (1 - (v.economy_left + v.business_left)::numeric
                        / NULLIF(v.economy_total + v.business_total, 0)), 1) AS load_pct
FROM FLIGHT f JOIN v_flight_availability v USING (flight_id)
WHERE f.departure_time > LOCALTIMESTAMP
ORDER BY load_pct DESC
LIMIT 20;

-- Payment method popularity (HAVING example)
SELECT pm.method_name, COUNT(*) AS bookings
FROM BOOKING b JOIN PAYMENT_METHOD pm ON pm.payment_id = b.payment_id
GROUP BY pm.method_name
HAVING COUNT(*) > 100
ORDER BY bookings DESC;

-- Subquery: passengers who spent more than the average customer
SELECT p.first_name, p.last_name, SUM(b.total_price) AS spent
FROM PASSENGER p JOIN BOOKING b ON b.passenger_id = p.passenger_id
WHERE b.status <> 'Cancelled'
GROUP BY p.passenger_id
HAVING SUM(b.total_price) > (
    SELECT AVG(t) FROM (SELECT SUM(total_price) t FROM BOOKING WHERE status <> 'Cancelled' GROUP BY passenger_id) x)
ORDER BY spent DESC
LIMIT 20;

-- Window function: cheapest flight per route for each day next week
SELECT * FROM (
    SELECT f.origin, f.destination, f.departure_time::date AS day, f.flight_number, f.price,
           RANK() OVER (PARTITION BY f.origin, f.destination, f.departure_time::date ORDER BY f.price) AS rnk
    FROM FLIGHT f
    WHERE f.departure_time::date BETWEEN CURRENT_DATE + 1 AND CURRENT_DATE + 7
) t
WHERE rnk = 1
ORDER BY origin, destination, day;

-- Everything about one booking reference (uses the view)
SELECT * FROM v_booking_details WHERE booking_ref = 'SMG7K2';

-- ---------- world network ----------

-- Istanbul -> London in the next week, with local times and real flight duration
SELECT f.flight_number, f.airline, f.departure_time AS departs_local, f.arrival_time AS arrives_local,
       f.arrival_utc - f.departure_utc AS duration, f.price, a.manufacturer || ' ' || a.model AS aircraft
FROM FLIGHT f JOIN AIRCRAFT a ON a.aircraft_id = f.aircraft_id
WHERE f.origin = 'IST' AND f.destination = 'LHR'
  AND f.departure_time::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
ORDER BY f.departure_time;

-- Each airline: home hub, fleet size and how many flights it operates
SELECT l.airline_code, l.name, ap.city AS hub,
       (SELECT COUNT(*) FROM AIRCRAFT a WHERE a.airline = l.name) AS aircraft,
       (SELECT COUNT(*) FROM FLIGHT f WHERE f.airline = l.name)   AS flights
FROM AIRLINE l LEFT JOIN AIRPORT ap ON ap.code = l.hub
ORDER BY flights DESC;

-- Longest routes in the network
SELECT origin, destination, MAX(arrival_utc - departure_utc) AS duration
FROM FLIGHT GROUP BY origin, destination ORDER BY duration DESC LIMIT 10;

-- ---------- payments ----------

-- Money taken per payment method (refunds shown separately)
SELECT pm.method_name,
       COUNT(*) FILTER (WHERE p.status = 'Paid')                      AS payments,
       COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'Paid'), 0)     AS paid,
       COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'Refunded'), 0) AS refunded,
       COUNT(*) FILTER (WHERE p.status = 'Pending')                   AS waiting_cash
FROM PAYMENT_METHOD pm LEFT JOIN PAYMENT p ON p.payment_id = pm.payment_id
GROUP BY pm.method_name ORDER BY paid DESC;

-- ---------- promo codes ----------

-- Every code with its state and how much it is used
SELECT code, description,
       COALESCE(discount_percent || '%', discount_amount || ' ₸') AS discount,
       valid_until, used_count, max_uses,
       CASE WHEN NOT active THEN 'Off'
            WHEN CURRENT_DATE > valid_until THEN 'Expired'
            WHEN max_uses IS NOT NULL AND used_count >= max_uses THEN 'Used up'
            ELSE 'Active' END AS state
FROM PROMO_CODE ORDER BY created_at DESC;

-- Ask the database whether a code works (code, user_id, booking total)
SELECT * FROM fn_promo_check('STUDENT10', 1, 120000);   -- ok, 12 000 ₸ off
SELECT * FROM fn_promo_check('SUMMER15', 1, 120000);    -- expired
SELECT * FROM fn_promo_check('LASTONE', 1, 120000);     -- usage limit reached

-- How much each code saved customers (JOIN + GROUP BY)
SELECT pc.code, COUNT(r.redemption_id) AS times_used, COALESCE(SUM(r.discount), 0) AS total_saved
FROM PROMO_CODE pc LEFT JOIN PROMO_REDEMPTION r ON r.code = pc.code
GROUP BY pc.code ORDER BY total_saved DESC;

-- Add a new code by hand (it then works on the website immediately):
-- INSERT INTO PROMO_CODE (code, description, discount_percent, valid_until, max_uses)
-- VALUES ('NEWYEAR25', 'New Year sale: 25% off', 25, '2027-01-10', 200);

-- The database refuses impossible codes (CHECK constraints), e.g. both % and ₸, or 95% off:
-- INSERT INTO PROMO_CODE (code, discount_percent, discount_amount, valid_until) VALUES ('BAD', 10, 500, '2027-01-01');

-- ---------- integrity checks (each should fail) ----------
-- Double-booking a seat is blocked by the unique index ux_booking_flight_seat:
--   INSERT INTO BOOKING (booking_ref, passenger_id, flight_id, seat_id, fare, total_price)
--   SELECT 'TEST01', 3, flight_id, seat_id, 0, 0 FROM BOOKING WHERE booking_ref = 'SMG7K2' LIMIT 1;
-- A seat from a different aircraft is blocked by trigger trg_booking_seat:
--   INSERT INTO BOOKING (booking_ref, passenger_id, flight_id, seat_id, fare, total_price) VALUES ('TEST02', 3, 1, 999999, 0, 0);
