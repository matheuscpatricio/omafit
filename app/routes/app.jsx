import { Outlet, useLoaderData, useRouteError, useLocation, redirect } from "react-router";
import { Buffer } from "node:buffer";
import process from "node:process";
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

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const hasHostParam = Boolean(url.searchParams.get("host"));
  if (!hasHostParam && session?.shop) {
    const shopHandle = String(session.shop).replace(/\.myshopify\.com$/i, "");
    const host = Buffer.from(`admin.shopify.com/store/${shopHandle}`, "utf8").toString("base64");
    url.searchParams.set("shop", session.shop);
    url.searchParams.set("host", host);
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

  let locale = "en";
  try {
    const response = await admin.graphql(SHOP_LOCALE_QUERY);
    const json = await response.json();
    const primaryLocale = json?.data?.shop?.primaryLocale;
    if (primaryLocale) {
      locale = primaryLocale;
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
  return (
    <s-app-nav>
      <s-link href={`/app${search}`}>{t("nav.home")}</s-link>
      <s-link href={`/app/billing${search}`}>{t("nav.billing")}</s-link>
      <s-link href={`/app/widget${search}`}>{t("nav.widget")}</s-link>
      <s-link href={`/app/size-chart${search}`}>{t("nav.sizeChart")}</s-link>
      <s-link href={`/app/analytics${search}`}>{t("nav.analytics")}</s-link>
    </s-app-nav>
  );
}

export default function App() {
  const { apiKey, supabaseUrl, supabaseKey, appUrl, locale } = useLoaderData();

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
