// Sends a simulated cut to a running server.  Usage: npm run simulate -- LAG-IKR-BB-03
require('dotenv').config();
const code = process.argv[2];
if (!code) { console.error('Give a route code, for example: npm run simulate -- LAG-IKR-BB-03'); process.exit(1); }
const base = process.env.SERVER_URL || `http://localhost:${process.env.PORT || 3000}`;
fetch(`${base}/api/simulate/cut`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Feed-Key': process.env.SIM_FEED_KEY || '' }, body: JSON.stringify({ route_code: code }) })
  .then(async (r) => { console.log(r.status, await r.text()); })
  .catch((e) => { console.error(e.message); process.exit(1); });
