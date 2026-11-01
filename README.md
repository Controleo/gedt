# GEDT Prototype: Phases 1 and 2 (database and server)

A shared, map-based registry of telecom devices and fibre routes for several operators, with fibre cut alerts. All data is synthetic and the three operators are fictional.

## What is in this folder

| File | What it is |
|---|---|
| `database/schema.sql` | Creates every table, rule, trigger, view and alert function |
| `database/generate_seed.py` | Creates the demo data (fixed random seed, so it is always the same) |
| `database/seed.sql` | The demo data produced by the script above |
| `database/tests.sql` | 37 automatic checks that prove the database behaves correctly |
| `database/00_setup.sql` | Runs the three files above in order |
| `server/` | The Node.js and Express server: login, roles, devices, routes, alerts, reports, export |
| `server/tests/api.test.js` | 39 automatic tests of the server |
| `server/public/` | The web interface: sign in, map, alerts, maintenance, free routes, dashboard, reports, users, audit log |
| `server/tests/ui_smoke_test.py` | Optional browser test of the interface (40 checks, needs Playwright) |
| `package.json` | Project description and commands |
| `.env.example` | Template for settings. Copy it to `.env` and fill it in |
| `docs/api.md` | List of every server endpoint and who may use it |
| `docs/DEPLOY.md` | How to put the system online (Neon database and Render server) |
| `docs/demo-video-script.md` | Script for the 7-minute demonstration video |
| `evaluation/` | Questionnaire items, response template and the analysis script for Chapter Five |
| `render.yaml`, `Dockerfile`, `docker-compose.yml` | Hosting settings. The Docker files are untested |
| `database/seed_evaluation.sql` | 60 practice routes for evaluators (`npm run db:eval`) |
| `docs/design-notes.md` | Decisions and assumptions behind the design |

## What the demo data contains

3 fictional operators (Lagoon Telecom, Harmattan Networks, Savanna Fibre), 15 users (each operator has a GIS administrator, asset manager, two field technicians and a decision maker), 120 devices, 84 routes, 31 maintenance records, and 3 fibre cut alerts (2 open, 1 resolved).

Every demo account uses the password `Demo@12345`, for example `tunde.bakare@lagoon-telecom.example` (asset manager).

## Set up on a Windows laptop

1. **Install these** (accept the default options unless told otherwise):
   - Git for Windows
   - Visual Studio Code
   - Node.js 20 LTS (used from Phase 2 onward)
   - PostgreSQL 16 from the EDB installer. Choose a password for the `postgres` user and write it down. Keep the port as 5432. On the last screen, tick **Stack Builder**.
2. **Add PostGIS.** In Stack Builder, pick PostgreSQL 16, open **Spatial Extensions**, and install **PostGIS 3.4 Bundle**. When asked, allow it to set up the PostGIS environment variables and register the GDAL drivers.
3. **Open a terminal in this folder** (in VS Code: Terminal, New Terminal). If `psql` is not recognised, add `C:\Program Files\PostgreSQL\16\bin` to your PATH, or use the "SQL Shell (psql)" app from the Start menu.
4. **Create the database:**
   ```
   psql -U postgres -c "CREATE DATABASE gedt_dev;"
   ```
5. **Build everything** (tables, demo data and checks):
   ```
   psql -U postgres -d gedt_dev -f database/00_setup.sql
   ```
6. **Success looks like** 37 lines starting with `PASS`, then `All checks passed.`

Running step 5 again wipes the database and restores the demo data. Do this only when you want a clean start.

## Run the server (Phase 2)

1. Copy `.env.example` to `.env`. Put your PostgreSQL password in `DATABASE_URL`, and replace `JWT_SECRET` and `SIM_FEED_KEY` with long random text.
2. Install the server's packages (needs internet, once only):
   ```
   npm install
   ```
3. Load the database. This also creates it if it does not exist:
   ```
   npm run db:load
   ```
   (You can skip step 4 of the Windows setup above if you use this.)
4. Start the server:
   ```
   npm start
   ```
   It listens on http://localhost:3000. Check http://localhost:3000/api/health. You should see `{"status":"ok"}`.
5. Run the automatic tests (they build and use a separate database called `gedt_test`):
   ```
   npm test
   ```
   Success looks like `# pass 39` and `# fail 0`.
6. Try a simulated fibre cut while the server is running (open a second terminal):
   ```
   npm run simulate -- LAG-AOE-BB-03
   ```
   The alert emails are printed in the server terminal, because `EMAIL_MODE=console`.

## Use the web interface (Phase 3)

With the server running, open **http://localhost:3000** in a browser (use Chrome, Edge or Firefox). The map background needs an internet connection. Everything else works offline.

1. On the sign-in page click a demonstration account, for example **Asset Manager**, then **Sign in**. (These buttons appear because `DEMO_MODE=true` in `.env`.)
2. The **Map** shows your devices and routes. Click one to update its status, log maintenance, see its history or report a cut. Use **+ Device** and **+ Route** to add new ones.
3. Report a cut on a route, then sign out and sign in as **Other operator (manager)** to see the general warning that a neighbour receives.
4. Try the other pages: **Alerts**, **Maintenance**, **Free routes**, **Dashboard**, **Reports and export**. A GIS Administrator also sees **Users** and **Audit log**.

Demo logins are listed above. Other tools can use the server directly: sign in with `POST /api/auth/login` and use the returned token as described in `docs/api.md`.

## Save your work to GitHub

```
git init
git add .
git commit -m "Phase 1: database schema, demo data and checks"
git branch -M main
git remote add origin https://github.com/YOUR-NAME/gedt-prototype.git
git push -u origin main
```

Create the (private) repository on GitHub first. Push at the end of every session.

## Moving to a different laptop later

1. Install the same four programs (and PostGIS) as above.
2. `git clone` the repository.
3. Copy `.env.example` to `.env` and fill it in.
4. Run steps 4 and 5 above. The database is rebuilt from the files, so nothing else needs moving.

## On a borrowed laptop

Sign out of GitHub, Google and email when you finish, do not save passwords in the browser, and delete the project folder once everything is pushed.
