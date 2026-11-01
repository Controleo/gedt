# GEDT API reference (Phase 2)

All paths start with `/api`. Every request except `GET /health`, `POST /auth/login` and `POST /simulate/cut` needs the header `Authorization: Bearer <token>`. Replies are JSON. Map data is GeoJSON. Errors look like `{ "error": "message" }`.

Roles: **FT** Field Technician, **AM** Asset Manager, **GA** GIS Administrator, **DM** Decision Maker. Everyone only sees and changes the records of their own operator, except the limited views under Shared.

## Sign in
| Method and path | Who | What it does |
|---|---|---|
| `POST /auth/login` | anyone | Body `{ email, password }`. Returns `{ token, user }` |
| `GET /auth/me` | all | The signed-in user |
| `GET /health` | anyone | Server and database check |

## Devices (points)
| Method and path | Who | What it does |
|---|---|---|
| `GET /devices` | all | Own devices as GeoJSON. Filters: `type`, `status`, `visibility`, `q`, `bbox=minLng,minLat,maxLng,maxLat`, `limit` |
| `POST /devices` | FT, AM | Body `{ device_code, name, device_type, longitude, latitude, status?, visibility?, install_date?, details? }` |
| `GET /devices/:id` | all | One device |
| `PATCH /devices/:id` | FT, AM | Change `name`, `visibility`, `install_date`, `details` |
| `PATCH /devices/:id/status` | FT, AM | Body `{ status, note? }`. Written to the status log and audit log |
| `GET /devices/:id/history` | all | Status history |

## Routes (lines)
| Method and path | Who | What it does |
|---|---|---|
| `GET /routes` | all | Own routes as GeoJSON, same filters as devices |
| `POST /routes` | FT, AM | Body `{ route_code, name, route_type, total_fibres, spare_capacity_fibres, geometry (GeoJSON LineString), visibility?, status? (active or planned), start_device?, end_device?, install_date? }`. The end devices are given by code or id and must be your own |
| `GET /routes/:id`, `PATCH /routes/:id` | all / FT, AM | Read, or change `name`, `visibility`, `total_fibres`, `spare_capacity_fibres` |
| `PATCH /routes/:id/status` | FT, AM | Body `{ status, note? }`. A route cannot be set to `cut` here; use `POST /alerts` |
| `GET /routes/:id/history` | all | Status history |

## Shared registry
| Method and path | Who | What it does |
|---|---|---|
| `GET /shared/routes` | all | Other operators' shared routes: route code, owner, type, status, spare fibres only |
| `GET /shared/devices` | all | Other operators' shared devices: owner, type, status and location only |
| `GET /free-routes` | AM, DM | Shared, active routes with spare fibres. Filters: `min_spare`, `bbox`, `include_own=true` |

## Maintenance and reports
| Method and path | Who | What it does |
|---|---|---|
| `GET /maintenance` | all | Own records. Filters: `status`, `issue_type`, `device_id`, `route_id` |
| `POST /maintenance` | FT, AM | Body `{ device_id or route_id, issue_type, status?, notes? }` |
| `PATCH /maintenance/:id/resolve` | FT, AM | Body `{ notes? }` |
| `GET /reports/maintenance` | AM, DM | Filters: `from`, `to` (YYYY-MM-DD), `status`, `issue_type`, `asset_kind`, `bbox`; add `format=csv` for a download |
| `GET /dashboard` | AM, DM | Asset counts, maintenance in the last 90 days, alerts, unread notices, free routes available |
| `GET /export/devices`, `GET /export/routes` | AM, DM | GeoJSON by default, `format=csv` for CSV |

## Alerts and notifications
| Method and path | Who | What it does |
|---|---|---|
| `POST /alerts` | FT, AM | Body `{ route_code or route_id, longitude?, latitude? }`. Marks the route as cut and notifies the owner, connected parties and nearby operators. A given location must be within 200 m of the route |
| `GET /alerts` | all | Alerts that concern your operator. Owners see everything. Connected parties see the owner and route. Neighbours see a generic warning and the location only. Filter `status` |
| `PATCH /alerts/:id/acknowledge` | AM, DM | Owner's operator only |
| `PATCH /alerts/:id/resolve` | AM, DM | Owner's operator only. Body `{ notes? }`. Restores the route and records the repair |
| `GET /notifications` | all | Your in-app notices. Filter `unread=true` |
| `PATCH /notifications/:id/read` | all | Mark one as read |
| `POST /simulate/cut` | simulated feed | Header `X-Feed-Key`, body `{ route_code, longitude?, latitude? }`. Same effect as a technician report, with source `simulated_feed` |

## Administration (GA only)
| Method and path | What it does |
|---|---|
| `GET /admin/users`, `POST /admin/users`, `PATCH /admin/users/:id` | List, create and change users of your operator (role, active state, name, password). You cannot change your own role or active state |
| `GET /admin/audit` | Audit log of changes made by people in your operator. Filters: `table`, `record_id`, `limit` |
