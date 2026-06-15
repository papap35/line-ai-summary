// Structured JSON logging for Cloud Logging. Each line is a JSON object with
// a `severity` field (INFO/WARNING/ERROR) that Cloud Run's logging agent
// uses for filtering and log-level display.
function serializeMeta(meta = {}) {
  const out = { ...meta };
  if (out.err instanceof Error) {
    out.err = { name: out.err.name, message: out.err.message, stack: out.err.stack };
  }
  return out;
}

function write(severity, message, meta) {
  const entry = { severity, message, ...serializeMeta(meta) };
  const line = JSON.stringify(entry);
  if (severity === 'ERROR') {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (message, meta) => write('INFO', message, meta),
  warn: (message, meta) => write('WARNING', message, meta),
  error: (message, meta) => write('ERROR', message, meta),
};
