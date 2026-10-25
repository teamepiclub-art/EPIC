/**
 * Structured Logger and Secret Sanitizer
 * Ensures secrets (tokens, passwords, hashes) are never leaked in logs, audit tables, or API errors
 */

function sanitizeSecrets(data) {
  if (data === null || data === undefined) return data;

  if (typeof data === 'string') {
    // Mask bot tokens like 123456789:ABCdef...
    let clean = data.replace(/bot\d+:[A-Za-z0-9_-]+/gi, 'bot[REDACTED_TOKEN]');
    // Mask token query params or bearer tokens
    clean = clean.replace(/token=([a-zA-Z0-9_\-\.]+)/gi, 'token=[REDACTED]');
    clean = clean.replace(/Bearer\s+([a-zA-Z0-9_\-\.]+)/gi, 'Bearer [REDACTED]');
    // Mask passwords in JSON-like strings
    clean = clean.replace(/"password"\s*:\s*"[^"]+"/gi, '"password":"[REDACTED]"');
    return clean;
  }

  if (Array.isArray(data)) {
    return data.map(item => sanitizeSecrets(item));
  }

  if (typeof data === 'object') {
    const sanitized = {};
    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();
      if (lowerKey.includes('password') || lowerKey.includes('salt') || lowerKey.includes('hash') || lowerKey.includes('secret')) {
        sanitized[key] = '[REDACTED]';
      } else if (lowerKey.includes('token') && typeof value === 'string' && value.length > 8) {
        sanitized[key] = `${value.slice(0, 4)}...${value.slice(-4)}`;
      } else {
        sanitized[key] = sanitizeSecrets(value);
      }
    }
    return sanitized;
  }

  return data;
}

const logger = {
  info(event, meta = {}) {
    const timestamp = new Date().toISOString();
    const safeMeta = sanitizeSecrets(meta);
    console.log(`[${timestamp}] [INFO] [${event}]`, Object.keys(safeMeta).length ? JSON.stringify(safeMeta) : '');
  },

  warn(event, meta = {}) {
    const timestamp = new Date().toISOString();
    const safeMeta = sanitizeSecrets(meta);
    console.warn(`[${timestamp}] [WARN] [${event}]`, Object.keys(safeMeta).length ? JSON.stringify(safeMeta) : '');
  },

  error(event, err, meta = {}) {
    const timestamp = new Date().toISOString();
    const safeMeta = sanitizeSecrets(meta);
    const errMsg = err && err.message ? sanitizeSecrets(err.message) : sanitizeSecrets(String(err));
    console.error(`[${timestamp}] [ERROR] [${event}]: ${errMsg}`, Object.keys(safeMeta).length ? JSON.stringify(safeMeta) : '');
  },

  sanitize(data) {
    return sanitizeSecrets(data);
  }
};

module.exports = logger;
