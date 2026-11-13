import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.STYLIST_SESSION_SECRET = "test-secret-".padEnd(48, "x");

const { handleCreateSession, handleToolCall, handleGetEntitlements } = await import(
  "../../app/stylist/handlers.server.js"
);
const { issueStylistToken, verifyStylistToken } = await import(
  "../../app/stylist/session-token.server.js"
);
const { FixedWindowRateLimiter } = await import("../../app/stylist/request-guard.server.js");
const { validateToolCall } = await import("../../app/stylist/tools.server.js");
const { resolveOfflineSessionShop } = await import("../../app/widget-shop-admin.server.js");
const { makeDeps } = await import("./fakes.mjs");

const BASE = "https://app.example";
const nonce = () => crypto.randomBytes(16).toString("hex");

function sessionReq(body, headers = {}) {
  return new Request(`${BASE}/api/stylist/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "1.2.3.4", ...headers },
    body: JSON.stringify(body),
  });
}

function toolReq(token, tool, args, { n = nonce(), headers = {} } = {}) {
  const h = { "Content-Type": "application/json", ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (n) h["X-Omafit-Nonce"] = n;
  return new Request(`${BASE}/api/stylist/tools`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({ tool, arguments: args }),
  });
}

async function body(res) {
  return { status: res.status, json: await res.json() };
}

async function tokenFor(deps, shop, extra = {}) {
  const r = await body(
    await handleCreateSession(sessionReq({ shop_domain: shop, public_id: `pub_${shop}`, ...extra }), deps)
  );
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.token;
}

let deps;
let calls;
beforeEach(() => {
  ({ deps, calls } = makeDeps());
});

describe("sessão pública", () => {
  test("emite token vinculado à loja, sem segredo no payload", async () => {
    const r = await body(
      await handleCreateSession(
        sessionReq({ shop_domain: "shop-a", public_id: "pub_shop-a.myshopify.com" }),
        deps
      )
    );
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.scopes, ["stylist"]);
    const claims = JSON.parse(Buffer.from(r.json.token.split(".")[0], "base64url").toString());
    assert.equal(claims.shop, "shop-a.myshopify.com");
    assert.ok(claims.exp - claims.iat <= 900);
    assert.ok(!r.json.token.includes(process.env.STYLIST_SESSION_SECRET));
  });

  test("public_id de outra loja é recusado", async () => {
    const r = await body(
      await handleCreateSession(
        sessionReq({ shop_domain: "shop-a.myshopify.com", public_id: "pub_shop-b.myshopify.com" }),
        deps
      )
    );
    assert.equal(r.status, 403);
    assert.equal(r.json.error, "shop_public_id_mismatch");
  });

  test("loja sem plano ativo não recebe sessão", async () => {
    const r = await body(
      await handleCreateSession(
        sessionReq({ shop_domain: "shop-free.myshopify.com", public_id: "pub_shop-free.myshopify.com" }),
        deps
      )
    );
    assert.equal(r.status, 403);
    assert.equal(r.json.error, "plan_required");
  });

  test("origem não permitida é recusada", async () => {
    const r = await handleCreateSession(
      sessionReq(
        { shop_domain: "shop-a.myshopify.com", public_id: "pub_shop-a.myshopify.com" },
        { Origin: "https://evil.example" }
      ),
      deps
    );
    assert.equal(r.status, 403);
  });

  test("limite de emissão por cliente", async () => {
    deps.guards.sessionIssuePerClient = new FixedWindowRateLimiter({ limit: 2, windowMs: 60_000 });
    const b = { shop_domain: "shop-a.myshopify.com", public_id: "pub_shop-a.myshopify.com" };
    assert.equal((await handleCreateSession(sessionReq(b), deps)).status, 200);
    assert.equal((await handleCreateSession(sessionReq(b), deps)).status, 200);
    const r = await handleCreateSession(sessionReq(b), deps);
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers.get("Retry-After")) > 0);
  });
});

describe("voz Enterprise", () => {
  test("Growth não recebe escopo de voz", async () => {
    const r = await body(
      await handleCreateSession(
        sessionReq({ shop_domain: "shop-a.myshopify.com", public_id: "pub_shop-a.myshopify.com", voice: true }),
        deps
      )
    );
    assert.equal(r.status, 403);
    assert.equal(r.json.error, "voice_plan_required");
  });

  test("Enterprise recebe escopo de voz e entitlements refletem o billing atual", async () => {
    const token = await tokenFor(deps, "shop-b.myshopify.com", { voice: true });
    const req = new Request(`${BASE}/api/stylist/session`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    let r = await body(await handleGetEntitlements(req, deps));
    assert.equal(r.json.voice, true);

    deps.fetchPlan = async () => "growth";
    r = await body(await handleGetEntitlements(req.clone(), deps));
    assert.equal(r.json.voice, false);
    assert.equal(r.json.stylist, true);
  });
});

describe("autenticação das ferramentas", () => {
  test("sem assinatura/token → 401", async () => {
    const r = await body(await handleToolCall(toolReq(null, "get_store_profile", {}), deps));
    assert.equal(r.status, 401);
    assert.equal(r.json.error, "unauthorized");
  });

  test("token adulterado (troca de loja) → 401", async () => {
    const token = await tokenFor(deps, "shop-a.myshopify.com");
    const [payload, sig] = token.split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    claims.shop = "shop-b.myshopify.com";
    const forged = `${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${sig}`;
    const r = await body(await handleToolCall(toolReq(forged, "get_store_profile", {}), deps));
    assert.equal(r.status, 401);
    assert.equal(r.json.error, "bad_token");
  });

  test("token expirado → 401", async () => {
    const issued = issueStylistToken({
      shop: "shop-a.myshopify.com",
      publicId: "x",
      scopes: ["stylist"],
      now: Date.now() - 16 * 60 * 1000,
    });
    assert.equal(verifyStylistToken(issued.token).ok, false);
    const r = await body(await handleToolCall(toolReq(issued.token, "get_store_profile", {}), deps));
    assert.equal(r.json.error, "token_expired");
  });

  test("replay do mesmo nonce → 409", async () => {
    const token = await tokenFor(deps, "shop-a.myshopify.com");
    const n = nonce();
    const first = await handleToolCall(toolReq(token, "get_store_profile", {}, { n }), deps);
    assert.equal(first.status, 200);
    const again = await body(await handleToolCall(toolReq(token, "get_store_profile", {}, { n }), deps));
    assert.equal(again.status, 409);
    assert.equal(again.json.error, "replay_detected");
  });

  test("sem nonce → 400", async () => {
    const token = await tokenFor(deps, "shop-a.myshopify.com");
    const r = await body(await handleToolCall(toolReq(token, "get_store_profile", {}, { n: "" }), deps));
    assert.equal(r.json.error, "missing_nonce");
  });

  test("limite de chamadas por sessão → 429", async () => {
    deps.guards.toolCallsPerSession = new FixedWindowRateLimiter({ limit: 2, windowMs: 60_000 });
    const token = await tokenFor(deps, "shop-a.myshopify.com");
    for (let i = 0; i < 2; i++) {
      assert.equal((await handleToolCall(toolReq(token, "get_store_profile", {}), deps)).status, 200);
    }
    const r = await body(await handleToolCall(toolReq(token, "get_store_profile", {}), deps));
    assert.equal(r.status, 429);
    assert.equal(r.json.error, "rate_limited");
  });

  test("limite agregado por loja → 429", async () => {
    deps.guards.toolCallsPerShop = new FixedWindowRateLimiter({ limit: 1, windowMs: 60_000 });
    const t1 = await tokenFor(deps, "shop-a.myshopify.com");
    const t2 = await tokenFor(deps, "shop-a.myshopify.com");
    assert.equal((await handleToolCall(toolReq(t1, "get_store_profile", {}), deps)).status, 200);
    assert.equal((await handleToolCall(toolReq(t2, "get_store_profile", {}), deps)).status, 429);
  });

  test("plano cancelado durante a sessão → 403", async () => {
    const token = await tokenFor(deps, "shop-a.myshopify.com");
    deps.fetchPlan = async () => null;
    const r = await body(await handleToolCall(toolReq(token, "get_store_profile", {}), deps));
    assert.equal(r.status, 403);
    assert.equal(r.json.error, "plan_required");
  });
});

describe("tenant isolation", () => {
  test("shop_domain nos argumentos é rejeitado", async () => {
    const token = await tokenFor(deps, "shop-a.myshopify.com");
    const r = await body(
      await handleToolCall(
        toolReq(token, "get_product_details", { handle: "segredo-b", shop_domain: "shop-b.myshopify.com" }),
        deps
      )
    );
    assert.equal(r.status, 400);
    assert.equal(r.json.detail, "unexpected_shop_domain");
  });

  test("produto de outra loja não é visível", async () => {
    const token = await tokenFor(deps, "shop-a.myshopify.com");
    const r = await body(await handleToolCall(toolReq(token, "get_product_details", { handle: "segredo-b" }), deps));
    assert.equal(r.status, 200);
    assert.equal(r.json.result.product, null);
    assert.ok(calls.length > 0 && calls.every((c) => c.shop === "shop-a.myshopify.com"));
  });

  test("variante de outra loja não valida", async () => {
    const token = await tokenFor(deps, "shop-a.myshopify.com");
    const r = await body(
      await handleToolCall(toolReq(token, "validate_variant_for_purchase", { variant_id: "901" }), deps)
    );
    assert.equal(r.json.result.valid, false);
    assert.equal(r.json.result.reason, "variant_not_found");
  });

  test("search_products só devolve produtos da loja do token e publicados", async () => {
    const token = await tokenFor(deps, "shop-a.myshopify.com");
    const r = await body(await handleToolCall(toolReq(token, "search_products", { query: "calça" }), deps));
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const handles = r.json.result.products.map((p) => p.handle);
    assert.ok(handles.includes("calca-linho"));
    assert.ok(!handles.includes("segredo-b"));
    assert.ok(!handles.includes("rascunho"));
  });

  test("resolução de sessão offline não faz match por substring", async () => {
    const prisma = {
      session: {
        findFirst: async () => null,
        findMany: async () => [{ shop: "arrascaneta-2.myshopify.com" }],
      },
    };
    assert.equal(await resolveOfflineSessionShop(prisma, "rrascaneta-2"), null);
    assert.equal(
      await resolveOfflineSessionShop(prisma, "rrascaneta-2", { allowFuzzy: true }),
      "arrascaneta-2.myshopify.com"
    );
  });
});

describe("variantes e compra", () => {
  test("get_available_variants exclui variantes esgotadas e traz preço", async () => {
    const token = await tokenFor(deps, "shop-a.myshopify.com");
    const r = await body(
      await handleToolCall(toolReq(token, "get_available_variants", { handle: "calca-linho" }), deps)
    );
    assert.deepEqual(
      r.json.result.variants.map((v) => [v.id, v.price, v.available]),
      [["101", "199.90", true]]
    );
  });

  test("produto esgotado → sem variantes; validação → out_of_stock", async () => {
    const token = await tokenFor(deps, "shop-a.myshopify.com");
    const v = await body(
      await handleToolCall(toolReq(token, "get_available_variants", { handle: "saia-esgotada" }), deps)
    );
    assert.deepEqual(v.json.result.variants, []);
    const r = await body(
      await handleToolCall(toolReq(token, "validate_variant_for_purchase", { variant_id: "201" }), deps)
    );
    assert.equal(r.json.result.valid, false);
    assert.equal(r.json.result.reason, "out_of_stock");
  });

  test("variante inexistente → variant_not_found", async () => {
    const token = await tokenFor(deps, "shop-a.myshopify.com");
    for (const variant_id of ["999999", "gid://shopify/ProductVariant/424242", "not-an-id"]) {
      const r = await body(
        await handleToolCall(toolReq(token, "validate_variant_for_purchase", { variant_id }), deps)
      );
      assert.equal(r.json.result.reason, "variant_not_found", variant_id);
    }
  });

  test("preço divergente → price_changed; preço atual → ok", async () => {
    const token = await tokenFor(deps, "shop-a.myshopify.com");
    let r = await body(
      await handleToolCall(
        toolReq(token, "validate_variant_for_purchase", { variant_id: "101", expected_price: "149.90" }),
        deps
      )
    );
    assert.equal(r.json.result.reason, "price_changed");
    assert.equal(r.json.result.current_price, "199.90");
    r = await body(
      await handleToolCall(
        toolReq(token, "validate_variant_for_purchase", { variant_id: "101", expected_price: "199.9", quantity: 2 }),
        deps
      )
    );
    assert.equal(r.json.result.valid, true);
    assert.equal(r.json.result.currency_code, "BRL");
  });

  test("produto em rascunho não é recomendável nem comprável", async () => {
    const token = await tokenFor(deps, "shop-a.myshopify.com");
    const d = await body(await handleToolCall(toolReq(token, "get_product_details", { handle: "rascunho" }), deps));
    assert.equal(d.json.result.product, null);
    const r = await body(
      await handleToolCall(toolReq(token, "validate_variant_for_purchase", { variant_id: "301" }), deps)
    );
    assert.equal(r.json.result.reason, "product_not_recommendable");
  });
});

describe("validação de argumentos", () => {
  test("ferramenta desconhecida (ex.: GraphQL arbitrário) é recusada", () => {
    assert.equal(validateToolCall("run_graphql", { query: "{ shop { name } }" }).error, "unknown_tool");
    assert.equal(validateToolCall("__proto__", {}).error, "unknown_tool");
  });

  test("tipos e limites", () => {
    assert.equal(validateToolCall("search_products", { limit: 50 }).detail, "bad_limit");
    assert.equal(validateToolCall("get_product_details", {}).detail, "missing_handle");
    assert.equal(validateToolCall("get_product_details", { handle: "../x" }).detail, "bad_handle");
    assert.equal(
      validateToolCall("validate_variant_for_purchase", { variant_id: "1", quantity: 0 }).detail,
      "bad_quantity"
    );
  });
});
