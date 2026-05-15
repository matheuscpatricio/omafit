/**
 * Agregados Prisma para sugestões estilista (âncora → sugerido) e re-ranking em catalog-search.
 */

const BOOST_K = 20;
const MAX_SUGGESTION_HANDLES = 24;

function normShop(shop) {
  return String(shop || "")
    .trim()
    .toLowerCase();
}

function normHandle(h) {
  return String(h || "")
    .trim()
    .toLowerCase();
}

function pairBoost(row) {
  const imp = row.impressions ?? 0;
  const atc = row.atc ?? 0;
  return (atc + 1) / (imp + BOOST_K);
}

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {string} shopDomain
 * @param {string} anchorHandle
 * @param {Array<{ handle: string; title?: string; url?: string; image_url?: string }>} candidates
 */
export async function rankCandidatesByLearnedBoost(prisma, shopDomain, anchorHandle, candidates) {
  const shop = normShop(shopDomain);
  const anchor = normHandle(anchorHandle);
  if (!shop || !anchor || !Array.isArray(candidates) || candidates.length === 0) {
    return candidates;
  }

  const handles = [...new Set(candidates.map((c) => normHandle(c.handle)).filter(Boolean))];
  if (!handles.length) return candidates;

  const rows = await prisma.widgetSuggestionPairStat.findMany({
    where: {
      shop,
      anchorHandle: anchor,
      suggestedHandle: { in: handles },
    },
  });

  const bySuggested = new Map(rows.map((r) => [r.suggestedHandle, r]));

  const indexed = candidates.map((c, idx) => {
    const h = normHandle(c.handle);
    const row = bySuggested.get(h);
    const boost = row ? pairBoost(row) : (0 + 1) / (0 + BOOST_K);
    return { c, idx, boost };
  });

  indexed.sort((a, b) => {
    if (b.boost !== a.boost) return b.boost - a.boost;
    return a.idx - b.idx;
  });

  return indexed.map((x) => x.c);
}

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {{ shop: string; anchorHandle: string; suggestedHandle: string }} key
 * @param {"impressions" | "stylistClicks" | "atc"} field
 */
async function bumpPair(prisma, key, field) {
  const shop = normShop(key.shop);
  const anchorHandle = normHandle(key.anchorHandle);
  const suggestedHandle = normHandle(key.suggestedHandle);
  if (!shop || !anchorHandle || !suggestedHandle) return;

  const inc = { [field]: { increment: 1 } };
  await prisma.widgetSuggestionPairStat.upsert({
    where: {
      shop_anchorHandle_suggestedHandle: {
        shop,
        anchorHandle,
        suggestedHandle,
      },
    },
    create: {
      shop,
      anchorHandle,
      suggestedHandle,
      impressions: field === "impressions" ? 1 : 0,
      stylistClicks: field === "stylistClicks" ? 1 : 0,
      atc: field === "atc" ? 1 : 0,
    },
    update: inc,
  });
}

/**
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {string} shopDomain
 * @param {string} anchorHandle
 * @param {string[]} suggestedHandlesLower
 */
export async function recordImpressionPairs(prisma, shopDomain, anchorHandle, suggestedHandlesLower) {
  const shop = normShop(shopDomain);
  const anchor = normHandle(anchorHandle);
  if (!shop || !anchor || !suggestedHandlesLower?.length) return;
  const unique = [...new Set(suggestedHandlesLower.map(normHandle).filter(Boolean))].slice(0, MAX_SUGGESTION_HANDLES);
  for (const suggestedHandle of unique) {
    if (suggestedHandle === anchor) continue;
    await bumpPair(prisma, { shop, anchorHandle: anchor, suggestedHandle }, "impressions");
  }
}

export async function recordStylistClick(prisma, shopDomain, anchorHandle, suggestedHandle) {
  await bumpPair(prisma, { shop: shopDomain, anchorHandle, suggestedHandle }, "stylistClicks");
}

export async function recordAtc(prisma, shopDomain, anchorHandle, suggestedHandle) {
  await bumpPair(prisma, { shop: shopDomain, anchorHandle, suggestedHandle }, "atc");
}
