const config = require("./config");
const { createApp } = require("./app");
const { sendPendingEmails } = require("./mailer");
const { pool } = require("./db");

if (process.env.NODE_ENV === "production" && config.demoMode)
  console.warn(
    "DEMO_MODE is on: demonstration sign-in buttons are visible. Fine for the evaluation, switch it off afterwards.",
  );
const app = createApp();
const server = app.listen(config.port, () =>
  console.log(`GEDT server listening on http://localhost:${config.port}`),
);

// Send queued alert emails every 30 seconds
const timer = setInterval(() => sendPendingEmails().catch(() => {}), 30000);
timer.unref();

function stop() {
  clearInterval(timer);
  server.close(() => pool.end().then(() => process.exit(0)));
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
