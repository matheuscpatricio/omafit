import {
  searchProducts,
  getProductDetails,
  getAvailableVariants,
  getStoreProfile,
  validateVariantForPurchase,
} from "./catalog.server.js";

/** @typedef {import("./contracts").StylistToolName} StylistToolName */

/**
 * Contexto derivado do token verificado. Nunca vem dos argumentos do LLM.
 * @typedef {{ shopDomain: string, admin: any, prisma: any }} StylistToolContext
 */

const HANDLE_RE = /^[a-z0-9][a-z0-9-]{0,254}$/;

/** Validadores mínimos: tipo, tamanho e chaves permitidas. */
const str = (max) => (v) => typeof v === "string" && v.length <= max;
const handle = (v) => typeof v === "string" && HANDLE_RE.test(v);
const oneOf = (...vals) => (v) => vals.includes(v);
const int = (min, max) => (v) => Number.isInteger(v) && v >= min && v <= max;
const priceStr = (v) => typeof v === "string" && /^\d{1,9}(\.\d{1,2})?$/.test(v);

/**
 * Esquemas JSON (para o orquestrador anunciar ao LLM) + validadores server-side.
 * @type {Record<StylistToolName, { description: string, parameters: object, validate: Record<string, (v: any) => boolean>, required: string[], run: (ctx: StylistToolContext, args: any) => Promise<any> }>}
 */
export const STYLIST_TOOLS = {
  search_products: {
    description:
      "Procura produtos publicados da loja atual para recomendar. Disponibilidade é indicativa; use validate_variant_for_purchase antes de comprar.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", maxLength: 200 },
        anchor_handle: { type: "string", maxLength: 255 },
        collection_type: { type: "string", enum: ["upper", "lower", "full"] },
        shopper_gender: { type: "string", maxLength: 20 },
        limit: { type: "integer", minimum: 1, maximum: 10 },
      },
    },
    validate: {
      query: str(200),
      anchor_handle: handle,
      collection_type: oneOf("upper", "lower", "full"),
      shopper_gender: str(20),
      limit: int(1, 10),
    },
    required: [],
    run: async (ctx, args) => ({ products: await searchProducts(ctx, args) }),
  },
  get_product_details: {
    description: "Detalhes de um produto publicado da loja atual, por handle.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["handle"],
      properties: { handle: { type: "string", maxLength: 255 } },
    },
    validate: { handle },
    required: ["handle"],
    run: (ctx, args) => getProductDetails(ctx, args),
  },
  get_available_variants: {
    description: "Variantes atualmente à venda (availableForSale) de um produto publicado, com preço.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["handle"],
      properties: { handle: { type: "string", maxLength: 255 } },
    },
    validate: { handle },
    required: ["handle"],
    run: (ctx, args) => getAvailableVariants(ctx, args),
  },
  get_store_profile: {
    description: "Perfil comercial inferido da loja (público, faixa de preço, categorias).",
    parameters: { type: "object", additionalProperties: false, properties: {} },
    validate: {},
    required: [],
    run: async (ctx) => ({ profile: await getStoreProfile(ctx) }),
  },
  validate_variant_for_purchase: {
    description:
      "Revalida na Shopify, em tempo real, variante, preço e stock antes de qualquer ação de compra.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["variant_id"],
      properties: {
        variant_id: { type: "string", maxLength: 80 },
        quantity: { type: "integer", minimum: 1, maximum: 20 },
        expected_price: { type: "string", pattern: "^\\d{1,9}(\\.\\d{1,2})?$" },
      },
    },
    validate: { variant_id: str(80), quantity: int(1, 20), expected_price: priceStr },
    required: ["variant_id"],
    run: (ctx, args) => validateVariantForPurchase(ctx, args),
  },
};

export function listStylistToolSchemas() {
  return Object.entries(STYLIST_TOOLS).map(([name, t]) => ({
    name,
    description: t.description,
    parameters: t.parameters,
  }));
}

/**
 * @param {unknown} name
 * @param {unknown} args
 * @returns {{ ok: true, tool: StylistToolName, args: Record<string, any> } | { ok: false, error: "unknown_tool" | "invalid_arguments", detail?: string }}
 */
export function validateToolCall(name, args) {
  if (typeof name !== "string" || !Object.prototype.hasOwnProperty.call(STYLIST_TOOLS, name)) {
    return { ok: false, error: "unknown_tool" };
  }
  const def = STYLIST_TOOLS[/** @type {StylistToolName} */ (name)];
  const a = args == null ? {} : args;
  if (typeof a !== "object" || Array.isArray(a)) {
    return { ok: false, error: "invalid_arguments", detail: "arguments_must_be_object" };
  }
  for (const [k, v] of Object.entries(a)) {
    const check = def.validate[k];
    if (!check) return { ok: false, error: "invalid_arguments", detail: `unexpected_${k}` };
    if (!check(v)) return { ok: false, error: "invalid_arguments", detail: `bad_${k}` };
  }
  for (const k of def.required) {
    if (!(k in a)) return { ok: false, error: "invalid_arguments", detail: `missing_${k}` };
  }
  return { ok: true, tool: /** @type {StylistToolName} */ (name), args: a };
}

/**
 * @param {StylistToolContext} ctx
 * @param {StylistToolName} tool
 * @param {Record<string, any>} args já validados
 */
export function runStylistTool(ctx, tool, args) {
  return STYLIST_TOOLS[tool].run(ctx, args);
}
