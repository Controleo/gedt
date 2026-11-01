-- =====================================================================
-- GEDT prototype: database checks
-- Run after schema.sql and seed.sql. Each check prints PASS, or stops
-- with an error that says what went wrong. Everything the checks change
-- is rolled back at the end, so the demo data stays untouched.
-- =====================================================================
\set ON_ERROR_STOP on
SET client_min_messages = notice;
BEGIN;

CREATE TEMP TABLE check_results (name text, passed boolean);

CREATE FUNCTION pg_temp.assert_ok(p_name text, p_ok boolean) RETURNS void AS $$
BEGIN
    IF p_ok IS NOT TRUE THEN
        RAISE EXCEPTION 'FAIL: %', p_name;
    END IF;
    RAISE NOTICE 'PASS: %', p_name;
END;
$$ LANGUAGE plpgsql;

-- 1. Demo data is all there
SELECT pg_temp.assert_ok('3 operators, 15 users',
    (SELECT count(*) FROM operators) = 3 AND (SELECT count(*) FROM users) = 15);
SELECT pg_temp.assert_ok('120 devices and 84 routes loaded',
    (SELECT count(*) FROM devices) = 120 AND (SELECT count(*) FROM routes) = 84);
SELECT pg_temp.assert_ok('each operator has all four roles',
    (SELECT count(*) FROM (SELECT operator_id FROM users GROUP BY operator_id
                           HAVING count(DISTINCT role) = 4) t) = 3);

-- 2. Geometry quality
SELECT pg_temp.assert_ok('all geometries are valid and use SRID 4326',
    NOT EXISTS (SELECT 1 FROM (SELECT geom FROM devices UNION ALL SELECT geom FROM routes) g
                WHERE NOT ST_IsValid(geom) OR ST_SRID(geom) <> 4326));
SELECT pg_temp.assert_ok('every route starts and ends within 10 m of its end devices',
    NOT EXISTS (
        SELECT 1 FROM routes r
        JOIN devices s ON s.device_id = r.start_device_id
        JOIN devices e ON e.device_id = r.end_device_id
        WHERE ST_Distance(ST_StartPoint(r.geom)::geography, s.geom::geography) > 10
           OR ST_Distance(ST_EndPoint(r.geom)::geography,   e.geom::geography) > 10));
SELECT pg_temp.assert_ok('devices and routes all lie inside the Lagos area',
    NOT EXISTS (SELECT 1 FROM (SELECT geom FROM devices UNION ALL SELECT geom FROM routes) g
                WHERE NOT ST_Intersects(g.geom, ST_MakeEnvelope(3.2, 6.3, 3.7, 6.8, 4326))));

-- 3. Rules enforced by the database
DO $$
DECLARE d integer := (SELECT min(device_id) FROM devices);
        r integer := (SELECT min(route_id) FROM routes);
        ok boolean;
BEGIN
    ok := false;
    BEGIN INSERT INTO status_log (device_id, route_id, new_status) VALUES (d, r, 'active');
    EXCEPTION WHEN check_violation THEN ok := true; END;
    PERFORM pg_temp.assert_ok('status log rejects an entry for both a device and a route', ok);

    ok := false;
    BEGIN INSERT INTO maintenance_records (issue_type) VALUES ('other');
    EXCEPTION WHEN check_violation THEN ok := true; END;
    PERFORM pg_temp.assert_ok('maintenance record needs a device or a route', ok);

    ok := false;
    BEGIN UPDATE routes SET spare_capacity_fibres = total_fibres + 1 WHERE route_id = r;
    EXCEPTION WHEN check_violation THEN ok := true; END;
    PERFORM pg_temp.assert_ok('spare fibres cannot exceed total fibres', ok);

    ok := false;
    BEGIN UPDATE devices SET status = 'broken' WHERE device_id = d;
    EXCEPTION WHEN check_violation THEN ok := true; END;
    PERFORM pg_temp.assert_ok('unknown device status is rejected', ok);

    ok := false;
    BEGIN UPDATE users SET role = 'superuser' WHERE user_id = 1;
    EXCEPTION WHEN check_violation THEN ok := true; END;
    PERFORM pg_temp.assert_ok('unknown user role is rejected', ok);
END $$;

-- 4. Status log and audit log
DO $$
DECLARE d integer; u integer; before_log integer; before_audit integer;
BEGIN
    SELECT device_id INTO d FROM devices WHERE device_code = 'LAG-IKR-01';
    SELECT user_id INTO u FROM users WHERE email = 'chinedu.eze@lagoon-telecom.example';
    PERFORM set_config('app.current_user_id', u::text, true);
    SELECT count(*) INTO before_log FROM status_log WHERE device_id = d;
    SELECT count(*) INTO before_audit FROM audit_log WHERE table_name = 'devices' AND record_id = d::text;

    UPDATE devices SET status = 'faulty' WHERE device_id = d;

    PERFORM pg_temp.assert_ok('a status change adds one status log row',
        (SELECT count(*) FROM status_log WHERE device_id = d) = before_log + 1);
    PERFORM pg_temp.assert_ok('the status log records who made the change',
        (SELECT recorded_by FROM status_log WHERE device_id = d ORDER BY log_id DESC LIMIT 1) = u);
    PERFORM pg_temp.assert_ok('the audit log records old and new values',
        (SELECT count(*) FROM audit_log WHERE table_name = 'devices' AND record_id = d::text) = before_audit + 1
        AND (SELECT new_data ->> 'status' FROM audit_log WHERE table_name = 'devices'
             AND record_id = d::text ORDER BY audit_id DESC LIMIT 1) = 'faulty');

    UPDATE devices SET name = name WHERE device_id = d;   -- no status change
    PERFORM pg_temp.assert_ok('an update without a status change adds no status log row',
        (SELECT count(*) FROM status_log WHERE device_id = d) = before_log + 1);
END $$;

-- 4b. User changes are audited without password hashes
DO $$
DECLARE u integer; a integer := (SELECT user_id FROM users WHERE email = 'adaeze.okafor@lagoon-telecom.example');
BEGIN
    SELECT user_id INTO u FROM users WHERE email = 'tobi.adebayo@savanna-fibre.example';
    PERFORM set_config('app.current_user_id', a::text, true);
    UPDATE users SET role = 'asset_manager' WHERE user_id = u;
    PERFORM pg_temp.assert_ok('a role change is audited and the password hash is not stored in the audit log',
        EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'users' AND record_id = u::text
                AND new_data ->> 'role' = 'asset_manager' AND NOT (new_data ? 'password_hash')
                AND NOT (old_data ? 'password_hash') AND user_id = a));
END $$;

-- 5. Confidentiality between operators (FR12)
SELECT pg_temp.assert_ok('shared route view contains no private routes',
    NOT EXISTS (SELECT 1 FROM v_routes_shared s JOIN routes r USING (route_id) WHERE r.visibility <> 'shared'));
SELECT pg_temp.assert_ok('free route view only shows shared, working routes with spare fibres',
    NOT EXISTS (SELECT 1 FROM v_free_routes f JOIN routes r USING (route_id)
                WHERE r.visibility <> 'shared' OR r.status <> 'active' OR r.spare_capacity_fibres = 0)
    AND (SELECT count(*) FROM v_free_routes) > 0);
SELECT pg_temp.assert_ok('shared route view hides device details and notes',
    NOT EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'v_routes_shared'
                  AND column_name IN ('created_by', 'install_date', 'total_fibres')));
SELECT pg_temp.assert_ok('shared device view shows only shared devices and hides code, notes and dates',
    NOT EXISTS (SELECT 1 FROM v_devices_shared s JOIN devices d USING (device_id) WHERE d.visibility <> 'shared')
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'v_devices_shared'
                      AND column_name IN ('device_code', 'name', 'details', 'install_date', 'created_by')));
SELECT pg_temp.assert_ok('neighbour notifications never mention the owner or the route code',
    NOT EXISTS (SELECT 1 FROM notifications n
                JOIN alerts a USING (alert_id) JOIN routes r ON r.route_id = a.route_id
                JOIN operators o ON o.operator_id = r.operator_id
                WHERE n.reason = 'corridor_neighbour'
                  AND (n.message ILIKE '%' || o.name || '%' OR n.message ILIKE '%' || r.route_code || '%')));

-- 6. Corridor neighbours (distance logic)
-- Sideways offsets in the demo data: IKR 0/20/60 m, LEK 0/250/90 m, AOE 0/40/400 m
SELECT pg_temp.assert_ok('Ikorodu Road: both other operators are within 100 m of a Lagoon route',
    (SELECT count(DISTINCT operator_id) FROM find_corridor_neighbours(
        (SELECT route_id FROM routes WHERE route_code = 'LAG-IKR-BB-02'),
        ST_LineInterpolatePoint((SELECT geom FROM routes WHERE route_code = 'LAG-IKR-BB-02'), 0.5), 100)) = 2);
SELECT pg_temp.assert_ok('Lekki corridor: Savanna (90 m) is a neighbour, Harmattan (250 m) is not',
    (SELECT array_agg(DISTINCT o.name ORDER BY o.name) FROM find_corridor_neighbours(
        (SELECT route_id FROM routes WHERE route_code = 'LAG-LEK-BB-02'),
        ST_LineInterpolatePoint((SELECT geom FROM routes WHERE route_code = 'LAG-LEK-BB-02'), 0.5), 120) n
        JOIN operators o ON o.operator_id = n.operator_id) = ARRAY['Savanna Fibre']);
SELECT pg_temp.assert_ok('Apapa corridor: Harmattan (40 m) is a neighbour, Savanna (400 m) is not',
    (SELECT array_agg(DISTINCT o.name ORDER BY o.name) FROM find_corridor_neighbours(
        (SELECT route_id FROM routes WHERE route_code = 'LAG-AOE-BB-02'),
        ST_LineInterpolatePoint((SELECT geom FROM routes WHERE route_code = 'LAG-AOE-BB-02'), 0.5), 100) n
        JOIN operators o ON o.operator_id = n.operator_id) = ARRAY['Harmattan Networks']);

-- 7. Seeded alerts
SELECT pg_temp.assert_ok('demo data has 2 open alerts and 1 resolved alert',
    (SELECT count(*) FROM alerts WHERE status <> 'resolved') = 2
    AND (SELECT count(*) FROM alerts WHERE status = 'resolved') = 1);
SELECT pg_temp.assert_ok('routes with open alerts are marked as cut',
    NOT EXISTS (SELECT 1 FROM alerts a JOIN routes r USING (route_id)
                WHERE a.status <> 'resolved' AND r.status <> 'cut'));
SELECT pg_temp.assert_ok('the resolved alert left a resolved maintenance record',
    EXISTS (SELECT 1 FROM maintenance_records m JOIN alerts a USING (alert_id)
            WHERE a.status = 'resolved' AND m.status = 'resolved' AND m.issue_type = 'fibre_cut'));

-- 8. Full alert cycle: raise, notify, resolve
DO $$
DECLARE rid integer; alert integer; owner_op integer; techn integer; mgr integer;
BEGIN
    SELECT route_id, operator_id INTO rid, owner_op FROM routes WHERE route_code = 'LAG-MIL-BB-01';
    SELECT user_id INTO techn FROM users WHERE email = 'chinedu.eze@lagoon-telecom.example';
    SELECT user_id INTO mgr   FROM users WHERE email = 'tunde.bakare@lagoon-telecom.example';

    alert := raise_fibre_cut_alert(rid, 'technician', NULL, techn);

    PERFORM pg_temp.assert_ok('raising an alert marks the route as cut',
        (SELECT status FROM routes WHERE route_id = rid) = 'cut');
    PERFORM pg_temp.assert_ok('the new alert starts with status new',
        (SELECT status FROM alerts WHERE alert_id = alert) = 'new');
    PERFORM pg_temp.assert_ok('the owner is notified in the app and by email',
        (SELECT count(*) FROM notifications WHERE alert_id = alert AND reason = 'owner' AND channel = 'in_app') = 2
        AND (SELECT count(*) FROM notifications WHERE alert_id = alert AND reason = 'owner' AND channel = 'email') = 1);
    PERFORM pg_temp.assert_ok('the Harmattan route 35 m away is warned, Savanna 180 m away is not',
        EXISTS (SELECT 1 FROM notifications n JOIN operators o ON o.operator_id = n.recipient_operator_id
                WHERE n.alert_id = alert AND n.reason = 'corridor_neighbour' AND o.name = 'Harmattan Networks')
        AND NOT EXISTS (SELECT 1 FROM notifications n JOIN operators o ON o.operator_id = n.recipient_operator_id
                WHERE n.alert_id = alert AND o.name = 'Savanna Fibre'));
    PERFORM pg_temp.assert_ok('field technicians do not receive notifications',
        NOT EXISTS (SELECT 1 FROM notifications n JOIN users u ON u.user_id = n.recipient_user_id
                    WHERE n.alert_id = alert AND u.role = 'field_technician'));
    PERFORM pg_temp.assert_ok('the cut is written to the status log with the technician',
        EXISTS (SELECT 1 FROM status_log WHERE route_id = rid AND new_status = 'cut' AND recorded_by = techn));

    PERFORM resolve_alert(alert, mgr, 'Test repair.');
    PERFORM pg_temp.assert_ok('resolving an alert restores the route',
        (SELECT status FROM routes WHERE route_id = rid) = 'active'
        AND (SELECT status FROM alerts WHERE alert_id = alert) = 'resolved');
    PERFORM pg_temp.assert_ok('resolving an alert records a repair in maintenance',
        EXISTS (SELECT 1 FROM maintenance_records WHERE alert_id = alert AND status = 'resolved'));
END $$;

-- 9. Dashboard views
SELECT pg_temp.assert_ok('asset counts add up to all devices and routes',
    (SELECT sum(total) FROM v_asset_counts) = 120 + 84);
SELECT pg_temp.assert_ok('open alert view lists only alerts that are not resolved',
    NOT EXISTS (SELECT 1 FROM v_open_alerts WHERE status = 'resolved'));

ROLLBACK;
\echo
\echo All checks passed. Test changes were rolled back.
