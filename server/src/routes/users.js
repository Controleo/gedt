const express = require('express');
const bcrypt = require('bcryptjs');
const { query, tx } = require('../db');
const { requireRole } = require('../auth');
const H = require('../http');
const { asyncHandler, HttpError, ENUMS } = H;

const router = express.Router();
router.use(requireRole('gis_admin'));

const COLS = 'user_id, full_name, email, role, is_active, created_at';

router.get('/users', asyncHandler(async (req, res) => {
  const { rows } = await query(`SELECT ${COLS} FROM users WHERE operator_id = $1 ORDER BY full_name`, [req.user.operatorId]);
  res.json(rows);
}));

router.post('/users', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const name = H.text(b.full_name, 'full_name', { max: 120 });
  const email = H.text(b.email, 'email', { max: 200 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'email is not valid');
  const role = H.oneOf(b.role, ENUMS.role, 'role');
  const password = H.text(b.password, 'password', { min: 8, max: 72 });
  const hash = await bcrypt.hash(password, 10);
  const row = await tx(req.user.id, async (c) => {
    const { rows } = await c.query(
      `INSERT INTO users (operator_id, full_name, email, password_hash, role) VALUES ($1,$2,$3,$4,$5) RETURNING ${COLS}`,
      [req.user.operatorId, name, email, hash, role]);
    return rows[0];
  });
  res.status(201).json(row);
}));

router.patch('/users/:id', asyncHandler(async (req, res) => {
  const id = H.integer(req.params.id, 'id', { min: 1 });
  const b = req.body || {};
  if (id === req.user.id && (b.role !== undefined || b.is_active !== undefined)) throw new HttpError(400, 'You cannot change your own role or switch off your own account');
  const sets = []; const params = [];
  const set = (col, v) => { params.push(v); sets.push(`${col} = $${params.length}`); };
  if (b.role !== undefined) set('role', H.oneOf(b.role, ENUMS.role, 'role'));
  if (b.is_active !== undefined) { if (typeof b.is_active !== 'boolean') throw new HttpError(400, 'is_active must be true or false'); set('is_active', b.is_active); }
  if (b.full_name !== undefined) set('full_name', H.text(b.full_name, 'full_name', { max: 120 }));
  if (b.password !== undefined) set('password_hash', await bcrypt.hash(H.text(b.password, 'password', { min: 8, max: 72 }), 10));
  if (!sets.length) throw new HttpError(400, 'Nothing to update');
  const row = await tx(req.user.id, async (c) => {
    params.push(id, req.user.operatorId);
    const { rows } = await c.query(`UPDATE users SET ${sets.join(', ')} WHERE user_id = $${params.length - 1} AND operator_id = $${params.length} RETURNING ${COLS}`, params);
    if (!rows[0]) throw new HttpError(404, 'User not found');
    return rows[0];
  });
  res.json(row);
}));

// The audit log, limited to changes made by people in the administrator's own operator
router.get('/audit', asyncHandler(async (req, res) => {
  const params = [req.user.operatorId]; const where = ['a.user_id IN (SELECT user_id FROM users WHERE operator_id = $1)'];
  if (req.query.table) { params.push(H.oneOf(req.query.table, ['devices', 'routes', 'maintenance_records', 'alerts', 'users'], 'table')); where.push(`a.table_name = $${params.length}`); }
  if (req.query.record_id) { params.push(String(req.query.record_id).slice(0, 20)); where.push(`a.record_id = $${params.length}`); }
  params.push(H.limit(req.query.limit, 200, 1000));
  const { rows } = await query(
    `SELECT a.audit_id, a.action, a.table_name, a.record_id, a.old_data, a.new_data, a.performed_at, u.full_name AS performed_by
       FROM audit_log a LEFT JOIN users u ON u.user_id = a.user_id WHERE ${where.join(' AND ')} ORDER BY a.audit_id DESC LIMIT $${params.length}`, params);
  res.json(rows);
}));

module.exports = router;
