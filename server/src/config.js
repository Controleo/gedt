require('dotenv').config();
const env = process.env;

const config = {
  port: Number(env.PORT || 3000),
  databaseUrl: env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/gedt_dev',
  jwtSecret: env.JWT_SECRET,
  jwtExpires: env.JWT_EXPIRES || '8h',
  simFeedKey: env.SIM_FEED_KEY || '',
  demoMode: String(env.DEMO_MODE || 'true') === 'true',
  trustProxy: String(env.TRUST_PROXY || 'false') === 'true',   // set true behind a host such as Render
  databaseSsl: String(env.PGSSL || 'false') === 'true',
  corridorM: Number(env.CORRIDOR_M || 100),
  email: {
    mode: env.EMAIL_MODE || 'console', // console prints emails, smtp sends them
    from: env.EMAIL_FROM || 'alerts@gedt.example',
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT || 587),
    user: env.SMTP_USER || '',
    password: env.SMTP_PASSWORD || '',
  },
};

if (!config.jwtSecret || config.jwtSecret.length < 16) {
  if (env.NODE_ENV === 'test') {
    config.jwtSecret = 'test-secret-for-automated-tests';
  } else {
    throw new Error('JWT_SECRET is missing or too short. Set a random text of at least 16 characters in .env');
  }
}

module.exports = config;
