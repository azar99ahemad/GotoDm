const express = require('express');
const { authenticate } = require('../middleware/auth');
const { pool } = require('../db');

const router = express.Router();

// GET /api/analytics/overview  →  High-level stats for the dashboard
router.get('/overview', authenticate, async (req, res) => {
  const userId = req.user.id;

  const [totalDMs, successRate, recentLogs, usageSummary] = await Promise.all([
    // Total DMs sent (all time)
    pool.query(
      `SELECT COUNT(*) AS total
       FROM message_logs
       WHERE user_id = $1 AND direction = 'outbound' AND message_type = 'dm'`,
      [userId],
    ),

    // Success rate (last 30 days)
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'sent')  AS sent,
         COUNT(*) FILTER (WHERE status = 'failed') AS failed,
         COUNT(*) AS total
       FROM message_logs
       WHERE user_id = $1
         AND direction = 'outbound'
         AND created_at >= NOW() - INTERVAL '30 days'`,
      [userId],
    ),

    // Last 10 outbound logs
    pool.query(
      `SELECT ml.id, ml.message_type, ml.status, ml.created_at,
              ml.recipient_ig_id, ia.username AS ig_username
       FROM message_logs ml
       JOIN instagram_accounts ia ON ia.id = ml.instagram_account_id
       WHERE ml.user_id = $1 AND ml.direction = 'outbound'
       ORDER BY ml.created_at DESC
       LIMIT 10`,
      [userId],
    ),

    // Current period usage
    pool.query(
      `SELECT dm_sent, dm_limit, period_start, period_end
       FROM usage_limits
       WHERE user_id = $1
         AND period_start <= NOW()
         AND period_end   >= NOW()
       LIMIT 1`,
      [userId],
    ),
  ]);

  const sr = successRate.rows[0];
  const total = parseInt(sr.total, 10) || 0;
  const sent  = parseInt(sr.sent, 10)  || 0;

  res.json({
    total_dms_sent:  parseInt(totalDMs.rows[0].total, 10),
    success_rate:    total > 0 ? Math.round((sent / total) * 100) : 100,
    recent_logs:     recentLogs.rows,
    usage:           usageSummary.rows[0] || null,
  });
});

// GET /api/analytics/daily?days=30  →  Daily DM volume
router.get('/daily', authenticate, async (req, res) => {
  const days = Math.min(parseInt(req.query.days, 10) || 30, 90);
  const userId = req.user.id;

  const { rows } = await pool.query(
    `SELECT
       date_trunc('day', created_at) AS day,
       COUNT(*) FILTER (WHERE status = 'sent')   AS sent,
       COUNT(*) FILTER (WHERE status = 'failed') AS failed
     FROM message_logs
     WHERE user_id = $1
       AND direction = 'outbound'
       AND created_at >= NOW() - ($2 || ' days')::INTERVAL
     GROUP BY 1
     ORDER BY 1`,
    [userId, days],
  );

  res.json(rows);
});

// GET /api/analytics/automations  →  Per-automation performance
router.get('/automations', authenticate, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT
       a.id, a.name, a.trigger_type,
       COUNT(ml.id) FILTER (WHERE ml.status = 'sent')   AS sent,
       COUNT(ml.id) FILTER (WHERE ml.status = 'failed') AS failed
     FROM automations a
     LEFT JOIN message_logs ml ON ml.automation_id = a.id
     WHERE a.user_id = $1
     GROUP BY a.id, a.name, a.trigger_type
     ORDER BY sent DESC`,
    [req.user.id],
  );
  res.json(rows);
});

module.exports = router;
