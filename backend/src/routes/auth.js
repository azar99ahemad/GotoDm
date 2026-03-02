const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const { pool } = require('../db');
const { authLimiter } = require('../middleware/rateLimiter');
const logger = require('../config/logger');

const router = express.Router();

const SALT_ROUNDS = 12;
const ACCESS_TOKEN_TTL  = '15m';
const REFRESH_TOKEN_TTL = '7d';
const REFRESH_TOKEN_DAYS = 7;

function generateTokens(userId) {
  const accessToken = jwt.sign({ sub: userId }, process.env.JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL,
  });
  const refreshToken = crypto.randomBytes(40).toString('hex');
  return { accessToken, refreshToken };
}

// POST /api/auth/register
router.post(
  '/register',
  authLimiter,
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }),
    body('full_name').optional().trim().isLength({ max: 255 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const { email, password, full_name } = req.body;
    try {
      const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'Email already registered' });
      }

      const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
      const { rows } = await pool.query(
        `INSERT INTO users (email, password_hash, full_name)
         VALUES ($1, $2, $3)
         RETURNING id, email, full_name, role`,
        [email, password_hash, full_name || null],
      );

      const user = rows[0];

      // Bootstrap free plan subscription row
      await pool.query(
        `INSERT INTO subscriptions (user_id, stripe_customer_id, plan, status)
         VALUES ($1, $2, 'free', 'active')
         ON CONFLICT DO NOTHING`,
        [user.id, `pending_${user.id}`],
      );

      // Bootstrap usage limits for this month
      const now = new Date();
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      await pool.query(
        `INSERT INTO usage_limits (user_id, period_start, period_end, dm_limit)
         VALUES ($1, date_trunc('month', NOW()), $2, 500)
         ON CONFLICT (user_id, period_start) DO NOTHING`,
        [user.id, periodEnd],
      );

      const { accessToken, refreshToken } = generateTokens(user.id);
      const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 86400 * 1000);
      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

      await pool.query(
        'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)',
        [user.id, tokenHash, expiresAt],
      );

      logger.info('User registered', { userId: user.id });
      res.status(201).json({ accessToken, refreshToken, user });
    } catch (err) {
      logger.error('Registration error', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// POST /api/auth/login
router.post(
  '/login',
  authLimiter,
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const { email, password } = req.body;
    try {
      const { rows } = await pool.query(
        'SELECT id, email, password_hash, full_name, role FROM users WHERE email = $1',
        [email],
      );
      if (rows.length === 0) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const user = rows[0];
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

      const { accessToken, refreshToken } = generateTokens(user.id);
      const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 86400 * 1000);
      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

      await pool.query(
        'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)',
        [user.id, tokenHash, expiresAt],
      );

      const { password_hash, ...safeUser } = user;
      res.json({ accessToken, refreshToken, user: safeUser });
    } catch (err) {
      logger.error('Login error', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// POST /api/auth/refresh
router.post('/refresh', authLimiter, async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });

  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  try {
    const { rows } = await pool.query(
      `SELECT rt.user_id, u.email, u.role
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1
         AND rt.revoked = FALSE
         AND rt.expires_at > NOW()`,
      [tokenHash],
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const { user_id, email, role } = rows[0];

    // Rotate: revoke old, issue new
    await pool.query('UPDATE refresh_tokens SET revoked = TRUE WHERE token_hash = $1', [tokenHash]);

    const tokens = generateTokens(user_id);
    const newExpiry = new Date(Date.now() + REFRESH_TOKEN_DAYS * 86400 * 1000);
    const newHash = crypto.createHash('sha256').update(tokens.refreshToken).digest('hex');

    await pool.query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)',
      [user_id, newHash, newExpiry],
    );

    res.json({ ...tokens, user: { id: user_id, email, role } });
  } catch (err) {
    logger.error('Token refresh error', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    await pool.query('UPDATE refresh_tokens SET revoked = TRUE WHERE token_hash = $1', [tokenHash]).catch(() => {});
  }
  res.json({ message: 'Logged out' });
});

module.exports = router;
