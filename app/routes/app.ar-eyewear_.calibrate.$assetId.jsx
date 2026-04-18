/**
 * /app/ar-eyewear/calibrate/:assetId
 *
 * Ferramenta visual para o lojista ajustar como o modelo 3D aparece no rosto:
 * rotação, altura, profundidade e tamanho. Sem termos técnicos — sliders com
 * nomes do dia-a-dia ("Girar para cima/baixo", "Altura", etc.).
 *
 * Guarda um metafield JSON (omafit.ar_calibration) no produto e, opcionalmente,
 * numa variante específica. O widget (omafit-embed.liquid + omafit-ar-widget.js)
 * lê esse JSON e aplica no GLB automaticamente.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useLoaderData, useFetcher, useNavigate, useSearchParams } from "react-router-dom";
import { redirect } from "react-router";
import { Buffer } from "node:buffer";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Button,
  Banner,
  RangeSlider,
  Select,
  Box,
  Divider,
  Badge,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { ensureShopHasActiveBilling } from "../billing-access.server";
import {
  getAssetById,
  getShopArEyewearEnabled,
  fetchProductArCalibrationContext,
  ensureArCalibrationMetafieldDefinition,
  setProductArCalibrationMetafield,
  setVariantArCalibrationMetafield,
  sanitizeArCalibrationInput,
  defaultArCalibration,
  storageCreateSignedUrl,
} from "../ar-eyewear.server.js";
import { useAppI18n } from "../contexts/AppI18n";
import { getShopDomain } from "../utils/getShopDomain";

function tryResignIfPrivate(rawUrl) {
  if (!rawUrl) return rawUrl;
  try {
    const u = new URL(rawUrl);
    const match = u.pathname.match(
      /\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+)$/,
    );
    if (!match) return rawUrl;
    const bucket = decodeURIComponent(match[1]);
    const path = decodeURIComponent(match[2]);
    if (bucket !== "self-hosted-results") return rawUrl;
    return { bucket, path };
  } catch {
    return rawUrl;
  }
}

export async function loader({ request, params }) {
  const { admin, session } = await authenticate.admin(request);
  const billing = await ensureShopHasActiveBilling(admin, session.shop);
  if (!billing.active) {
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

  if (!(await getShopArEyewearEnabled(session.shop))) {
    throw new Response("AR Eyewear disabled", { status: 403 });
  }

  const assetId = params.assetId;
  if (!assetId) throw new Response("Missing assetId", { status: 400 });

  const row = await getAssetById(assetId);
  if (!row || row.shop_domain !== session.shop) {
    throw new Response("Not found", { status: 404 });
  }

  const glbCandidate = row.glb_published_url || row.glb_draft_url || "";
  let glbPreviewUrl = glbCandidate;
  const parsed = tryResignIfPrivate(glbCandidate);
  if (parsed && typeof parsed === "object" && parsed.bucket && parsed.path) {
    try {
      glbPreviewUrl = await storageCreateSignedUrl(parsed.bucket, parsed.path, 3600);
    } catch (e) {
      console.warn("[calibrate] sign glb failed:", e?.message || e);
    }
  }

  let productContext = null;
  try {
    productContext = await fetchProductArCalibrationContext(admin, row.product_id);
  } catch (e) {
    console.warn("[calibrate] fetchProductArCalibrationContext:", e?.message || e);
  }

  const productCalibration =
    productContext?.productCalibration || defaultArCalibration();

  const variants = (productContext?.variants || []).map((v) => ({
    id: v.id,
    title: v.title,
    imageUrl: v.imageUrl,
    hasCalibration: Boolean(v.calibration),
    calibration: v.calibration || null,
  }));

  return {
    asset: {
      id: row.id,
      product_id: row.product_id,
      variant_id: row.variant_id || null,
      status: row.status,
      product_name: row.product_name || productContext?.title || "",
    },
    productTitle: productContext?.title || row.product_name || "",
    productImageUrl: productContext?.featuredImageUrl || "",
    glbPreviewUrl,
    productCalibration,
    variants,
    defaultCalibration: defaultArCalibration(),
  };
}

export async function action({ request, params }) {
  const { admin, session } = await authenticate.admin(request);
  if (!(await getShopArEyewearEnabled(session.shop))) {
    return Response.json({ error: "AR Eyewear disabled" }, { status: 403 });
  }
  const assetId = params.assetId;
  if (!assetId) return Response.json({ error: "Missing assetId" }, { status: 400 });

  const row = await getAssetById(assetId);
  if (!row || row.shop_domain !== session.shop) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const calibration = sanitizeArCalibrationInput(body?.calibration);
  const target = String(body?.target || "product").toLowerCase();
  const variantGid = body?.variantGid ? String(body.variantGid) : "";

  try {
    await ensureArCalibrationMetafieldDefinition(admin);
    if (target === "variant" && variantGid) {
      await setVariantArCalibrationMetafield(admin, variantGid, calibration);
    } else {
      await setProductArCalibrationMetafield(admin, row.product_id, calibration);
    }
    return Response.json({ ok: true, calibration, target, variantGid });
  } catch (e) {
    return Response.json(
      { error: e?.message || "save_failed" },
      { status: 500 },
    );
  }
}

const MODEL_VIEWER_SRC =
  "https://cdn.jsdelivr.net/npm/@google/model-viewer@3.5.0/dist/model-viewer.min.js";

function useModelViewerLoaded() {
  const [loaded, setLoaded] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.customElements !== "undefined" &&
      Boolean(window.customElements.get?.("model-viewer")),
  );
  useEffect(() => {
    if (loaded || typeof window === "undefined") return undefined;
    if (window.customElements?.get?.("model-viewer")) {
      setLoaded(true);
      return undefined;
    }
    let script = document.querySelector(`script[data-omafit-model-viewer="1"]`);
    if (!script) {
      script = document.createElement("script");
      script.type = "module";
      script.src = MODEL_VIEWER_SRC;
      script.crossOrigin = "anonymous";
      script.dataset.omafitModelViewer = "1";
      document.head.appendChild(script);
    }
    const check = () => {
      if (window.customElements?.get?.("model-viewer")) setLoaded(true);
    };
    script.addEventListener("load", check);
    const id = window.setInterval(check, 150);
    return () => {
      script?.removeEventListener("load", check);
      window.clearInterval(id);
    };
  }, [loaded]);
  return loaded;
}

export default function ArEyewearCalibratePage() {
  const { t } = useAppI18n();
  const data = useLoaderData();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const [searchParams] = useSearchParams();
  getShopDomain(searchParams);
  const appSearch = searchParams.toString();
  const backHref = `/app/ar-eyewear${appSearch ? `?${appSearch}` : ""}`;
  const mvLoaded = useModelViewerLoaded();

  const [target, setTarget] = useState(
    data.asset.variant_id && data.variants.find((v) => v.id === `gid://shopify/ProductVariant/${data.asset.variant_id}` || String(v.id).endsWith(`/${data.asset.variant_id}`))
      ? "variant"
      : "product",
  );
  const [variantGid, setVariantGid] = useState(() => {
    if (!data.asset.variant_id) return data.variants[0]?.id || "";
    const match = data.variants.find((v) => String(v.id).endsWith(`/${data.asset.variant_id}`));
    return match ? match.id : data.variants[0]?.id || "";
  });

  const activeVariant = useMemo(
    () => data.variants.find((v) => v.id === variantGid) || null,
    [data.variants, variantGid],
  );

  const initialCalibration = useMemo(() => {
    if (target === "variant") {
      return activeVariant?.calibration || data.productCalibration;
    }
    return data.productCalibration;
  }, [target, activeVariant, data.productCalibration]);

  const [cal, setCal] = useState(initialCalibration);
  const lastInitialRef = useRef(initialCalibration);

  useEffect(() => {
    if (lastInitialRef.current !== initialCalibration) {
      lastInitialRef.current = initialCalibration;
      setCal(initialCalibration);
    }
  }, [initialCalibration]);

  const isSaving = fetcher.state !== "idle";
  const saveResult = fetcher.data;

  const setField = (field) => (val) => {
    const v = Array.isArray(val) ? val[0] : val;
    setCal((prev) => ({ ...prev, [field]: Number(v) }));
  };

  const handleReset = () => {
    setCal(data.defaultCalibration);
  };

  const handleSave = () => {
    fetcher.submit(
      {
        calibration: cal,
        target,
        variantGid: target === "variant" ? variantGid : "",
      },
      {
        method: "post",
        action: `/app/ar-eyewear/calibrate/${data.asset.id}${appSearch ? `?${appSearch}` : ""}`,
        encType: "application/json",
      },
    );
  };

  const orientationAttr = `${cal.rx}deg ${cal.ry}deg ${cal.rz}deg`;
  const cameraOrbit = "0deg 90deg 0.35m";
  const cameraTarget = `${cal.wearX}m ${cal.wearY + cal.bridgeY * 0.05}m ${cal.wearZ}m`;

  const hasChanges = useMemo(() => {
    const a = cal;
    const b = initialCalibration;
    return (
      a.rx !== b.rx ||
      a.ry !== b.ry ||
      a.rz !== b.rz ||
      a.bridgeY !== b.bridgeY ||
      a.wearX !== b.wearX ||
      a.wearY !== b.wearY ||
      a.wearZ !== b.wearZ ||
      a.scale !== b.scale
    );
  }, [cal, initialCalibration]);

  return (
    <Page
      title={t("arEyewear.calibrate.title")}
      subtitle={t("arEyewear.calibrate.subtitle")}
      backAction={{
        content: t("arEyewear.calibrate.back"),
        onAction: () => navigate(backHref),
      }}
    >
      <Layout>
        <Layout.Section>
          <Banner tone="info" title={t("arEyewear.calibrate.howToTitle")}>
            <BlockStack gap="100">
              <Text as="p">{t("arEyewear.calibrate.howToIntro")}</Text>
              <Text as="p">• {t("arEyewear.calibrate.howToStep1")}</Text>
              <Text as="p">• {t("arEyewear.calibrate.howToStep2")}</Text>
              <Text as="p">• {t("arEyewear.calibrate.howToStep3")}</Text>
              <Text as="p">• {t("arEyewear.calibrate.howToStep4")}</Text>
            </BlockStack>
          </Banner>
        </Layout.Section>

        <Layout.Section>
          <InlineStack gap="400" wrap={false} align="space-between" blockAlign="start">
            <Box width="58%" minWidth="360px">
              <Card padding="0">
                <div
                  style={{
                    position: "relative",
                    width: "100%",
                    aspectRatio: "4 / 5",
                    background:
                      "radial-gradient(ellipse at center, #2b3744 0%, #11161d 70%, #070a0d 100%)",
                    overflow: "hidden",
                    borderRadius: "8px",
                  }}
                >
                  <FaceSilhouette />
                  <PreviewModel
                    ready={mvLoaded}
                    src={data.glbPreviewUrl}
                    orientationAttr={orientationAttr}
                    scale={`${cal.scale} ${cal.scale} ${cal.scale}`}
                    cameraOrbit={cameraOrbit}
                    cameraTarget={cameraTarget}
                  />
                  <div
                    style={{
                      position: "absolute",
                      bottom: "12px",
                      left: "12px",
                      right: "12px",
                      color: "rgba(255,255,255,0.75)",
                      fontSize: "12px",
                      textAlign: "center",
                      textShadow: "0 1px 2px rgba(0,0,0,0.7)",
                      pointerEvents: "none",
                    }}
                  >
                    {t("arEyewear.calibrate.previewHint")}
                  </div>
                </div>
              </Card>
            </Box>

            <Box width="42%" minWidth="340px">
              <Card>
                <BlockStack gap="400">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">
                      {data.productTitle || data.asset.product_name || t("arEyewear.productUnknown")}
                    </Text>
                    <Badge tone="info">{t(`arEyewear.status.${data.asset.status}`)}</Badge>
                  </BlockStack>

                  {data.variants.length > 1 ? (
                    <>
                      <Select
                        label={t("arEyewear.calibrate.targetLabel")}
                        helpText={t("arEyewear.calibrate.targetHelp")}
                        options={[
                          {
                            label: t("arEyewear.calibrate.targetProduct"),
                            value: "product",
                          },
                          {
                            label: t("arEyewear.calibrate.targetVariant"),
                            value: "variant",
                          },
                        ]}
                        value={target}
                        onChange={setTarget}
                      />
                      {target === "variant" ? (
                        <Select
                          label={t("arEyewear.calibrate.variantLabel")}
                          options={data.variants.map((v) => ({
                            label: `${v.title}${v.hasCalibration ? ` ✓` : ""}`,
                            value: v.id,
                          }))}
                          value={variantGid}
                          onChange={setVariantGid}
                        />
                      ) : null}
                    </>
                  ) : null}

                  <Divider />

                  <CalibrationSliders cal={cal} setField={setField} t={t} />

                  <Divider />

                  <InlineStack gap="200" wrap>
                    <Button
                      variant="primary"
                      onClick={handleSave}
                      loading={isSaving}
                      disabled={!hasChanges || !data.glbPreviewUrl}
                    >
                      {t("arEyewear.calibrate.save")}
                    </Button>
                    <Button onClick={handleReset} disabled={isSaving}>
                      {t("arEyewear.calibrate.reset")}
                    </Button>
                    <Button
                      onClick={() => navigate(backHref)}
                      disabled={isSaving}
                      variant="tertiary"
                    >
                      {t("arEyewear.calibrate.cancel")}
                    </Button>
                  </InlineStack>

                  {saveResult?.ok ? (
                    <Banner tone="success">{t("arEyewear.calibrate.saveSuccess")}</Banner>
                  ) : null}
                  {saveResult?.error ? (
                    <Banner tone="critical">
                      {t("arEyewear.calibrate.saveError")}: {saveResult.error}
                    </Banner>
                  ) : null}
                </BlockStack>
              </Card>
            </Box>
          </InlineStack>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                {t("arEyewear.calibrate.tipsTitle")}
              </Text>
              <Text as="p" tone="subdued">
                {t("arEyewear.calibrate.tip1")}
              </Text>
              <Text as="p" tone="subdued">
                {t("arEyewear.calibrate.tip2")}
              </Text>
              <Text as="p" tone="subdued">
                {t("arEyewear.calibrate.tip3")}
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function PreviewModel({ ready, src, orientationAttr, scale, cameraOrbit, cameraTarget }) {
  if (!src) {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
        }}
      >
        <Text as="p">—</Text>
      </div>
    );
  }
  if (!ready) {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(255,255,255,0.8)",
          fontSize: "13px",
        }}
      >
        Carregando visualizador 3D…
      </div>
    );
  }
  return (
    <model-viewer
      src={src}
      alt="Modelo 3D do acessório"
      orientation={orientationAttr}
      scale={scale}
      camera-orbit={cameraOrbit}
      camera-target={cameraTarget}
      disable-zoom=""
      disable-pan=""
      disable-tap=""
      interaction-prompt="none"
      shadow-intensity="0"
      exposure="1.1"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        background: "transparent",
        "--poster-color": "transparent",
      }}
    />
  );
}

function CalibrationSliders({ cal, setField, t }) {
  return (
    <BlockStack gap="300">
      <RangeSlider
        output
        label={t("arEyewear.calibrate.sliders.tilt.label")}
        helpText={t("arEyewear.calibrate.sliders.tilt.help")}
        min={-90}
        max={90}
        step={1}
        value={cal.rx}
        onChange={setField("rx")}
        suffix={`${cal.rx}°`}
      />
      <RangeSlider
        output
        label={t("arEyewear.calibrate.sliders.yaw.label")}
        helpText={t("arEyewear.calibrate.sliders.yaw.help")}
        min={-180}
        max={180}
        step={1}
        value={cal.ry}
        onChange={setField("ry")}
        suffix={`${cal.ry}°`}
      />
      <RangeSlider
        output
        label={t("arEyewear.calibrate.sliders.roll.label")}
        helpText={t("arEyewear.calibrate.sliders.roll.help")}
        min={-45}
        max={45}
        step={1}
        value={cal.rz}
        onChange={setField("rz")}
        suffix={`${cal.rz}°`}
      />

      <RangeSlider
        output
        label={t("arEyewear.calibrate.sliders.height.label")}
        helpText={t("arEyewear.calibrate.sliders.height.help")}
        min={-0.5}
        max={0.5}
        step={0.01}
        value={cal.bridgeY}
        onChange={setField("bridgeY")}
        suffix={formatPct(cal.bridgeY)}
      />
      <RangeSlider
        output
        label={t("arEyewear.calibrate.sliders.depth.label")}
        helpText={t("arEyewear.calibrate.sliders.depth.help")}
        min={-0.05}
        max={0.05}
        step={0.001}
        value={cal.wearZ}
        onChange={setField("wearZ")}
        suffix={formatMm(cal.wearZ)}
      />
      <RangeSlider
        output
        label={t("arEyewear.calibrate.sliders.nudgeY.label")}
        helpText={t("arEyewear.calibrate.sliders.nudgeY.help")}
        min={-0.05}
        max={0.05}
        step={0.001}
        value={cal.wearY}
        onChange={setField("wearY")}
        suffix={formatMm(cal.wearY)}
      />
      <RangeSlider
        output
        label={t("arEyewear.calibrate.sliders.nudgeX.label")}
        helpText={t("arEyewear.calibrate.sliders.nudgeX.help")}
        min={-0.05}
        max={0.05}
        step={0.001}
        value={cal.wearX}
        onChange={setField("wearX")}
        suffix={formatMm(cal.wearX)}
      />
      <RangeSlider
        output
        label={t("arEyewear.calibrate.sliders.scale.label")}
        helpText={t("arEyewear.calibrate.sliders.scale.help")}
        min={0.5}
        max={1.8}
        step={0.01}
        value={cal.scale}
        onChange={setField("scale")}
        suffix={`${Math.round(cal.scale * 100)}%`}
      />
    </BlockStack>
  );
}

function formatPct(n) {
  const p = Math.round(n * 100);
  return `${p > 0 ? "+" : ""}${p}%`;
}

function formatMm(n) {
  const mm = Math.round(n * 1000);
  return `${mm > 0 ? "+" : ""}${mm} mm`;
}

function FaceSilhouette() {
  return (
    <svg
      viewBox="0 0 400 500"
      xmlns="http://www.w3.org/2000/svg"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="faceGrad" cx="50%" cy="45%" r="55%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.18)" />
          <stop offset="60%" stopColor="rgba(255,255,255,0.08)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
      </defs>
      {/* Face oval */}
      <ellipse cx="200" cy="240" rx="120" ry="155" fill="url(#faceGrad)" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" />
      {/* Eyes (reference height) */}
      <ellipse cx="155" cy="230" rx="14" ry="7" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" />
      <ellipse cx="245" cy="230" rx="14" ry="7" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" />
      {/* Nose bridge */}
      <path d="M200 232 Q196 275 188 302 L210 302" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
      {/* Mouth */}
      <path d="M170 340 Q200 358 230 340" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
      {/* Eye line reference */}
      <line x1="60" y1="230" x2="340" y2="230" stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="4 6" />
    </svg>
  );
}
