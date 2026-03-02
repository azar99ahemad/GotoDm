const IORedis = require('ioredis');
const logger = require('./logger');

let redisClient = null;

function getRedisClient() {
  if (!redisClient) {
    redisClient = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: null, // required by BullMQ
      enableReadyCheck: false,
      retryStrategy: (times) => Math.min(times * 50, 2000),
    });

    redisClient.on('connect', () => logger.info('Redis connected'));
    redisClient.on('error', (err) => logger.error('Redis error', { error: err.message }));
  }
  return redisClient;
}

module.exports = { getRedisClient };
