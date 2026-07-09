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
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { ensureShopHasActiveBilling } from "../billing-access.server";
import { getShopDomain } from "../utils/getShopDomain";
import { useAppI18n } from "../contexts/AppI18n";
import { shopHasWhatsappMarketingAccess } from "../shop-whatsapp-marketing-access.server.js";

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
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [selectedCollections, setSelectedCollections] = useState([]);
  const [scheduledAt, setScheduledAt] = useState("");
  const [previewCount, setPreviewCount] = useState(null);

  const collectionOptions = useMemo(
    () => collections.map((c) => ({ label: c.title || c.handle, value: c.handle })),
    [collections],
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
      setTemplates(tplRes.templates || []);
      setCampaigns(campRes.campaigns || []);
      setMetrics(metricsRes);
      setSegments(segRes.segments || []);

      if (shopDomain) {
        const colRes = await fetch(`/api/collections?shop_domain=${encodeURIComponent(shopDomain)}`);
        const colJson = await colRes.json().catch(() => ({}));
        setCollections(colJson.collections || []);
      }
    } catch (err) {
      setError(err.message || "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [shopDomain]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

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
      setNotice("WhatsApp conectado com sucesso.");
      await loadAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSyncTemplates = async () => {
    try {
      await apiFetch("templates/sync", { method: "POST", body: {} });
      setNotice("Templates sincronizados.");
      await loadAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const handlePreview = async () => {
    try {
      const res = await apiFetch("segments/preview", {
        method: "POST",
        body: {
          filter_json: {
            has_marketing_consent: true,
            tryon_since_days: 30,
            product_handles: [],
          },
        },
      });
      setPreviewCount(res.count);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCreateCampaign = async () => {
    try {
      let segmentId = segments[0]?.id;
      if (!segmentId) {
        const seg = await apiFetch("segments", {
          method: "POST",
          body: {
            name: "Opt-in ativos (30 dias)",
            filter_json: { has_marketing_consent: true, tryon_since_days: 30 },
          },
        });
        segmentId = seg.segment?.id;
      }
      await apiFetch("campaigns", {
        method: "POST",
        body: {
          name: campaignName || "Campanha Try On",
          segment_id: segmentId,
          template_id: selectedTemplate || null,
          promoted_collection_handles: selectedCollections,
          scheduled_at: scheduledAt || null,
          materialize: true,
          confirm: Boolean(scheduledAt),
        },
      });
      setNotice("Campanha criada.");
      setCampaignName("");
      await loadAll();
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) {
    return (
      <Page title="Try On Marketing">
        <InlineStack align="center">
          <Spinner />
        </InlineStack>
      </Page>
    );
  }

  if (!hasWhatsappMarketingAccess) {
    return (
      <Page title="Try On Marketing">
        <Layout>
          <Layout.Section>
            <Banner tone="warning">
              <p>
                Try On Marketing está em piloto e ainda não está disponível para esta loja.{" "}
                <Link to={`/app/billing${searchParams.toString() ? `?${searchParams.toString()}` : ""}`}>
                  Ver planos
                </Link>
              </p>
            </Banner>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page title="Try On Marketing" subtitle="WhatsApp marketing pós-provador virtual">
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
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Conexão WhatsApp (WABA)
              </Text>
              {connection?.connected ? (
                <Banner tone="success">
                  Conectado — {connection.display_phone || connection.phone_number_id}
                </Banner>
              ) : (
                <Text as="p" tone="subdued">
                  Informe o Phone Number ID e o token permanente da Meta Business Manager.
                </Text>
              )}
              <TextField label="Phone Number ID" value={phoneNumberId} onChange={setPhoneNumberId} autoComplete="off" />
              <TextField label="WABA ID" value={wabaId} onChange={setWabaId} autoComplete="off" />
              <TextField label="Número exibido" value={displayPhone} onChange={setDisplayPhone} autoComplete="off" />
              <TextField label="Access Token" value={accessToken} onChange={setAccessToken} type="password" autoComplete="off" />
              <Button variant="primary" onClick={() => void handleConnect()}>
                Salvar conexão
              </Button>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">
                  Templates
                </Text>
                <Button onClick={() => void handleSyncTemplates()}>Sincronizar</Button>
              </InlineStack>
              <DataTable
                columnContentTypes={["text", "text", "text"]}
                headings={["Nome", "Idioma", "Status"]}
                rows={(templates || []).map((tpl) => [tpl.name, tpl.language, tpl.status])}
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Métricas
              </Text>
              <InlineStack gap="400">
                <Badge tone="info">{`Opt-ins: ${metrics?.opt_in_count ?? 0}`}</Badge>
                <Badge>{`Campanhas: ${metrics?.campaigns_total ?? 0}`}</Badge>
                <Badge tone="success">{`Entregues: ${metrics?.messages_delivered ?? 0}`}</Badge>
              </InlineStack>
              <Text as="p" tone="subdued">
                Custo estimado (USD): ${Number(metrics?.estimated_cost_usd ?? 0).toFixed(2)}
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Nova campanha
              </Text>
              <TextField label="Nome" value={campaignName} onChange={setCampaignName} autoComplete="off" />
              <Select
                label="Template"
                options={[
                  { label: "Selecione…", value: "" },
                  ...templates.map((tpl) => ({ label: `${tpl.name} (${tpl.status})`, value: tpl.id })),
                ]}
                value={selectedTemplate}
                onChange={setSelectedTemplate}
              />
              <Select
                label="Coleções a divulgar"
                options={collectionOptions}
                value={selectedCollections[0] || ""}
                onChange={(value) => setSelectedCollections(value ? [value] : [])}
              />
              <TextField
                label="Agendar (ISO local)"
                value={scheduledAt}
                onChange={setScheduledAt}
                placeholder="2026-07-09T10:00:00"
                autoComplete="off"
              />
              <InlineStack gap="200">
                <Button onClick={() => void handlePreview()}>Preview audiência</Button>
                {previewCount != null ? <Badge>{`${previewCount} contatos`}</Badge> : null}
                <Button variant="primary" onClick={() => void handleCreateCampaign()}>
                  Criar campanha
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Campanhas
              </Text>
              <DataTable
                columnContentTypes={["text", "text", "text"]}
                headings={["Nome", "Status", "Agendada"]}
                rows={(campaigns || []).map((c) => [
                  c.name,
                  c.status,
                  c.scheduled_at ? new Date(c.scheduled_at).toLocaleString() : "—",
                ])}
              />
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
