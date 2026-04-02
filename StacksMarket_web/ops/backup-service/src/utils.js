const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

function utcStamp(date = new Date()) {
  const iso = date.toISOString();
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function backupBaseName({ appName, backupEnv, database, stamp }) {
  return `${appName}-${backupEnv}-${database}-${stamp}`;
}

function buildBackupKeys({ s3Prefix, backupEnv, database, stamp, baseName }) {
  const year = stamp.slice(0, 4);
  const month = stamp.slice(4, 6);
  const day = stamp.slice(6, 8);
  const root = [s3Prefix, backupEnv, database, year, month, day].filter(Boolean).join("/");
  return {
    archiveKey: `${root}/${baseName}.archive.gz`,
    manifestKey: `${root}/${baseName}.manifest.json`,
    latestKey: [s3Prefix, backupEnv, database, "latest.json"].filter(Boolean).join("/")
  };
}

function fileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function stat(filePath) {
  return fs.promises.stat(filePath);
}

function safeUnlink(filePath) {
  return fs.promises.unlink(filePath).catch(() => {});
}

function resolveMongoTool(binDir, toolName) {
  if (!binDir) return toolName;
  return path.join(binDir, process.platform === "win32" ? `${toolName}.exe` : toolName);
}

function runCommand(cmd, args, { logger, env } = {}) {
  return new Promise((resolve, reject) => {
    logger?.debug("run_command", { cmd, args });
    const child = spawn(cmd, args, {
      env: { ...process.env, ...(env || {}) },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      logger?.debug("stdout", { cmd, text: text.trim() });
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      logger?.debug("stderr", { cmd, text: text.trim() });
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve({ code, stdout, stderr });
      const err = new Error(`Command failed (${code}): ${cmd}`);
      err.code = code;
      err.stdout = stdout;
      err.stderr = stderr;
      reject(err);
    });
  });
}

module.exports = {
  utcStamp,
  backupBaseName,
  buildBackupKeys,
  fileSha256,
  stat,
  safeUnlink,
  resolveMongoTool,
  runCommand
};
