import { unauthenticated } from "../shopify.server";
import prisma from "../db.server";
import { fetchShopBillingPlan } from "../shop-billing-plan.server";
import { getShopifyAdminForWidget, publicIdMatchesShop } from "../widget-shop-admin.server";
import { stylistGuards } from "./request-guard.server.js";

/** @type {import("./handlers.server.js").StylistDeps} */
export const stylistDeps = {
  prisma,
  getAdmin: (shop) =>
    getShopifyAdminForWidget(prisma, unauthenticated, shop, { allowFuzzy: false }),
  publicIdMatchesShop,
  fetchPlan: fetchShopBillingPlan,
  guards: stylistGuards,
};
