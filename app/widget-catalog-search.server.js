/**
 * Heurísticas de pesquisa para combinações (sem LLM — plano permite LLM opcional depois).
 */

const DARK_HINTS =
  /\b(preto|preta|black|navy|azul[\s-]?marinho|grafite|chumbo|cinza[\s-]?escur|dark|charcoal)\b/i;

const LIGHT_TERMS = ["claro", "light", "off white", "off-white", "bege", "beige", "cru", "natural", "white", "branco"];

const LOWER_TERMS_PT_EN = [
  "calça",
  "calca",
  "pants",
  "trousers",
  "jeans",
  "bermuda",
  "shorts",
  "saia",
  "skirt",
  "legging",
];

const UPPER_TERMS_PT_EN = [
  "camisa",
  "shirt",
  "blusa",
  "top",
  "casaco",
  "jaqueta",
  "jacket",
  "cardigan",
  "suéter",
  "sweater",
  "moletom",
  "hoodie",
];

const SHOE_TERMS = ["sapato", "shoe", "tênis", "tenis", "sneaker", "bota", "boot", "sandália"];

function uniqueQueries(arr) {
  const seen = new Set();
  const out = [];
  for (const q of arr) {
    const s = String(q || "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

export function buildCatalogSearchQueries({
  userMessage = "",
  productName = "",
  collectionType = "upper",
  titleLooksDark = false,
}) {
  const msg = String(userMessage || "").trim();
  const name = String(productName || "").trim();
  const queries = [];

  if (msg) {
    queries.push(msg);
    const words = msg.split(/\s+/).filter((w) => w.length > 2).slice(0, 6).join(" ");
    if (words && words !== msg) {
      queries.push(words);
    }
  }

  const addContrast = titleLooksDark || DARK_HINTS.test(name);
  const contrastSuffix = addContrast ? LIGHT_TERMS.slice(0, 4).join(" OR ") : "";

  if (collectionType === "upper") {
    for (const term of LOWER_TERMS_PT_EN) {
      queries.push(contrastSuffix ? `${term} (${contrastSuffix})` : term);
    }
    queries.push("bottom");
  } else if (collectionType === "lower") {
    for (const term of UPPER_TERMS_PT_EN.slice(0, 6)) {
      queries.push(term);
    }
    queries.push("top");
  } else {
    for (const term of [...LOWER_TERMS_PT_EN.slice(0, 3), ...UPPER_TERMS_PT_EN.slice(0, 3)]) {
      queries.push(contrastSuffix ? `${term} ${contrastSuffix}` : term);
    }
  }

  if (/sapato|shoe|tênis|tenis|bota|sand/i.test(msg)) {
    for (const term of SHOE_TERMS) {
      queries.push(term);
    }
  }

  return uniqueQueries(queries).slice(0, 8);
}

export function titleLooksDark(title) {
  return DARK_HINTS.test(String(title || ""));
}

const SEARCH_PRODUCTS = `#graphql
  query WidgetCatalogSearch($query: String!, $first: Int!) {
    products(first: $first, query: $query) {
      edges {
        node {
          handle
          title
          onlineStoreUrl
          featuredImage {
            url
          }
        }
      }
    }
  }
`;

const PRODUCT_BY_HANDLE = `#graphql
  query WidgetProductByHandle($handle: String!) {
    productByHandle(handle: $handle) {
      id
      legacyResourceId
      handle
      title
      productType
      onlineStoreUrl
      featuredImage {
        url
      }
      images(first: 15) {
        edges {
          node {
            url
          }
        }
      }
      variants(first: 80) {
        edges {
          node {
            id
            legacyResourceId
            title
            availableForSale
            image {
              url
            }
            selectedOptions {
              name
              value
            }
          }
        }
      }
    }
  }
`;

function mapEdgesToCandidates(edges, excludeHandle) {
  const ex = String(excludeHandle || "").trim().toLowerCase();
  const list = [];
  for (const { node } of edges || []) {
    if (!node?.handle) continue;
    if (ex && node.handle.toLowerCase() === ex) continue;
    const imageUrl = node.featuredImage?.url || "";
    if (!imageUrl) continue;
    list.push({
      handle: node.handle,
      title: node.title || node.handle,
      url: node.onlineStoreUrl || "",
      image_url: imageUrl,
    });
  }
  return list;
}

export async function runCatalogSearches(admin, searchQueries, { excludeHandle, limit = 15 }) {
  const byHandle = new Map();

  for (const q of searchQueries) {
    const response = await admin.graphql(SEARCH_PRODUCTS, {
      variables: { query: q, first: Math.min(limit, 20) },
    });
    const json = await response.json();
    const edges = json?.data?.products?.edges ?? [];
    for (const c of mapEdgesToCandidates(edges, excludeHandle)) {
      if (!byHandle.has(c.handle)) {
        byHandle.set(c.handle, c);
      }
      if (byHandle.size >= limit) break;
    }
    if (byHandle.size >= limit) break;
  }

  return Array.from(byHandle.values()).slice(0, limit);
}

const PRODUCT_BY_HANDLE_FALLBACK = `#graphql
  query WidgetProductByHandleFallback($q: String!) {
    products(first: 1, query: $q) {
      edges {
        node {
          id
          legacyResourceId
          handle
          title
          productType
          onlineStoreUrl
          featuredImage {
            url
          }
          images(first: 15) {
            edges {
              node {
                url
              }
            }
          }
          variants(first: 80) {
            edges {
              node {
                id
                legacyResourceId
                title
                availableForSale
                image {
                  url
                }
                selectedOptions {
                  name
                  value
                }
              }
            }
          }
        }
      }
    }
  }
`;

export async function fetchProductDetailByHandle(admin, handle) {
  const h = String(handle || "").trim();
  if (!h) {
    return { product: null, error: "missing_handle" };
  }

  let p = null;
  const r1 = await admin.graphql(PRODUCT_BY_HANDLE, { variables: { handle: h } });
  const j1 = await r1.json();
  p = j1?.data?.productByHandle;

  if (!p) {
    const r2 = await admin.graphql(PRODUCT_BY_HANDLE_FALLBACK, {
      variables: { q: `handle:${h}` },
    });
    const j2 = await r2.json();
    const edge = j2?.data?.products?.edges?.[0];
    p = edge?.node || null;
  }

  if (!p) {
    return { product: null, error: "not_found" };
  }

  const images = [];
  if (p.featuredImage?.url) {
    images.push(p.featuredImage.url);
  }
  for (const e of p.images?.edges || []) {
    const u = e?.node?.url;
    if (u && !images.includes(u)) {
      images.push(u);
    }
  }

  const variants = [];
  for (const { node: v } of p.variants?.edges || []) {
    if (!v) continue;
    const opts = v.selectedOptions || [];
    const optionValues = opts.map((o) => o.value).filter(Boolean);
    const row = {
      id: v.legacyResourceId != null ? String(v.legacyResourceId) : String(v.id || ""),
      title: v.title || "",
      available: Boolean(v.availableForSale),
      featured_image: v.image?.url || images[0] || "",
      selectedOptions: opts.reduce((acc, o) => {
        if (o.name && o.value) {
          acc[o.name] = o.value;
        }
        return acc;
      }, {}),
    };
    for (let i = 0; i < optionValues.length; i++) {
      const key = `option${i + 1}`;
      if (!row[key]) {
        row[key] = optionValues[i];
      }
    }
    variants.push(row);
  }

  const sizes = new Set();
  const colors = new Set();
  for (const v of variants) {
    for (const [name, value] of Object.entries(v.selectedOptions || {})) {
      const n = String(name).toLowerCase();
      const val = String(value).trim();
      if (!val) continue;
      if (/size|tamanho|talla/.test(n)) {
        sizes.add(val);
      }
      if (/color|cor|colour/.test(n)) {
        colors.add(val);
      }
    }
  }

  return {
    product: {
      id: p.legacyResourceId != null ? String(p.legacyResourceId) : String(p.id || ""),
      handle: p.handle,
      title: p.title,
      product_type: p.productType || "",
      url: p.onlineStoreUrl || "",
      images,
      image_url: images[0] || "",
      catalog: {
        sizes: Array.from(sizes),
        colors: Array.from(colors),
        variants,
      },
    },
    error: null,
  };
}
