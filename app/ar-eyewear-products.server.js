/**
 * Lista produtos elegíveis para provador AR (óculos, colares, relógios,
 * pulseiras, etc.) — filtro por tipo, taxonomia Shopify, tags e título.
 * Shopify Admin GraphQL.
 */

const PRODUCTS_QUERY = `#graphql
  query ArEyewearProducts($first: Int!, $after: String) {
    products(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          handle
          productType
          tags
          category {
            fullName
          }
          featuredMedia {
            ... on MediaImage {
              id
              image {
                url(transform: { maxWidth: 1200 })
                altText
                width
                height
              }
            }
          }
          media(first: 20, sortKey: POSITION) {
            nodes {
              ... on MediaImage {
                id
                image {
                  url(transform: { maxWidth: 1200 })
                  altText
                  width
                  height
                }
              }
            }
          }
          variants(first: 100) {
            nodes {
              id
              title
              price
              image {
                url(transform: { maxWidth: 600 })
                altText
              }
            }
          }
        }
      }
    }
  }
`;

/** Mesma query sem `category` (APIs antigas ou lojas sem o campo). */
const PRODUCTS_QUERY_NO_CATEGORY = `#graphql
  query ArEyewearProductsNoCat($first: Int!, $after: String) {
    products(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          handle
          productType
          tags
          featuredMedia {
            ... on MediaImage {
              id
              image {
                url(transform: { maxWidth: 1200 })
                altText
                width
                height
              }
            }
          }
          media(first: 20, sortKey: POSITION) {
            nodes {
              ... on MediaImage {
                id
                image {
                  url(transform: { maxWidth: 1200 })
                  altText
                  width
                  height
                }
              }
            }
          }
          variants(first: 100) {
            nodes {
              id
              title
              price
              image {
                url(transform: { maxWidth: 600 })
                altText
              }
            }
          }
        }
      }
    }
  }
`;

function isLikelyCategoryFieldError(errs) {
  const msg = (errs || []).map((e) => e?.message || "").join(" ");
  return /category|fullName|unknown field|Field ['"]?category/i.test(msg);
}

import { AR_ACCESSORY_HINT_REGEXES } from "./ar-accessory-type.shared.js";

/**
 * Heurísticas (PT/EN/ES) importadas de `ar-accessory-type.shared.js` para
 * garantir que a listagem ("Acessórios AR") e a deteção de tipo usam
 * exactamente os mesmos padrões — qualquer produto que apareça na lista
 * é classificado de forma consistente pelo detector.
 */
const EYEWEAR_HINTS = AR_ACCESSORY_HINT_REGEXES.glasses;
const NECKLACE_HINTS = AR_ACCESSORY_HINT_REGEXES.necklace;
const WATCH_HINTS = AR_ACCESSORY_HINT_REGEXES.watch;
const BRACELET_HINTS = AR_ACCESSORY_HINT_REGEXES.bracelet;

const AR_ACCESSORY_CATEGORY_HINTS = [
  ...EYEWEAR_HINTS,
  ...NECKLACE_HINTS,
  ...WATCH_HINTS,
  ...BRACELET_HINTS,
];

/** Tag explícita `ar:<tipo>` — o produto entra na lista mesmo fora das heurísticas. */
function hasExplicitArAccessoryTag(node) {
  const tags = Array.isArray(node?.tags) ? node.tags : [];
  return tags.some((t) =>
    /^ar[:\-_]?(glasses|necklace|watch|bracelet|oculos|colar|relogio|pulseira)\b/i.test(
      String(t || "").trim(),
    ),
  );
}

function productAccessorySearchText(node) {
  const parts = [
    node?.productType,
    node?.title,
    node?.category?.fullName,
    ...(Array.isArray(node?.tags) ? node.tags : []),
  ].filter(Boolean);
  return parts.join(" | ");
}

/**
 * Produto elegível para aparecer em “Acessórios AR”: óculos, colar, relógio
 * ou pulseira (por texto) ou tag `ar:*` explícita.
 */
export function isArAccessoryCategoryProduct(node) {
  if (!node) return false;
  if (hasExplicitArAccessoryTag(node)) return true;
  const text = productAccessorySearchText(node);
  if (!text.trim()) return false;
  return AR_ACCESSORY_CATEGORY_HINTS.some((re) => re.test(text));
}

/** @deprecated Use `isArAccessoryCategoryProduct` — mantido por compatibilidade. */
export function isEyewearCategoryProduct(node) {
  return isArAccessoryCategoryProduct(node);
}

export function gidToNumericProductId(gid) {
  const m = String(gid || "").match(/Product\/(\d+)/);
  return m ? m[1] : String(gid || "").replace(/\D/g, "") || null;
}

function collectImages(node) {
  const seen = new Set();
  const out = [];
  const push = (img) => {
    const url = img?.url;
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({
      url,
      altText: img?.altText || "",
      width: img?.width,
      height: img?.height,
    });
  };
  const fm = node?.featuredMedia?.image;
  if (fm) push(fm);
  const nodes = node?.media?.nodes || [];
  for (const n of nodes) {
    if (n?.image) push(n.image);
  }
  return out;
}

function collectVariants(node) {
  const nodes = node?.variants?.nodes || [];
  return nodes.map((v) => {
    const gid = v?.id || "";
    const m = gid.match(/ProductVariant\/(\d+)/);
    return {
      id: m ? m[1] : String(gid).replace(/\D/g, "") || null,
      gid,
      title: v?.title || "",
      price: v?.price || "",
      imageUrl: v?.image?.url || null,
      imageAlt: v?.image?.altText || "",
    };
  });
}

/**
 * @param {object} admin - GraphQL client from authenticate.admin
 * @param {{ maxPages?: number, pageSize?: number }} opts
 */
export async function fetchEyewearProductsForShop(admin, opts = {}) {
  const maxPages = Math.min(Number(opts.maxPages) || 6, 15);
  const pageSize = Math.min(Number(opts.pageSize) || 80, 250);
  const candidates = [];
  let cursor = null;
  let pages = 0;
  let query = PRODUCTS_QUERY;

  while (pages < maxPages) {
    const response = await admin.graphql(query, {
      variables: { first: pageSize, after: cursor },
    });
    const json = await response.json();
    const errs = json?.errors;
    if (Array.isArray(errs) && errs.length) {
      if (
        query === PRODUCTS_QUERY &&
        isLikelyCategoryFieldError(errs) &&
        pages === 0 &&
        !cursor
      ) {
        query = PRODUCTS_QUERY_NO_CATEGORY;
        continue;
      }
      const msg = errs.map((e) => e?.message).join("; ");
      throw new Error(`Shopify GraphQL: ${msg}`);
    }
    const conn = json?.data?.products;
    const edges = conn?.edges || [];
    for (const { node } of edges) {
      if (node && isArAccessoryCategoryProduct(node)) {
        const numericId = gidToNumericProductId(node.id);
        candidates.push({
          id: numericId,
          gid: node.id,
          title: node.title || "",
          handle: node.handle || "",
          productType: node.productType || "",
          categoryFullName: node.category?.fullName || node.category?.name || "",
          tags: Array.isArray(node.tags) ? node.tags : [],
          images: collectImages(node),
          variants: collectVariants(node),
        });
      }
    }
    const pi = conn?.pageInfo;
    if (!pi?.hasNextPage || !pi?.endCursor) break;
    cursor = pi.endCursor;
    pages += 1;
  }

  return candidates;
}
