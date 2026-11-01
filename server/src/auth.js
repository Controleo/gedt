const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('./config');
const { query } = require('./db');
const { HttpError, asyncHandler } = require('./http');

// Compared against when the email is unknown, so the response time does not reveal which emails exist
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

const sign = (user) => jwt.sign({ sub: user.user_id }, config.jwtSecret, { expiresIn: config.jwtExpires });

async function login(email, password) {
  const { rows } = await query(
    `SELECT u.user_id, u.operator_id, u.full_name, u.email, u.role, u.is_active, u.password_hash, o.name AS operator_name
       FROM users u JOIN operators o ON o.operator_id = u.operator_id WHERE lower(u.email) = lower($1)`,
    [String(email || '')]
  );
  const user = rows[0];
  const ok = await bcrypt.compare(String(password || ''), user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok || !user.is_active) throw new HttpError(401, 'Email or password is incorrect');
  return {
    token: sign(user),
    user: { id: user.user_id, name: user.full_name, email: user.email, role: user.role, operatorId: user.operator_id, operatorName: user.operator_name },
  };
}

// Reads the token, then loads the user again so a disabled account or changed role takes effect at once
const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) throw new HttpError(401, 'Sign in required');
  let payload;
  try {
    payload = jwt.verify(header.slice(7), config.jwtSecret);
  } catch (e) {
    throw new HttpError(401, 'Your session is not valid. Please sign in again');
  }
  const { rows } = await query(
    `SELECT u.user_id, u.operator_id, u.full_name, u.email, u.role, o.name AS operator_name
       FROM users u JOIN operators o ON o.operator_id = u.operator_id WHERE u.user_id = $1 AND u.is_active`,
    [payload.sub]
  );
  if (!rows[0]) throw new HttpError(401, 'Your session is not valid. Please sign in again');
  const u = rows[0];
  req.user = { id: u.user_id, operatorId: u.operator_id, name: u.full_name, email: u.email, role: u.role, operatorName: u.operator_name };
  next();
});

const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : next(new HttpError(403, 'Your role is not allowed to do this'));

module.exports = { login, authenticate, requireRole };
