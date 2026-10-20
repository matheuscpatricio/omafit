import {
  getWidgetCatalogCorsHeaders,
  isAllowedWidgetCatalogOrigin,
} from "../widget-catalog-auth.server.js";
import { normalizeMyshopifyDomain } from "../widget-shop-admin.server.js";
import { issueStylistToken, verifyStylistToken, readBearerToken } from "./session-token.server.js";
import { isValidNonce } from "./request-guard.server.js";
import { checkStylistAccess, checkVoiceAccess, resolveStylistEntitlements } from "./access.server.js";
import { validateToolCall, runStylistTool, listStylistToolSchemas } from "./tools.server.js";

/**
 * Dependências injetadas pelas rotas (e substituídas nos testes).
 * @typedef {{
 *   prisma: any,
 *   getAdmin: (shop: string) => Promise<{ ok: true, admin: any } | { ok: false }>,
 *   publicIdMatchesShop: (publicId: string, shop: string) => Promise<boolean>,
 *   fetchPlan: (shop: string) => Promise<string | null>,
 *   guards: typeof import("./request-guard.server.js").stylistGuards,
 * }} StylistDeps
 */

function corsHeaders(request) {
  return {
    ...getWidgetCatalogCorsHeaders(request),
    "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, X-Omafit-Nonce",
    "Cache-Control": "no-store",
  };
}

function json(request, data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json", ...extra },
  });
}

function fail(request, error, status, extra = {}) {
  const headers = {};
  const body = { ok: false, error };
  if (extra.retryAfter) {
    body.retry_after = extra.retryAfter;
    headers["Retry-After"] = String(extra.retryAfter);
  }
  return json(request, body, status, headers);
}

export function preflight(request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

function clientIp(request) {
  const xff = request.headers.get("X-Forwarded-For") || "";
  return xff.split(",")[0].trim() || "unknown";
}

async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

/**
 * Autentica um pedido com Bearer token. Devolve claims ou uma Response de erro.
 * @param {Request} request
 * @returns {{ ok: true, claims: import("./contracts").StylistTokenClaims } | { ok: false, response: Response }}
 */
function authenticate(request) {
  const token = readBearerToken(request);
  if (!token) return { ok: false, response: fail(request, "unauthorized", 401) };
  const v = verifyStylistToken(token);
  if (!v.ok) {
    const status = v.reason === "server_misconfigured" ? 503 : 401;
    return { ok: false, response: fail(request, v.reason, status) };
  }
  return { ok: true, claims: v.claims };
}

/**
 * POST /api/stylist/session — emite sessão pública curta, vinculada à loja.
 * @param {Request} request
 * @param {StylistDeps} deps
 */
export async function handleCreateSession(request, deps) {
  if (request.method === "OPTIONS") return preflight(request);
  if (request.method !== "POST") return fail(request, "method_not_allowed", 405);

  const origin = request.headers.get("Origin");
  if (origin && !isAllowedWidgetCatalogOrigin(origin)) return fail(request, "unauthorized", 403);

  const body = await readJson(request);
  if (!body) return fail(request, "invalid_body", 400);

  const shop = normalizeMyshopifyDomain(body.shop_domain);
  const publicId = String(body.public_id || "").trim();
  if (!shop || !publicId || publicId.length > 128) return fail(request, "missing_params", 400);

  const rl = deps.guards.sessionIssuePerClient.hit(`${clientIp(request)}|${shop}`);
  if (!rl.allowed) return fail(request, "rate_limited", 429, { retryAfter: rl.retryAfterSec });

  if (!(await deps.publicIdMatchesShop(publicId, shop))) {
    return fail(request, "shop_public_id_mismatch", 403);
  }

  const access = body.voice === true
    ? await checkVoiceAccess(shop, deps)
    : await checkStylistAccess(shop, deps);
  if (!access.ok) return fail(request, access.error, 403);

  /** @type {import("./contracts").StylistScope[]} */
  const scopes = body.voice === true ? ["stylist", "voice"] : ["stylist"];
  const issued = issueStylistToken({ shop, publicId, scopes });
  if (!issued) return fail(request, "server_misconfigured", 503);

  return json(request, {
    ok: true,
    token: issued.token,
    expires_at: issued.claims.exp,
    scopes,
    plan: access.plan,
  });
}

/**
 * GET /api/stylist/session — entitlements atuais (billing pode mudar durante a sessão).
 * @param {Request} request
 * @param {StylistDeps} deps
 */
export async function handleGetEntitlements(request, deps) {
  if (request.method === "OPTIONS") return preflight(request);
  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const e = await resolveStylistEntitlements(auth.claims.shop, deps);
  return json(request, {
    ok: true,
    shop_domain: auth.claims.shop,
    expires_at: auth.claims.exp,
    plan: e.plan,
    stylist: e.stylist,
    voice: e.voice && auth.claims.scopes.includes("voice"),
    tools: listStylistToolSchemas(),
  });
}

/**
 * POST /api/stylist/tools — executa uma ferramenta comercial na loja do token.
 * @param {Request} request
 * @param {StylistDeps} deps
 */
export async function handleToolCall(request, deps) {
  if (request.method === "OPTIONS") return preflight(request);
  if (request.method !== "POST") return fail(request, "method_not_allowed", 405);

  const auth = authenticate(request);
  if (!auth.ok) return auth.response;
  const { claims } = auth;

  const nonce = request.headers.get("X-Omafit-Nonce") || "";
  if (!isValidNonce(nonce)) return fail(request, "missing_nonce", 400);

  const perSession = deps.guards.toolCallsPerSession.hit(claims.sid);
  if (!perSession.allowed) {
    return fail(request, "rate_limited", 429, { retryAfter: perSession.retryAfterSec });
  }
  const perShop = deps.guards.toolCallsPerShop.hit(claims.shop);
  if (!perShop.allowed) {
    return fail(request, "rate_limited", 429, { retryAfter: perShop.retryAfterSec });
  }

  if (!deps.guards.nonces.claim(`${claims.sid}:${nonce}`, claims.exp * 1000)) {
    return fail(request, "replay_detected", 409);
  }

  const body = await readJson(request);
  if (!body) return fail(request, "invalid_body", 400);

  const call = validateToolCall(body.tool, body.arguments);
  if (!call.ok) return json(request, { ok: false, error: call.error, detail: call.detail }, 400);

  const access = await checkStylistAccess(claims.shop, deps);
  if (!access.ok) return fail(request, access.error, 403);

  const adminResult = await deps.getAdmin(claims.shop);
  if (!adminResult.ok) return fail(request, "no_session", 503);

  try {
    const result = await runStylistTool(
      { shopDomain: claims.shop, admin: adminResult.admin, prisma: deps.prisma },
      call.tool,
      call.args
    );
    return json(request, { ok: true, tool: call.tool, result });
  } catch (err) {
    console.error("[api.stylist.tools]", call.tool, err?.message || err);
    return fail(request, "tool_failed", 502);
  }
}
