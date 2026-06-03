/**
 * Perfil comercial da loja (consultor Growth+).
 */

import { detectProductGenderSignal } from "./widget-catalog-search.server.js";

const SAMPLE_QUERY = "published_status:published";

function median(nums) {
  const arr = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function inferAudienceFromNodes(nodes) {
  let male = 0;
  let female = 0;
  for (const node of nodes) {
    const g = detectProductGenderSignal(node);
    if (g === "male") male++;
    else if (g === "female") female++;
  }
  if (male > female * 1.4) return "male";
  if (female > male * 1.4) return "female";
  return "mixed";
}

function inferPriceBand(amounts) {
  const med = median(amounts);
  if (med == null) return "unknown";
  if (med < 120) return "budget";
  if (med > 350) return "premium";
  return "mid";
}

const PROFILE_SAMPLE = `#graphql
  query WidgetStoreProfileSample($first: Int!) {
    products(first: $first, query: "published_status:published") {
      edges {
        node {
          title
          productType
          tags
          priceRangeV2 {
            minVariantPrice { amount }
          }
        }
      }
    }
  }
`;

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {string} shopDomain
 * @param {import("@shopify/shopify-app-remix/server").AdminApiContext} admin
 */
export async function resolveStoreProfileForShop(prisma, shopDomain, admin) {
  const shop = String(shopDomain || "").trim().toLowerCase();
  if (!shop) {
    return {
      audience: "mixed",
      price_band: "unknown",
      primary_categories: [],
      source: "fallback",
    };
  }

  const cached = await prisma.widgetStoreProfile.findUnique({ where: { shop } });
  const maxAgeMs = 7 * 24 * 3600 * 1000;
  if (cached && Date.now() - new Date(cached.updatedAt).getTime() < maxAgeMs) {
    return {
      audience: cached.audience,
      price_band: cached.priceBand,
      primary_categories: String(cached.primaryCategories || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      source: cached.source,
    };
  }

  let audience = "mixed";
  let price_band = "unknown";
  const categories = new Set();
  const prices = [];

  if (admin) {
    try {
      const response = await admin.graphql(PROFILE_SAMPLE, {
        variables: { first: 40 },
      });
      const json = await response.json();
      const edges = json?.data?.products?.edges ?? [];
      const nodes = edges.map((e) => e?.node).filter(Boolean);
      audience = inferAudienceFromNodes(nodes);
      for (const node of nodes) {
        const amt = Number(node?.priceRangeV2?.minVariantPrice?.amount);
        if (Number.isFinite(amt)) prices.push(amt);
        const pt = String(node?.productType || "").trim();
        if (pt) categories.add(pt);
      }
      price_band = inferPriceBand(prices);
    } catch (e) {
      console.warn("[widget-store-profile] infer failed", e);
    }
  }

  const profile = {
    audience,
    price_band,
    primary_categories: [...categories].slice(0, 8),
    source: admin ? "inferred" : "fallback",
  };

  await prisma.widgetStoreProfile.upsert({
    where: { shop },
    create: {
      shop,
      audience: profile.audience,
      priceBand: profile.price_band,
      primaryCategories: profile.primary_categories.join(","),
      source: profile.source,
    },
    update: {
      audience: profile.audience,
      priceBand: profile.price_band,
      primaryCategories: profile.primary_categories.join(","),
      source: profile.source,
    },
  });

  return profile;
}
