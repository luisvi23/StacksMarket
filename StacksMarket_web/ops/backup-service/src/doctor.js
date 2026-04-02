const { resolveMongoTool } = require("./utils");
const { runCommand } = require("./utils");

async function runDoctor(config, logger) {
  const mongodump = resolveMongoTool(config.mongoToolsBinDir, "mongodump");
  const mongorestore = resolveMongoTool(config.mongoToolsBinDir, "mongorestore");

  logger.info("doctor_start");
  await runCommand(mongodump, ["--version"], { logger });
  await runCommand(mongorestore, ["--version"], { logger });
  logger.info("doctor_done", {
    awsRegion: config.awsRegion,
    bucket: config.s3Bucket,
    database: config.mongodbDatabase
  });
}

module.exports = { runDoctor };
