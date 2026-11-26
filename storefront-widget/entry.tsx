/**
 * Entrada da vitrine embutida. Monta as mesmas páginas do omafit-widget
 * (`/widget` e `/widget-shoes`) sem o site, o admin nem o router do Netlify.
 * O tema injeta `window.__OMAFIT_SEARCH__`, `__OMAFIT_PATH__` e
 * `__OMAFIT_AR_MODULE_URL__` antes deste módulo.
 */
import { createRoot } from "react-dom/client";
import { WidgetPage } from "@omafit-widget/components/WidgetPage";
import { ShoeARWidgetPage } from "@omafit-widget/components/ShoeARWidgetPage";
import "@omafit-widget/index.css";

function embedPath(): string {
  const injected = (window as Window & { __OMAFIT_PATH__?: string }).__OMAFIT_PATH__;
  if (typeof injected === "string" && injected.trim()) return injected;
  return window.location.pathname || "/widget";
}

function embedSearch(): string {
  const injected = (window as Window & { __OMAFIT_SEARCH__?: string }).__OMAFIT_SEARCH__;
  if (typeof injected === "string" && injected.length) return injected;
  return window.location.search || "";
}

const path = embedPath();
const search = embedSearch();
const shoes =
  path.indexOf("widget-shoes") !== -1 ||
  new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("omafit_surface") === "shoes";

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(shoes ? <ShoeARWidgetPage /> : <WidgetPage />);
}
