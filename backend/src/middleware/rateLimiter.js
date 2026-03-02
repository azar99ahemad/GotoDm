const rateLimit = require('express-rate-limit');
const { getRedisClient } = require('../config/redis');
const logger = require('../config/logger');

/**
 * Returns an express-rate-limit middleware configured with safe defaults.
 */
function createRateLimiter({ windowMs = 60 * 1000, max = 60, keyPrefix = 'rl' } = {}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const userId = req.user?.id || req.ip;
      return `${keyPrefix}:${userId}`;
    },
    handler: (req, res) => {
      logger.warn('Rate limit exceeded', { ip: req.ip, path: req.path });
      res.status(429).json({ error: 'Too many requests, please slow down.' });
    },
  });
}

const apiLimiter     = createRateLimiter({ windowMs: 60 * 1000, max: 120, keyPrefix: 'api' });
const authLimiter    = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20, keyPrefix: 'auth' });
const webhookLimiter = createRateLimiter({ windowMs: 1000, max: 50, keyPrefix: 'wh' });

module.exports = { apiLimiter, authLimiter, webhookLimiter };
