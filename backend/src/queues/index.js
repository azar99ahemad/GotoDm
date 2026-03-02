const { Queue } = require('bullmq');
const { getRedisClient } = require('../config/redis');

let messageQueue = null;
let commentQueue = null;

const QUEUE_OPTS = {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 200 },
  },
};

function getMessageQueue() {
  if (!messageQueue) {
    messageQueue = new Queue('dm-send', {
      connection: getRedisClient(),
      ...QUEUE_OPTS,
    });
  }
  return messageQueue;
}

function getCommentQueue() {
  if (!commentQueue) {
    commentQueue = new Queue('comment-reply', {
      connection: getRedisClient(),
      ...QUEUE_OPTS,
    });
  }
  return commentQueue;
}

/**
 * Enqueue a DM send job.
 *
 * @param {object} payload
 * @param {string} payload.logId         - message_logs row ID (pre-created)
 * @param {string} payload.userId
 * @param {string} payload.igAccountId
 * @param {string} payload.recipientIgId
 * @param {string} payload.messageText
 * @param {string} payload.automationId
 * @param {string} payload.ruleId
 * @param {number} payload.delaySeconds
 */
async function enqueueDM(payload) {
  const delay = (payload.delaySeconds || 0) * 1000;
  return getMessageQueue().add('send-dm', payload, { delay });
}

/**
 * Enqueue a comment-reply job.
 */
async function enqueueCommentReply(payload) {
  const delay = (payload.delaySeconds || 0) * 1000;
  return getCommentQueue().add('reply-comment', payload, { delay });
}

module.exports = { getMessageQueue, getCommentQueue, enqueueDM, enqueueCommentReply };
