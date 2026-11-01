-- =====================================================================
-- GEDT prototype: database schema, version 2
-- PostgreSQL 16 with PostGIS 3.4
--
-- Covers the version 2 requirements: devices as points, fibre routes
-- as lines, one shared registry for several operators, an audit log,
-- and fibre cut alerts with notifications.
--
-- Run this file on an empty database. It can be run again safely
-- because it starts by removing the old objects.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Remove old objects so the script can be re-run during development
SET client_min_messages = warning;
DROP VIEW  IF EXISTS v_asset_counts, v_open_alerts, v_free_routes, v_routes_shared, v_devices_shared CASCADE;
DROP TABLE IF EXISTS audit_log, notifications, alerts, maintenance_records,
                     status_log, routes, devices, users, operators CASCADE;
DROP FUNCTION IF EXISTS fn_set_updated_at(), fn_log_status_change(),
                        fn_write_audit(), find_corridor_neighbours(int, geometry, numeric),
                        raise_fibre_cut_alert(int, text, geometry, int, numeric),
                        resolve_alert(int, int, text) CASCADE;

-- ---------------------------------------------------------------------
-- 1. Operators and users
-- ---------------------------------------------------------------------
CREATE TABLE operators (
    operator_id   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name          text NOT NULL UNIQUE,
    contact_email text,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
    user_id       integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operator_id   integer NOT NULL REFERENCES operators(operator_id),
    full_name     text NOT NULL,
    email         text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    role          text NOT NULL CHECK (role IN
                    ('field_technician', 'asset_manager', 'gis_admin', 'decision_maker')),
    is_active     boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_operator ON users(operator_id);

-- ---------------------------------------------------------------------
-- 2. Devices (points) and routes (lines)
-- ---------------------------------------------------------------------
CREATE TABLE devices (
    device_id    integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operator_id  integer NOT NULL REFERENCES operators(operator_id),
    device_code  text NOT NULL UNIQUE,
    name         text NOT NULL,
    device_type  text NOT NULL CHECK (device_type IN
                   ('tower', 'olt', 'pop', 'splice_enclosure', 'distribution_point')),
    status       text NOT NULL DEFAULT 'active' CHECK (status IN
                   ('active', 'faulty', 'under_repair', 'vandalised', 'decommissioned')),
    visibility   text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared')),
    install_date date,
    geom         geometry(Point, 4326) NOT NULL,
    details      jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by   integer REFERENCES users(user_id),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_devices_geom     ON devices USING gist (geom);
CREATE INDEX idx_devices_operator ON devices(operator_id);
CREATE INDEX idx_devices_status   ON devices(status);

CREATE TABLE routes (
    route_id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operator_id          integer NOT NULL REFERENCES operators(operator_id),
    route_code           text NOT NULL UNIQUE,
    name                 text NOT NULL,
    route_type           text NOT NULL CHECK (route_type IN
                           ('backbone', 'feeder', 'distribution', 'drop')),
    status               text NOT NULL DEFAULT 'active' CHECK (status IN
                           ('active', 'cut', 'under_repair', 'planned', 'decommissioned')),
    visibility           text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared')),
    total_fibres         integer NOT NULL DEFAULT 0 CHECK (total_fibres >= 0),
    spare_capacity_fibres integer NOT NULL DEFAULT 0 CHECK (spare_capacity_fibres >= 0),
    start_device_id      integer REFERENCES devices(device_id),
    end_device_id        integer REFERENCES devices(device_id),
    install_date         date,
    geom                 geometry(LineString, 4326) NOT NULL,
    created_by           integer REFERENCES users(user_id),
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    CHECK (spare_capacity_fibres <= total_fibres)
);
CREATE INDEX idx_routes_geom     ON routes USING gist (geom);
CREATE INDEX idx_routes_operator ON routes(operator_id);
CREATE INDEX idx_routes_status   ON routes(status);

-- ---------------------------------------------------------------------
-- 3. Status history, maintenance, alerts, notifications, audit
-- ---------------------------------------------------------------------
CREATE TABLE status_log (
    log_id      integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    device_id   integer REFERENCES devices(device_id),
    route_id    integer REFERENCES routes(route_id),
    old_status  text,
    new_status  text NOT NULL,
    note        text,
    recorded_by integer REFERENCES users(user_id),
    recorded_at timestamptz NOT NULL DEFAULT now(),
    -- exactly one of device_id or route_id must be filled
    CHECK ((device_id IS NOT NULL)::int + (route_id IS NOT NULL)::int = 1)
);
CREATE INDEX idx_status_log_device ON status_log(device_id);
CREATE INDEX idx_status_log_route  ON status_log(route_id);

CREATE TABLE alerts (
    alert_id        integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    route_id        integer NOT NULL REFERENCES routes(route_id),
    alert_type      text NOT NULL DEFAULT 'fibre_cut' CHECK (alert_type IN ('fibre_cut')),
    source          text NOT NULL CHECK (source IN ('technician', 'simulated_feed')),
    severity        text NOT NULL DEFAULT 'high' CHECK (severity IN ('low', 'medium', 'high')),
    status          text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'acknowledged', 'resolved')),
    message         text NOT NULL,
    cut_location    geometry(Point, 4326) NOT NULL,
    raised_by       integer REFERENCES users(user_id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    acknowledged_by integer REFERENCES users(user_id),
    acknowledged_at timestamptz,
    resolved_by     integer REFERENCES users(user_id),
    resolved_at     timestamptz
);
CREATE INDEX idx_alerts_route  ON alerts(route_id);
CREATE INDEX idx_alerts_status ON alerts(status);
CREATE INDEX idx_alerts_geom   ON alerts USING gist (cut_location);

CREATE TABLE maintenance_records (
    record_id   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    device_id   integer REFERENCES devices(device_id),
    route_id    integer REFERENCES routes(route_id),
    alert_id    integer REFERENCES alerts(alert_id),
    issue_type  text NOT NULL CHECK (issue_type IN
                  ('fibre_cut', 'equipment_fault', 'vandalism', 'theft',
                   'power_failure', 'routine_inspection', 'other')),
    status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
    notes       text,
    reported_by integer REFERENCES users(user_id),
    reported_at timestamptz NOT NULL DEFAULT now(),
    resolved_by integer REFERENCES users(user_id),
    resolved_at timestamptz,
    CHECK ((device_id IS NOT NULL)::int + (route_id IS NOT NULL)::int = 1),
    CHECK (status <> 'resolved' OR resolved_at IS NOT NULL)
);
CREATE INDEX idx_maint_device ON maintenance_records(device_id);
CREATE INDEX idx_maint_route  ON maintenance_records(route_id);
CREATE INDEX idx_maint_status ON maintenance_records(status);

CREATE TABLE notifications (
    notification_id     integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    alert_id            integer NOT NULL REFERENCES alerts(alert_id),
    recipient_operator_id integer NOT NULL REFERENCES operators(operator_id),
    recipient_user_id   integer NOT NULL REFERENCES users(user_id),
    channel             text NOT NULL CHECK (channel IN ('in_app', 'email')),
    reason              text NOT NULL CHECK (reason IN
                          ('owner', 'connected_device', 'corridor_neighbour')),
    message             text NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    delivered_at        timestamptz,   -- filled by the backend after an email is sent
    read_at             timestamptz    -- filled when the user opens an in-app notice
);
CREATE INDEX idx_notif_user ON notifications(recipient_user_id, read_at);
CREATE INDEX idx_notif_alert ON notifications(alert_id);

CREATE TABLE audit_log (
    audit_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id      integer,          -- not a foreign key, so history survives user changes
    action       text NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
    table_name   text NOT NULL,
    record_id    text,
    old_data     jsonb,
    new_data     jsonb,
    performed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_table ON audit_log(table_name, record_id);
CREATE INDEX idx_audit_time  ON audit_log(performed_at);

-- ---------------------------------------------------------------------
-- 4. Triggers
-- The backend sets the signed-in user for each request with:
--   SELECT set_config('app.current_user_id', '<user_id>', true);
-- ---------------------------------------------------------------------
CREATE FUNCTION fn_set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_devices_updated BEFORE UPDATE ON devices
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_routes_updated BEFORE UPDATE ON routes
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- Every status change is written to status_log (requirement FR4)
CREATE FUNCTION fn_log_status_change() RETURNS trigger AS $$
DECLARE
    uid integer := NULLIF(current_setting('app.current_user_id', true), '')::integer;
BEGIN
    IF TG_TABLE_NAME = 'devices' THEN
        INSERT INTO status_log (device_id, old_status, new_status, recorded_by)
        VALUES (NEW.device_id, OLD.status, NEW.status, uid);
    ELSE
        INSERT INTO status_log (route_id, old_status, new_status, recorded_by)
        VALUES (NEW.route_id, OLD.status, NEW.status, uid);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_devices_status AFTER UPDATE OF status ON devices
    FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION fn_log_status_change();
CREATE TRIGGER trg_routes_status AFTER UPDATE OF status ON routes
    FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION fn_log_status_change();

-- Audit log of who changed what (requirement FR10)
-- The trigger argument names the primary key column of the table.
CREATE FUNCTION fn_write_audit() RETURNS trigger AS $$
DECLARE
    uid     integer := NULLIF(current_setting('app.current_user_id', true), '')::integer;
    pk_name text := TG_ARGV[0];
    rec_id  text;
BEGIN
    IF TG_OP = 'DELETE' THEN
        rec_id := to_jsonb(OLD) ->> pk_name;
        INSERT INTO audit_log (user_id, action, table_name, record_id, old_data)
        VALUES (uid, TG_OP, TG_TABLE_NAME, rec_id, to_jsonb(OLD) - 'password_hash');
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        rec_id := to_jsonb(NEW) ->> pk_name;
        INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data)
        VALUES (uid, TG_OP, TG_TABLE_NAME, rec_id, to_jsonb(OLD) - 'password_hash', to_jsonb(NEW) - 'password_hash');
        RETURN NEW;
    ELSE
        rec_id := to_jsonb(NEW) ->> pk_name;
        INSERT INTO audit_log (user_id, action, table_name, record_id, new_data)
        VALUES (uid, TG_OP, TG_TABLE_NAME, rec_id, to_jsonb(NEW) - 'password_hash');
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_devices AFTER INSERT OR UPDATE OR DELETE ON devices
    FOR EACH ROW EXECUTE FUNCTION fn_write_audit('device_id');
CREATE TRIGGER trg_audit_routes AFTER INSERT OR UPDATE OR DELETE ON routes
    FOR EACH ROW EXECUTE FUNCTION fn_write_audit('route_id');
CREATE TRIGGER trg_audit_maintenance AFTER INSERT OR UPDATE OR DELETE ON maintenance_records
    FOR EACH ROW EXECUTE FUNCTION fn_write_audit('record_id');
CREATE TRIGGER trg_audit_alerts AFTER INSERT OR UPDATE OR DELETE ON alerts
    FOR EACH ROW EXECUTE FUNCTION fn_write_audit('alert_id');
CREATE TRIGGER trg_audit_users AFTER INSERT OR UPDATE OR DELETE ON users
    FOR EACH ROW EXECUTE FUNCTION fn_write_audit('user_id');

-- ---------------------------------------------------------------------
-- 5. Views used by the map, the free route view and the dashboard
-- ---------------------------------------------------------------------

-- What other operators are allowed to see: shared routes, limited columns (FR12)
CREATE VIEW v_routes_shared AS
SELECT r.route_id, o.name AS operator_name, r.operator_id, r.route_code,
       r.route_type, r.status, r.spare_capacity_fibres, r.geom
FROM routes r
JOIN operators o ON o.operator_id = r.operator_id
WHERE r.visibility = 'shared';

-- What other operators are allowed to see of shared devices: location, type, owner, status
CREATE VIEW v_devices_shared AS
SELECT d.device_id, o.name AS operator_name, d.operator_id, d.device_type, d.status, d.geom
FROM devices d
JOIN operators o ON o.operator_id = d.operator_id
WHERE d.visibility = 'shared';

-- Free route view: shared routes that are working and have spare fibres (FR13)
CREATE VIEW v_free_routes AS
SELECT r.route_id, o.name AS operator_name, r.operator_id, r.route_code,
       r.route_type, r.spare_capacity_fibres, r.total_fibres,
       round((ST_Length(r.geom::geography))::numeric, 0) AS length_m,
       r.geom
FROM routes r
JOIN operators o ON o.operator_id = r.operator_id
WHERE r.visibility = 'shared'
  AND r.status = 'active'
  AND r.spare_capacity_fibres > 0;

-- Alerts that still need attention, for the dashboard (FR7, FR14)
CREATE VIEW v_open_alerts AS
SELECT a.alert_id, a.status, a.severity, a.source, a.message, a.created_at,
       r.route_id, r.route_code, r.operator_id, o.name AS operator_name, a.cut_location
FROM alerts a
JOIN routes r ON r.route_id = a.route_id
JOIN operators o ON o.operator_id = r.operator_id
WHERE a.status <> 'resolved';

-- Counts for the dashboard charts (FR7)
CREATE VIEW v_asset_counts AS
SELECT operator_id, 'device'::text AS asset_kind, device_type AS asset_type, status, count(*) AS total
FROM devices GROUP BY operator_id, device_type, status
UNION ALL
SELECT operator_id, 'route'::text, route_type, status, count(*)
FROM routes GROUP BY operator_id, route_type, status;

-- ---------------------------------------------------------------------
-- 6. Fibre cut alert logic (FR14)
-- ---------------------------------------------------------------------

-- Routes of OTHER operators within a set distance of the cut location
CREATE FUNCTION find_corridor_neighbours(
    p_route_id   integer,
    p_cut_point  geometry,
    p_distance_m numeric DEFAULT 100
) RETURNS TABLE (route_id integer, operator_id integer, route_code text, distance_m numeric)
AS $$
    SELECT r.route_id, r.operator_id, r.route_code,
           round(ST_Distance(r.geom::geography, p_cut_point::geography)::numeric, 1)
    FROM routes r
    WHERE r.route_id <> p_route_id
      AND r.operator_id <> (SELECT operator_id FROM routes WHERE route_id = p_route_id)
      AND r.status <> 'decommissioned'
      AND ST_DWithin(r.geom::geography, p_cut_point::geography, p_distance_m)
    ORDER BY 4;
$$ LANGUAGE sql STABLE;

-- Raise a fibre cut alert: mark the route, record the alert, notify everyone affected.
-- p_source is 'technician' or 'simulated_feed'. If no cut point is given,
-- the middle of the route is used.
CREATE FUNCTION raise_fibre_cut_alert(
    p_route_id   integer,
    p_source     text,
    p_cut_point  geometry DEFAULT NULL,
    p_user_id    integer DEFAULT NULL,
    p_corridor_m numeric DEFAULT 100
) RETURNS integer AS $$
DECLARE
    v_route   routes%ROWTYPE;
    v_owner   text;
    v_point   geometry;
    v_alert   integer;
    v_op      record;
BEGIN
    SELECT * INTO v_route FROM routes WHERE route_id = p_route_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Route % does not exist', p_route_id;
    END IF;
    SELECT name INTO v_owner FROM operators WHERE operator_id = v_route.operator_id;

    v_point := COALESCE(p_cut_point, ST_LineInterpolatePoint(v_route.geom, 0.5));
    v_point := ST_SetSRID(v_point, 4326);

    -- Let the audit and status triggers know who is acting
    IF p_user_id IS NOT NULL THEN
        PERFORM set_config('app.current_user_id', p_user_id::text, true);
    END IF;

    UPDATE routes SET status = 'cut' WHERE route_id = p_route_id AND status <> 'cut';

    INSERT INTO alerts (route_id, source, message, cut_location, raised_by)
    VALUES (p_route_id, p_source,
            'Fibre cut on route ' || v_route.route_code || ' (' || v_owner || ')',
            v_point, p_user_id)
    RETURNING alert_id INTO v_alert;

    -- Who is affected: the owner, the operators of the connected end devices,
    -- and operators whose routes pass near the cut. Each operator is notified once,
    -- using the first reason that applies.
    FOR v_op IN
        WITH targets AS (
            SELECT v_route.operator_id AS operator_id, 'owner'::text AS reason, 1 AS prio
            UNION ALL
            SELECT d.operator_id, 'connected_device', 2
            FROM devices d
            WHERE d.device_id IN (v_route.start_device_id, v_route.end_device_id)
            UNION ALL
            SELECT n.operator_id, 'corridor_neighbour', 3
            FROM find_corridor_neighbours(p_route_id, v_point, p_corridor_m) n
        )
        SELECT DISTINCT ON (operator_id) operator_id, reason
        FROM targets
        ORDER BY operator_id, prio
    LOOP
        -- In-app notice for managers and decision makers, email for managers
        INSERT INTO notifications (alert_id, recipient_operator_id, recipient_user_id,
                                   channel, reason, message)
        SELECT v_alert, v_op.operator_id, u.user_id, c.channel, v_op.reason,
               CASE v_op.reason
                   WHEN 'owner' THEN
                       'Fibre cut on your route ' || v_route.route_code || '.'
                   WHEN 'connected_device' THEN
                       'A route connected to your device was cut: ' || v_route.route_code
                       || ' (' || v_owner || ').'
                   ELSE
                       'A fibre cut was reported near your routes. Check before any work in this corridor.'
               END
        FROM users u
        CROSS JOIN LATERAL (VALUES ('in_app'), ('email')) AS c(channel)
        WHERE u.operator_id = v_op.operator_id
          AND u.is_active
          AND u.role IN ('asset_manager', 'decision_maker')
          AND (c.channel = 'in_app' OR u.role = 'asset_manager');
    END LOOP;

    RETURN v_alert;
END;
$$ LANGUAGE plpgsql;

-- Close an alert: restore the route and record the repair
CREATE FUNCTION resolve_alert(
    p_alert_id integer,
    p_user_id  integer,
    p_notes    text DEFAULT NULL
) RETURNS void AS $$
DECLARE
    v_route integer;
BEGIN
    SELECT route_id INTO v_route FROM alerts WHERE alert_id = p_alert_id AND status <> 'resolved';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Alert % does not exist or is already resolved', p_alert_id;
    END IF;

    PERFORM set_config('app.current_user_id', p_user_id::text, true);

    UPDATE alerts
       SET status = 'resolved', resolved_by = p_user_id, resolved_at = now(),
           acknowledged_by = COALESCE(acknowledged_by, p_user_id),
           acknowledged_at = COALESCE(acknowledged_at, now())
     WHERE alert_id = p_alert_id;

    UPDATE routes SET status = 'active' WHERE route_id = v_route AND status IN ('cut', 'under_repair');

    INSERT INTO maintenance_records (route_id, alert_id, issue_type, status, notes,
                                     reported_by, resolved_by, resolved_at)
    VALUES (v_route, p_alert_id, 'fibre_cut', 'resolved',
            COALESCE(p_notes, 'Cut repaired and route restored.'),
            p_user_id, p_user_id, now());
END;
$$ LANGUAGE plpgsql;
