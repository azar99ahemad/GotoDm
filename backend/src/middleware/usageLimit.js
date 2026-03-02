const { pool } = require('../db');

/**
 * Middleware that blocks requests when the user has exceeded their plan's DM send limit.
 * Must be used AFTER authenticate middleware.
 */
async function checkUsageLimit(req, res, next) {
  const userId = req.user.id;

  try {
    const { rows } = await pool.query(
      `SELECT ul.dm_sent, ul.dm_limit
       FROM usage_limits ul
       WHERE ul.user_id = $1
         AND ul.period_start <= NOW()
         AND ul.period_end   >= NOW()
       ORDER BY ul.period_start DESC
       LIMIT 1`,
      [userId],
    );

    if (rows.length === 0) {
      // No active period row – allow through; the billing service will create one.
      return next();
    }

    const { dm_sent, dm_limit } = rows[0];
    if (dm_sent >= dm_limit) {
      return res.status(429).json({
        error: 'Monthly DM limit reached. Please upgrade your plan.',
        dm_sent,
        dm_limit,
      });
    }

    req.usageRow = rows[0];
    next();
  } catch (err) {
    // On DB error, fail open (log and continue) to avoid blocking legitimate traffic.
    next();
  }
}

module.exports = { checkUsageLimit };
