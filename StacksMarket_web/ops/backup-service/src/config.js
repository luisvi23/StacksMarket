const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config();

function bool(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null || raw === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(raw).toLowerCase());
}

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name, fallback = "") {
  const value = process.env[name];
  return value == null ? fallback : value;
}

function resolveTmpDir(value) {
  const dir = value || "./tmp";
  return path.resolve(process.cwd(), dir);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function loadConfig() {
  const cfg = {
    appName: optional("APP_NAME", "app"),
    backupEnv: optional("BACKUP_ENV", "prod"),
    awsRegion: required("AWS_REGION"),
    s3Bucket: required("S3_BUCKET"),
    s3Prefix: optional("S3_PREFIX", "mongodb").replace(/^\/+|\/+$/g, ""),
    s3StorageClass: optional("S3_STORAGE_CLASS", "STANDARD"),
    mongodbUri: required("MONGODB_URI"),
    mongodbDatabase: required("MONGODB_DATABASE"),
    mongoToolsBinDir: optional("MONGO_TOOLS_BIN_DIR", ""),
    localTmpDir: resolveTmpDir(optional("LOCAL_TMP_DIR", "./tmp")),
    restoreMongoUri: optional("RESTORE_MONGODB_URI", ""),
    restoreDatabase: optional("RESTORE_DATABASE", ""),
    restoreDropBefore: bool("RESTORE_DROP_BEFORE", true),
    verifyRestoreEnabled: bool("VERIFY_RESTORE_ENABLED", false),
    verifyRestoreMongoUri: optional("VERIFY_RESTORE_MONGODB_URI", ""),
    verifyRestoreDatabase: optional("VERIFY_RESTORE_DATABASE", "backup_verify"),
    verifyRestoreDropBefore: bool("VERIFY_RESTORE_DROP_BEFORE", true),
    keepLocalArchive: bool("KEEP_LOCAL_ARCHIVE", false),
    uploadManifest: bool("UPLOAD_MANIFEST", true),
    uploadLatestPointer: bool("UPLOAD_LATEST_POINTER", true),
    logLevel: optional("LOG_LEVEL", "info")
  };

  ensureDir(cfg.localTmpDir);
  return cfg;
}

module.exports = { loadConfig };
