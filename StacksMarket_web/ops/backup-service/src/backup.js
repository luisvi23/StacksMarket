const fs = require("fs");
const path = require("path");
const {
  utcStamp,
  backupBaseName,
  buildBackupKeys,
  fileSha256,
  stat,
  safeUnlink,
  resolveMongoTool,
  runCommand
} = require("./utils");
const { createS3Client, uploadFile, putJson } = require("./s3");

async function runBackup(config, logger) {
  const stamp = utcStamp();
  const baseName = backupBaseName({
    appName: config.appName,
    backupEnv: config.backupEnv,
    database: config.mongodbDatabase,
    stamp
  });
  const archivePath = path.join(config.localTmpDir, `${baseName}.archive.gz`);
  const manifestPath = path.join(config.localTmpDir, `${baseName}.manifest.json`);
  const keys = buildBackupKeys({
    s3Prefix: config.s3Prefix,
    backupEnv: config.backupEnv,
    database: config.mongodbDatabase,
    stamp,
    baseName
  });
  const mongodump = resolveMongoTool(config.mongoToolsBinDir, "mongodump");

  logger.info("backup_start", {
    database: config.mongodbDatabase,
    archivePath,
    bucket: config.s3Bucket,
    archiveKey: keys.archiveKey
  });

  await runCommand(mongodump, [
    "--uri",
    config.mongodbUri,
    "--db",
    config.mongodbDatabase,
    `--archive=${archivePath}`,
    "--gzip"
  ], { logger });

  const archiveStat = await stat(archivePath);
  const sha256 = await fileSha256(archivePath);

  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    appName: config.appName,
    backupEnv: config.backupEnv,
    source: {
      database: config.mongodbDatabase
    },
    archive: {
      fileName: path.basename(archivePath),
      bytes: archiveStat.size,
      sha256,
      compression: "gzip",
      format: "mongodump-archive"
    },
    s3: {
      bucket: config.s3Bucket,
      archiveKey: keys.archiveKey,
      manifestKey: keys.manifestKey
    }
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const s3 = createS3Client(config.awsRegion);
  await uploadFile({
    s3,
    bucket: config.s3Bucket,
    key: keys.archiveKey,
    filePath: archivePath,
    storageClass: config.s3StorageClass,
    contentType: "application/gzip",
    metadata: {
      app: config.appName,
      env: config.backupEnv,
      db: config.mongodbDatabase,
      sha256
    },
    logger
  });

  if (config.uploadManifest) {
    await uploadFile({
      s3,
      bucket: config.s3Bucket,
      key: keys.manifestKey,
      filePath: manifestPath,
      storageClass: config.s3StorageClass,
      contentType: "application/json",
      metadata: {
        app: config.appName,
        env: config.backupEnv,
        db: config.mongodbDatabase
      },
      logger
    });
  }

  if (config.uploadLatestPointer) {
    await putJson({
      s3,
      bucket: config.s3Bucket,
      key: keys.latestKey,
      body: {
        updatedAt: new Date().toISOString(),
        archiveKey: keys.archiveKey,
        manifestKey: keys.manifestKey,
        database: config.mongodbDatabase
      },
      storageClass: "STANDARD",
      logger
    });
  }

  if (!config.keepLocalArchive) {
    await safeUnlink(archivePath);
    await safeUnlink(manifestPath);
  }

  logger.info("backup_done", {
    archiveKey: keys.archiveKey,
    bytes: archiveStat.size,
    sha256
  });

  return { manifest, keys };
}

module.exports = { runBackup };
