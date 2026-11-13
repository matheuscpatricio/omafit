import crypto from "crypto";

/** @typedef {import("./contracts").StylistTokenClaims} StylistTokenClaims */
/** @typedef {import("./contracts").StylistScope} StylistScope */

export const STYLIST_TOKEN_TTL_SEC = 15 * 60;
const MIN_SECRET_LENGTH = 32;

let devFallbackSecret = "";

/**
 * Segredo exclusivamente server-side. Não confundir com WIDGET_CATALOG_HMAC_SECRET,
 * que o widget atual embute no bundle público.
 * @returns {string}
 */
export function getStylistSessionSecret() {
  const s = String(process.env.STYLIST_SESSION_SECRET || "").trim();
  if (s.length >= MIN_SECRET_LENGTH) return s;
  if (process.env.NODE_ENV === "production") return "";
  if (!devFallbackSecret) devFallbackSecret = crypto.randomBytes(32).toString("hex");
  return devFallbackSecret;
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function sign(secret, payloadB64) {
  return crypto.createHmac("sha256", secret).update(`stylist_v1.${payloadB64}`).digest();
}

/**
 * @param {{ shop: string, publicId: string, scopes: StylistScope[], ttlSec?: number, now?: number }} input
 * @returns {{ token: string, claims: StylistTokenClaims } | null}
 */
export function issueStylistToken({ shop, publicId, scopes, ttlSec = STYLIST_TOKEN_TTL_SEC, now }) {
  const secret = getStylistSessionSecret();
  if (!secret) return null;
  const iat = Math.floor((now ?? Date.now()) / 1000);
  /** @type {StylistTokenClaims} */
  const claims = {
    v: 1,
    shop,
    pid: publicId,
    sid: crypto.randomBytes(16).toString("hex"),
    scopes,
    iat,
    exp: iat + Math.min(ttlSec, STYLIST_TOKEN_TTL_SEC),
  };
  const payload = b64url(JSON.stringify(claims));
  return { token: `${payload}.${b64url(sign(secret, payload))}`, claims };
}

/**
 * @param {string} token
 * @param {{ now?: number }} [opts]
 * @returns {{ ok: true, claims: StylistTokenClaims } | { ok: false, reason: "server_misconfigured" | "bad_token" | "token_expired" }}
 */
export function verifyStylistToken(token, opts = {}) {
  const secret = getStylistSessionSecret();
  if (!secret) return { ok: false, reason: "server_misconfigured" };

  const parts = String(token || "").split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "bad_token" };
  const [payload, sig] = parts;

  const expected = sign(secret, payload);
  let given;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return { ok: false, reason: "bad_token" };
  }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return { ok: false, reason: "bad_token" };
  }

  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "bad_token" };
  }
  if (
    claims?.v !== 1 ||
    typeof claims.shop !== "string" ||
    !claims.shop ||
    typeof claims.sid !== "string" ||
    !Array.isArray(claims.scopes) ||
    !Number.isFinite(claims.exp)
  ) {
    return { ok: false, reason: "bad_token" };
  }

  const nowSec = Math.floor((opts.now ?? Date.now()) / 1000);
  if (nowSec >= claims.exp) return { ok: false, reason: "token_expired" };

  return { ok: true, claims };
}

/** @param {Request} request */
export function readBearerToken(request) {
  const h = request.headers.get("Authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : "";
}
