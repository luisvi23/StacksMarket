const { runRestore } = require("./restore");

async function runVerify(config, logger) {
  if (!config.verifyRestoreEnabled) {
    logger.warn("verify_skipped", {
      reason: "VERIFY_RESTORE_ENABLED=false"
    });
    return { skipped: true };
  }

  if (!config.verifyRestoreMongoUri) {
    throw new Error("VERIFY_RESTORE_MONGODB_URI is required when VERIFY_RESTORE_ENABLED=true");
  }

  logger.info("verify_start", {
    targetDatabase: config.verifyRestoreDatabase
  });

  const result = await runRestore(config, logger, {
    targetUri: config.verifyRestoreMongoUri,
    targetDatabase: config.verifyRestoreDatabase,
    dropBefore: config.verifyRestoreDropBefore
  });

  logger.info("verify_done", result);
  return result;
}

module.exports = { runVerify };
