const axios = require('axios');
const { pool } = require('../db');
const { sendDM, replyToComment } = require('./instagramService');
const logger = require('../config/logger');

const GRAPH_API_BASE = 'https://graph.facebook.com/v19.0';

// Maximum retries before marking a message as failed
const MAX_RETRIES = 3;
// Base delay for exponential backoff (ms)
const RETRY_BASE_DELAY_MS = 1000;

/**
 * Compute exponential backoff delay: base * 2^attempt (max 30s)
 */
function backoffMs(attempt) {
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, 30000);
}

/**
 * Sleep for `ms` milliseconds.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Send a DM with retry logic and message log tracking.
 */
async function sendDMWithRetry({
  logId,
  recipientIgId,
  messageText,
  igAccountId,
  userId,
  automationId,
  ruleId,
  delaySeconds = 0,
}) {
  // Human-like delay before sending
  if (delaySeconds > 0) {
    await sleep(delaySeconds * 1000);
  }

  let lastError = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await sendDM({ recipientIgId, messageText, igAccountId });

      // Mark log as sent
      await pool.query(
        `UPDATE message_logs
         SET status = 'sent', graph_message_id = $1, sent_at = NOW()
         WHERE id = $2`,
        [result.message_id || null, logId],
      );

      // Increment usage counter
      await incrementUsage(userId);

      logger.info('DM sent successfully', { logId, recipientIgId, messageId: result.message_id });
      return result;
    } catch (err) {
      lastError = err;
      const isRetryable = isRetryableError(err);
      logger.warn('DM send attempt failed', {
        logId,
        attempt,
        retryable: isRetryable,
        error: err.message,
      });

      if (!isRetryable || attempt === MAX_RETRIES - 1) break;
      await sleep(backoffMs(attempt));
    }
  }

  // All attempts failed
  await pool.query(
    `UPDATE message_logs
     SET status = 'failed', error_message = $1
     WHERE id = $2`,
    [lastError?.message || 'Unknown error', logId],
  );
  throw lastError;
}

/**
 * Reply to a comment with retry logic and message log tracking.
 */
async function replyToCommentWithRetry({
  logId,
  commentId,
  messageText,
  igAccountId,
  userId,
  delaySeconds = 0,
}) {
  if (delaySeconds > 0) {
    await sleep(delaySeconds * 1000);
  }

  let lastError = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await replyToComment({ commentId, messageText, igAccountId });

      await pool.query(
        `UPDATE message_logs
         SET status = 'sent', graph_message_id = $1, sent_at = NOW()
         WHERE id = $2`,
        [result.id || null, logId],
      );

      await incrementUsage(userId);
      logger.info('Comment reply sent', { logId, commentId });
      return result;
    } catch (err) {
      lastError = err;
      if (!isRetryableError(err) || attempt === MAX_RETRIES - 1) break;
      await sleep(backoffMs(attempt));
    }
  }

  await pool.query(
    `UPDATE message_logs SET status = 'failed', error_message = $1 WHERE id = $2`,
    [lastError?.message || 'Unknown error', logId],
  );
  throw lastError;
}

/**
 * Create a pending message log entry and return its ID.
 */
async function createMessageLog({
  userId,
  instagramAccountId,
  automationId,
  ruleId,
  direction,
  messageType,
  recipientIgId,
  senderIgId,
  messageText,
}) {
  const { rows } = await pool.query(
    `INSERT INTO message_logs
       (user_id, instagram_account_id, automation_id, rule_id, direction,
        message_type, recipient_ig_id, sender_ig_id, message_text, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')
     RETURNING id`,
    [
      userId,
      instagramAccountId,
      automationId || null,
      ruleId || null,
      direction,
      messageType,
      recipientIgId || null,
      senderIgId || null,
      messageText,
    ],
  );
  return rows[0].id;
}

/**
 * Increment the DM sent counter for the current billing period.
 */
async function incrementUsage(userId) {
  await pool.query(
    `UPDATE usage_limits
     SET dm_sent = dm_sent + 1, updated_at = NOW()
     WHERE user_id = $1
       AND period_start <= NOW()
       AND period_end   >= NOW()`,
    [userId],
  );
}

/**
 * Determine whether a Graph API error should trigger a retry.
 * Codes 4, 17, 32, 613 are rate-limit related; 500+ are server errors.
 */
function isRetryableError(err) {
  const code = err.response?.data?.error?.code;
  const status = err.response?.status;

  if (code && [4, 17, 32, 613].includes(code)) return true;
  if (status && status >= 500) return true;
  return false;
}

module.exports = {
  sendDMWithRetry,
  replyToCommentWithRetry,
  createMessageLog,
  incrementUsage,
};
