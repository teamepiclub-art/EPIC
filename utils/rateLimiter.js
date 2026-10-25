/**
 * In-Memory Sliding-Window Rate Limiter
 * Protects Telegram verification, linking attempts, and webhook endpoints
 */

const tracker = new Map();

// Periodic cleanup of expired rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of tracker.entries()) {
    if (now > entry.resetAt) {
      tracker.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

function checkRateLimit(identifier, maxRequests = 10, windowMs = 60000) {
  if (!identifier) return { allowed: true, remaining: maxRequests };

  const now = Date.now();
  const entry = tracker.get(identifier);

  if (!entry || now > entry.resetAt) {
    tracker.set(identifier, {
      count: 1,
      resetAt: now + windowMs
    });
    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetMs: windowMs
    };
  }

  if (entry.count >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetMs: entry.resetAt - now
    };
  }

  entry.count += 1;
  return {
    allowed: true,
    remaining: maxRequests - entry.count,
    resetMs: entry.resetAt - now
  };
}

module.exports = { checkRateLimit };
