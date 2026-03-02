const { Worker } = require('bullmq');
const { getRedisClient } = require('../../config/redis');
const { sendDMWithRetry, replyToCommentWithRetry } = require('../../services/messageService');
const logger = require('../../config/logger');

/**
 * Worker that processes DM send jobs from the 'dm-send' queue.
 */
function startDMWorker() {
  const worker = new Worker(
    'dm-send',
    async (job) => {
      const {
        logId,
        userId,
        igAccountId,
        recipientIgId,
        messageText,
        automationId,
        ruleId,
        delaySeconds,
      } = job.data;

      logger.info('Processing DM job', { jobId: job.id, logId, recipientIgId });

      await sendDMWithRetry({
        logId,
        recipientIgId,
        messageText,
        igAccountId,
        userId,
        automationId,
        ruleId,
        delaySeconds: 0, // delay already handled by BullMQ job delay
      });
    },
    {
      connection: getRedisClient(),
      concurrency: 5,
    },
  );

  worker.on('completed', (job) => logger.info('DM job completed', { jobId: job.id }));
  worker.on('failed', (job, err) =>
    logger.error('DM job failed', { jobId: job?.id, error: err.message }),
  );

  return worker;
}

/**
 * Worker that processes comment reply jobs from the 'comment-reply' queue.
 */
function startCommentWorker() {
  const worker = new Worker(
    'comment-reply',
    async (job) => {
      const { logId, userId, igAccountId, commentId, messageText, delaySeconds } = job.data;

      logger.info('Processing comment reply job', { jobId: job.id, logId, commentId });

      await replyToCommentWithRetry({
        logId,
        commentId,
        messageText,
        igAccountId,
        userId,
        delaySeconds: 0,
      });
    },
    {
      connection: getRedisClient(),
      concurrency: 5,
    },
  );

  worker.on('completed', (job) => logger.info('Comment reply job completed', { jobId: job.id }));
  worker.on('failed', (job, err) =>
    logger.error('Comment reply job failed', { jobId: job?.id, error: err.message }),
  );

  return worker;
}

module.exports = { startDMWorker, startCommentWorker };
