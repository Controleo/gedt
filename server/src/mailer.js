const nodemailer = require('nodemailer');
const config = require('./config');
const { pool } = require('./db');

let transport = null;
function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.port === 465,
      auth: config.email.user ? { user: config.email.user, pass: config.email.password } : undefined,
    });
  }
  return transport;
}

// Sends the email notices that the alert function queued. Returns how many were handled.
async function sendPendingEmails(batch = 50) {
  const client = await pool.connect();
  let handled = 0;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT n.notification_id, n.message, u.email, u.full_name
         FROM notifications n JOIN users u ON u.user_id = n.recipient_user_id
        WHERE n.channel = 'email' AND n.delivered_at IS NULL
        ORDER BY n.notification_id LIMIT $1 FOR UPDATE OF n SKIP LOCKED`,
      [batch]
    );
    for (const n of rows) {
      try {
        if (config.email.mode === 'smtp') {
          await getTransport().sendMail({ from: config.email.from, to: n.email, subject: 'GEDT fibre cut alert', text: `Hello ${n.full_name},\n\n${n.message}\n\nSign in to the GEDT registry for details.` });
        } else {
          console.log(`[email:console] to ${n.email}: ${n.message}`);
        }
        await client.query('UPDATE notifications SET delivered_at = now() WHERE notification_id = $1', [n.notification_id]);
        handled += 1;
      } catch (err) {
        console.error(`Email to ${n.email} failed and will be retried:`, err.message);
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Email run failed:', err.message);
  } finally {
    client.release();
  }
  return handled;
}

module.exports = { sendPendingEmails };
