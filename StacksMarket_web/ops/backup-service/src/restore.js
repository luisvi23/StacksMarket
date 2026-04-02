const path = require("path");
const {
  utcStamp,
  safeUnlink,
  resolveMongoTool,
  runCommand
} = require("./utils");
const { createS3Client, downloadToFile, findLatestArchive } = require("./s3");

async function resolveArchiveKey(config, logger, explicitKey) {
  if (explicitKey) return explicitKey;
  const prefix = [config.s3Prefix, config.backupEnv, config.mongodbDatabase].filter(Boolean).join("/");
  const s3 = createS3Client(config.awsRegion);
  const latest = await findLatestArchive({
    s3,
    bucket: config.s3Bucket,
    prefix
  });
  if (!latest) {
    throw new Error(`No backup archive found under s3://${config.s3Bucket}/${prefix}`);
  }
  logger.info("restore_latest_selected", {
    key: latest.Key,
    lastModified: latest.LastModified
  });
  return latest.Key;
}

async function runRestore(config, logger, options = {}) {
  const targetUri = options.targetUri || config.restoreMongoUri;
  const targetDatabase = options.targetDatabase || config.restoreDatabase || config.mongodbDatabase;
  const sourceDatabase = config.mongodbDatabase;

  if (!targetUri) {
    throw new Error("RESTORE_MONGODB_URI (or options.targetUri) is required for restore.");
  }

  const archiveKey = await resolveArchiveKey(config, logger, options.archiveKey);
  const stamp = utcStamp();
  const archiveFile = path.join(config.localTmpDir, `restore-${stamp}.archive.gz`);
  const s3 = createS3Client(config.awsRegion);
  const mongorestore = resolveMongoTool(config.mongoToolsBinDir, "mongorestore");

  await downloadToFile({
    s3,
    bucket: config.s3Bucket,
    key: archiveKey,
    filePath: archiveFile,
    logger
  });

  const args = [
    "--uri",
    targetUri,
    `--archive=${archiveFile}`,
    "--gzip",
    "--nsInclude",
    `${sourceDatabase}.*`
  ];

  const targetIsDifferentDb = targetDatabase && targetDatabase !== sourceDatabase;
  if (targetIsDifferentDb) {
    args.push("--nsFrom", `${sourceDatabase}.*`, "--nsTo", `${targetDatabase}.*`);
  }

  const dropBefore = options.dropBefore ?? config.restoreDropBefore;
  if (dropBefore) {
    args.push("--drop");
  }

  logger.info("restore_start", {
    archiveKey,
    sourceDatabase,
    targetDatabase,
    dropBefore
  });

  try {
    await runCommand(mongorestore, args, { logger });
  } finally {
    if (!config.keepLocalArchive) {
      await safeUnlink(archiveFile);
    }
  }

  logger.info("restore_done", {
    archiveKey,
    targetDatabase
  });

  return { archiveKey, targetDatabase };
}

module.exports = { runRestore };
