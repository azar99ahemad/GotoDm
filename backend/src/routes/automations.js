const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { pool } = require('../db');
const logger = require('../config/logger');

const router = express.Router();

const VALID_TRIGGERS  = ['comment_keyword', 'dm_keyword', 'first_dm', 'story_mention'];
const VALID_ACTIONS   = ['send_dm', 'reply_comment', 'send_template'];
const VALID_MATCH     = ['contains', 'exact', 'starts_with', 'regex'];

// ─── Automations ─────────────────────────────────────────────────────────────

// GET /api/automations
router.get('/', authenticate, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.*, ia.username AS ig_username
     FROM automations a
     JOIN instagram_accounts ia ON ia.id = a.instagram_account_id
     WHERE a.user_id = $1
     ORDER BY a.created_at DESC`,
    [req.user.id],
  );
  res.json(rows);
});

// POST /api/automations
router.post(
  '/',
  authenticate,
  [
    body('instagram_account_id').isUUID(),
    body('name').trim().notEmpty().isLength({ max: 255 }),
    body('trigger_type').isIn(VALID_TRIGGERS),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const { instagram_account_id, name, trigger_type } = req.body;

    // Verify account belongs to user
    const { rows: accts } = await pool.query(
      'SELECT id FROM instagram_accounts WHERE id = $1 AND user_id = $2',
      [instagram_account_id, req.user.id],
    );
    if (accts.length === 0) return res.status(404).json({ error: 'Instagram account not found' });

    const { rows } = await pool.query(
      `INSERT INTO automations (user_id, instagram_account_id, name, trigger_type)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.user.id, instagram_account_id, name, trigger_type],
    );
    res.status(201).json(rows[0]);
  },
);

// GET /api/automations/:id
router.get('/:id', authenticate, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.*, ia.username AS ig_username
     FROM automations a
     JOIN instagram_accounts ia ON ia.id = a.instagram_account_id
     WHERE a.id = $1 AND a.user_id = $2`,
    [req.params.id, req.user.id],
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Automation not found' });
  res.json(rows[0]);
});

// PATCH /api/automations/:id
router.patch(
  '/:id',
  authenticate,
  [
    body('name').optional().trim().notEmpty().isLength({ max: 255 }),
    body('is_active').optional().isBoolean(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const allowed = ['name', 'is_active'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 1}`);
    const values     = Object.values(updates);
    values.push(req.params.id, req.user.id);

    const { rows } = await pool.query(
      `UPDATE automations SET ${setClauses.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length - 1} AND user_id = $${values.length}
       RETURNING *`,
      values,
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Automation not found' });
    res.json(rows[0]);
  },
);

// DELETE /api/automations/:id
router.delete('/:id', authenticate, async (req, res) => {
  const { rows } = await pool.query(
    'DELETE FROM automations WHERE id = $1 AND user_id = $2 RETURNING id',
    [req.params.id, req.user.id],
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Automation not found' });
  res.json({ message: 'Automation deleted' });
});

// ─── Rules ───────────────────────────────────────────────────────────────────

// GET /api/automations/:id/rules
router.get('/:id/rules', authenticate, async (req, res) => {
  // Verify automation ownership
  const { rows: autoRows } = await pool.query(
    'SELECT id FROM automations WHERE id = $1 AND user_id = $2',
    [req.params.id, req.user.id],
  );
  if (autoRows.length === 0) return res.status(404).json({ error: 'Automation not found' });

  const { rows } = await pool.query(
    'SELECT * FROM automation_rules WHERE automation_id = $1 ORDER BY priority DESC',
    [req.params.id],
  );
  res.json(rows);
});

// POST /api/automations/:id/rules
router.post(
  '/:id/rules',
  authenticate,
  [
    body('keyword').optional({ nullable: true }).trim(),
    body('match_type').optional().isIn(VALID_MATCH),
    body('action_type').isIn(VALID_ACTIONS),
    body('message_text').optional({ nullable: true }).trim().isLength({ max: 2000 }),
    body('delay_seconds').optional().isInt({ min: 0, max: 3600 }),
    body('priority').optional().isInt({ min: 0, max: 100 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const { rows: autoRows } = await pool.query(
      'SELECT id FROM automations WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id],
    );
    if (autoRows.length === 0) return res.status(404).json({ error: 'Automation not found' });

    const {
      keyword = null,
      match_type = 'contains',
      action_type,
      message_text = null,
      delay_seconds = 0,
      priority = 0,
    } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO automation_rules
         (automation_id, keyword, match_type, action_type, message_text, delay_seconds, priority)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.id, keyword, match_type, action_type, message_text, delay_seconds, priority],
    );
    res.status(201).json(rows[0]);
  },
);

// DELETE /api/automations/:id/rules/:ruleId
router.delete('/:id/rules/:ruleId', authenticate, async (req, res) => {
  const { rows: autoRows } = await pool.query(
    'SELECT id FROM automations WHERE id = $1 AND user_id = $2',
    [req.params.id, req.user.id],
  );
  if (autoRows.length === 0) return res.status(404).json({ error: 'Automation not found' });

  const { rows } = await pool.query(
    'DELETE FROM automation_rules WHERE id = $1 AND automation_id = $2 RETURNING id',
    [req.params.ruleId, req.params.id],
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Rule not found' });
  res.json({ message: 'Rule deleted' });
});

module.exports = router;
