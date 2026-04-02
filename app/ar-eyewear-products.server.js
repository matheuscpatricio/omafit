/**
 * Lista produtos elegíveis para AR óculos (tipo, taxonomia, tags, título).
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
        }
      }
    }
  }
`;

function isLikelyCategoryFieldError(errs) {
  const msg = (errs || []).map((e) => e?.message || "").join(" ");
  return /category|fullName|unknown field|Field ['"]?category/i.test(msg);
}

/** Heurística: óculos / sunglasses / eyewear (PT, EN, ES) + taxonomia Shopify */
const EYEWEAR_HINTS = [
  /óculos/i,
  /\boculos\b/i,
  /sunglass/i,
  /sunglasses/i,
  /eyeglass/i,
  /eyeglasses/i,
  /eyewear/i,
  /\bgafas\b/i,
  /gafa\b/i,
  /lentes?\s+de\s+sol/i,
  /optical/i,
  /armaç(ão|ões|oes|o|a)/i,
  /spectacle/i,
  /monturas?/i,
  /anteojos/i,
  /anteojo/i,
];

function productEyewearText(node) {
  const parts = [
    node?.productType,
    node?.title,
    node?.category?.fullName,
    ...(Array.isArray(node?.tags) ? node.tags : []),
  ].filter(Boolean);
  return parts.join(" | ");
}

export function isEyewearCategoryProduct(node) {
  const text = productEyewearText(node);
  if (!text.trim()) return false;
  return EYEWEAR_HINTS.some((re) => re.test(text));
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
      if (node && isEyewearCategoryProduct(node)) {
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
