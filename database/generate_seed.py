#!/usr/bin/env python3
"""
Generate synthetic demo data for the GEDT prototype.

Everything here is invented for demonstration. The three operators are
fictional and the routes only follow the general direction of main road
corridors in Lagos. They are NOT real network positions.

Usage:   python3 generate_seed.py            (writes seed.sql next to this file)
The random seed is fixed, so the same data is produced every time.
"""
import math
import os
import random

random.seed(2026)

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "seed.sql")
DEMO_PASSWORD = "Demo@12345"   # demo accounts only

# ---------------------------------------------------------------------
# Operators and users (fictional)
# ---------------------------------------------------------------------
OPERATORS = [
    {"code": "LAG", "name": "Lagoon Telecom", "domain": "lagoon-telecom.example",
     "users": [("Adaeze Okafor", "gis_admin"), ("Tunde Bakare", "asset_manager"),
               ("Chinedu Eze", "field_technician"), ("Ngozi Obi", "field_technician"),
               ("Femi Adeyemi", "decision_maker")]},
    {"code": "HAR", "name": "Harmattan Networks", "domain": "harmattan-networks.example",
     "users": [("Hauwa Bello", "gis_admin"), ("Ibrahim Danjuma", "asset_manager"),
               ("Emeka Nwosu", "field_technician"), ("Sade Olawale", "field_technician"),
               ("Yusuf Garba", "decision_maker")]},
    {"code": "SAV", "name": "Savanna Fibre", "domain": "savanna-fibre.example",
     "users": [("Blessing Etim", "gis_admin"), ("Kunle Ogunleye", "asset_manager"),
               ("Tobi Adebayo", "field_technician"), ("Amaka Uche", "field_technician"),
               ("Musa Lawal", "decision_maker")]},
]
for op in OPERATORS:
    op["emails"] = []
    for full, role in op["users"]:
        first, last = full.lower().split()
        op["emails"].append((f"{first}.{last}@{op['domain']}", full, role))

def emails_of(op, role):
    return [e for e, _, r in op["emails"] if r == role]

# ---------------------------------------------------------------------
# Corridors: (lon, lat) points following main road directions in Lagos.
# offsets_m is the sideways shift of each operator's route from the corridor line.
# ---------------------------------------------------------------------
CORRIDORS = [
    {"slug": "IKR", "name": "Ikorodu Road corridor",
     "pts": [(3.3680, 6.5170), (3.3640, 6.5550), (3.3667, 6.5667), (3.3800, 6.5900), (3.3900, 6.6050)],
     "offsets_m": [0, 20, 60]},
    {"slug": "MIL", "name": "Mainland to Island link",
     "pts": [(3.3711, 6.5095), (3.3830, 6.4780), (3.3950, 6.4600), (3.4050, 6.4500)],
     "offsets_m": [0, 35, 180]},
    {"slug": "LEK", "name": "Lekki to Ajah corridor",
     "pts": [(3.4219, 6.4281), (3.4700, 6.4474), (3.5200, 6.4560), (3.5852, 6.4698)],
     "offsets_m": [0, 250, 90]},
    {"slug": "AOE", "name": "Apapa to Ikeja corridor",
     "pts": [(3.3593, 6.4474), (3.3580, 6.5011), (3.3430, 6.5560), (3.3515, 6.6018)],
     "offsets_m": [0, 40, 400]},
]

TOWER_AREAS = [("Ikeja", 6.6018, 3.3515), ("Yaba", 6.5095, 3.3711), ("Victoria Island", 6.4281, 3.4219),
               ("Lekki", 6.4474, 3.4700), ("Surulere", 6.5011, 3.3580), ("Apapa 2", 6.4474, 3.3593),
               ("Ikorodu", 6.6194, 3.5105), ("Ajah", 6.4698, 3.5852)]

# ---------------------------------------------------------------------
# Small geometry helpers (flat approximation, fine for a few kilometres)
# ---------------------------------------------------------------------
LON0, LAT0 = 3.35, 6.40
M_LAT = 111320.0
M_LON = 111320.0 * math.cos(math.radians(6.5))

def to_m(lon, lat):
    return ((lon - LON0) * M_LON, (lat - LAT0) * M_LAT)

def to_ll(x, y):
    return (x / M_LON + LON0, y / M_LAT + LAT0)

def seg_len(a, b):
    return math.hypot(b[0] - a[0], b[1] - a[1])

def total_len(poly):
    return sum(seg_len(poly[i], poly[i + 1]) for i in range(len(poly) - 1))

def point_at(poly, dist):
    run = 0.0
    for i in range(len(poly) - 1):
        L = seg_len(poly[i], poly[i + 1])
        if run + L >= dist or i == len(poly) - 2:
            t = 0 if L == 0 else min(max((dist - run) / L, 0), 1)
            return (poly[i][0] + t * (poly[i + 1][0] - poly[i][0]),
                    poly[i][1] + t * (poly[i + 1][1] - poly[i][1]))
        run += L

def sub_polyline(poly, f1, f2):
    """Vertices of the part of poly between fractions f1 and f2 of its length."""
    T = total_len(poly)
    d1, d2 = f1 * T, f2 * T
    pts = [point_at(poly, d1)]
    run = 0.0
    for i in range(len(poly) - 1):
        run += seg_len(poly[i], poly[i + 1])
        if d1 < run < d2:
            pts.append(poly[i + 1])
    pts.append(point_at(poly, d2))
    return pts

def wkt_point(p):
    lon, lat = to_ll(*p)
    return f"ST_SetSRID(ST_MakePoint({lon:.6f}, {lat:.6f}), 4326)"

def wkt_line(pts):
    body = ", ".join(f"{to_ll(*p)[0]:.6f} {to_ll(*p)[1]:.6f}" for p in pts)
    return f"ST_GeomFromText('LINESTRING({body})', 4326)"

def q(s):
    return "'" + s.replace("'", "''") + "'"

def rdate(y0=2018, y1=2025):
    y = random.randint(y0, y1)
    return f"{y}-{random.randint(1, 12):02d}-{random.randint(1, 28):02d}"

# ---------------------------------------------------------------------
# Build the data in memory
# ---------------------------------------------------------------------
devices = []   # dicts
routes = []    # dicts
by_code = {}

def add_device(op, code, name, dtype, pos_m, visibility):
    creator = random.choice(emails_of(op, "gis_admin") + emails_of(op, "field_technician"))
    d = {"op": op, "code": code, "name": name, "type": dtype, "pos": pos_m,
         "vis": visibility, "date": rdate(), "creator": creator}
    devices.append(d)
    by_code[code] = d
    return d

def add_route(op, code, name, rtype, pts, start, end, total, spare, visibility):
    creator = random.choice(emails_of(op, "gis_admin") + emails_of(op, "field_technician"))
    r = {"op": op, "code": code, "name": name, "type": rtype, "pts": pts,
         "start": start, "end": end, "total": total, "spare": spare,
         "vis": visibility, "date": rdate(), "creator": creator, "status": "active"}
    routes.append(r)
    return r

FRACS = [0.0, 0.25, 0.5, 0.75, 1.0]

for oi, op in enumerate(OPERATORS):
    for c in CORRIDORS:
        base = [to_m(*p) for p in c["pts"]]
        # Sideways shift for this operator
        dx, dy = base[-1][0] - base[0][0], base[-1][1] - base[0][1]
        L = math.hypot(dx, dy)
        nx, ny = -dy / L, dx / L
        off = c["offsets_m"][oi]
        shifted = [(x + nx * off + random.uniform(-6, 6), y + ny * off + random.uniform(-6, 6))
                   for x, y in base]

        # Devices along the corridor
        devs = []
        for k, f in enumerate(FRACS):
            pos = point_at(shifted, f * total_len(shifted))
            if k == 0:
                dtype, label = "pop", "PoP"
            elif k == len(FRACS) - 1:
                dtype, label = "olt", "OLT"
            else:
                dtype, label = "splice_enclosure", "Enclosure"
            code = f"{op['code']}-{c['slug']}-{k + 1:02d}"
            vis = "shared" if dtype in ("pop", "olt") and random.random() < 0.6 else "private"
            devs.append(add_device(op, code, f"{op['name']} {c['slug']} {label} {k + 1}", dtype, pos, vis))

        # Backbone routes between neighbouring devices
        for k in range(len(FRACS) - 1):
            pts = sub_polyline(shifted, FRACS[k], FRACS[k + 1])
            total = random.choice([48, 96, 144])
            spare = random.choice([0, 0, 4, 8, 12, 24, 36])
            spare = min(spare, total)
            vis = "shared" if random.random() < 0.7 else "private"
            add_route(op, f"{op['code']}-{c['slug']}-BB-{k + 1:02d}",
                      f"{op['name']} {c['slug']} backbone {k + 1}", "backbone", pts,
                      devs[k]["code"], devs[k + 1]["code"], total, spare, vis)

        # One distribution point off each splice enclosure
        for k in (1, 2, 3):
            enc = devs[k]
            side = random.choice([-1, 1])
            length = random.uniform(150, 500)
            mid = (enc["pos"][0] + nx * side * length * 0.5 + random.uniform(-15, 15),
                   enc["pos"][1] + ny * side * length * 0.5 + random.uniform(-15, 15))
            end = (enc["pos"][0] + nx * side * length, enc["pos"][1] + ny * side * length)
            dp = add_device(op, f"{op['code']}-{c['slug']}-DP{k}", f"{op['name']} {c['slug']} DP {k}",
                            "distribution_point", end, "shared" if random.random() < 0.2 else "private")
            total = random.choice([12, 24])
            spare = random.choice([0, 2, 4, 6])
            add_route(op, f"{op['code']}-{c['slug']}-DR-{k}", f"{op['name']} {c['slug']} distribution {k}",
                      "distribution", [enc["pos"], mid, end], enc["code"], dp["code"], total, spare,
                      "shared" if random.random() < 0.2 else "private")

    # Towers spread over the city
    for ti, (area, lat, lon) in enumerate(TOWER_AREAS):
        x, y = to_m(lon, lat)
        pos = (x + random.uniform(-1200, 1200), y + random.uniform(-1200, 1200))
        add_device(op, f"{op['code']}-TWR-{ti + 1:02d}", f"{area} Tower {op['code']}", "tower", pos,
                   "shared" if random.random() < 0.3 else "private")

# A couple of planned routes (not built yet)
for r in routes:
    if r["code"] in ("HAR-LEK-DR-3", "SAV-IKR-DR-2"):
        r["status"] = "planned"

# ---------------------------------------------------------------------
# Write seed.sql
# ---------------------------------------------------------------------
out = []
w = out.append
w("-- =====================================================================")
w("-- GEDT prototype: synthetic demo data (generated by generate_seed.py)")
w("-- All operators, people and positions are invented for demonstration.")
w(f"-- Every demo account uses the password: {DEMO_PASSWORD}")
w("-- =====================================================================")
w("SET client_min_messages = warning;")
w("BEGIN;")
w("TRUNCATE audit_log, notifications, alerts, maintenance_records, status_log, routes, devices, users, operators RESTART IDENTITY CASCADE;")
w("")

w("-- Operators")
for op in OPERATORS:
    w(f"INSERT INTO operators (name, contact_email) VALUES ({q(op['name'])}, {q('info@' + op['domain'])});")
w("")

w("-- Users")
for op in OPERATORS:
    for email, full, role in op["emails"]:
        w("INSERT INTO users (operator_id, full_name, email, password_hash, role) VALUES "
          f"((SELECT operator_id FROM operators WHERE name = {q(op['name'])}), {q(full)}, {q(email)}, "
          f"crypt({q(DEMO_PASSWORD)}, gen_salt('bf', 10)), {q(role)});")
w("")

def uid(email):
    return f"(SELECT user_id FROM users WHERE email = {q(email)})"

def opid(op):
    return f"(SELECT operator_id FROM operators WHERE name = {q(op['name'])})"

def set_user(email):
    w(f"SELECT set_config('app.current_user_id', {uid(email)}::text, true);")

w("-- Devices")
for d in devices:
    set_user(d["creator"])
    w("INSERT INTO devices (operator_id, device_code, name, device_type, visibility, install_date, geom, created_by) VALUES "
      f"({opid(d['op'])}, {q(d['code'])}, {q(d['name'])}, {q(d['type'])}, {q(d['vis'])}, {q(d['date'])}, "
      f"{wkt_point(d['pos'])}, {uid(d['creator'])});")
w("")

w("-- Routes")
for r in routes:
    set_user(r["creator"])
    w("INSERT INTO routes (operator_id, route_code, name, route_type, status, visibility, total_fibres, "
      "spare_capacity_fibres, start_device_id, end_device_id, install_date, geom, created_by) VALUES "
      f"({opid(r['op'])}, {q(r['code'])}, {q(r['name'])}, {q(r['type'])}, {q(r['status'])}, {q(r['vis'])}, "
      f"{r['total']}, {r['spare']}, "
      f"(SELECT device_id FROM devices WHERE device_code = {q(r['start'])}), "
      f"(SELECT device_id FROM devices WHERE device_code = {q(r['end'])}), "
      f"{q(r['date'])}, {wkt_line(r['pts'])}, {uid(r['creator'])});")
w("")

# Status changes made by technicians (these fill status_log through the trigger)
w("-- Some status changes, so the history is not empty")
status_changes = [
    ("device", "LAG-IKR-03", "faulty", "chinedu.eze@lagoon-telecom.example"),
    ("device", "LAG-TWR-04", "vandalised", "ngozi.obi@lagoon-telecom.example"),
    ("device", "HAR-LEK-02", "under_repair", "emeka.nwosu@harmattan-networks.example"),
    ("device", "HAR-TWR-02", "faulty", "sade.olawale@harmattan-networks.example"),
    ("device", "SAV-MIL-DP2", "faulty", "tobi.adebayo@savanna-fibre.example"),
    ("device", "SAV-TWR-07", "vandalised", "amaka.uche@savanna-fibre.example"),
    ("device", "LAG-AOE-DP1", "decommissioned", "tunde.bakare@lagoon-telecom.example"),
    ("route", "HAR-AOE-DR-2", "under_repair", "ibrahim.danjuma@harmattan-networks.example"),
]
for kind, code, status, email in status_changes:
    set_user(email)
    if kind == "device":
        w(f"UPDATE devices SET status = {q(status)} WHERE device_code = {q(code)};")
    else:
        w(f"UPDATE routes SET status = {q(status)} WHERE route_code = {q(code)};")
w("")

# Maintenance records
w("-- Maintenance records")
issue_types = ["equipment_fault", "vandalism", "theft", "power_failure", "routine_inspection", "other"]
route_issue_types = ["fibre_cut", "vandalism", "routine_inspection", "other"]
notes_pool = {
    "equipment_fault": "Unit replaced after fault found during site visit.",
    "vandalism": "Cabinet forced open, lock replaced and site secured.",
    "theft": "Battery bank reported stolen, replacement requested.",
    "power_failure": "Mains supply lost, generator started.",
    "routine_inspection": "Scheduled inspection completed, no defects.",
    "fibre_cut": "Cable damaged by road works, splice repair arranged.",
    "other": "Follow-up visit recorded.",
}
for i in range(30):
    op = random.choice(OPERATORS)
    reporter = random.choice(emails_of(op, "field_technician") + emails_of(op, "asset_manager"))
    on_route = random.random() < 0.4
    pool = [r for r in routes if r["op"] is op] if on_route else [d for d in devices if d["op"] is op]
    target = random.choice(pool)
    itype = random.choice(route_issue_types if on_route else issue_types)
    state = random.choice(["open", "in_progress", "resolved", "resolved"])
    days_ago = random.randint(3, 120)
    set_user(reporter)
    cols = "device_id, route_id" if not on_route else "route_id, device_id"
    ref = (f"(SELECT route_id FROM routes WHERE route_code = {q(target['code'])}), NULL" if on_route
           else f"(SELECT device_id FROM devices WHERE device_code = {q(target['code'])}), NULL")
    cols = "route_id, device_id" if on_route else "device_id, route_id"
    resolved_cols = ""
    resolved_vals = ""
    if state == "resolved":
        resolver = random.choice(emails_of(op, "asset_manager") + emails_of(op, "field_technician"))
        resolved_cols = ", resolved_by, resolved_at"
        resolved_vals = f", {uid(resolver)}, now() - interval '{max(days_ago - random.randint(1, 3), 0)} days'"
    w(f"INSERT INTO maintenance_records ({cols}, issue_type, status, notes, reported_by, reported_at{resolved_cols}) VALUES "
      f"({ref}, {q(itype)}, {q(state)}, {q(notes_pool[itype])}, {uid(reporter)}, "
      f"now() - interval '{days_ago} days'{resolved_vals});")
w("")

# Alerts: one resolved in the past, two still open (one acknowledged)
w("-- Alerts (created through the alert function so notifications are generated)")
w("SELECT raise_fibre_cut_alert((SELECT route_id FROM routes WHERE route_code = 'HAR-LEK-BB-03'), "
  "'technician', NULL, (SELECT user_id FROM users WHERE email = 'emeka.nwosu@harmattan-networks.example'));")
w("SELECT resolve_alert((SELECT alert_id FROM alerts ORDER BY alert_id DESC LIMIT 1), "
  "(SELECT user_id FROM users WHERE email = 'ibrahim.danjuma@harmattan-networks.example'), "
  "'Splice repaired by field team, route tested and restored.');")
w("SELECT raise_fibre_cut_alert((SELECT route_id FROM routes WHERE route_code = 'LAG-IKR-BB-02'), "
  "'simulated_feed');")
w("SELECT raise_fibre_cut_alert((SELECT route_id FROM routes WHERE route_code = 'SAV-AOE-BB-01'), "
  "'technician', NULL, (SELECT user_id FROM users WHERE email = 'tobi.adebayo@savanna-fibre.example'));")
w("UPDATE alerts SET status = 'acknowledged', "
  "acknowledged_by = (SELECT user_id FROM users WHERE email = 'kunle.ogunleye@savanna-fibre.example'), "
  "acknowledged_at = now() "
  "WHERE route_id = (SELECT route_id FROM routes WHERE route_code = 'SAV-AOE-BB-01');")
w("")
w("COMMIT;")
w("")
w("ANALYZE;")

with open(OUT, "w", encoding="utf-8") as f:
    f.write("\n".join(out) + "\n")

print(f"Wrote {OUT}")
print(f"Operators: {len(OPERATORS)}  Users: {sum(len(o['emails']) for o in OPERATORS)}  "
      f"Devices: {len(devices)}  Routes: {len(routes)}")
