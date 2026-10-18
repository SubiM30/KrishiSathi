/**
 * Tiny in-memory rate limiter (no external packages).
 *
 * Why: the Groq free key is shared by the whole app (1,000 requests/day),
 * so one user must not be able to drain it. Each IP gets a bucket of
 * requests per time window per AI endpoint.
 */
const buckets = new Map(); // key → { count, resetAt }

function rateLimit({ windowMs, max }) {
  return (req, res, next) => {
    // Trust the last hop in x-forwarded-for, else the socket address
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
    const key = `${req.path}:${ip}`;
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    if (bucket.count > max) {
      const waitSec = Math.ceil((bucket.resetAt - now) / 1000);
      res.set('Retry-After', String(waitSec));
      return res.status(429).json({
        error: `Too many requests. Please wait about ${waitSec}s and try again.`,
      });
    }
    next();
  };
}

module.exports = { rateLimit };
