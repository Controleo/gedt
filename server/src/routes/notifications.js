const express = require('express');
const { query } = require('../db');
const H = require('../http');
const { asyncHandler, HttpError } = H;

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const unread = String(req.query.unread) === 'true' ? ' AND n.read_at IS NULL' : '';
  const { rows } = await query(
    `SELECT n.notification_id, n.alert_id, n.reason, n.message, n.created_at, n.read_at, a.status AS alert_status
       FROM notifications n JOIN alerts a ON a.alert_id = n.alert_id
      WHERE n.recipient_user_id = $1 AND n.channel = 'in_app'${unread} ORDER BY n.created_at DESC LIMIT $2`,
    [req.user.id, H.limit(req.query.limit, 100, 500)]);
  res.json(rows);
}));

router.patch('/:id/read', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `UPDATE notifications SET read_at = COALESCE(read_at, now())
      WHERE notification_id = $1 AND recipient_user_id = $2 AND channel = 'in_app' RETURNING notification_id, read_at`,
    [H.integer(req.params.id, 'id', { min: 1 }), req.user.id]);
  if (!rows[0]) throw new HttpError(404, 'Notification not found');
  res.json(rows[0]);
}));

module.exports = router;
