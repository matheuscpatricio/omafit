/* eslint-env node */
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const widgetRoot = path.resolve(process.env.OMAFIT_WIDGET_DIR || "/tmp/omafit-widget");
const outDir = path.resolve(process.env.OMAFIT_STOREFRONT_OUT || "/tmp/omafit-storefront-dist");

const { defineConfig } = await import(pathToFileURL(path.join(widgetRoot, "node_modules/vite/dist/node/index.js")).href);
const reactMod = await import(pathToFileURL(path.join(widgetRoot, "node_modules/@vitejs/plugin-react/dist/index.js")).href);
const react = reactMod.default;

function embedRuntimePlugin() {
  return {
    name: "omafit-embed-runtime",
    transform(code, id) {
      if (!/\.(tsx|ts|jsx|js)$/.test(id) || id.includes("node_modules")) return null;
      let next = code.replace(
        /buildArModuleUrl\(\s*window\.location\.origin\s*,\s*([^)]+)\)/g,
        "(window.__OMAFIT_AR_MODULE_URL__||buildArModuleUrl(window.location.origin, $1))",
      );
      next = next.replace(
        /\bwindow\.location\.search\b/g,
        "(window.__OMAFIT_SEARCH__||window.location.search)",
      );
      if (next === code) return null;
      return { code: next, map: null };
    },
  };
}

export default defineConfig({
  root: widgetRoot,
  base: "./",
  publicDir: false,
  plugins: [react(), embedRuntimePlugin()],
  resolve: {
    alias: {
      "@": path.join(widgetRoot, "src"),
      "@omafit-widget": path.join(widgetRoot, "src"),
    },
  },
  build: {
    outDir,
    emptyOutDir: true,
    cssCodeSplit: false,
    sourcemap: false,
    assetsInlineLimit: 8192,
    rollupOptions: {
      input: path.join(repoRoot, "storefront-widget", "entry.tsx"),
      output: {
        entryFileNames: "omafit-storefront.js",
        chunkFileNames: "omafit-storefront-[name].js",
        assetFileNames: "omafit-storefront-[name][extname]",
      },
    },
  },
  worker: {
    format: "es",
    rollupOptions: {
      output: {
        entryFileNames: "omafit-storefront-mediapipe.worker.js",
      },
    },
  },
});
