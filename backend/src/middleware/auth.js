const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const logger = require('../config/logger');

/**
 * Verifies the JWT access token from the Authorization header.
 * Attaches req.user = { id, email, role } on success.
 */
async function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Confirm user still exists (handles deleted/banned accounts)
    const { rows } = await pool.query(
      'SELECT id, email, role FROM users WHERE id = $1',
      [decoded.sub],
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }
    req.user = rows[0];
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    logger.warn('Invalid JWT', { error: err.message });
    return res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = { authenticate };
