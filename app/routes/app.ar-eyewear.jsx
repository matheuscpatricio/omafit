import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
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
  Spinner,
  Badge,
  Select,
  Thumbnail,
  Divider,
  Box,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { ensureShopHasActiveBilling } from "../billing-access.server";
import { getShopDomain } from "../utils/getShopDomain";
import { useAppI18n } from "../contexts/AppI18n";
import { detectAccessoryType } from "../ar-accessory-type.shared.js";

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
  return null;
};

function statusTone(status) {
  switch (status) {
    case "published":
      return "success";
    case "pending_review":
      return "attention";
    case "failed":
    case "rejected":
      return "critical";
    case "processing":
    case "queued":
      return "info";
    default:
      return "new";
  }
}

function imageSelectOptions(images, t) {
  return [
    { label: t("arEyewear.selectPlaceholder"), value: "" },
    ...images.map((im, i) => ({
      label: `${i + 1}. ${(im.altText || t("arEyewear.imageLabel", { n: i + 1 })).slice(0, 42)}${(im.altText || "").length > 42 ? "…" : ""}`,
      value: im.url,
    })),
  ];
}

export default function ArEyewearPage() {
  const { t } = useAppI18n();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const shopDomain = getShopDomain(searchParams);
  const appSearch = searchParams.toString();
  const appBackHref = `/app${appSearch ? `?${appSearch}` : ""}`;

  const [assetsLoading, setAssetsLoading] = useState(true);
  const [productsLoading, setProductsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [assets, setAssets] = useState([]);
  const [products, setProducts] = useState([]);
  const [productFilter, setProductFilter] = useState("");
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [generationImageUrl, setGenerationImageUrl] = useState("");

  const [productId, setProductId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [frameWidthMm, setFrameWidthMm] = useState("");
  const [confirmingShop, setConfirmingShop] = useState(false);
  const [actionId, setActionId] = useState(null);

  const loadAssets = useCallback(async () => {
    setAssetsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ar-eyewear", { credentials: "include", cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      setAssets(data.assets || []);
    } catch (e) {
      setError(e.message || t("arEyewear.errorLoadAssets"));
    } finally {
      setAssetsLoading(false);
    }
  }, [t]);

  const loadProducts = useCallback(async () => {
    setProductsLoading(true);
    try {
      const res = await fetch("/api/ar-eyewear/products", {
        credentials: "include",
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      setProducts(data.products || []);
    } catch (e) {
      setError((prev) => prev || e.message || t("arEyewear.errorLoadProducts"));
      setProducts([]);
    } finally {
      setProductsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadAssets();
    loadProducts();
  }, [loadAssets, loadProducts]);

  const filteredProducts = useMemo(() => {
    const q = productFilter.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        (p.title || "").toLowerCase().includes(q) ||
        (p.handle || "").toLowerCase().includes(q) ||
        (p.productType || "").toLowerCase().includes(q) ||
        (p.categoryFullName || "").toLowerCase().includes(q),
    );
  }, [products, productFilter]);

  const detectedAccessoryType = useMemo(() => {
    if (!selectedProduct) return "glasses";
    return detectAccessoryType({
      tags: selectedProduct.tags,
      productType: selectedProduct.productType,
      categoryFullName: selectedProduct.categoryFullName,
      title: selectedProduct.title,
    });
  }, [selectedProduct]);

  const selectShopProduct = (p) => {
    setSelectedProduct(p);
    setProductId(String(p.id || ""));
    const imgs = p.images || [];
    setGenerationImageUrl(imgs[0]?.url || "");
  };

  const submitFromShopify = async () => {
    if (!productId.trim()) {
      setError(t("arEyewear.errorProductId"));
      return;
    }
    if (!generationImageUrl) {
      setError(t("arEyewear.errorSelectImage"));
      return;
    }
    setConfirmingShop(true);
    setError(null);
    try {
      const res = await fetch("/api/ar-eyewear/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          productId: productId.trim(),
          imageFrontUrl: generationImageUrl,
          variantId: variantId.trim() || undefined,
          frameWidthMm: frameWidthMm.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      setSelectedProduct(null);
      setGenerationImageUrl("");
      setVariantId("");
      setFrameWidthMm("");
      await loadAssets();
    } catch (e) {
      setError(e.message || t("arEyewear.errorSubmit"));
    } finally {
      setConfirmingShop(false);
    }
  };

  const doAction = async (id, intent) => {
    setActionId(`${id}-${intent}`);
    setError(null);
    try {
      const res = await fetch(`/api/ar-eyewear/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ intent }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      await loadAssets();
    } catch (e) {
      setError(e.message || t("arEyewear.errorAction"));
    } finally {
      setActionId(null);
    }
  };

  const imgOpts = selectedProduct ? imageSelectOptions(selectedProduct.images || [], t) : [];

  const hasQueuedJobs = useMemo(
    () => (assets || []).some((a) => a.status === "queued"),
    [assets],
  );
  const productNameById = useMemo(() => {
    const map = new Map();
    for (const p of products || []) map.set(String(p.id || ""), p.title || "");
    return map;
  }, [products]);

  return (
    <Page
      title={t("arEyewear.title")}
      subtitle={t("arEyewear.subtitle")}
      backAction={{
        content: t("common.dashboard"),
        onAction: () => navigate(appBackHref),
      }}
    >
      <Layout>
        {error && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => setError(null)}>
              {error}
            </Banner>
          </Layout.Section>
        )}

        {hasQueuedJobs && (
          <Layout.Section>
            <Banner tone="warning">{t("arEyewear.queueWorkerBanner")}</Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                {t("arEyewear.shopProductsTitle")}
              </Text>
              <Text as="p" tone="subdued">
                {t("arEyewear.shopProductsHelp")}
              </Text>
              <TextField
                label={t("arEyewear.shopProductsSearch")}
                value={productFilter}
                onChange={setProductFilter}
                autoComplete="off"
              />
              {productsLoading ? (
                <InlineStack gap="200" blockAlign="center">
                  <Spinner size="small" />
                  <Text as="span">{t("arEyewear.shopProductsLoading")}</Text>
                </InlineStack>
              ) : filteredProducts.length === 0 ? (
                <Banner tone="info">{t("arEyewear.shopProductsEmpty")}</Banner>
              ) : (
                <BlockStack gap="200">
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                      gap: "12px",
                      maxHeight: "320px",
                      overflowY: "auto",
                    }}
                  >
                    {filteredProducts.map((p) => {
                      const thumb = p.images?.[0]?.url;
                      const active = selectedProduct?.id === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => selectShopProduct(p)}
                          style={{
                            textAlign: "left",
                            padding: "10px",
                            borderRadius: "8px",
                            border: active ? "2px solid var(--p-color-border-emphasis)" : "1px solid var(--p-color-border)",
                            background: active ? "var(--p-color-bg-surface-secondary)" : "var(--p-color-bg-surface)",
                            cursor: "pointer",
                          }}
                        >
                          <BlockStack gap="200">
                            {thumb ? (
                              <Thumbnail source={thumb} alt="" size="large" />
                            ) : (
                              <Box padding="400" background="bg-surface-secondary">
                                <Text as="p" tone="subdued">
                                  —
                                </Text>
                              </Box>
                            )}
                            <Text as="p" variant="bodySm" fontWeight="semibold">
                              {p.title}
                            </Text>
                            {p.productType ? (
                              <Text as="p" variant="bodySm" tone="subdued">
                                {t("arEyewear.productTypeLabel")}: {p.productType}
                              </Text>
                            ) : null}
                          </BlockStack>
                        </button>
                      );
                    })}
                  </div>
                </BlockStack>
              )}

              {selectedProduct && (
                <BlockStack gap="400">
                  <Divider />
                  <Text as="h3" variant="headingMd">
                    {t("arEyewear.shopImagesTitle")}
                  </Text>
                  <Text as="p" tone="subdued">
                    {t("arEyewear.shopImagesHelp")}
                  </Text>
                  <Banner tone="info">{t("arEyewear.whiteBackgroundHint")}</Banner>
                  {selectedProduct.categoryFullName ? (
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("arEyewear.categoryLabel")}: {selectedProduct.categoryFullName}
                    </Text>
                  ) : null}
                  <Banner tone="info">
                    <InlineStack gap="200" wrap>
                      <Text as="span" variant="bodySm">
                        {t("arEyewear.detection.detectedLabel")}:
                      </Text>
                      <Badge tone="attention">
                        {t(`arEyewear.accessoryType.${detectedAccessoryType}`) ||
                          detectedAccessoryType}
                      </Badge>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {t("arEyewear.detection.hint")}
                    </Text>
                  </Banner>
                  <InlineStack gap="200" wrap>
                    {(selectedProduct.images || []).slice(0, 8).map((im, idx) => (
                      <Thumbnail key={`${im.url}-${idx}`} source={im.url} alt={im.altText || ""} size="large" />
                    ))}
                  </InlineStack>
                  {(selectedProduct.images || []).length === 0 ? (
                    <Banner tone="warning">{t("arEyewear.needOneImage")}</Banner>
                  ) : null}
                  <Select
                    label={t("arEyewear.selectGenerationImage")}
                    options={imgOpts}
                    value={generationImageUrl}
                    onChange={setGenerationImageUrl}
                  />
                  {(selectedProduct.variants || []).length > 1 ? (
                    <Select
                      label={t("arEyewear.variantSelect")}
                      options={[
                        { label: t("arEyewear.variantSelectAll"), value: "" },
                        ...(selectedProduct.variants || []).map((v) => ({
                          label: `${v.title}${v.price ? ` — ${v.price}` : ""}`,
                          value: String(v.id || ""),
                        })),
                      ]}
                      value={variantId}
                      onChange={setVariantId}
                      helpText={t("arEyewear.variantSelectHelp")}
                    />
                  ) : null}
                  {detectedAccessoryType === "glasses" ? (
                    <TextField
                      label={t("arEyewear.frameWidth")}
                      value={frameWidthMm}
                      onChange={setFrameWidthMm}
                      autoComplete="off"
                      helpText={t("arEyewear.frameWidthHelp")}
                    />
                  ) : null}
                  <Button
                    variant="primary"
                    loading={confirmingShop}
                    disabled={(selectedProduct.images || []).length === 0}
                    onClick={submitFromShopify}
                  >
                    {t("arEyewear.confirmGenerationImage")}
                  </Button>
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  {t("arEyewear.listTitle")}
                </Text>
                <Button
                  onClick={() => {
                    loadAssets();
                    loadProducts();
                  }}
                  disabled={assetsLoading}
                >
                  {t("arEyewear.refresh")}
                </Button>
              </InlineStack>
              {assetsLoading ? (
                <InlineStack align="center" blockAlign="center">
                  <Spinner size="small" />
                  <Text as="span">{t("common.loading")}</Text>
                </InlineStack>
              ) : assets.length === 0 ? (
                <Text as="p" tone="subdued">
                  {t("arEyewear.empty")}
                </Text>
              ) : (
                <BlockStack gap="300">
                  {assets.map((a) => (
                    <Card key={a.id} padding="400">
                      <BlockStack gap="300">
                        <InlineStack align="space-between" blockAlign="center" wrap>
                          <Text as="p" fontWeight="semibold">
                            {a.product_name || productNameById.get(String(a.product_id || "")) || t("arEyewear.productUnknown")}
                          </Text>
                          <InlineStack gap="200" wrap>
                            {a.accessory_type ? (
                              <Badge tone="attention">
                                {t(`arEyewear.accessoryType.${a.accessory_type}`) ||
                                  a.accessory_type}
                              </Badge>
                            ) : null}
                            <Badge tone={statusTone(a.status)}>
                              {t(`arEyewear.status.${a.status}`)}
                            </Badge>
                          </InlineStack>
                        </InlineStack>
                        {a.error_message && (
                          <Text as="p" tone="critical">
                            {a.error_message}
                          </Text>
                        )}
                        {a.glb_draft_url && (
                          <Text as="p">
                            <a href={a.glb_draft_url} target="_blank" rel="noreferrer">
                              {t("arEyewear.openDraft")}
                            </a>
                          </Text>
                        )}
                        <InlineStack gap="200" wrap>
                          {a.status === "pending_review" && (
                            <Button
                              variant="primary"
                              loading={actionId === `${a.id}-publish`}
                              onClick={() => doAction(a.id, "publish")}
                            >
                              {t("arEyewear.publish")}
                            </Button>
                          )}
                          {a.status === "pending_review" && (
                            <Button
                              variant="plain"
                              tone="critical"
                              loading={actionId === `${a.id}-reject`}
                              onClick={() => doAction(a.id, "reject")}
                            >
                              {t("arEyewear.reject")}
                            </Button>
                          )}
                          {(a.status === "failed" ||
                            a.status === "rejected" ||
                            a.status === "processing") && (
                            <Button
                              loading={actionId === `${a.id}-requeue`}
                              onClick={() => doAction(a.id, "requeue")}
                            >
                              {t("arEyewear.requeue")}
                            </Button>
                          )}
                          {(a.status === "published" || a.status === "pending_review") && (
                            <Button
                              onClick={() =>
                                navigate(
                                  `/app/ar-eyewear/calibrate/${a.id}${appSearch ? `?${appSearch}` : ""}`,
                                )
                              }
                            >
                              {t("arEyewear.calibrate.openButton")}
                            </Button>
                          )}
                        </InlineStack>
                      </BlockStack>
                    </Card>
                  ))}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {!shopDomain && (
          <Layout.Section>
            <Banner tone="warning">{t("arEyewear.warnShop")}</Banner>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
