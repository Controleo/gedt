const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({ connectionString: config.databaseUrl, ...(config.databaseSsl ? { ssl: true } : {}) });

const query = (text, params) => pool.query(text, params);

// Run work in one transaction and tell the database who is acting, so the
// status log and the audit log record the right user.
async function tx(userId, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (userId) await client.query("SELECT set_config('app.current_user_id', $1, true)", [String(userId)]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, tx };
