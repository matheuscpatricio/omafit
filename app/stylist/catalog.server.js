import {
  buildCatalogSearchQueries,
  runCatalogSearches,
  titleLooksDark,
  resolveCatalogSearchTargetGender,
  parseCollectionHandlesInput,
  resolveCollectionHandlesForCatalog,
  fetchProductNodeByHandle,
  mapProductNodeToWidgetDetail,
} from "../widget-catalog-search.server.js";
import { rankCandidatesByLearnedBoost } from "../widget-suggestion-learn.server.js";
import {
  filterCandidatesByStylistParams,
  scoreCandidatesForStylist,
} from "../widget-stylist-filters.server.js";
import { resolveStoreProfileForShop } from "../widget-store-profile.server.js";

/** @typedef {import("./contracts").ProductSummary} ProductSummary */
/** @typedef {import("./contracts").ProductDetails} ProductDetails */
/** @typedef {import("./contracts").VariantInfo} VariantInfo */
/** @typedef {import("./contracts").PurchaseValidation} PurchaseValidation */

/**
 * Pipeline de `/api/widget/catalog-search` (busca → boost aprendido → filtros → score).
 * `admin` tem de ser o cliente da loja autenticada: é ele que isola o tenant.
 * Muta `params` (store_audience / price_band) tal como a rota fazia.
 */
export async function runStylistCatalogSearch({ prisma, admin, shopDomain, params }) {
  const userMessage = String(params.user_message || "").trim();
  const excludeHandle = String(params.exclude_handle || "").trim();
  const productName = String(params.product_name || "").trim();
  const collectionType = String(params.collection_type || "upper").trim().toLowerCase();
  const safeCollection =
    collectionType === "lower" || collectionType === "full" ? collectionType : "upper";
  const shopperGender = String(params.shopper_gender || "").trim();
  const chartGenderScope = String(params.chart_gender_scope || "both").trim();
  const collectionHandles = parseCollectionHandlesInput(params.collection_handles);
  const targetGender = resolveCatalogSearchTargetGender({ shopperGender, chartGenderScope });

  const storeProfile = await resolveStoreProfileForShop(prisma, shopDomain, admin);
  if (
    storeProfile?.audience &&
    storeProfile.audience !== "mixed" &&
    (!String(params.store_audience || "").trim() ||
      String(params.store_audience).trim() === "unknown")
  ) {
    params.store_audience = storeProfile.audience;
  }
  if (!String(params.price_band || "").trim() && storeProfile?.price_band) {
    params.price_band = storeProfile.price_band;
  }

  const resolvedCollectionHandles = await resolveCollectionHandlesForCatalog(
    admin,
    collectionHandles,
    excludeHandle
  );
  const handlesForSearch =
    resolvedCollectionHandles.length > 0 ? resolvedCollectionHandles : collectionHandles;

  const effectiveSearchGender =
    String(params.effective_search_gender || "").trim() || targetGender;

  const queries = buildCatalogSearchQueries({
    userMessage,
    productName,
    collectionType: safeCollection,
    titleLooksDark: titleLooksDark(productName),
    shopperGender,
    chartGenderScope,
    collectionHandles: handlesForSearch,
    searchTermsBoost: String(params.search_terms_boost || ""),
  });

  const candidatesRaw = await runCatalogSearches(admin, queries, {
    excludeHandle,
    limit: 15,
    targetGender: effectiveSearchGender,
    collectionHandles: handlesForSearch,
  });

  const boosted = await rankCandidatesByLearnedBoost(
    prisma,
    shopDomain,
    excludeHandle,
    candidatesRaw
  );

  const filtered = filterCandidatesByStylistParams(boosted, {
    ...params,
    exclude_handle: excludeHandle,
    effective_search_gender: effectiveSearchGender,
  });

  const scoredTop = scoreCandidatesForStylist(filtered, {
    ...params,
    product_name: productName,
    collection_type: safeCollection,
  });

  const candidates = scoredTop.length ? scoredTop : filtered.slice(0, 15);

  return {
    candidates,
    scoredTop,
    storeProfile,
    diagnostics: {
      excludeHandle,
      collectionHandles,
      resolvedCollectionHandles,
      queries,
      targetGender,
      effectiveSearchGender,
      chartGenderScope,
      shopperGender,
      safeCollection,
      candidatesRaw,
      filtered,
    },
  };
}

/** Publicado na Online Store e ACTIVE (drafts/arquivados nunca são recomendados). */
export function isRecommendableProductNode(node) {
  if (!node) return false;
  if (node.status != null && String(node.status).toUpperCase() !== "ACTIVE") return false;
  return Boolean(node.onlineStoreUrl);
}

/**
 * @param {any} c candidato do pipeline
 * @returns {ProductSummary}
 */
function toProductSummary(c) {
  return {
    handle: c.handle,
    title: c.title,
    url: c.url || "",
    image_url: c.image_url || "",
    product_type: c.product_type || "",
    price_amount: c.price_amount ?? null,
    currency_code: c.currency_code ?? null,
    in_stock: c.in_stock !== false,
  };
}

/**
 * Produtos recomendáveis: só publicados (url da Online Store). `in_stock` é indicativo.
 * @returns {Promise<ProductSummary[]>}
 */
export async function searchProducts({ prisma, admin, shopDomain }, args) {
  const limit = Math.min(10, Math.max(1, Number(args.limit) || 6));
  const params = {
    user_message: args.query || "",
    exclude_handle: args.anchor_handle || "",
    product_name: "",
    collection_type: args.collection_type || "upper",
    shopper_gender: args.shopper_gender || "",
  };
  if (args.anchor_handle) {
    const anchor = await fetchProductNodeByHandle(admin, args.anchor_handle);
    if (anchor.node && isRecommendableProductNode(anchor.node)) {
      params.product_name = anchor.node.title || "";
    }
  }
  const { candidates } = await runStylistCatalogSearch({ prisma, admin, shopDomain, params });
  return candidates
    .filter((c) => Boolean(c?.url))
    .slice(0, limit)
    .map(toProductSummary);
}

/**
 * @returns {VariantInfo}
 */
function toVariantInfo(v) {
  return {
    id: v.legacyResourceId != null ? String(v.legacyResourceId) : String(v.id || ""),
    title: v.title || "",
    price: v.price != null ? String(v.price) : null,
    available: Boolean(v.availableForSale),
    options: (v.selectedOptions || []).reduce((acc, o) => {
      if (o?.name && o?.value) acc[o.name] = o.value;
      return acc;
    }, {}),
  };
}

async function loadRecommendableNode(admin, handle) {
  const { node } = await fetchProductNodeByHandle(admin, handle);
  return node && isRecommendableProductNode(node) ? node : null;
}

/**
 * @returns {Promise<{ product: ProductDetails | null, error: "not_found" | null }>}
 */
export async function getProductDetails({ admin }, { handle }) {
  const node = await loadRecommendableNode(admin, handle);
  if (!node) return { product: null, error: "not_found" };
  const d = mapProductNodeToWidgetDetail(node, []);
  return {
    product: {
      id: d.id,
      handle: d.handle,
      title: d.title,
      product_type: d.product_type,
      url: d.url,
      images: d.images,
      recommendable: true,
      sizes: d.catalog.sizes,
      colors: d.catalog.colors,
    },
    error: null,
  };
}

/**
 * Apenas variantes `availableForSale` no momento da consulta.
 * @returns {Promise<{ handle: string, variants: VariantInfo[], error: "not_found" | null }>}
 */
export async function getAvailableVariants({ admin }, { handle }) {
  const node = await loadRecommendableNode(admin, handle);
  if (!node) return { handle, variants: [], error: "not_found" };
  const variants = (node.variants?.edges || [])
    .map((e) => e?.node)
    .filter((v) => v && v.availableForSale)
    .map(toVariantInfo);
  return { handle: node.handle, variants, error: null };
}

const VARIANT_FOR_PURCHASE = `#graphql
  query StylistVariantForPurchase($id: ID!) {
    shop {
      currencyCode
    }
    node(id: $id) {
      ... on ProductVariant {
        id
        legacyResourceId
        price
        availableForSale
        product {
          handle
          status
          onlineStoreUrl
        }
      }
    }
  }
`;

const VARIANT_GID_RE = /^gid:\/\/shopify\/ProductVariant\/\d+$/;

/** @returns {string | null} */
export function toVariantGid(variantId) {
  const s = String(variantId || "").trim();
  if (/^\d{1,20}$/.test(s)) return `gid://shopify/ProductVariant/${s}`;
  if (VARIANT_GID_RE.test(s)) return s;
  return null;
}

function samePrice(a, b) {
  const x = Number(a);
  const y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) && Math.round(x * 100) === Math.round(y * 100);
}

/**
 * Leitura atual da Shopify, sem cache. Uma variante de outra loja não existe para este `admin`.
 * @returns {Promise<PurchaseValidation>}
 */
export async function validateVariantForPurchase({ admin }, { variant_id, quantity, expected_price }) {
  const base = {
    variant_id: String(variant_id || ""),
    product_handle: null,
    current_price: null,
    currency_code: null,
    available: false,
  };
  const qty = quantity == null ? 1 : Number(quantity);
  if (!Number.isInteger(qty) || qty < 1 || qty > 20) {
    return { ...base, valid: false, reason: "invalid_quantity" };
  }
  const gid = toVariantGid(variant_id);
  if (!gid) return { ...base, valid: false, reason: "variant_not_found" };

  const res = await admin.graphql(VARIANT_FOR_PURCHASE, { variables: { id: gid } });
  const json = await res.json();
  const v = json?.data?.node;
  const currency = json?.data?.shop?.currencyCode ?? null;
  if (!v || v.price === undefined || !v.product) {
    return { ...base, valid: false, reason: "variant_not_found" };
  }

  const out = {
    variant_id: v.legacyResourceId != null ? String(v.legacyResourceId) : base.variant_id,
    product_handle: v.product.handle ?? null,
    current_price: v.price != null ? String(v.price) : null,
    currency_code: currency,
    available: Boolean(v.availableForSale),
  };
  if (!isRecommendableProductNode(v.product)) {
    return { ...out, valid: false, reason: "product_not_recommendable" };
  }
  if (!v.availableForSale) return { ...out, valid: false, reason: "out_of_stock" };
  if (expected_price != null && expected_price !== "" && !samePrice(expected_price, v.price)) {
    return { ...out, valid: false, reason: "price_changed" };
  }
  return { ...out, valid: true, reason: "ok" };
}

export async function getStoreProfile({ prisma, admin, shopDomain }) {
  return resolveStoreProfileForShop(prisma, shopDomain, admin);
}
