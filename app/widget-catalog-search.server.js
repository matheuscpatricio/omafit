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

/** Heurística em título/productType/tags: calçado ou acessório (consultor sugere só vestuário). */
const FOOTWEAR_OR_ACCESSORY_HINTS =
  /\b(?:sapatos?|cal[cç]ados?|t[eê]nis|tenis|trainer|trainers|sneaker|sneakers|footwear|sand[aá]lias?|chinelos?|slides?|(?:ankle\s+)?boots?|\bheels?\b|stiletto|loafers?|oxfords?|moccasins?|clogs?|\bpumps\b|zapatos?|zapatillas?|botas?|chanclas?|calzado|[oó]culos(?:\s+de\s+sol)?|gafa(?:s)?(?:\s+de\s+sol)?|sunglass(?:es)?|eyewear|rel[oó]g(?:io|ios)|reloj(?:es)?|smartwatch|\bwatches?\b|carteira|cinto|cintur[oó]n|\bbelts?\b|bols[ao]s?|handbag|clutch|mochila|backpack|rucksack|chap[eé]u|chapeu|\bbon[eé]\b|gorros?|toucas?|beanie|bucket\s+hat|baseball\s+cap|cachecol|pa[nñ]uelo|(?:len[cç]o|scarf)(?:\s+de\s+pesco[cç]o)?|jewelry|jewellery|jo[ií]as|bijuteria|colar(?:es)?|necklaces?|pulseiras?|bracelets?|brincos?|earrings?|\ban[eé]is\b|\banillos?\b|headbands?|hair\s+clips?|necessaire)\b/i;

/** Peças tipicamente associadas a um género no título/tipo (heurística). */
const FEMALE_GARMENT_HINTS =
  /\b(saia|skirt|vestido|dress|maxi dress|midi skirt|falda|vestid|blusa feminina|legging feminin)\b/i;
const MALE_GARMENT_HINTS =
  /\b(gravata|tie\b|terno masculino|smoking|suspensório|cueca|boxer masculino)\b/i;

const FEMALE_TAG_HINTS =
  /\b(women|woman|womens|feminino|feminina|fem|mulher|mulheres|mujer|mujeres|female|feminine|ladies|lady)\b/i;
const MALE_TAG_HINTS =
  /\b(men|man|mens|masculino|masculina|homem|homens|hombre|hombres|male|masculine)\b/i;
const UNISEX_TAG_HINTS = /\b(unisex|unissex|neutro|neutral|gender[\s-]?neutral)\b/i;

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

/** Handles de coleções Shopify (csv ou array) — produtos da mesma coleção entram nos candidatos. */
export function parseCollectionHandlesInput(input) {
  if (Array.isArray(input)) {
    return uniqueQueries(
      input.map((h) => String(h || "").trim()).filter(Boolean)
    ).slice(0, 8);
  }
  const raw = String(input || "").trim();
  if (!raw) return [];
  return uniqueQueries(
    raw
      .split(/[,;|]/)
      .map((h) => h.trim())
      .filter(Boolean)
  ).slice(0, 8);
}

export function normalizeShopperGender(v) {
  const s = String(v || "")
    .trim()
    .toLowerCase();
  if (s === "m" || s === "man" || s === "men" || s === "homem" || s === "hombre" || s === "masculino") {
    return "male";
  }
  if (s === "f" || s === "woman" || s === "women" || s === "mulher" || s === "mujer" || s === "feminino") {
    return "female";
  }
  if (s === "unisex" || s === "neutro") return "unisex";
  return "";
}

export function normalizeChartGenderScope(v) {
  const s = String(v || "")
    .trim()
    .toLowerCase();
  if (s === "male" || s === "female" || s === "both") return s;
  return "both";
}

/**
 * Género efectivo para filtrar candidatos: prioriza o escopo do lojista na tabela de medidas;
 * senão o perfil escolhido no provador.
 */
export function resolveCatalogSearchTargetGender({ shopperGender, chartGenderScope }) {
  const scope = normalizeChartGenderScope(chartGenderScope);
  if (scope === "male" || scope === "female") return scope;
  const shopper = normalizeShopperGender(shopperGender);
  if (shopper === "male" || shopper === "female") return shopper;
  return "unisex";
}

function lowerTermsForGender(collectionType, targetGender) {
  let lowers = [...LOWER_TERMS_PT_EN];
  let uppers = [...UPPER_TERMS_PT_EN];
  if (targetGender === "male") {
    lowers = lowers.filter((t) => !/\b(saia|skirt|legging)\b/i.test(t));
  }
  if (targetGender === "female") {
    uppers = uppers.filter((t) => !/\b(moletom masculino)\b/i.test(t));
  }
  if (collectionType === "upper") return { lowers, uppers };
  if (collectionType === "lower") return { lowers, uppers };
  return { lowers, uppers };
}

export function buildCatalogSearchQueries({
  userMessage = "",
  productName = "",
  collectionType = "upper",
  titleLooksDark = false,
  shopperGender = "",
  chartGenderScope = "both",
  collectionHandles = [],
  searchTermsBoost = "",
}) {
  const msg = String(userMessage || "").trim();
  const name = String(productName || "").trim();
  const effectiveGender = resolveCatalogSearchTargetGender({
    shopperGender,
    chartGenderScope,
  });
  const queries = [];

  for (const handle of parseCollectionHandlesInput(collectionHandles)) {
    queries.push(`collection:${handle}`);
  }

  if (effectiveGender === "male") {
    queries.push("tag:men", "tag:masculino", "tag:homem", "tag:male");
  } else if (effectiveGender === "female") {
    queries.push("tag:women", "tag:feminino", "tag:mulher", "tag:female");
  }

  if (msg) {
    queries.push(msg);
    const words = msg.split(/\s+/).filter((w) => w.length > 2).slice(0, 6).join(" ");
    if (words && words !== msg) {
      queries.push(words);
    }
  }

  const boostRaw = String(searchTermsBoost || "").trim();
  if (boostRaw) {
    for (const term of boostRaw.split(/[,;|]/).map((t) => t.trim()).filter(Boolean).slice(0, 6)) {
      queries.push(term);
    }
  }

  const addContrast = titleLooksDark || DARK_HINTS.test(name);
  const contrastSuffix = addContrast ? LIGHT_TERMS.slice(0, 4).join(" OR ") : "";
  const { lowers, uppers } = lowerTermsForGender(collectionType, effectiveGender);

  if (collectionType === "upper") {
    for (const term of lowers) {
      queries.push(contrastSuffix ? `${term} (${contrastSuffix})` : term);
    }
    queries.push("bottom");
  } else if (collectionType === "lower") {
    for (const term of uppers.slice(0, 6)) {
      queries.push(term);
    }
    queries.push("top");
  } else {
    for (const term of [...lowers.slice(0, 3), ...uppers.slice(0, 3)]) {
      queries.push(contrastSuffix ? `${term} ${contrastSuffix}` : term);
    }
  }

  return uniqueQueries(queries).slice(0, 10);
}

function joinCatalogSearchBlob(node) {
  const tags = Array.isArray(node?.tags)
    ? node.tags.map((t) => String(t || "").toLowerCase()).join(" ")
    : "";
  return [node?.title, node?.productType, tags].filter(Boolean).join(" ").toLowerCase();
}

/** Exclui candidatos que parecem calçado ou acessório (modo consultor = só vestuário). */
export function productLooksLikeFootwearOrAccessory(node) {
  const blob = joinCatalogSearchBlob(node);
  if (!blob.trim()) return false;
  return FOOTWEAR_OR_ACCESSORY_HINTS.test(blob);
}

/**
 * Sinal de género inferido do produto (tags, título, productType).
 * @returns {"male"|"female"|"unisex"|"neutral"}
 */
export function detectProductGenderSignal(node) {
  const tags = Array.isArray(node?.tags) ? node.tags : [];
  const tagStr = tags.map((t) => String(t || "").toLowerCase()).join(" ");
  const blob = [node?.title, node?.productType, tagStr].filter(Boolean).join(" ").toLowerCase();

  if (UNISEX_TAG_HINTS.test(blob)) return "unisex";
  const hasFemale = FEMALE_TAG_HINTS.test(blob) || FEMALE_GARMENT_HINTS.test(blob);
  const hasMale = MALE_TAG_HINTS.test(blob) || MALE_GARMENT_HINTS.test(blob);
  if (hasFemale && hasMale) return "unisex";
  if (hasFemale) return "female";
  if (hasMale) return "male";
  return "neutral";
}

/** Exclui candidatos claramente do género oposto; neutros/unissex passam. */
export function productMatchesTargetGender(node, targetGender) {
  if (!targetGender || targetGender === "unisex") return true;
  const signal = detectProductGenderSignal(node);
  if (signal === "unisex" || signal === "neutral") return true;
  if (targetGender === "male") return signal !== "female";
  if (targetGender === "female") return signal !== "male";
  return true;
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
          productType
          tags
          onlineStoreUrl
          priceRangeV2 {
            minVariantPrice {
              amount
              currencyCode
            }
          }
          featuredImage {
            url
          }
          images(first: 1) {
            edges {
              node {
                url
              }
            }
          }
          variants(first: 8) {
            edges {
              node {
                availableForSale
              }
            }
          }
        }
      }
    }
  }
`;

const COLLECTION_PRODUCTS = `#graphql
  query WidgetCatalogCollectionProducts($handle: String!, $first: Int!) {
    collectionByHandle(handle: $handle) {
      products(first: $first) {
        edges {
          node {
            handle
            title
            productType
            tags
            onlineStoreUrl
            priceRangeV2 {
              minVariantPrice {
                amount
                currencyCode
              }
            }
            featuredImage {
              url
            }
            images(first: 1) {
              edges {
                node {
                  url
                }
              }
            }
            variants(first: 8) {
              edges {
                node {
                  availableForSale
                }
              }
            }
          }
        }
      }
    }
  }
`;

const PRODUCT_COLLECTION_HANDLES = `#graphql
  query WidgetProductCollectionHandles($handle: String!) {
    productByHandle(handle: $handle) {
      collections(first: 15) {
        edges {
          node {
            handle
          }
        }
      }
    }
  }
`;

function graphqlErrors(json) {
  return Array.isArray(json?.errors) ? json.errors : [];
}

function resolveCandidateImageUrl(node) {
  const featured = node?.featuredImage?.url;
  if (featured) return featured;
  const fromImages = node?.images?.edges?.[0]?.node?.url;
  if (fromImages) return fromImages;
  for (const { node: v } of node?.variants?.edges || []) {
    const u = v?.image?.url;
    if (u) return u;
  }
  return "";
}

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

function productHasAvailableVariant(node) {
  const edges = node?.variants?.edges;
  if (!Array.isArray(edges) || edges.length === 0) return undefined;
  return edges.some((e) => Boolean(e?.node?.availableForSale));
}

function mapEdgesToCandidates(
  edges,
  excludeHandle,
  targetGender = "unisex",
  { requireImage = true, applyGenderFilter = true, excludeFootwearAndAccessories = true } = {}
) {
  const ex = String(excludeHandle || "").trim().toLowerCase();
  const list = [];
  for (const { node } of edges || []) {
    if (!node?.handle) continue;
    if (ex && node.handle.toLowerCase() === ex) continue;
    if (excludeFootwearAndAccessories && productLooksLikeFootwearOrAccessory(node)) continue;
    if (applyGenderFilter && !productMatchesTargetGender(node, targetGender)) continue;
    const imageUrl = resolveCandidateImageUrl(node);
    if (requireImage && !imageUrl) continue;
    const minPrice = node?.priceRangeV2?.minVariantPrice;
    const priceAmount = minPrice?.amount != null ? Number(minPrice.amount) : null;
    const currencyCode = minPrice?.currencyCode || null;
    const stock = productHasAvailableVariant(node);
    list.push({
      handle: node.handle,
      title: node.title || node.handle,
      url: node.onlineStoreUrl || "",
      image_url: imageUrl,
      product_type: node.productType || "",
      tags: Array.isArray(node.tags) ? node.tags : [],
      price_amount: Number.isFinite(priceAmount) ? priceAmount : null,
      currency_code: currencyCode,
      ...(stock !== undefined ? { in_stock: stock } : {}),
    });
  }
  return list;
}

/**
 * Se o widget não enviar coleções, infere a partir do produto âncora (exclude_handle).
 */
export async function resolveCollectionHandlesForCatalog(
  admin,
  collectionHandles,
  anchorProductHandle
) {
  const parsed = parseCollectionHandlesInput(collectionHandles);
  if (parsed.length) return parsed;

  const anchor = String(anchorProductHandle || "").trim();
  if (!anchor) return [];

  try {
    const response = await admin.graphql(PRODUCT_COLLECTION_HANDLES, {
      variables: { handle: anchor },
    });
    const json = await response.json();
    const errs = graphqlErrors(json);
    if (errs.length) {
      console.warn("[catalog-search] product collections:", errs.map((e) => e.message).join("; "));
    }
    const edges = json?.data?.productByHandle?.collections?.edges ?? [];
    return uniqueQueries(edges.map((e) => e?.node?.handle).filter(Boolean)).slice(0, 8);
  } catch (err) {
    console.warn("[catalog-search] resolveCollectionHandlesForCatalog:", err);
    return [];
  }
}

/**
 * Produtos das coleções Shopify do produto em try-on (só exclui o handle atual).
 */
export async function fetchCandidatesFromCollections(
  admin,
  collectionHandles,
  { excludeHandle, limit = 15, targetGender = "unisex" } = {}
) {
  const handles = parseCollectionHandlesInput(collectionHandles);
  if (!handles.length) return [];

  const gender =
    targetGender === "male" || targetGender === "female" || targetGender === "unisex"
      ? targetGender
      : "unisex";
  const perCollection = Math.min(30, Math.max(limit, 12));
  const byHandle = new Map();

  for (const collectionHandle of handles) {
    try {
      const response = await admin.graphql(COLLECTION_PRODUCTS, {
        variables: { handle: collectionHandle, first: perCollection },
      });
      const json = await response.json();
      const errs = graphqlErrors(json);
      if (errs.length) {
        console.warn(
          "[catalog-search] collection graphql:",
          collectionHandle,
          errs.map((e) => e.message).join("; ")
        );
        continue;
      }
      const edges = json?.data?.collectionByHandle?.products?.edges ?? [];
      for (const c of mapEdgesToCandidates(edges, excludeHandle, gender)) {
        if (!byHandle.has(c.handle)) {
          byHandle.set(c.handle, c);
        }
      }
    } catch (err) {
      console.warn("[catalog-search] collection fetch failed:", collectionHandle, err);
    }
    if (byHandle.size >= limit) break;
  }

  return Array.from(byHandle.values()).slice(0, limit);
}

export async function runCatalogSearches(
  admin,
  searchQueries,
  { excludeHandle, limit = 15, targetGender = "unisex", collectionHandles = [] } = {}
) {
  const byHandle = new Map();
  const gender =
    targetGender === "male" || targetGender === "female" || targetGender === "unisex"
      ? targetGender
      : "unisex";
  const fetchFirst =
    gender !== "unisex" ? Math.min(40, Math.max(limit * 3, 24)) : Math.min(limit, 20);

  const resolvedCollectionHandles = await resolveCollectionHandlesForCatalog(
    admin,
    collectionHandles,
    excludeHandle
  );

  const fromCollections = await fetchCandidatesFromCollections(admin, resolvedCollectionHandles, {
    excludeHandle,
    limit,
    targetGender: gender,
  });
  for (const c of fromCollections) {
    byHandle.set(c.handle, c);
  }

  for (const q of searchQueries) {
    const response = await admin.graphql(SEARCH_PRODUCTS, {
      variables: { query: q, first: fetchFirst },
    });
    const json = await response.json();
    const errs = graphqlErrors(json);
    if (errs.length) {
      console.warn("[catalog-search] products graphql:", q, errs.map((e) => e.message).join("; "));
      continue;
    }
    const edges = json?.data?.products?.edges ?? [];
    for (const c of mapEdgesToCandidates(edges, excludeHandle, gender)) {
      if (!byHandle.has(c.handle)) {
        byHandle.set(c.handle, c);
      }
      if (byHandle.size >= limit) break;
    }
    if (byHandle.size >= limit) break;
  }

  if (byHandle.size === 0 && resolvedCollectionHandles.length) {
    for (const collectionHandle of resolvedCollectionHandles) {
      try {
        const response = await admin.graphql(COLLECTION_PRODUCTS, {
          variables: { handle: collectionHandle, first: fetchFirst },
        });
        const json = await response.json();
        const edges = json?.data?.collectionByHandle?.products?.edges ?? [];
        for (const c of mapEdgesToCandidates(edges, excludeHandle, gender, {
          applyGenderFilter: false,
        })) {
          if (!byHandle.has(c.handle)) byHandle.set(c.handle, c);
        }
      } catch {
        /* ignore */
      }
      if (byHandle.size >= limit) break;
    }
  }

  if (byHandle.size === 0) {
    const broadQueries = uniqueQueries([
      ...searchQueries.filter((q) => !String(q).startsWith("collection:")),
      "published_status:published",
    ]).slice(0, 8);
    for (const q of broadQueries) {
      try {
        const response = await admin.graphql(SEARCH_PRODUCTS, {
          variables: { query: q, first: fetchFirst },
        });
        const json = await response.json();
        const edges = json?.data?.products?.edges ?? [];
        for (const c of mapEdgesToCandidates(edges, excludeHandle, gender, {
          applyGenderFilter: false,
        })) {
          if (!byHandle.has(c.handle)) byHandle.set(c.handle, c);
        }
      } catch {
        /* ignore */
      }
      if (byHandle.size >= limit) break;
    }
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

  const collection_handles = await resolveCollectionHandlesForCatalog(admin, [], h);

  return {
    product: {
      id: p.legacyResourceId != null ? String(p.legacyResourceId) : String(p.id || ""),
      handle: p.handle,
      title: p.title,
      product_type: p.productType || "",
      url: p.onlineStoreUrl || "",
      images,
      image_url: images[0] || "",
      collection_handles,
      catalog: {
        sizes: Array.from(sizes),
        colors: Array.from(colors),
        variants,
      },
    },
    error: null,
  };
}
