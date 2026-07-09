import {
  isStoreWhatsappPilotAllowed,
  isWhatsappPilotRestrictionActive,
  whatsappMarketingAccessDeniedHint,
} from "./whatsapp-pilot-access.server.js";
import { shopHasStylistConsultantAccess } from "./shop-billing-plan.server.js";

/**
 * @param {string} shopDomain
 * @returns {Promise<boolean>}
 */
export async function shopHasWhatsappMarketingAccess(shopDomain) {
  const shop = String(shopDomain || "").trim();
  if (!shop) return false;
  if (isWhatsappPilotRestrictionActive()) {
    return isStoreWhatsappPilotAllowed(shop);
  }
  return shopHasStylistConsultantAccess(shop);
}

export { whatsappMarketingAccessDeniedHint };
