/**
 * Copia `omafit-ar-widget.js` do tema Shopify para:
 * - `../omafit-widget/public/ar/omafit-ar-widget.js` (URL servida pelo Netlify: `/ar/omafit-ar-widget.js`)
 * - `../omafit-widget/public/omafit-ar-widget.js` (espelho na raiz de `public/`)
 * - `public/omafit-ar-widget.js` neste repo (espelho para deploys que apontam à raiz)
 *
 * Fonte canónica: `extensions/omafit-theme/assets/omafit-ar-widget.js`
 *
 * Uso (na raiz de `omafit`): `npm run sync:ar-widget-to-widget`
 * Ou o agregador: `npm run sync:netlify-widget-ar` (inclui o resto do bundle via `omafit-widget`).
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const omafitRoot = join(__dirname, "..");
const src = join(omafitRoot, "extensions", "omafit-theme", "assets", "omafit-ar-widget.js");
const destWidgetAr = join(omafitRoot, "..", "omafit-widget", "public", "ar", "omafit-ar-widget.js");
const destWidgetPublicRoot = join(omafitRoot, "..", "omafit-widget", "public", "omafit-ar-widget.js");
const destOmafitPublic = join(omafitRoot, "public", "omafit-ar-widget.js");

if (!existsSync(src)) {
  console.error("[sync-ar-widget] Ficheiro em falta:", src);
  process.exit(1);
}

mkdirSync(dirname(destWidgetAr), { recursive: true });
mkdirSync(dirname(destWidgetPublicRoot), { recursive: true });
mkdirSync(dirname(destOmafitPublic), { recursive: true });
copyFileSync(src, destWidgetAr);
copyFileSync(src, destWidgetPublicRoot);
copyFileSync(src, destOmafitPublic);
console.log("[sync-ar-widget]", src, "→", destWidgetAr);
console.log("[sync-ar-widget]", src, "→", destWidgetPublicRoot);
console.log("[sync-ar-widget]", src, "→", destOmafitPublic);
