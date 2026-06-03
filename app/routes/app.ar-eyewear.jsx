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
  Icon,
} from "@shopify/polaris";
import { SearchIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { ensureShopHasActiveBilling } from "../billing-access.server";
import { getShopDomain } from "../utils/getShopDomain";
import { useAppI18n } from "../contexts/AppI18n";
import { detectAccessoryType } from "../ar-accessory-type.shared.js";
import {
  listGlassesLensProfileOptions,
  glassesLensProfileLabel,
  normalizeGlassesLensProfile,
  canEditGlassesLensProfile,
} from "../ar-glasses-lens-profile.shared.js";

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

const MAX_GENERATION_IMAGES = 5;

function defaultGenerationImageUrls(product, variantId) {
  const imgs = product?.images || [];
  const urls = imgs.map((i) => i.url).filter(Boolean);
  if (!variantId) return urls[0] ? [urls[0]] : [];
  const v = (product?.variants || []).find((x) => String(x.id) === String(variantId));
  if (v?.imageUrl) return [v.imageUrl];
  return urls[0] ? [urls[0]] : [];
}

function toggleGenerationImageUrl(current, url, max = MAX_GENERATION_IMAGES) {
  if (current.includes(url)) {
    return current.filter((u) => u !== url);
  }
  if (current.length >= max) return current;
  return [...current, url];
}

const AR_TYPES = ["glasses", "necklace", "watch", "bracelet"];

/**
 * Badge "Tipo" na lista de envios: o valor em BD (`accessory_type`) pode estar
 * desatualizado (criado antes da deteção por categoria). Priorizamos sempre
 * `detectAccessoryType` com os dados actuais do produto na lista.
 */
function resolveAccessoryTypeForAsset(asset, productById) {
  const pid = String(asset?.product_id ?? "").trim();
  const fromDb = asset?.accessory_type;
  const fallback =
    fromDb && AR_TYPES.includes(fromDb) ? fromDb : "glasses";
  if (!pid || !productById?.get) return fallback;
  const p = productById.get(pid);
  if (!p) return fallback;
  return detectAccessoryType({
    tags: p.tags,
    productType: p.productType,
    categoryFullName: p.categoryFullName,
    title: p.title,
  });
}

/**
 * Rótulo do card em "Pedidos e progresso": nome do produto e, se o catálogo
 * tiver mais de uma variante, o título da variante do envio entre aspas.
 */
function resolveSubmissionProductDisplay(asset, productById, productNameById, unknownLabel) {
  const pid = String(asset?.product_id ?? "").trim();
  const productName =
    asset?.product_name ||
    productNameById.get(pid) ||
    unknownLabel;

  const product = pid ? productById.get(pid) : null;
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  if (variants.length <= 1) {
    return { productName, variantLabel: null };
  }

  const variantId = String(asset?.variant_id ?? "").trim();
  if (!variantId) {
    return { productName, variantLabel: null };
  }

  const variant = variants.find((v) => String(v?.id ?? "").trim() === variantId);
  const variantLabel = String(variant?.title ?? "").trim();
  if (!variantLabel) {
    return { productName, variantLabel: null };
  }

  return { productName, variantLabel };
}

export default function ArEyewearPage() {
  const { t } = useAppI18n();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const shopDomain = getShopDomain(searchParams);
  const appSearch = searchParams.toString();
  const appBackHref = `/app${appSearch ? `?${appSearch}` : ""}`;

  const [assetsLoading, setAssetsLoading] = useState(true);
  const [productsLoading, setProductsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [assets, setAssets] = useState([]);
  const [products, setProducts] = useState([]);
  const [productFilter, setProductFilter] = useState("");
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [generationImageUrls, setGenerationImageUrls] = useState([]);

  const [productId, setProductId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [frameWidthMm, setFrameWidthMm] = useState("");
  /** @type {"opaque"|"translucent"|"transparent"} */
  const [glassesLensProfile, setGlassesLensProfile] = useState("opaque");
  const [confirmingShop, setConfirmingShop] = useState(false);
  const [actionId, setActionId] = useState(null);
  const [publishFeedback, setPublishFeedback] = useState(null);
  const [submissionsSearch, setSubmissionsSearch] = useState("");
  const [submissionsStatusFilter, setSubmissionsStatusFilter] = useState("all");
  /** @type {Record<string, "opaque"|"translucent"|"transparent">} */
  const [lensProfileDraftByAsset, setLensProfileDraftByAsset] = useState({});
  const [lensProfileSaveId, setLensProfileSaveId] = useState(null);

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

  const productSearchQuery = productFilter.trim();

  useEffect(() => {
    loadAssets();
    loadProducts();
  }, [loadAssets, loadProducts]);

  const filteredProducts = useMemo(() => {
    const q = productSearchQuery.toLowerCase();
    if (!q) return [];
    return products.filter(
      (p) =>
        (p.title || "").toLowerCase().includes(q) ||
        (p.handle || "").toLowerCase().includes(q) ||
        (p.productType || "").toLowerCase().includes(q) ||
        (p.categoryFullName || "").toLowerCase().includes(q),
    );
  }, [products, productSearchQuery]);

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
    const vars = p.variants || [];
    const nextVariantId =
      vars.length >= 1 ? String(vars[0].id || "") : "";
    setVariantId(nextVariantId);
    setGenerationImageUrls(defaultGenerationImageUrls(p, nextVariantId));
    setGlassesLensProfile("opaque");
  };

  const glassesLensProfileOptions = useMemo(
    () =>
      listGlassesLensProfileOptions().map((o) => ({
        value: o.value,
        label: t(o.labelKey),
      })),
    [t],
  );

  const handleVariantChange = (id) => {
    setVariantId(id);
    if (selectedProduct) {
      setGenerationImageUrls(defaultGenerationImageUrls(selectedProduct, id));
    }
  };

  const submitFromShopify = async () => {
    if (!productId.trim()) {
      setError(t("arEyewear.errorProductId"));
      return;
    }
    const vars = selectedProduct?.variants || [];
    if (vars.length >= 1 && !String(variantId || "").trim()) {
      setError(t("arEyewear.errorVariantRequired"));
      return;
    }
    if (generationImageUrls.length === 0) {
      setError(t("arEyewear.errorSelectImage"));
      return;
    }
    if (generationImageUrls.length > MAX_GENERATION_IMAGES) {
      setError(t("arEyewear.errorMaxImages", { max: MAX_GENERATION_IMAGES }));
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
          imageUrls: generationImageUrls,
          variantId: variantId.trim() || undefined,
          frameWidthMm: frameWidthMm.trim() || undefined,
          lensProfile:
            detectedAccessoryType === "glasses" ? glassesLensProfile : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      setSelectedProduct(null);
      setGenerationImageUrls([]);
      setVariantId("");
      setFrameWidthMm("");
      await loadAssets();
    } catch (e) {
      setError(e.message || t("arEyewear.errorSubmit"));
    } finally {
      setConfirmingShop(false);
    }
  };

  const saveLensProfile = async (asset) => {
    const id = asset.id;
    const value =
      lensProfileDraftByAsset[id] ??
      normalizeGlassesLensProfile(asset.lens_profile) ??
      "opaque";
    setLensProfileSaveId(id);
    setError(null);
    try {
      const res = await fetch(`/api/ar-eyewear/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ intent: "update_lens_profile", lensProfile: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      setLensProfileDraftByAsset((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await loadAssets();
    } catch (e) {
      setError(e.message || t("arEyewear.lensProfile.saveError"));
    } finally {
      setLensProfileSaveId(null);
    }
  };

  const doAction = async (id, intent) => {
    setActionId(`${id}-${intent}`);
    setError(null);
    if (intent !== "publish") setPublishFeedback(null);
    try {
      const res = await fetch(`/api/ar-eyewear/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ intent }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      if (intent === "publish" && data.publishTargets) {
        setPublishFeedback(data.publishTargets);
      }
      await loadAssets();
    } catch (e) {
      setError(e.message || t("arEyewear.errorAction"));
    } finally {
      setActionId(null);
    }
  };

  const hasQueuedJobs = useMemo(
    () =>
      (assets || []).some((a) => a.status === "queued" || a.status === "processing"),
    [assets],
  );

  const productNameById = useMemo(() => {
    const map = new Map();
    for (const p of products || []) map.set(String(p.id || ""), p.title || "");
    return map;
  }, [products]);

  const productById = useMemo(() => {
    const map = new Map();
    for (const p of products || []) map.set(String(p.id || ""), p);
    return map;
  }, [products]);

  const submissionsStatusOptions = useMemo(
    () => [
      { label: t("arEyewear.submissionsFilterAll"), value: "all" },
      { label: t("arEyewear.status.published"), value: "published" },
      { label: t("arEyewear.status.pending_review"), value: "pending_review" },
      { label: t("arEyewear.status.queued"), value: "queued" },
      { label: t("arEyewear.status.processing"), value: "processing" },
      { label: t("arEyewear.status.uploaded"), value: "uploaded" },
      { label: t("arEyewear.status.failed"), value: "failed" },
      { label: t("arEyewear.status.rejected"), value: "rejected" },
    ],
    [t],
  );

  const filteredAssets = useMemo(() => {
    const q = submissionsSearch.trim().toLowerCase();
    return (assets || []).filter((a) => {
      if (submissionsStatusFilter !== "all" && a.status !== submissionsStatusFilter) {
        return false;
      }
      if (!q) return true;
      const display = resolveSubmissionProductDisplay(
        a,
        productById,
        productNameById,
        "",
      );
      const haystack = [display.productName, display.variantLabel, String(a.product_id || "")]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [assets, submissionsSearch, submissionsStatusFilter, productNameById, productById]);

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
                placeholder={t("arEyewear.shopProductsSearchPlaceholder")}
                prefix={<Icon source={SearchIcon} />}
                clearButton
                onClearButtonClick={() => setProductFilter("")}
              />
              {!productSearchQuery ? (
                <Text as="p" tone="subdued">
                  {t("arEyewear.shopProductsSearchPrompt")}
                </Text>
              ) : productsLoading ? (
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
                  {(selectedProduct.variants || []).length > 1 ? (
                    <Select
                      label={t("arEyewear.variantSelect")}
                      options={(selectedProduct.variants || []).map((v) => ({
                        label: `${v.title}${v.price ? ` — ${v.price}` : ""}`,
                        value: String(v.id || ""),
                      }))}
                      value={variantId}
                      onChange={handleVariantChange}
                      helpText={t("arEyewear.variantSelectHelp")}
                    />
                  ) : null}
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("arEyewear.generationImagesCount", {
                      count: generationImageUrls.length,
                      max: MAX_GENERATION_IMAGES,
                    })}
                  </Text>
                  <InlineStack gap="200" wrap>
                    {(selectedProduct.images || []).map((im, idx) => {
                      const selected = generationImageUrls.includes(im.url);
                      const order = selected ? generationImageUrls.indexOf(im.url) + 1 : 0;
                      const atMax =
                        generationImageUrls.length >= MAX_GENERATION_IMAGES && !selected;
                      return (
                        <button
                          key={`${im.url}-${idx}`}
                          type="button"
                          onClick={() =>
                            setGenerationImageUrls((prev) =>
                              toggleGenerationImageUrl(prev, im.url),
                            )
                          }
                          disabled={atMax}
                          style={{
                            cursor: atMax ? "not-allowed" : "pointer",
                            opacity: atMax ? 0.5 : 1,
                            border: selected
                              ? "2px solid var(--p-color-border-emphasis)"
                              : "2px solid transparent",
                            borderRadius: "var(--p-border-radius-200)",
                            padding: 4,
                            background: "none",
                          }}
                          aria-pressed={selected}
                          aria-label={t("arEyewear.imageLabel", { n: idx + 1 })}
                        >
                          <BlockStack gap="100" inlineAlign="center">
                            <Thumbnail
                              source={im.url}
                              alt={im.altText || ""}
                              size="large"
                            />
                            {selected ? (
                              <Badge tone="success">{String(order)}</Badge>
                            ) : null}
                          </BlockStack>
                        </button>
                      );
                    })}
                  </InlineStack>
                  {(selectedProduct.images || []).length === 0 ? (
                    <Banner tone="warning">{t("arEyewear.needOneImage")}</Banner>
                  ) : null}
                  {detectedAccessoryType === "glasses" ? (
                    <BlockStack gap="300">
                      <Select
                        label={t("arEyewear.lensProfile.label")}
                        options={glassesLensProfileOptions}
                        value={glassesLensProfile}
                        onChange={setGlassesLensProfile}
                        helpText={t("arEyewear.lensProfile.help")}
                      />
                      <TextField
                        label={t("arEyewear.frameWidth")}
                        value={frameWidthMm}
                        onChange={setFrameWidthMm}
                        autoComplete="off"
                        helpText={t("arEyewear.frameWidthHelp")}
                      />
                    </BlockStack>
                  ) : null}
                  <Button
                    variant="primary"
                    loading={confirmingShop}
                    disabled={
                      (selectedProduct.images || []).length === 0 ||
                      generationImageUrls.length === 0
                    }
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
              <Banner tone="info">
                <Text as="p" variant="bodySm">
                  {t("arEyewear.publishMetafieldExplain")}
                </Text>
              </Banner>
              {publishFeedback ? (
                <Banner
                  tone={
                    publishFeedback.variantMetafieldAttempted && !publishFeedback.variantMetafield
                      ? "warning"
                      : "success"
                  }
                  onDismiss={() => setPublishFeedback(null)}
                >
                  <Text as="p" variant="bodySm">
                    {publishFeedback.variantMetafieldAttempted
                      ? publishFeedback.variantMetafield
                        ? t("arEyewear.publishDoneProductAndVariant")
                        : t("arEyewear.publishDoneVariantFailed")
                      : t("arEyewear.publishDoneProductOnly")}
                  </Text>
                </Banner>
              ) : null}
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
              {!assetsLoading && assets.length > 0 ? (
                <InlineStack gap="200" wrap>
                  <Box minWidth="240px">
                    <TextField
                      label={t("arEyewear.submissionsSearchLabel")}
                      labelHidden
                      value={submissionsSearch}
                      onChange={setSubmissionsSearch}
                      autoComplete="off"
                      placeholder={t("arEyewear.submissionsSearchPlaceholder")}
                      prefix={<Icon source={SearchIcon} />}
                      clearButton
                      onClearButtonClick={() => setSubmissionsSearch("")}
                    />
                  </Box>
                  <Box minWidth="220px">
                    <Select
                      label={t("arEyewear.submissionsFilterLabel")}
                      labelHidden
                      options={submissionsStatusOptions}
                      value={submissionsStatusFilter}
                      onChange={setSubmissionsStatusFilter}
                    />
                  </Box>
                </InlineStack>
              ) : null}
              {assetsLoading ? (
                <InlineStack align="center" blockAlign="center">
                  <Spinner size="small" />
                  <Text as="span">{t("common.loading")}</Text>
                </InlineStack>
              ) : assets.length === 0 ? (
                <Text as="p" tone="subdued">
                  {t("arEyewear.empty")}
                </Text>
              ) : filteredAssets.length === 0 ? (
                <Text as="p" tone="subdued">
                  {t("arEyewear.submissionsEmptyFiltered")}
                </Text>
              ) : (
                <BlockStack gap="300">
                  {filteredAssets.map((a) => {
                    const displayAccessoryType = resolveAccessoryTypeForAsset(a, productById);
                    const productDisplay = resolveSubmissionProductDisplay(
                      a,
                      productById,
                      productNameById,
                      t("arEyewear.productUnknown"),
                    );
                    return (
                    <Card key={a.id} padding="400">
                      <BlockStack gap="300">
                        <InlineStack align="space-between" blockAlign="center" wrap>
                          <Text as="p" fontWeight="semibold">
                            {productDisplay.productName}
                            {productDisplay.variantLabel ? (
                              <>
                                {' '}
                                <Text as="span" variant="bodyMd" fontWeight="regular">
                                  &quot;{productDisplay.variantLabel}&quot;
                                </Text>
                              </>
                            ) : null}
                          </Text>
                          <InlineStack gap="200" wrap>
                            <Badge tone="attention">
                              {t(`arEyewear.accessoryType.${displayAccessoryType}`) ||
                                displayAccessoryType}
                            </Badge>
                            {displayAccessoryType === "glasses" && a.lens_profile ? (
                              <Badge>
                                {glassesLensProfileLabel(a.lens_profile, t)}
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
                        {displayAccessoryType === "glasses" &&
                        canEditGlassesLensProfile(a.status) ? (
                          <BlockStack gap="200">
                            <Select
                              label={t("arEyewear.lensProfile.editLabel")}
                              options={glassesLensProfileOptions}
                              value={
                                lensProfileDraftByAsset[a.id] ??
                                normalizeGlassesLensProfile(a.lens_profile) ??
                                "opaque"
                              }
                              onChange={(v) =>
                                setLensProfileDraftByAsset((prev) => ({
                                  ...prev,
                                  [a.id]: v,
                                }))
                              }
                              helpText={t("arEyewear.lensProfile.editHelp")}
                            />
                            <InlineStack gap="200" wrap>
                              <Button
                                size="slim"
                                loading={lensProfileSaveId === a.id}
                                disabled={
                                  lensProfileSaveId === a.id ||
                                  (lensProfileDraftByAsset[a.id] ??
                                    normalizeGlassesLensProfile(a.lens_profile) ??
                                    "opaque") ===
                                    (normalizeGlassesLensProfile(a.lens_profile) ??
                                      "opaque")
                                }
                                onClick={() => saveLensProfile(a)}
                              >
                                {t("arEyewear.lensProfile.save")}
                              </Button>
                              {a.status === "pending_review" && a.glb_draft_url ? (
                                <Text as="span" variant="bodySm" tone="subdued">
                                  {t("arEyewear.lensProfile.manifestHint")}
                                </Text>
                              ) : null}
                            </InlineStack>
                          </BlockStack>
                        ) : null}
                        <InlineStack gap="200" wrap>
                          {(a.status === "pending_review" ||
                            (a.status === "rejected" && a.glb_draft_url)) && (
                            <Button
                              variant="primary"
                              loading={actionId === `${a.id}-publish`}
                              onClick={() => doAction(a.id, "publish")}
                            >
                              {a.status === "rejected"
                                ? t("arEyewear.republish")
                                : t("arEyewear.publish")}
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
                            a.status === "processing" ||
                            a.status === "queued") && (
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
                    );
                  })}
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
