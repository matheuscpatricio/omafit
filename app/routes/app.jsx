import {
  Outlet,
  useLoaderData,
  useRouteError,
  useLocation,
  redirect,
  Link,
} from "react-router";
import process from "node:process";
import { useEffect } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import ptBRTranslations from "@shopify/polaris/locales/pt-BR.json";
import esTranslations from "@shopify/polaris/locales/es.json";
import { authenticate, registerWebhooks } from "../shopify.server";
import { syncBillingFromShopify } from "../billing-sync.server";
import { AppI18nProvider, useAppI18n } from "../contexts/AppI18n";

const SHOP_LOCALE_QUERY = `#graphql
  query ShopPrimaryLocale {
    shop {
      primaryLocale
    }
  }
`;

function normalizeSupportedLocale(rawLocale) {
  const value = String(rawLocale || "").trim().toLowerCase();
  if (!value) return "en";
  if (value.startsWith("pt")) return "pt-BR";
  if (value.startsWith("es")) return "es";
  return "en";
}

function toBase64Url(input) {
  const base64 =
    typeof window !== "undefined" && typeof window.btoa === "function"
      ? window.btoa(input)
      : typeof globalThis !== "undefined" && globalThis.Buffer
        ? globalThis.Buffer.from(input, "utf8").toString("base64")
        : "";
  return base64
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function deriveEmbeddedHost(shop) {
  const shopHandle = String(shop || "").replace(/\.myshopify\.com$/i, "");
  if (!shopHandle) return "";
  return toBase64Url(`admin.shopify.com/store/${shopHandle}`);
}

function isValidEmbeddedHost(hostValue) {
  const raw = String(hostValue || "").trim();
  if (!raw) return false;
  try {
    const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - (normalized.length % 4)) % 4;
    const padded = normalized + "=".repeat(padLen);
    const decoded =
      typeof window !== "undefined" && typeof window.atob === "function"
        ? window.atob(padded)
        : typeof globalThis !== "undefined" && globalThis.Buffer
          ? globalThis.Buffer.from(padded, "base64").toString("utf8")
          : "";
    return /^admin\.shopify\.com\/store\/[a-z0-9-]+$/i.test(decoded);
  } catch (_err) {
    return false;
  }
}

function deriveEmbeddedHostClient(shop) {
  const shopHandle = String(shop || "").replace(/\.myshopify\.com$/i, "");
  if (!shopHandle) return "";
  const raw = `admin.shopify.com/store/${shopHandle}`;
  try {
    if (typeof window !== "undefined" && typeof window.btoa === "function") {
      return window
        .btoa(raw)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
    }
  } catch (_err) {
    // fallback below
  }
  return toBase64Url(raw);
}

/** Evita reload quando só a ordem dos query params difere (URLSearchParams pode reordenar). */
function areSearchParamsEquivalent(a, b) {
  const pa = new URLSearchParams(a.startsWith("?") ? a.slice(1) : a);
  const pb = new URLSearchParams(b.startsWith("?") ? b.slice(1) : b);
  if (pa.size !== pb.size) return false;
  for (const [key, value] of pa.entries()) {
    if (pb.get(key) !== value) return false;
  }
  return true;
}

function pickPreferredLocaleFromRequest(request, session) {
  const url = new URL(request.url);
  const localeFromQuery = url.searchParams.get("locale");
  if (localeFromQuery) {
    return normalizeSupportedLocale(localeFromQuery);
  }

  const localeFromSession = session?.locale || session?.user?.locale || "";
  if (localeFromSession) {
    return normalizeSupportedLocale(localeFromSession);
  }

  const acceptLanguage = request.headers.get("accept-language") || "";
  if (acceptLanguage) {
    const first = acceptLanguage.split(",")[0] || "";
    return normalizeSupportedLocale(first);
  }

  return null;
}

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const incomingHost = url.searchParams.get("host") || "";
  const hasValidHostParam = isValidEmbeddedHost(incomingHost);
  const hasEmbeddedParam = url.searchParams.get("embedded") === "1";
  if (((!hasValidHostParam || !incomingHost) || !hasEmbeddedParam) && session?.shop) {
    const host = deriveEmbeddedHost(session.shop);
    url.searchParams.set("shop", session.shop);
    if (host) url.searchParams.set("host", host);
    url.searchParams.set("embedded", "1");
    return redirect(`${url.pathname}?${url.searchParams.toString()}`);
  }

  // Garante webhooks ativos mesmo em instalações antigas (sem precisar reinstalar).
  try {
    await registerWebhooks({ session });
  } catch (e) {
    console.warn("[App] Webhook registration failed:", e);
  }

  // Sincroniza o plano da Shopify com o Supabase ao abrir o admin (assim o app reflete o plano real, mesmo se assinou fora do admin)
  try {
    await syncBillingFromShopify(admin, session.shop);
  } catch (e) {
    console.warn("[App] Billing sync failed:", e);
  }

  let locale = pickPreferredLocaleFromRequest(request, session) || "en";
  try {
    // Fallback final: locale primário da loja (apenas se não houver locale do usuário/request).
    if (!pickPreferredLocaleFromRequest(request, session)) {
      const response = await admin.graphql(SHOP_LOCALE_QUERY);
      const json = await response.json();
      const primaryLocale = json?.data?.shop?.primaryLocale;
      if (primaryLocale) {
        locale = normalizeSupportedLocale(primaryLocale);
      }
    }
  } catch (e) {
    console.warn("[App] Could not fetch shop locale, using en:", e);
  }

  const appUrl = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    supabaseUrl: process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "",
    supabaseKey: process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "",
    appUrl: appUrl || "",
    locale,
  };
};

function AppNav() {
  const { t } = useAppI18n();
  const location = useLocation();
  const search = location.search || "";
  // React Router <Link> evita reload completo do iframe; <s-link> pode forçar navegação documento inteiro.
  const navLinkStyle = { textDecoration: "none", color: "inherit" };
  return (
    <s-app-nav>
      <Link to={`/app${search}`} style={navLinkStyle}>
        {t("nav.home")}
      </Link>
      <Link to={`/app/billing${search}`} style={navLinkStyle}>
        {t("nav.billing")}
      </Link>
      <Link to={`/app/widget${search}`} style={navLinkStyle}>
        {t("nav.widget")}
      </Link>
      <Link to={`/app/size-chart${search}`} style={navLinkStyle}>
        {t("nav.sizeChart")}
      </Link>
      <Link to={`/app/analytics${search}`} style={navLinkStyle}>
        {t("nav.analytics")}
      </Link>
      <Link to={`/app/ar-eyewear${search}`} style={navLinkStyle}>
        {t("nav.arEyewear")}
      </Link>
    </s-app-nav>
  );
}

export default function App() {
  const { apiKey, supabaseUrl, supabaseKey, appUrl, locale } = useLoaderData();
  const location = useLocation();

  const effectiveLocale = locale;
  const polarisLocale =
    effectiveLocale && effectiveLocale.toLowerCase().startsWith("pt")
      ? ptBRTranslations
      : effectiveLocale && effectiveLocale.toLowerCase().startsWith("es")
        ? esTranslations
        : enTranslations;

  if (typeof window !== "undefined") {
    window.ENV = window.ENV || {};
    window.ENV.VITE_SUPABASE_URL = supabaseUrl;
    window.ENV.VITE_SUPABASE_ANON_KEY = supabaseKey;
    window.ENV.APP_URL = appUrl;
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const host = url.searchParams.get("host") || "";
    const embedded = url.searchParams.get("embedded") || "";
    const shop = url.searchParams.get("shop") || "";
    const hasValidHost = isValidEmbeddedHost(host);
    const hasEmbedded = embedded === "1";

    // Blindagem final: se perder contexto embedded, corrige URL imediatamente.
    if ((!hasValidHost || !hasEmbedded) && shop) {
      const correctedHost = deriveEmbeddedHostClient(shop);
      if (correctedHost) url.searchParams.set("host", correctedHost);
      url.searchParams.set("embedded", "1");
      const next = `${url.pathname}?${url.searchParams.toString()}`;
      const current = `${window.location.pathname}${window.location.search}`;
      const samePath = url.pathname === window.location.pathname;
      const sameParams = areSearchParamsEquivalent(
        url.search,
        window.location.search || "",
      );
      if (!(samePath && sameParams)) {
        window.location.replace(next);
      }
    }
  }, [location.key]);

  return (
    <AppProvider embedded apiKey={apiKey}>
      <PolarisAppProvider i18n={polarisLocale}>
        <AppI18nProvider locale={effectiveLocale}>
          <AppNav />
          <Outlet />
        </AppI18nProvider>
      </PolarisAppProvider>
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
