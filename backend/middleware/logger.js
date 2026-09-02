const LEVELS = { error: "error", warn: "warn", info: "info" };

function emit(level, message, meta) {
  const rest = meta && typeof meta === "object" ? { ...meta } : {};
  const errValue = rest.err;
  delete rest.err;
  const line = {
    ts: new Date().toISOString(),
    level,
    message,
    ...rest,
    ...(errValue instanceof Error
      ? { err: { name: errValue.name, message: errValue.message, code: errValue.code, stack: errValue.stack } }
      : errValue !== undefined
        ? { err: errValue }
        : {}),
  };
  const out = JSON.stringify(line);
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
