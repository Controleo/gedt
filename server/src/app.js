const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { login, authenticate } = require('./auth');
const { query } = require('./db');
const { asyncHandler, errorHandler, HttpError } = require('./http');
const config = require('./config');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);   // so the sign-in limit sees each visitor's address, not the host's
  // The map needs images from the OpenStreetMap tile servers
  const csp = helmet.contentSecurityPolicy.getDefaultDirectives();
  csp['img-src'] = ["'self'", 'data:', 'https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.org'];
  if (process.env.NODE_ENV !== 'production') csp['upgrade-insecure-requests'] = null;   // lets the page work over plain http on a laptop
     app.use(helmet({ contentSecurityPolicy: { directives: csp }, referrerPolicy: { policy: 'strict-origin-when-cross-origin' } }));
  app.use(express.json({ limit: '200kb' }));

  const api = express.Router();
  api.get('/health', asyncHandler(async (req, res) => {
    await query('SELECT 1');
    res.json({ status: 'ok', demo: config.demoMode });
  }));

  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: process.env.NODE_ENV === 'test' ? 1000 : 30, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many sign-in attempts. Please wait a few minutes and try again' } });
  api.post('/auth/login', loginLimiter, asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    res.json(await login(email, password));
  }));

  // The simulated monitoring feed signs in with its own key, not as a person
  api.use('/simulate', require('./routes/simulate'));

  api.use(authenticate);
  api.get('/auth/me', (req, res) => res.json(req.user));
  api.use('/devices', require('./routes/devices'));
  api.use('/routes', require('./routes/fibre-routes'));
  api.use('/maintenance', require('./routes/maintenance'));
  api.use('/alerts', require('./routes/alerts'));
  api.use('/notifications', require('./routes/notifications'));
  api.use('/admin', require('./routes/users'));
  api.use('/', require('./routes/shared'));
  api.use('/', require('./routes/reports'));
  api.use((req, res, next) => next(new HttpError(404, 'Not found')));
  app.use('/api', api);

  const modules = path.join(__dirname, '..', '..', 'node_modules');
  app.use('/vendor/leaflet', express.static(path.join(modules, 'leaflet', 'dist')));
  app.use('/vendor/chartjs', express.static(path.join(modules, 'chart.js', 'dist')));
  const pub = path.join(__dirname, '..', 'public');
  if (fs.existsSync(path.join(pub, 'index.html'))) app.use(express.static(pub));
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
