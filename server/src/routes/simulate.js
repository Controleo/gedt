const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const H = require('../http');
const { raiseAlert } = require('./alerts');
const { sendPendingEmails } = require('../mailer');
const { asyncHandler, HttpError } = H;

const router = express.Router();

// The simulated monitoring feed (FR15). It stands in for equipment that would report a cut.
// It is not signed in as a person, so it uses a shared key sent in the X-Feed-Key header.
router.post('/cut', asyncHandler(async (req, res) => {
  if (!config.simFeedKey) throw new HttpError(503, 'The simulated feed is switched off. Set SIM_FEED_KEY in .env to turn it on');
  const given = Buffer.from(String(req.headers['x-feed-key'] || ''));
  const expected = Buffer.from(config.simFeedKey);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw new HttpError(401, 'Feed key is missing or wrong');
  const b = req.body || {};
  if (!b.route_code) throw new HttpError(400, 'route_code is required');
  let lng = null, lat = null;
  if (b.longitude !== undefined || b.latitude !== undefined) [lng, lat] = H.coordinate(b.longitude, b.latitude);
  const alertId = await raiseAlert({ routeRef: H.text(b.route_code, 'route_code', { max: 40 }), lng, lat, source: 'simulated_feed', userId: null, operatorId: null });
  sendPendingEmails().catch(() => {});
  res.status(201).json({ alert_id: alertId, source: 'simulated_feed' });
}));

module.exports = router;
