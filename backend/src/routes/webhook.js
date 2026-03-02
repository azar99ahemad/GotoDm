const express = require('express');
const crypto = require('crypto');
const { evaluate } = require('../services/automationEngine');
const { createMessageLog } = require('../services/messageService');
const { enqueueDM, enqueueCommentReply } = require('../queues');
const { pool } = require('../db');
const { webhookLimiter } = require('../middleware/rateLimiter');
const logger = require('../config/logger');

const router = express.Router();

/**
 * GET /api/webhook  →  Meta webhook verification challenge
 */
router.get('/', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    logger.info('Webhook verified by Meta');
    return res.status(200).send(challenge);
  }
  res.status(403).json({ error: 'Forbidden' });
});

/**
 * POST /api/webhook  →  Receive Meta webhook events
 *
 * Must respond < 5 seconds. Heavy processing is offloaded to BullMQ.
 */
router.post('/', webhookLimiter, async (req, res) => {
  // Verify X-Hub-Signature-256
  const sig = req.headers['x-hub-signature-256'];
  if (!verifySignature(req.rawBody, sig)) {
    logger.warn('Invalid webhook signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Acknowledge immediately to Meta (must be < 5s)
  res.status(200).json({ status: 'ok' });

  const body = req.body;
  if (body.object !== 'instagram') return;

  for (const entry of body.entry || []) {
    // ---------- DM events ----------
    for (const messaging of entry.messaging || []) {
      handleDMEvent(entry.id, messaging).catch((err) =>
        logger.error('DM event processing error', { error: err.message }),
      );
    }

    // ---------- Comment events ----------
    for (const change of entry.changes || []) {
      if (change.field === 'comments') {
        handleCommentEvent(entry.id, change.value).catch((err) =>
          logger.error('Comment event processing error', { error: err.message }),
        );
      }
    }
  }
});

/**
 * Verify the HMAC-SHA256 signature from Meta.
 */
function verifySignature(rawBody, sigHeader) {
  if (!sigHeader) return false;
  const expected = `sha256=${crypto
    .createHmac('sha256', process.env.INSTAGRAM_APP_SECRET)
    .update(rawBody)
    .digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Handle an inbound DM messaging event.
 */
async function handleDMEvent(pageIgId, messaging) {
  const senderId    = messaging.sender?.id;
  const recipientId = messaging.recipient?.id;
  const messageText = messaging.message?.text || '';

  if (!senderId || !recipientId) return;

  // Ignore messages sent by the business account itself (echo)
  if (messaging.message?.is_echo) return;

  // Lookup Instagram account by instagram_user_id (which equals the page IG ID for Business)
  const { rows: accounts } = await pool.query(
    `SELECT ia.id, ia.user_id
     FROM instagram_accounts ia
     WHERE ia.instagram_user_id = $1 AND ia.is_active = TRUE`,
    [recipientId],
  );
  if (accounts.length === 0) return;

  const { id: igAccountId, user_id: userId } = accounts[0];

  // Log inbound message
  await createMessageLog({
    userId,
    instagramAccountId: igAccountId,
    direction: 'inbound',
    messageType: 'dm',
    senderIgId: senderId,
    recipientIgId: recipientId,
    messageText,
  });

  // Check if this is the user's first-ever DM (first_dm trigger)
  const { rows: prevDMs } = await pool.query(
    `SELECT id FROM message_logs
     WHERE instagram_account_id = $1
       AND sender_ig_id = $2
       AND direction = 'inbound'
       AND message_type = 'dm'
     LIMIT 2`,
    [igAccountId, senderId],
  );
  const isFirstDM = prevDMs.length <= 1;

  // Try first_dm automations first, then dm_keyword
  const triggerTypes = isFirstDM
    ? ['first_dm', 'dm_keyword']
    : ['dm_keyword'];

  for (const triggerType of triggerTypes) {
    const match = await evaluate({
      instagramAccountId: igAccountId,
      triggerType,
      inboundText: messageText,
      context: {},
    });

    if (match && match.messageText) {
      const logId = await createMessageLog({
        userId,
        instagramAccountId: igAccountId,
        automationId: match.automation.id,
        ruleId: match.rule.id,
        direction: 'outbound',
        messageType: 'dm',
        recipientIgId: senderId,
        messageText: match.messageText,
      });

      await enqueueDM({
        logId,
        userId,
        igAccountId,
        recipientIgId: senderId,
        messageText: match.messageText,
        automationId: match.automation.id,
        ruleId: match.rule.id,
        delaySeconds: match.rule.delay_seconds || 0,
      });

      break; // Only send one automated reply per event
    }
  }
}

/**
 * Handle an inbound comment event.
 */
async function handleCommentEvent(pageIgId, commentData) {
  const { id: commentId, text: commentText, from } = commentData;
  if (!commentId) return;

  const { rows: accounts } = await pool.query(
    `SELECT ia.id, ia.user_id
     FROM instagram_accounts ia
     WHERE ia.instagram_user_id = $1 AND ia.is_active = TRUE`,
    [pageIgId],
  );
  if (accounts.length === 0) return;

  const { id: igAccountId, user_id: userId } = accounts[0];

  const match = await evaluate({
    instagramAccountId: igAccountId,
    triggerType: 'comment_keyword',
    inboundText: commentText,
    context: { username: from?.username || '' },
  });

  if (match && match.messageText) {
    const logId = await createMessageLog({
      userId,
      instagramAccountId: igAccountId,
      automationId: match.automation.id,
      ruleId: match.rule.id,
      direction: 'outbound',
      messageType: 'comment_reply',
      recipientIgId: from?.id,
      messageText: match.messageText,
    });

    await enqueueCommentReply({
      logId,
      userId,
      igAccountId,
      commentId,
      messageText: match.messageText,
      delaySeconds: match.rule.delay_seconds || 0,
    });
  }
}

module.exports = router;
