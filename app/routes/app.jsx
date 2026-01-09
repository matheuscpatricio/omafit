import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { 
    apiKey: process.env.SHOPIFY_API_KEY || "",
    // Expor variáveis do Supabase para o frontend (anon key é pública, então é seguro)
    supabaseUrl: process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "",
    supabaseKey: process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ""
  };
};

export default function App() {
  const { apiKey, supabaseUrl, supabaseKey } = useLoaderData();

  // Expor variáveis do Supabase para o frontend via window.ENV
  if (typeof window !== 'undefined') {
    window.ENV = window.ENV || {};
    window.ENV.VITE_SUPABASE_URL = supabaseUrl;
    window.ENV.VITE_SUPABASE_ANON_KEY = supabaseKey;
  }

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Home</s-link>
        <s-link href="/app/billing">Billing</s-link>
        <s-link href="/app/widget">Widget</s-link>
        <s-link href="/app/size-chart">Tabelas de Medidas</s-link>
        <s-link href="/app/analytics">Analytics</s-link>
      </s-app-nav>
      <Outlet />
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
