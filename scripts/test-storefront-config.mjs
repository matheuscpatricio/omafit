/* eslint-env node */
import assert from "node:assert/strict";
import { buildStorefrontConfigValue } from "../app/storefront-config-payload.js";

const value = buildStorefrontConfigValue({
  widgetEnabled: true,
  isActive: true,
  publicId: "wgt_pub_abc",
  linkText: "Provar",
  primaryColor: "#112233",
  storeLogo: "data:image/png;base64,AAAA",
  embedPosition: "above_buy_buttons",
  ctaType: "button",
  ctaButtonBorderRadius: 12,
  tryonLayout: "sidebar",
  excludedCollections: ["cuecas", ""],
  stylistModeEnabled: true,
  shopDomain: "loja.myshopify.com",
});

assert.equal(value.storeLogo, "");
assert.equal(value.embedPosition, "above_buy_buttons");
assert.equal(value.ctaType, "button");
assert.equal(value.tryonLayout, "sidebar");
assert.deepEqual(value.excludedCollections, ["cuecas"]);
assert.equal(value.billingPlan, "growth");
assert.equal(value.stylistModeEnabled, true);

const urlLogo = buildStorefrontConfigValue({
  storeLogo: "https://cdn.shopify.com/logo.png",
  tryonLayout: "nope",
  widgetEnabled: false,
});
assert.equal(urlLogo.storeLogo, "https://cdn.shopify.com/logo.png");
assert.equal(urlLogo.tryonLayout, "default");
assert.equal(urlLogo.widgetEnabled, false);
assert.equal(urlLogo.billingPlan, null);

console.log("storefront config payload ok");
