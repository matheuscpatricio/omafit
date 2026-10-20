import { FixedWindowRateLimiter, NonceStore } from "../../app/stylist/request-guard.server.js";

/**
 * Catálogo fake por loja. Cada `admin` só enxerga a sua loja, como o cliente Admin real.
 */
export const CATALOGS = {
  "shop-a.myshopify.com": {
    currency: "BRL",
    products: [
      product("calca-linho", "Calça de linho", 1, [
        variant(101, "P", "199.90", true),
        variant(102, "M", "199.90", false),
      ]),
      product("saia-esgotada", "Saia midi", 2, [variant(201, "U", "149.00", false)]),
      product("rascunho", "Calça rascunho", 3, [variant(301, "U", "99.00", true)], {
        status: "DRAFT",
        onlineStoreUrl: null,
      }),
    ],
  },
  "shop-b.myshopify.com": {
    currency: "USD",
    products: [product("segredo-b", "Calça privada B", 9, [variant(901, "U", "10.00", true)])],
  },
};

function product(handle, title, id, variants, extra = {}) {
  return {
    id: `gid://shopify/Product/${id}`,
    legacyResourceId: String(id),
    handle,
    title,
    productType: "Calça",
    tags: [],
    status: "ACTIVE",
    onlineStoreUrl: `https://store.example/products/${handle}`,
    featuredImage: { url: `https://cdn.example/${handle}.jpg` },
    images: { edges: [] },
    priceRangeV2: { minVariantPrice: { amount: variants[0].price, currencyCode: "BRL" } },
    variants: { edges: variants.map((node) => ({ node })) },
    collections: { edges: [] },
    ...extra,
  };
}

function variant(id, size, price, availableForSale) {
  return {
    id: `gid://shopify/ProductVariant/${id}`,
    legacyResourceId: String(id),
    title: size,
    price,
    availableForSale,
    image: null,
    selectedOptions: [{ name: "Tamanho", value: size }],
  };
}

const ok = (data) => ({ json: async () => ({ data }) });

export function fakeAdmin(shop, calls = []) {
  const cat = CATALOGS[shop];
  return {
    async graphql(query, { variables = {} } = {}) {
      calls.push({ shop, query, variables });
      const find = (h) => cat.products.find((p) => p.handle === h) || null;
      if (query.includes("StylistVariantForPurchase")) {
        for (const p of cat.products) {
          const v = p.variants.edges.map((e) => e.node).find((n) => n.id === variables.id);
          if (v) {
            return ok({
              shop: { currencyCode: cat.currency },
              node: { ...v, product: { handle: p.handle, status: p.status, onlineStoreUrl: p.onlineStoreUrl } },
            });
          }
        }
        return ok({ shop: { currencyCode: cat.currency }, node: null });
      }
      if (query.includes("WidgetProductByHandleFallback")) {
        const h = String(variables.q || "").replace(/^handle:/, "");
        const p = find(h);
        return ok({ products: { edges: p ? [{ node: p }] : [] } });
      }
      if (query.includes("WidgetProductCollectionHandles")) {
        return ok({ productByHandle: find(variables.handle) });
      }
      if (query.includes("WidgetProductByHandle")) {
        return ok({ productByHandle: find(variables.handle) });
      }
      if (query.includes("WidgetCatalogCollectionProducts")) {
        return ok({ collectionByHandle: null });
      }
      if (query.includes("WidgetCatalogSearch") || query.includes("WidgetStoreProfileSample")) {
        return ok({ products: { edges: cat.products.map((node) => ({ node })) } });
      }
      throw new Error(`unexpected query: ${query.slice(0, 60)}`);
    },
  };
}

export function fakePrisma() {
  return {
    widgetStoreProfile: {
      findUnique: async () => null,
      upsert: async () => ({}),
    },
    widgetSuggestionPairStat: { findMany: async () => [] },
  };
}

export const PLANS = {
  "shop-a.myshopify.com": "growth",
  "shop-b.myshopify.com": "enterprise",
  "shop-free.myshopify.com": null,
};

export function makeDeps(overrides = {}) {
  const calls = [];
  const deps = {
    prisma: fakePrisma(),
    getAdmin: async (shop) =>
      CATALOGS[shop] ? { ok: true, admin: fakeAdmin(shop, calls) } : { ok: false },
    publicIdMatchesShop: async (pid, shop) => pid === `pub_${shop}`,
    fetchPlan: async (shop) => PLANS[shop] ?? null,
    guards: {
      nonces: new NonceStore(),
      sessionIssuePerClient: new FixedWindowRateLimiter({ limit: 20, windowMs: 60_000 }),
      toolCallsPerSession: new FixedWindowRateLimiter({ limit: 60, windowMs: 60_000 }),
      toolCallsPerShop: new FixedWindowRateLimiter({ limit: 600, windowMs: 60_000 }),
    },
    ...overrides,
  };
  return { deps, calls };
}
