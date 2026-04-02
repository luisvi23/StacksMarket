const { loadConfig } = require("./config");
const { createLogger } = require("./logger");
const { runBackup } = require("./backup");
const { runRestore } = require("./restore");
const { runVerify } = require("./verify");
const { runDoctor } = require("./doctor");

async function main() {
  const command = process.argv[2];
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  try {
    if (command === "backup") {
      await runBackup(config, logger);
      return;
    }
    if (command === "restore") {
      const explicitKey = process.argv[3];
      await runRestore(config, logger, { archiveKey: explicitKey });
      return;
    }
    if (command === "verify") {
      await runVerify(config, logger);
      return;
    }
    if (command === "doctor") {
      await runDoctor(config, logger);
      return;
    }

    console.error("Usage: node src/cli.js <backup|restore|verify|doctor> [archiveKey]");
    process.exitCode = 1;
  } catch (error) {
    const err = {
      message: error.message,
      code: error.code,
      stderr: error.stderr
    };
    console.error(JSON.stringify({ ts: new Date().toISOString(), level: "error", message: "command_failed", meta: err }));
    process.exitCode = 1;
  }
}

main();
