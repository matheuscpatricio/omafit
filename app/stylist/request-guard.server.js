/**
 * Anti-replay e rate limit em memória do processo.
 * Num deploy com várias instâncias os limites são por instância; ver docs/stylist/README.md.
 */

export class NonceStore {
  constructor({ maxEntries = 50_000 } = {}) {
    /** @type {Map<string, number>} */
    this.seen = new Map();
    this.maxEntries = maxEntries;
  }

  /**
   * Regista `key` até `expiresAtMs`. Devolve false se já tinha sido usado.
   * @param {string} key
   * @param {number} expiresAtMs
   * @param {number} [nowMs]
   */
  claim(key, expiresAtMs, nowMs = Date.now()) {
    const prev = this.seen.get(key);
    if (prev != null && prev > nowMs) return false;
    if (this.seen.size >= this.maxEntries) this.sweep(nowMs);
    if (this.seen.size >= this.maxEntries) return false;
    this.seen.set(key, expiresAtMs);
    return true;
  }

  sweep(nowMs = Date.now()) {
    for (const [k, exp] of this.seen) {
      if (exp <= nowMs) this.seen.delete(k);
    }
  }
}

export class FixedWindowRateLimiter {
  /**
   * @param {{ limit: number, windowMs: number }} opts
   */
  constructor({ limit, windowMs }) {
    this.limit = limit;
    this.windowMs = windowMs;
    /** @type {Map<string, { start: number, count: number }>} */
    this.buckets = new Map();
  }

  /**
   * @param {string} key
   * @param {number} [nowMs]
   * @returns {{ allowed: boolean, retryAfterSec: number }}
   */
  hit(key, nowMs = Date.now()) {
    let b = this.buckets.get(key);
    if (!b || nowMs - b.start >= this.windowMs) {
      if (this.buckets.size > 50_000) this.sweep(nowMs);
      b = { start: nowMs, count: 0 };
      this.buckets.set(key, b);
    }
    b.count += 1;
    if (b.count > this.limit) {
      return { allowed: false, retryAfterSec: Math.ceil((b.start + this.windowMs - nowMs) / 1000) };
    }
    return { allowed: true, retryAfterSec: 0 };
  }

  sweep(nowMs = Date.now()) {
    for (const [k, b] of this.buckets) {
      if (nowMs - b.start >= this.windowMs) this.buckets.delete(k);
    }
  }
}

const NONCE_RE = /^[A-Za-z0-9_-]{16,128}$/;

export function isValidNonce(nonce) {
  return NONCE_RE.test(String(nonce || ""));
}

function intFromEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export const stylistGuards = {
  nonces: new NonceStore(),
  sessionIssuePerClient: new FixedWindowRateLimiter({
    limit: intFromEnv("STYLIST_SESSION_ISSUE_PER_MIN", 20),
    windowMs: 60_000,
  }),
  toolCallsPerSession: new FixedWindowRateLimiter({
    limit: intFromEnv("STYLIST_TOOL_CALLS_PER_SESSION_PER_MIN", 60),
    windowMs: 60_000,
  }),
  toolCallsPerShop: new FixedWindowRateLimiter({
    limit: intFromEnv("STYLIST_TOOL_CALLS_PER_SHOP_PER_MIN", 600),
    windowMs: 60_000,
  }),
};
