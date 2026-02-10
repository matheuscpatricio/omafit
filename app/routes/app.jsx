import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import ptBRTranslations from "@shopify/polaris/locales/pt-BR.json";
import { authenticate } from "../shopify.server";
import { AppI18nProvider, useAppI18n } from "../contexts/AppI18n";

const SHOP_LOCALE_QUERY = `#graphql
  query ShopPrimaryLocale {
    shop {
      primaryLocale
    }
  }
`;

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

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

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    supabaseUrl: process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "",
    supabaseKey: process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "",
    locale,
  };
};

function AppNav() {
  const { t } = useAppI18n();
  return (
    <s-app-nav>
      <s-link href="/app">{t("nav.home")}</s-link>
      <s-link href="/app/billing">{t("nav.billing")}</s-link>
      <s-link href="/app/widget">{t("nav.widget")}</s-link>
      <s-link href="/app/size-chart">{t("nav.sizeChart")}</s-link>
      <s-link href="/app/analytics">{t("nav.analytics")}</s-link>
    </s-app-nav>
  );
}

export default function App() {
  const { apiKey, supabaseUrl, supabaseKey, locale } = useLoaderData();

  const polarisLocale = locale && locale.toLowerCase().startsWith("pt") ? ptBRTranslations : enTranslations;

  if (typeof window !== "undefined") {
    window.ENV = window.ENV || {};
    window.ENV.VITE_SUPABASE_URL = supabaseUrl;
    window.ENV.VITE_SUPABASE_ANON_KEY = supabaseKey;
  }

  return (
    <AppProvider embedded apiKey={apiKey}>
      <PolarisAppProvider i18n={polarisLocale}>
        <AppI18nProvider locale={locale}>
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
