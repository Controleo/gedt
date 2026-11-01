# Putting the system online for the evaluation

The evaluators need a web address they can open. The plan uses two free services:

| Part | Service | Why |
|---|---|---|
| Database (PostgreSQL with PostGIS) | **Neon**, free plan | Includes PostGIS, needs no credit card, and does not expire. The free plan has 0.5 GB of storage, far more than this demo needs. It sleeps after 5 minutes without use and wakes in under a second |
| The server and web pages | **Render**, free web service | Builds straight from your GitHub repository. It sleeps after 15 minutes without visitors and takes about a minute to wake |

Render also offers a free database, but it **expires after 30 days**, so this guide does not use it. Free plans change, so read the current terms on each site before you rely on them.

## Before you start
- The project is on GitHub (private is fine) and `npm test` passes on your computer.
- You have free accounts on Neon (neon.com) and Render (render.com). You can sign up to both with GitHub.

## Step 1. Create the database on Neon
1. In Neon, create a project (name it `gedt`). Pick the region closest to your evaluators.
2. Open **Connect**, turn **off** connection pooling, and copy the connection string. It looks like `postgresql://user:password@ep-something.neon.tech/neondb?sslmode=require`. Keep it secret.
3. On your computer, open the project's `.env` file and set `DATABASE_URL` to that string.
4. Build the database on Neon. The `--yes` is required because this command erases and rebuilds the tables:
   ```
   npm run db:load -- --yes
   npm run db:eval
   ```
   The second command adds the 60 practice routes the evaluators use.
5. Put `DATABASE_URL` back to your local value in `.env` afterwards, so you do not wipe the online database by accident.

## Step 2. Create the server on Render
1. In Render choose **New**, then **Blueprint**, and select your GitHub repository. Render reads `render.yaml` and proposes a web service called `gedt-registry`.
2. When asked, paste the Neon connection string as `DATABASE_URL`. The secrets `JWT_SECRET` and `SIM_FEED_KEY` are created for you.
3. Click **Apply**. The first build takes a few minutes.
4. Open the address Render gives you (it ends in `.onrender.com`). Add `/api/health` to it. You should see `{"status":"ok","demo":true}`.
5. Open the main address and sign in with a demonstration account.

## Step 3. Check it works
Sign in as the Asset Manager, search for `LAG-EVAL-01`, report a cut, then sign in as the Harmattan manager and look in Alerts. This is exactly what the evaluators will do. Then reset (see below).

## Before each evaluation session
- **Wake the site** by opening it a few minutes before people arrive. Tell evaluators the first load can take about a minute.
- **Reset the demo data** from your computer, with `DATABASE_URL` pointing at Neon: `npm run db:load -- --yes` then `npm run db:eval`. This removes earlier practice alerts and routes.
- Give each evaluator a participant number from 1 to 60. They use the practice route with that number, so two people never collide.

## While evaluators are using it
- Free services are for light use. About 30 to 50 people spread over days or weeks is fine. A large group at once is not.
- Do not share the Render or Neon logins. Evaluators only need the demonstration accounts.
- The demonstration accounts and the invented data are the only things on the system. No real operator data and no personal data should ever be put on it.

## Settings that matter
| Setting | Value online | Meaning |
|---|---|---|
| `NODE_ENV` | production | Turns on safer defaults |
| `DEMO_MODE` | true | Shows the demonstration sign-in buttons. Switch to false when the evaluation ends |
| `TRUST_PROXY` | true | Needed behind Render so the sign-in limit counts each visitor correctly |
| `EMAIL_MODE` | console | Alert emails are written to the server log. Real email is not set up |
| `SIM_FEED_KEY` | generated | The key for the simulated monitoring feed. Keep it secret |

## After the evaluation
1. Download the questionnaire responses and keep a copy.
2. In Render, suspend or delete the web service. In Neon, delete the project when you no longer need the demo.
3. Keep the GitHub repository. The final report refers to it.

## Back up the database
Run `npm run backup` for the exact commands. You only need a backup if you added data you cannot recreate, which should not be the case for this demo.

## Other ways to run it
- **Docker on any computer or rented server:** `docker compose up --build` starts the database and the server together, then open http://localhost:3000. This is written but has not been tested. Change the two secrets in `docker-compose.yml` first.
- **A paid host** removes the sleeping, for example a small always-on web service plus a database that does not sleep. This is worth considering only if the evaluation needs it.

## If something goes wrong
| Problem | Likely cause and fix |
|---|---|
| The page does not load at first | The free server was asleep. Wait a minute and refresh |
| Health check shows an error | `DATABASE_URL` is wrong or the Neon database is not loaded. Check Step 1 |
| Sign-in works but the map is empty | The demo data was not loaded. Repeat Step 1.4 |
| The map is grey | OpenStreetMap tiles did not load. Check the internet connection |
| "Too many sign-in attempts" | Wait 15 minutes. If it happens to many people, `TRUST_PROXY` is probably not true |
| Practice route is not found | `npm run db:eval` was not run, or the participant number is above 60 |
