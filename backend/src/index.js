require('dotenv').config();

const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');

const logger           = require('./config/logger');
const { runMigrations } = require('./db');
const { startDMWorker, startCommentWorker } = require('./queues/workers/messageWorker');
const { apiLimiter }   = require('./middleware/rateLimiter');

// Routes
const authRouter        = require('./routes/auth');
const instagramRouter   = require('./routes/instagram');
const webhookRouter     = require('./routes/webhook');
const automationsRouter = require('./routes/automations');
const billingRouter     = require('./routes/billing');
const analyticsRouter   = require('./routes/analytics');

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── Security headers ─────────────────────────────────────────────────────────
app.use(helmet());

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));

// ─── Body parsing ─────────────────────────────────────────────────────────────
// Stripe + Meta webhooks need the raw body for HMAC signature verification.
// Use express.raw() on those specific paths; express.json() everywhere else.
app.use('/api/billing/webhook', express.raw({ type: 'application/json', limit: '1mb' }), (req, res, next) => {
  req.rawBody = req.body;
  next();
});
app.use('/api/webhook', express.json({ limit: '1mb' }), (req, res, next) => {
  // rawBody for Meta webhook: reconstruct from parsed body for signature check
  req.rawBody = JSON.stringify(req.body);
  next();
});
app.use(express.json({ limit: '1mb' }));

// ─── Global API rate limiter ───────────────────────────────────────────────────
app.use('/api', apiLimiter);

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth',        authRouter);
app.use('/api/instagram',   instagramRouter);
app.use('/api/webhook',     webhookRouter);
app.use('/api/automations', automationsRouter);
app.use('/api/billing',     billingRouter);
app.use('/api/analytics',   analyticsRouter);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ─── 404 handler ──────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Bootstrap ────────────────────────────────────────────────────────────────
async function bootstrap() {
  try {
    await runMigrations();
    logger.info('Database migrations complete');
  } catch (err) {
    logger.error('Migration failed – continuing anyway', { error: err.message });
  }

  // Start BullMQ workers (in the same process for simplicity; can be split)
  if (process.env.RUN_WORKERS !== 'false') {
    startDMWorker();
    startCommentWorker();
    logger.info('BullMQ workers started');
  }

  app.listen(PORT, () => {
    logger.info(`Server listening on port ${PORT}`);
  });
}

bootstrap();

module.exports = app; // exported for testing
