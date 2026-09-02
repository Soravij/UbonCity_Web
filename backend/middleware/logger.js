const LEVELS = { error: "error", warn: "warn", info: "info" };

function emit(level, message, meta) {
  const line = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(meta?.err instanceof Error
      ? { err: { name: meta.err.name, message: meta.err.message, code: meta.err.code, stack: meta.err.stack } }
      : {}),
    ...(meta && typeof meta === "object" ? { ...meta, err: undefined } : {}),
  };
  const out = JSON.stringify(line, (k, v) => (v === undefined ? undefined : v));
  if (level === LEVELS.error) console.error(out);
  else if (level === LEVELS.warn) console.warn(out);
  else console.info(out);
}

export const logger = {
  error: (message, meta) => emit(LEVELS.error, message, meta),
  warn: (message, meta) => emit(LEVELS.warn, message, meta),
  info: (message, meta) => emit(LEVELS.info, message, meta),
};

export default logger;
