import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useLoaderData, Link } from "react-router-dom";
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
  Select,
  Badge,
  DataTable,
  Spinner,
  Collapsible,
  List,
  RangeSlider,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { ensureShopHasActiveBilling } from "../billing-access.server";
import { getShopDomain } from "../utils/getShopDomain";
import { useAppI18n } from "../contexts/AppI18n";
import { shopHasWhatsappMarketingAccess } from "../shop-whatsapp-marketing-access.server.js";

const META_WHATSAPP_MANAGER_URL = "https://business.facebook.com/wa/manage/home/";
const WHATSAPP_MESSAGE_PRICE_USD = 0.07;

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
  const billingPlan = check.row?.plan || null;
  const hasWhatsappMarketingAccess = await shopHasWhatsappMarketingAccess(session.shop);
  return {
    billingPlan,
    hasWhatsappMarketingAccess,
  };
};

async function apiFetch(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api/whatsapp-admin/${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Request failed");
  return json;
}

export default function TryOnMarketingPage() {
  const { hasWhatsappMarketingAccess } = useLoaderData();
  const [searchParams] = useSearchParams();
  const { t } = useAppI18n();
  const shopDomain = getShopDomain(searchParams);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [connection, setConnection] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [collections, setCollections] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [segments, setSegments] = useState([]);

  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [displayPhone, setDisplayPhone] = useState("");

  const [campaignName, setCampaignName] = useState("");
  const [campaignMode, setCampaignMode] = useState("personalized_tryon");
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [selectedCollections, setSelectedCollections] = useState([]);
  const [scheduledAt, setScheduledAt] = useState("");
  const [preview, setPreview] = useState(null);
  const [messageCount, setMessageCount] = useState(1);
  const [showConnectionForm, setShowConnectionForm] = useState(false);
  const [showAdvancedConnection, setShowAdvancedConnection] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showMessages, setShowMessages] = useState(false);

  const collectionOptions = useMemo(
    () => collections.map((c) => ({ label: c.title || c.handle, value: c.handle })),
    [collections],
  );

  const approvedTemplates = useMemo(
    () => (templates || []).filter((tpl) => String(tpl.status || "").toUpperCase() === "APPROVED"),
    [templates],
  );

  const selectedTemplateMeta = useMemo(
    () => approvedTemplates.find((tpl) => tpl.id === selectedTemplate) || approvedTemplates[0] || null,
    [approvedTemplates, selectedTemplate],
  );

  const capturedCustomers = metrics?.opt_in_count ?? 0;
  const maxMessageCount = useMemo(() => {
    if (preview == null) return 0;
    return Math.min(Math.max(0, preview.count ?? 0), capturedCustomers);
  }, [preview, capturedCustomers]);

  const selectedMessageCost = useMemo(
    () => (Number(messageCount) || 0) * WHATSAPP_MESSAGE_PRICE_USD,
    [messageCount],
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [connRes, tplRes, campRes, metricsRes, segRes] = await Promise.all([
        apiFetch("connection").catch(() => ({ connected: false })),
        apiFetch("templates").catch(() => ({ templates: [] })),
        apiFetch("campaigns").catch(() => ({ campaigns: [] })),
        apiFetch("metrics").catch(() => null),
        apiFetch("segments").catch(() => ({ segments: [] })),
      ]);
      setConnection(connRes);
      let loadedTemplates = tplRes.templates || [];
      if (connRes.connected && loadedTemplates.length === 0) {
        try {
          await apiFetch("templates/sync", { method: "POST", body: {} });
          const refreshed = await apiFetch("templates").catch(() => ({ templates: [] }));
          loadedTemplates = refreshed.templates || [];
        } catch {
          /* sync optional on load */
        }
      }
      setTemplates(loadedTemplates);
      setCampaigns(campRes.campaigns || []);
      setMetrics(metricsRes);
      setSegments(segRes.segments || []);

      if (shopDomain) {
        const colRes = await fetch(`/api/collections?shop_domain=${encodeURIComponent(shopDomain)}`);
        const colJson = await colRes.json().catch(() => ({}));
        setCollections(colJson.collections || []);
      }
    } catch (err) {
      setError(err.message || t("tryOnMarketing.loadError"));
    } finally {
      setLoading(false);
    }
  }, [shopDomain, t]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!connection?.connected) {
      setShowConnectionForm(true);
    }
  }, [connection?.connected]);

  useEffect(() => {
    if (approvedTemplates.length > 0 && !selectedTemplate) {
      setSelectedTemplate(approvedTemplates[0].id);
    }
  }, [approvedTemplates, selectedTemplate]);

  useEffect(() => {
    if (preview == null || maxMessageCount < 1) return;
    setMessageCount(maxMessageCount);
  }, [preview, maxMessageCount]);

  const handleConnect = async () => {
    setError(null);
    try {
      await apiFetch("connect", {
        method: "POST",
        body: {
          phone_number_id: phoneNumberId,
          access_token: accessToken,
          waba_id: wabaId || null,
          display_phone: displayPhone || null,
        },
      });
      setNotice(t("tryOnMarketing.connectSuccess"));
      setShowConnectionForm(false);
      await loadAll();
      await handleSyncTemplates();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSyncTemplates = async () => {
    try {
      await apiFetch("templates/sync", { method: "POST", body: {} });
      setNotice(t("tryOnMarketing.messagesSynced"));
      await loadAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const isExistingPhotoMode = campaignMode === "existing_tryon";

  const buildCampaignPayload = () => ({
    filter_json: {
      has_marketing_consent: true,
      has_photo_consent: !isExistingPhotoMode,
      tryon_since_days: 30,
      product_handles: [],
    },
    promoted_collection_handles: selectedCollections,
    generation_mode: campaignMode,
  });

  const handlePreview = async () => {
    if (!isExistingPhotoMode && selectedCollections.length === 0) {
      setError(t("tryOnMarketing.selectCollectionPreview"));
      return;
    }
    try {
      const res = await apiFetch("segments/preview", {
        method: "POST",
        body: buildCampaignPayload(),
      });
      setPreview(res);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCreateCampaign = async () => {
    if (!isExistingPhotoMode && selectedCollections.length === 0) {
      setError(t("tryOnMarketing.selectCollectionCreate"));
      return;
    }
    if (!preview) {
      setError(t("tryOnMarketing.previewRequired"));
      return;
    }
    const count = Number(messageCount);
    if (!Number.isFinite(count) || count < 1) {
      setError(t("tryOnMarketing.messageCountRequired"));
      return;
    }
    if (count > maxMessageCount) {
      setError(t("tryOnMarketing.messageCountExceeded", { max: maxMessageCount }));
      return;
    }
    try {
      let segmentId = segments[0]?.id;
      const segmentFilter = {
        has_marketing_consent: true,
        has_photo_consent: !isExistingPhotoMode,
        tryon_since_days: 30,
      };
      if (!segmentId) {
        const seg = await apiFetch("segments", {
          method: "POST",
          body: {
            name: isExistingPhotoMode
              ? t("tryOnMarketing.segmentDefaultNameExisting")
              : t("tryOnMarketing.segmentDefaultName"),
            filter_json: segmentFilter,
          },
        });
        segmentId = seg.segment?.id;
      }
      await apiFetch("campaigns", {
        method: "POST",
        body: {
          name: campaignName || t("tryOnMarketing.newCampaignTitle"),
          segment_id: segmentId,
          template_id: selectedTemplateMeta?.id || selectedTemplate || null,
          promoted_collection_handles: selectedCollections,
          generation_mode: campaignMode,
          scheduled_at: scheduledAt || null,
          max_recipients: count,
          materialize: true,
          confirm: Boolean(scheduledAt),
        },
      });
      setNotice(t("tryOnMarketing.campaignCreated"));
      setCampaignName("");
      setPreview(null);
      setMessageCount(1);
      await loadAll();
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) {
    return (
      <Page title={t("tryOnMarketing.title")}>
        <InlineStack align="center">
          <Spinner />
        </InlineStack>
      </Page>
    );
  }

  if (!hasWhatsappMarketingAccess) {
    return (
      <Page title={t("tryOnMarketing.title")}>
        <Layout>
          <Layout.Section>
            <Banner tone="warning">
              <p>
                {t("tryOnMarketing.pilotLocked")}{" "}
                <Link to={`/app/billing${searchParams.toString() ? `?${searchParams.toString()}` : ""}`}>
                  {t("tryOnMarketing.viewPlans")}
                </Link>
              </p>
            </Banner>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page title={t("tryOnMarketing.title")} subtitle={t("tryOnMarketing.subtitle")}>
      <Layout>
        {error ? (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => setError(null)}>
              {error}
            </Banner>
          </Layout.Section>
        ) : null}
        {notice ? (
          <Layout.Section>
            <Banner tone="success" onDismiss={() => setNotice(null)}>
              {notice}
            </Banner>
          </Layout.Section>
        ) : null}

        <Layout.Section>
          <Banner tone="info">{t("tryOnMarketing.introHelp")}</Banner>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                {t("tryOnMarketing.connectionTitle")}
              </Text>
              {connection?.connected ? (
                <Banner tone="success">
                  {t("tryOnMarketing.connected", {
                    phone: connection.display_phone || connection.phone_number_id,
                  })}
                </Banner>
              ) : (
                <Text as="p" tone="subdued">
                  {t("tryOnMarketing.connectionHint")}
                </Text>
              )}
              {connection?.connected && !showConnectionForm ? (
                <Button onClick={() => setShowConnectionForm(true)}>{t("tryOnMarketing.changeConnection")}</Button>
              ) : (
                <BlockStack gap="300">
                  <Button url={META_WHATSAPP_MANAGER_URL} external>
                    {t("tryOnMarketing.openMeta")}
                  </Button>
                  <List type="number">
                    <List.Item>{t("tryOnMarketing.connectionStep1")}</List.Item>
                    <List.Item>{t("tryOnMarketing.connectionStep2")}</List.Item>
                    <List.Item>{t("tryOnMarketing.connectionStep3")}</List.Item>
                  </List>
                  <TextField
                    label={t("tryOnMarketing.metaPhoneId")}
                    helpText={t("tryOnMarketing.metaPhoneIdHelp")}
                    value={phoneNumberId}
                    onChange={setPhoneNumberId}
                    autoComplete="off"
                  />
                  <TextField
                    label={t("tryOnMarketing.metaAccessToken")}
                    helpText={t("tryOnMarketing.metaAccessTokenHelp")}
                    value={accessToken}
                    onChange={setAccessToken}
                    type="password"
                    autoComplete="off"
                  />
                  <Button
                    disclosure={showAdvancedConnection ? "up" : "down"}
                    onClick={() => setShowAdvancedConnection((open) => !open)}
                  >
                    {t("tryOnMarketing.advancedSettings")}
                  </Button>
                  <Collapsible open={showAdvancedConnection} id="whatsapp-advanced-connection">
                    <BlockStack gap="300">
                      <TextField
                        label={t("tryOnMarketing.wabaId")}
                        helpText={t("tryOnMarketing.wabaIdHelp")}
                        value={wabaId}
                        onChange={setWabaId}
                        autoComplete="off"
                      />
                      <TextField
                        label={t("tryOnMarketing.displayPhone")}
                        value={displayPhone}
                        onChange={setDisplayPhone}
                        autoComplete="off"
                      />
                    </BlockStack>
                  </Collapsible>
                  <Button variant="primary" onClick={() => void handleConnect()}>
                    {t("tryOnMarketing.saveConnection")}
                  </Button>
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {connection?.connected ? (
          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="300">
                <Button disclosure={showMessages ? "up" : "down"} onClick={() => setShowMessages((open) => !open)}>
                  {t("tryOnMarketing.messagesToggle")}
                </Button>
                <Collapsible open={showMessages} id="whatsapp-messages">
                  <BlockStack gap="300">
                    <InlineStack align="space-between">
                      <Text as="h2" variant="headingMd">
                        {t("tryOnMarketing.messagesTitle")}
                      </Text>
                      <Button onClick={() => void handleSyncTemplates()}>{t("tryOnMarketing.syncMessages")}</Button>
                    </InlineStack>
                    <DataTable
                      columnContentTypes={["text", "text", "text"]}
                      headings={[
                        t("tryOnMarketing.messageName"),
                        t("tryOnMarketing.messageLanguage"),
                        t("tryOnMarketing.messageStatus"),
                      ]}
                      rows={(templates || []).map((tpl) => [tpl.name, tpl.language, tpl.status])}
                    />
                  </BlockStack>
                </Collapsible>
              </BlockStack>
            </Card>
          </Layout.Section>
        ) : null}

        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                {t("tryOnMarketing.metricsTitle")}
              </Text>
              <InlineStack gap="400">
                <Badge tone="info">{`${t("tryOnMarketing.metricsCustomers")}: ${metrics?.opt_in_count ?? 0}`}</Badge>
                <Badge>{`${t("tryOnMarketing.metricsCampaigns")}: ${metrics?.campaigns_total ?? 0}`}</Badge>
                <Badge tone="success">{`${t("tryOnMarketing.metricsDelivered")}: ${metrics?.messages_delivered ?? 0}`}</Badge>
              </InlineStack>
              <Text as="p" tone="subdued">
                {t("tryOnMarketing.metricsCost", {
                  amount: Number(metrics?.estimated_cost_usd ?? 0).toFixed(2),
                })}
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                {t("tryOnMarketing.newCampaignTitle")}
              </Text>
              <Banner tone="info">
                {isExistingPhotoMode ? t("tryOnMarketing.campaignHintExisting") : t("tryOnMarketing.campaignHint")}
              </Banner>
              <Select
                label={t("tryOnMarketing.campaignType")}
                options={[
                  {
                    label: t("tryOnMarketing.campaignTypeNewCollection"),
                    value: "personalized_tryon",
                  },
                  {
                    label: t("tryOnMarketing.campaignTypeExisting"),
                    value: "existing_tryon",
                  },
                ]}
                value={campaignMode}
                onChange={(value) => {
                  setCampaignMode(value);
                  setPreview(null);
                  setMessageCount(1);
                }}
              />
              <Select
                label={isExistingPhotoMode ? t("tryOnMarketing.collectionFilterOptional") : t("tryOnMarketing.collection")}
                helpText={isExistingPhotoMode ? undefined : t("tryOnMarketing.collectionHelp")}
                options={[
                  {
                    label: isExistingPhotoMode
                      ? t("tryOnMarketing.selectCollectionOptional")
                      : t("tryOnMarketing.selectOption"),
                    value: "",
                  },
                  ...collectionOptions,
                ]}
                value={selectedCollections[0] || ""}
                onChange={(value) => {
                  setSelectedCollections(value ? [value] : []);
                  setPreview(null);
                  setMessageCount(1);
                }}
              />
              <TextField
                label={t("tryOnMarketing.campaignName")}
                value={campaignName}
                onChange={setCampaignName}
                placeholder={t("tryOnMarketing.campaignNamePlaceholder")}
                autoComplete="off"
              />
              {approvedTemplates.length > 1 ? (
                <Select
                  label={t("tryOnMarketing.message")}
                  options={approvedTemplates.map((tpl) => ({ label: tpl.name, value: tpl.id }))}
                  value={selectedTemplate}
                  onChange={setSelectedTemplate}
                />
              ) : selectedTemplateMeta ? (
                <Text as="p" tone="subdued">
                  {t("tryOnMarketing.autoMessage", { name: selectedTemplateMeta.name })}
                </Text>
              ) : (
                <Banner tone="warning">{t("tryOnMarketing.noApprovedMessage")}</Banner>
              )}
              <Button disclosure={showSchedule ? "up" : "down"} onClick={() => setShowSchedule((open) => !open)}>
                {t("tryOnMarketing.scheduleToggle")}
              </Button>
              <Collapsible open={showSchedule} id="whatsapp-campaign-schedule">
                <TextField
                  label={t("tryOnMarketing.schedule")}
                  value={scheduledAt}
                  onChange={setScheduledAt}
                  placeholder={t("tryOnMarketing.schedulePlaceholder")}
                  autoComplete="off"
                />
              </Collapsible>
              <Button onClick={() => void handlePreview()}>{t("tryOnMarketing.previewAudience")}</Button>
              {preview != null ? (
                <BlockStack gap="300">
                  {maxMessageCount > 0 ? (
                    <RangeSlider
                      label={t("tryOnMarketing.messageCount")}
                      helpText={t("tryOnMarketing.messageCountHelp", {
                        max: capturedCustomers,
                        eligible: preview.count ?? 0,
                      })}
                      min={1}
                      max={maxMessageCount}
                      value={Math.min(Math.max(1, messageCount), maxMessageCount)}
                      onChange={setMessageCount}
                      output
                    />
                  ) : (
                    <Banner tone="warning">{t("tryOnMarketing.noEligibleCustomers")}</Banner>
                  )}
                  <Text as="span" tone="subdued" variant="bodySm">
                    {t(
                      isExistingPhotoMode ? "tryOnMarketing.previewCostExisting" : "tryOnMarketing.previewCost",
                      { cost: selectedMessageCost.toFixed(2) },
                    )}
                    {!isExistingPhotoMode &&
                    preview.base_opt_in_count != null &&
                    preview.count !== preview.base_opt_in_count
                      ? ` ${t("tryOnMarketing.previewFiltered", {
                          total: preview.base_opt_in_count ?? 0,
                          excluded: (preview.base_opt_in_count ?? 0) - (preview.count ?? 0),
                        })}`
                      : ""}
                  </Text>
                </BlockStack>
              ) : (
                <Text as="p" tone="subdued" variant="bodySm">
                  {t("tryOnMarketing.messageCountHint", { max: capturedCustomers })}
                </Text>
              )}
              <InlineStack gap="200" blockAlign="center">
                <Button
                  variant="primary"
                  onClick={() => void handleCreateCampaign()}
                  disabled={!preview || maxMessageCount < 1}
                >
                  {t("tryOnMarketing.createCampaign")}
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                {t("tryOnMarketing.campaignsTitle")}
              </Text>
              <DataTable
                columnContentTypes={["text", "text", "text"]}
                headings={[
                  t("tryOnMarketing.campaignNameCol"),
                  t("tryOnMarketing.campaignStatusCol"),
                  t("tryOnMarketing.campaignScheduledCol"),
                ]}
                rows={(campaigns || []).map((c) => [
                  c.name,
                  c.status,
                  c.scheduled_at ? new Date(c.scheduled_at).toLocaleString() : t("tryOnMarketing.notScheduled"),
                ])}
              />
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
