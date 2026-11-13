import { useEffect, useRef, useState } from "react";
import { Link as RouterLink, useFetcher, useLoaderData, useRevalidator, useSearchParams } from "react-router-dom";
import { redirect } from "react-router";
import { Buffer } from "node:buffer";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  TextField,
  Button,
  Banner,
  Checkbox,
  DataTable,
  Badge,
  Link,
  List,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { ensureShopHasActiveBilling } from "../billing-access.server";
import { useAppI18n } from "../contexts/AppI18n";
import { shopHasWhatsappMarketingAccess } from "../shop-whatsapp-marketing-access.server.js";
import {
  getKlaviyoAdminState,
  saveKlaviyoSettings,
  testStoredOrNewKlaviyo,
} from "../shop-klaviyo.server.js";

const KLAVIYO_KEYS_URL = "https://www.klaviyo.com/settings/account/api-keys";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const check = await ensureShopHasActiveBilling(admin, session.shop);
  if (!check.active) {
    const url = new URL(request.url);
    const hostFromQuery = url.searchParams.get("host") || "";
    const embeddedFromQuery = url.searchParams.get("embedded") || "";
    const shopHandle = String(session.shop || "").replace(/\.myshopify\.com$/i, "");
    const derivedHost = shopHandle
      ? Buffer.from(`admin.shopify.com/store/${shopHandle}`, "utf8").toString("base64")
      : "";
    const qs = new URLSearchParams();
    if (session.shop) qs.set("shop", session.shop);
    if (hostFromQuery || derivedHost) qs.set("host", hostFromQuery || derivedHost);
    if (embeddedFromQuery) qs.set("embedded", embeddedFromQuery);
    return redirect(`/app/billing?${qs.toString()}`);
  }

  const hasAccess = await shopHasWhatsappMarketingAccess(session.shop);
  if (!hasAccess) {
    return { hasAccess: false, schemaMissing: false, serviceMissing: false, loadFailed: false, settings: null, leads: [], leadsLimited: false };
  }

  const state = await getKlaviyoAdminState(session.shop);
  return { hasAccess: true, ...state };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const hasAccess = await shopHasWhatsappMarketingAccess(session.shop);
  if (!hasAccess) return { ok: false, error: "plan" };

  const form = await request.formData();
  const intent = String(form.get("intent") || "save");
  const apiKey = String(form.get("apiKey") || "");
  const listId = String(form.get("listId") || "");
  const enabled = String(form.get("enabled") || "") === "1";

  try {
    if (intent === "test") {
      const result = await testStoredOrNewKlaviyo(session.shop, { apiKey, listId });
      return { ok: Boolean(result.ok), error: result.error || null, intent, accountName: result.accountName || "" };
    }
    const result = await saveKlaviyoSettings(session.shop, { apiKey, listId, enabled });
    return {
      ok: Boolean(result.ok),
      error: result.error || null,
      intent: "save",
      accountName: result.accountName || "",
      enabled: result.enabled,
    };
  } catch (error) {
    return { ok: false, error: error?.code || "save_failed", intent };
  }
};

function statusBadge(status, t) {
  if (status === "synced") return <Badge tone="success">{t("tryOnMarketing.statusSynced")}</Badge>;
  if (status === "error") return <Badge tone="critical">{t("tryOnMarketing.statusError")}</Badge>;
  return <Badge>{t("tryOnMarketing.statusStored")}</Badge>;
}

export default function TryOnMarketingPage() {
  const data = useLoaderData();
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const [searchParams] = useSearchParams();
  const { t, locale } = useAppI18n();
  const settings = data.settings;
  const [apiKey, setApiKey] = useState("");
  const [listId, setListId] = useState(settings?.listId || "");
  const [enabled, setEnabled] = useState(settings ? settings.enabled : true);
  const handledSave = useRef(null);

  useEffect(() => {
    if (!fetcher.data?.ok || fetcher.data.intent !== "save") return;
    if (handledSave.current === fetcher.data) return;
    handledSave.current = fetcher.data;
    setApiKey("");
    revalidator.revalidate();
  }, [fetcher.data, revalidator]);

  if (!data.hasAccess) {
    return (
      <Page title={t("tryOnMarketing.title")}>
        <Layout>
          <Layout.Section>
            <Banner tone="warning">
              <p>
                {t("tryOnMarketing.pilotLocked")}{" "}
                <RouterLink to={`/app/billing${searchParams.toString() ? `?${searchParams.toString()}` : ""}`}>
                  {t("tryOnMarketing.viewPlans")}
                </RouterLink>
              </p>
            </Banner>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const result = fetcher.data;
  const errorCode = result && !result.ok ? result.error : data.serviceMissing ? "supabase_service_missing" : null;
  const busy = fetcher.state !== "idle";

  function submit(intent) {
    const form = new FormData();
    form.set("intent", intent);
    form.set("apiKey", apiKey);
    form.set("listId", listId);
    form.set("enabled", enabled ? "1" : "0");
    fetcher.submit(form, { method: "post" });
  }

  const rows = (data.leads || []).map((lead) => {
    const when = lead.created_at ? new Date(lead.created_at) : null;
    const whenLabel = when && !Number.isNaN(when.getTime()) ? when.toLocaleString(locale) : "—";
    const title = lead.product_title || lead.product_handle || "—";
    const product =
      lead.product_url && /^https?:\/\//i.test(lead.product_url) ? (
        <Link url={lead.product_url} target="_blank">
          {title}
        </Link>
      ) : (
        title
      );
    return [lead.email, product, whenLabel, statusBadge(lead.klaviyo_status, t)];
  });

  return (
    <Page title={t("tryOnMarketing.title")} subtitle={t("tryOnMarketing.subtitle")}>
      <Layout>
        {data.schemaMissing ? (
          <Layout.Section>
            <Banner tone="warning">{t("tryOnMarketing.schemaMissing")}</Banner>
          </Layout.Section>
        ) : null}
        {data.loadFailed ? (
          <Layout.Section>
            <Banner tone="critical">{t("tryOnMarketing.loadError")}</Banner>
          </Layout.Section>
        ) : null}
        {errorCode ? (
          <Layout.Section>
            <Banner tone="critical">
              {t(`tryOnMarketing.errors.${errorCode}`)}
            </Banner>
          </Layout.Section>
        ) : null}
        {result?.ok && result.intent === "save" ? (
          <Layout.Section>
            <Banner tone="success">
              {result.enabled === false ? t("tryOnMarketing.savedDisabled") : t("tryOnMarketing.saved")}
            </Banner>
          </Layout.Section>
        ) : null}
        {result?.ok && result.intent === "test" ? (
          <Layout.Section>
            <Banner tone="success">
              {t("tryOnMarketing.testOk", {
                account: result.accountName ? ` — ${result.accountName}` : "",
              })}
            </Banner>
          </Layout.Section>
        ) : null}

        <Layout.Section>
          <Banner tone="info">{t("tryOnMarketing.introHelp")}</Banner>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                {t("tryOnMarketing.connectionTitle")}
              </Text>
              {settings?.connected ? (
                <Banner tone="success">
                  {t("tryOnMarketing.connected", {
                    account: settings.accountName || "Klaviyo",
                  })}
                  {settings.keyLast4
                    ? ` ${t("tryOnMarketing.keySaved", { last4: settings.keyLast4 })}`
                    : ""}
                </Banner>
              ) : null}
              {enabled && !listId.trim() ? <Banner tone="warning">{t("tryOnMarketing.noListWarning")}</Banner> : null}
              <TextField
                label={t("tryOnMarketing.apiKey")}
                helpText={t("tryOnMarketing.apiKeyHelp")}
                type="password"
                autoComplete="off"
                value={apiKey}
                placeholder={settings?.connected ? t("tryOnMarketing.apiKeyPlaceholder") : "pk_..."}
                onChange={setApiKey}
              />
              <TextField
                label={t("tryOnMarketing.listId")}
                helpText={t("tryOnMarketing.listIdHelp")}
                autoComplete="off"
                value={listId}
                onChange={setListId}
              />
              <Checkbox label={t("tryOnMarketing.enabled")} checked={enabled} onChange={setEnabled} />
              <InlineStack gap="200">
                <Button variant="primary" loading={busy} onClick={() => submit("save")}>
                  {t("tryOnMarketing.save")}
                </Button>
                <Button loading={busy} onClick={() => submit("test")}>
                  {t("tryOnMarketing.test")}
                </Button>
                <Button url={KLAVIYO_KEYS_URL} target="_blank">
                  {t("tryOnMarketing.openKlaviyo")}
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                {t("tryOnMarketing.flowTitle")}
              </Text>
              <List type="number">
                <List.Item>{t("tryOnMarketing.flowStep1")}</List.Item>
                <List.Item>{t("tryOnMarketing.flowStep2")}</List.Item>
                <List.Item>{t("tryOnMarketing.flowStep3")}</List.Item>
              </List>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                {t("tryOnMarketing.leadsTitle")}
              </Text>
              {rows.length ? (
                <DataTable
                  columnContentTypes={["text", "text", "text", "text"]}
                  headings={[
                    t("tryOnMarketing.colEmail"),
                    t("tryOnMarketing.colProduct"),
                    t("tryOnMarketing.colWhen"),
                    t("tryOnMarketing.colStatus"),
                  ]}
                  rows={rows}
                />
              ) : (
                <Text as="p" tone="subdued">
                  {t("tryOnMarketing.leadsEmpty")}
                </Text>
              )}
              {data.leadsLimited ? (
                <Text as="p" tone="subdued">
                  {t("tryOnMarketing.leadsLimit")}
                </Text>
              ) : null}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
