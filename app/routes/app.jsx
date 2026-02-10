import { createContext, useContext, useState, useEffect } from "react";
import { Outlet, useLoaderData, useRouteError, useLocation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import ptBRTranslations from "@shopify/polaris/locales/pt-BR.json";
import esTranslations from "@shopify/polaris/locales/es.json";
import { authenticate } from "../shopify.server";
import { syncBillingFromShopify } from "../billing-sync.server";
import { AppI18nProvider, useAppI18n } from "../contexts/AppI18n";

const LOCALE_STORAGE_KEY = "omafit_locale";
const LocaleOverrideContext = createContext({ setLocaleOverride: () => {} });

export function useLocaleOverride() {
  return useContext(LocaleOverrideContext);
}

const SHOP_LOCALE_QUERY = `#graphql
  query ShopPrimaryLocale {
    shop {
      primaryLocale
    }
  }
`;

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

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
  const [localeOverride, setLocaleOverrideState] = useState(null);

  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage?.getItem(LOCALE_STORAGE_KEY) : null;
    if (stored === "en" || stored === "pt-BR" || stored === "es") setLocaleOverrideState(stored);
  }, []);

  const setLocaleOverride = (value) => {
    if (typeof window !== "undefined" && value) window.localStorage?.setItem(LOCALE_STORAGE_KEY, value);
    setLocaleOverrideState(value);
  };

  const effectiveLocale = localeOverride ?? locale;
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
        <LocaleOverrideContext.Provider value={{ setLocaleOverride }}>
          <AppI18nProvider locale={effectiveLocale}>
            <AppNav />
            <Outlet />
          </AppI18nProvider>
        </LocaleOverrideContext.Provider>
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
