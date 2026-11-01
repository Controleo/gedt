-- Practice routes for the practitioner evaluation.
-- Adds 60 short Lagoon Telecom routes (LAG-EVAL-01 to LAG-EVAL-60) beside the Ikorodu Road corridor,
-- close enough to the other two operators' routes that a cut on one warns both of them.
-- Each evaluator uses the route that matches their participant number, so nobody collides.
-- Run once after the normal demo data:  npm run db:eval
BEGIN;
INSERT INTO routes (operator_id, route_code, name, route_type, status, visibility, total_fibres, spare_capacity_fibres, install_date, geom)
SELECT (SELECT operator_id FROM operators WHERE name = 'Lagoon Telecom'),
       'LAG-EVAL-' || lpad(n::text, 2, '0'), 'Practice route ' || lpad(n::text, 2, '0'), 'distribution', 'active', 'private', 12, 0, DATE '2026-01-01',
       ST_Translate(ST_LineSubstring(b.geom, (n - 1) / 60.0, n / 60.0), 0.00008, 0)
FROM generate_series(1, 60) AS n, (SELECT geom FROM routes WHERE route_code = 'LAG-IKR-BB-02') AS b;
COMMIT;
