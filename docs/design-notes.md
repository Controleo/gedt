# Design notes for Phase 1

## Data model
- **Devices** are points (tower, OLT, PoP, splice enclosure, distribution point). **Routes** are lines (backbone, feeder, distribution, drop). Both use PostGIS geometry in WGS 84 (SRID 4326).
- Every device and route belongs to one operator and is marked `private` or `shared`.
- Status history, maintenance records and the audit log are written by the database itself, so no part of the backend can forget to record them.
- Status log and maintenance records point to exactly one of a device or a route (enforced by a database rule).

## What other operators can see
- Other operators read routes only through `v_routes_shared` and `v_free_routes`. These show route code, owner, type, status and spare fibres, and nothing about devices, install dates, notes or who created them.
- Private records are never shown to other operators.

## Fibre cut alerts
1. A cut is raised by a technician or by the simulated monitoring feed (`raise_fibre_cut_alert`).
2. The route becomes `cut`, an alert is created, and notifications are written.
3. Who is told: the owner, the operators of the devices at the route ends, and operators whose routes pass within a set distance of the **cut location** (100 m by default).
4. Asset managers get an in-app notice and an email entry. Decision makers get an in-app notice. Field technicians get none.
5. Neighbouring operators only receive a generic warning. It does not name the owner or the route.
6. The alert moves from new to acknowledged to resolved. Resolving restores the route and records the repair in maintenance.

## Assumptions to confirm with the student
- Distance for "near the cut" is 100 m, measured from the cut location, not from the whole route.
- A neutral host for the shared registry is not modelled. Each operator has its own administrator.
- Emails are only queued as notification rows in Phase 1. Sending them is part of Phase 2.

## Rules the backend must follow (Phase 2)
- At the start of every request, set the signed-in user: `SELECT set_config('app.current_user_id', '<id>', true);` inside the request's transaction. The audit log and status log depend on it.
- Never send `alerts.message` to a neighbouring operator. It names the owner. Neighbours get the text in `notifications.message` only.
- Hash passwords with bcrypt (the demo hashes are bcrypt and work with the Node `bcrypt` package).
- Real fibre cut detection from network equipment is out of scope. The simulated feed calls `raise_fibre_cut_alert` with source `simulated_feed`.

## Phase 2 decisions
- **Login:** passwords are checked against bcrypt hashes and a signed token (valid 8 hours) is returned. The user is looked up again on every request, so a disabled account or a changed role takes effect at once.
- **Operator separation is enforced in the server:** every query for devices, routes, maintenance, alerts, reports, exports, users and the audit log is filtered by the signed-in user's operator. A record of another operator is reported as "not found", never as "forbidden", so its existence is not revealed.
- **The database is told who is acting:** each write runs in a transaction that sets `app.current_user_id`, so the status log and audit log name the right person.
- **Alerts:** only technicians and asset managers of the route's own operator can raise a cut. Neighbours and connected parties see only what their relation allows, and cannot acknowledge or resolve the alert.
- **Simulated feed:** it signs in with a shared key (`X-Feed-Key`) and is switched off if `SIM_FEED_KEY` is empty.
- **Security measures:** parameterised queries only, input checks on every field, request size limit, login rate limit, standard security headers, no stack traces sent to users, CSV formula defusing, and a refusal to start without a proper `JWT_SECRET`.
- **Email:** in `console` mode the text is printed. In `smtp` mode it is sent with the SMTP settings in `.env`. The SMTP mode has not been tested against a real mail server.
- **Not built yet:** the web interface (Phase 3), and automatic cleanup of old notifications.

## Phase 3 decisions (web interface)
- **No build step.** The interface is plain JavaScript modules, HTML and CSS served by the same server. Leaflet 1.9 and Chart.js 4 come from the npm packages, so nothing is loaded from other websites except the map tiles.
- **Status is never shown by colour alone.** Every status also has a text label, and device types are told apart by shape (triangle tower, square point of presence, diamond OLT, dot enclosure, ring distribution point).
- **Each role sees only its own pages and buttons**, but the server enforces the rules too, so hiding a button is a convenience and not the protection.
- **Safe page building.** All text from the server is added as text, never as HTML, so a hostile device name cannot run a script. The security headers only allow scripts from this server.
- **Session.** The login token lives in the browser's session storage, so it is forgotten when the tab is closed. The page signs out by itself when the server rejects the token.
- **Drawing routes.** Click points on the map. Clicking an existing device snaps the route to it, and the start and end devices are preselected when a point is within 60 m of one of your devices.
- **Demonstration sign-in buttons** appear only when `DEMO_MODE=true`. Switch it off for any real deployment.
- **Base map.** OpenStreetMap's public tile servers are fine for a prototype and a small evaluation. A larger public deployment should use its own or a paid tile provider, as OpenStreetMap's tile usage policy requires.
- **Tested** in Chromium with 40 browser checks across the four roles and a phone-sized screen. It has not been tested in Safari or Firefox, and no formal accessibility audit has been done.
