import {
  isDefaultWhatsappPilotStore,
  isStoreWhatsappPilotAllowed,
  isWhatsappPilotRestrictionActive,
  whatsappMarketingAccessDeniedHint,
} from "./whatsapp-pilot-access.server.js";
import {
  expandWhatsappStoreCandidates,
  fetchShopBillingPlan,
  shopHasStylistConsultantAccess,
} from "./shop-billing-plan.server.js";

/**
 * @param {string} shopDomain
 * @returns {Promise<boolean>}
 */
export async function shopHasWhatsappMarketingAccess(shopDomain) {
  const candidates = await expandWhatsappStoreCandidates(shopDomain);
  if (!candidates.length) return false;

  if (candidates.some((key) => isDefaultWhatsappPilotStore(key))) {
    return true;
  }

  if (isWhatsappPilotRestrictionActive()) {
    return candidates.some((key) => isStoreWhatsappPilotAllowed(key));
  }

  for (const shop of candidates) {
    const plan = await fetchShopBillingPlan(shop);
    if (shopHasStylistConsultantAccess(plan)) return true;
  }

  return false;
}

export { whatsappMarketingAccessDeniedHint };
