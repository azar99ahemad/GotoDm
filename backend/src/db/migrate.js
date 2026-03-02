require('dotenv').config();
const { runMigrations } = require('./index');
const logger = require('../config/logger');

runMigrations()
  .then(() => {
    logger.info('All migrations completed successfully');
    process.exit(0);
  })
  .catch((err) => {
    logger.error('Migration process failed', { error: err.message });
    process.exit(1);
  });
