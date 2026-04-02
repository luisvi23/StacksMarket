function createLogger(level = "info") {
  const levels = { error: 0, warn: 1, info: 2, debug: 3 };
  const current = levels[level] ?? levels.info;

  function log(kind, message, meta) {
    if ((levels[kind] ?? 99) > current) return;
    const payload = {
      ts: new Date().toISOString(),
      level: kind,
      message
    };
    if (meta && Object.keys(meta).length) payload.meta = meta;
    const line = JSON.stringify(payload);
    if (kind === "error") {
      console.error(line);
    } else {
      console.log(line);
    }
  }

  return {
    error: (m, meta) => log("error", m, meta),
    warn: (m, meta) => log("warn", m, meta),
    info: (m, meta) => log("info", m, meta),
    debug: (m, meta) => log("debug", m, meta)
  };
}

module.exports = { createLogger };
