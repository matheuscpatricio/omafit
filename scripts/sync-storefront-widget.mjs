/* eslint-env node */
/**
 * Reconstrói a cópia da vitrine embutida a partir do omafit-widget (branch main).
 * Não altera o repositório omafit-widget.
 *
 * Uso:
 *   VITE_OMAFIT_APP_URL=https://omafit-production.up.railway.app \
 *   VITE_OMAFIT_WIDGET_HMAC_SECRET='o mesmo valor do build do Netlify' \
 *   npm run sync:storefront-widget
 *
 * Opcional:
 *   OMAFIT_WIDGET_DIR=/caminho/do/clone   (se omitido, clona em um diretório temporário)
 *   OMAFIT_WIDGET_REF=main
 *
 * Saída: extensions/omafit-theme/assets/omafit-storefront*.js|css
 *        scripts/storefront-widget.manifest.json
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const assetDir = path.join(repoRoot, "extensions", "omafit-theme", "assets");
const outDir = path.join(os.tmpdir(), "omafit-storefront-dist");
const widgetRepo = "https://github.com/matheuscpatricio/omafit-widget.git";
const ref = process.env.OMAFIT_WIDGET_REF || "main";

function run(cmd, args, cwd) {
  execFileSync(cmd, args, { cwd, stdio: "inherit", env: process.env });
}

function resolveWidgetDir() {
  if (process.env.OMAFIT_WIDGET_DIR) {
    return path.resolve(process.env.OMAFIT_WIDGET_DIR);
  }
  const dest = path.join(os.tmpdir(), "omafit-widget-sync");
  fs.rmSync(dest, { recursive: true, force: true });
  run("git", ["clone", "--depth", "1", "--branch", ref, widgetRepo, dest]);
  return dest;
}

if (!process.env.VITE_OMAFIT_APP_URL || !process.env.VITE_OMAFIT_WIDGET_HMAC_SECRET) {
  console.warn(
    "[sync-storefront-widget] Defina VITE_OMAFIT_APP_URL e VITE_OMAFIT_WIDGET_HMAC_SECRET com os mesmos valores do build do Netlify. Sem o segredo, a busca do catálogo no provador não assina igual à versão publicada.",
  );
}

const widgetDir = resolveWidgetDir();
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: widgetDir, encoding: "utf8" }).trim();
console.log("[sync-storefront-widget] fonte", commit);

if (!fs.existsSync(path.join(widgetDir, "node_modules", "vite"))) {
  run("npm", ["ci", "--no-audit", "--no-fund", "--ignore-scripts"], widgetDir);
}

process.env.OMAFIT_WIDGET_DIR = widgetDir;
process.env.OMAFIT_STOREFRONT_OUT = outDir;
run(process.execPath, [path.join(widgetDir, "node_modules", "vite", "bin", "vite.js"), "build", "--config", path.join(here, "storefront-widget.vite.config.mjs")], widgetDir);

const names = fs
  .readdirSync(outDir)
  .filter((name) => name.startsWith("omafit-storefront"));
if (!names.includes("omafit-storefront.js") || !names.some((name) => name.endsWith(".css"))) {
  throw new Error("Build da vitrine incompleto: falta o JS ou o CSS de entrada.");
}
const files = {};
for (const name of names) {
  const from = path.join(outDir, name);
  const dest = path.join(assetDir, name);
  fs.copyFileSync(from, dest);
  files[name] = fs.statSync(dest).size;
}
for (const existing of fs.readdirSync(assetDir)) {
  if (existing.startsWith("omafit-storefront") && !names.includes(existing)) {
    fs.rmSync(path.join(assetDir, existing));
  }
}

const manifest = {
  sourceRepo: widgetRepo,
  sourceRef: ref,
  sourceCommit: commit,
  builtAt: new Date().toISOString(),
  files,
};
fs.writeFileSync(path.join(here, "storefront-widget.manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log("[sync-storefront-widget] copiado", files);
