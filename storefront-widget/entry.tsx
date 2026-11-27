/**
 * Entrada da vitrine embutida. O tema injeta `window.__OMAFIT_SEARCH__`,
 * `__OMAFIT_PATH__` e `__OMAFIT_AR_MODULE_URL__` antes deste módulo.
 * Roupa e calçado são arquivos separados: só o fluxo escolhido é baixado.
 */
import { createRoot } from "react-dom/client";
import type { ComponentType } from "react";
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

function isShoes(path: string, search: string): boolean {
  if (path.indexOf("widget-shoes") !== -1) return true;
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return params.get("omafit_surface") === "shoes";
}

async function mount(): Promise<void> {
  const rootEl = document.getElementById("root");
  if (!rootEl) return;
  const path = embedPath();
  const search = embedSearch();
  let Page: ComponentType;
  if (isShoes(path, search)) {
    const mod = await import("@omafit-widget/components/ShoeARWidgetPage");
    Page = mod.ShoeARWidgetPage;
  } else {
    const mod = await import("@omafit-widget/components/WidgetPage");
    Page = mod.WidgetPage;
  }
  createRoot(rootEl).render(<Page />);
  try {
    window.parent.postMessage({ type: "omafit-embed-ready" }, "*");
  } catch {
    /* a página da loja segue com o spinner até o load do iframe */
  }
}

void mount();
