/**
 * /app/ar-eyewear/calibrate/:assetId
 *
 * Página admin: o lojista ajusta rotação/escala do acessório no provador AR
 * (textos em i18n: arEyewear.calibrate.*). Persistência em metafields Shopify.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useLoaderData, useFetcher, useNavigate, useSearchParams } from "react-router-dom";
import { redirect } from "react-router";
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
  Divider,
  Badge,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { ensureShopHasActiveBilling } from "../billing-access.server";
import {
  sanitizeArCalibrationInput,
  defaultArCalibration,
  buildCalibrationForRotationEditor,
  snapArRotationFineDeg,
  AR_GLASSES_ROTATION_MIN_DEG,
  AR_GLASSES_ROTATION_MAX_DEG,
  AR_GLASSES_ROTATION_STEP_DEG,
  AR_GLASSES_DEPTH_MIN_M,
  AR_GLASSES_DEPTH_MAX_M,
  AR_GLASSES_DEPTH_STEP_M,
  AR_GLASSES_SCALE_DEFAULT,
  AR_GLASSES_SCALE_MIN,
  AR_GLASSES_SCALE_MAX,
  AR_GLASSES_SCALE_STEP,
  AR_NECKLACE_SCALE_MIN,
  AR_NECKLACE_SCALE_MAX,
  AR_NECKLACE_SCALE_STEP,
} from "../ar-calibration.shared.js";
import {
  detectAccessoryType,
  normalizeAccessoryType,
} from "../ar-accessory-type.shared.js";
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
  const { Buffer } = await import("node:buffer");
  const {
    getAssetById,
    getShopArEyewearEnabled,
    fetchProductArCalibrationContext,
    ensureArAccessoryTypeMetafieldDefinition,
    setProductArAccessoryTypeMetafield,
    storageCreateSignedUrl,
  } = await import("../ar-eyewear.server.js");

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
      glbPreviewUrl = await storageCreateSignedUrl(parsed.bucket, parsed.path, 60 * 60 * 24);
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

  /**
   * Deteção preferindo SEMPRE o produto actual (tags + categoria + título)
   * sobre o valor em BD — que pode estar desactualizado (ex.: criado antes
   * da deteção por categoria taxonómica). Só caímos para a BD quando não
   * conseguimos carregar o contexto do produto.
   *
   * Persiste o valor corrigido em: (1) `ar_eyewear_assets.accessory_type`
   * (fire-and-forget) e (2) metafield `omafit.ar_accessory_type` no produto,
   * para o Liquid servir o widget com o tipo certo.
   */
  const dbType = normalizeAccessoryType(row.accessory_type);
  const freshType = productContext
    ? detectAccessoryType({
        tags: productContext.tags,
        productType: productContext.productType,
        categoryFullName: productContext.categoryFullName,
        title: productContext.title,
      })
    : null;
  const accessoryType = freshType || dbType || "glasses";

  if (freshType && freshType !== row.accessory_type && row.id) {
    // Atualizar DB sem bloquear o render.
    import("../ar-eyewear.server.js")
      .then(({ patchAsset }) =>
        patchAsset(row.id, { accessory_type: freshType }),
      )
      .catch((e) =>
        console.warn(
          "[calibrate] patch accessory_type falhou:",
          e?.message || e,
        ),
      );
  }
  if (freshType && row.product_id) {
    (async () => {
      try {
        await ensureArAccessoryTypeMetafieldDefinition(admin);
        await setProductArAccessoryTypeMetafield(
          admin,
          row.product_id,
          freshType,
        );
      } catch (e) {
        console.warn(
          "[calibrate] setProductArAccessoryTypeMetafield loader:",
          e?.message || e,
        );
      }
    })();
  }

  const productCalibration =
    productContext?.productCalibration || defaultArCalibration(accessoryType);

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
      accessory_type: accessoryType,
    },
    accessoryType,
    wearableClass: String(row.wearable_class || "").trim() || null,
    productTitle: productContext?.title || row.product_name || "",
    productImageUrl: productContext?.featuredImageUrl || "",
    glbPreviewUrl,
    productCalibration,
    variants,
    defaultCalibration: defaultArCalibration(accessoryType),
  };
}

export async function action({ request, params }) {
  const {
    getAssetById,
    getShopArEyewearEnabled,
    ensureArCalibrationMetafieldDefinition,
    ensureArAccessoryTypeMetafieldDefinition,
    setProductArCalibrationMetafield,
    setProductArAccessoryTypeMetafield,
    setVariantArCalibrationMetafield,
  } = await import("../ar-eyewear.server.js");

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
  const calibration = sanitizeArCalibrationInput(body?.calibration, row.accessory_type);
  const target = String(body?.target || "product").toLowerCase();
  const variantGid = body?.variantGid ? String(body.variantGid) : "";

  try {
    await ensureArCalibrationMetafieldDefinition(admin);
    if (target === "variant" && variantGid) {
      await setVariantArCalibrationMetafield(
        admin,
        variantGid,
        calibration,
        row.accessory_type,
      );
    } else {
      await setProductArCalibrationMetafield(
        admin,
        row.product_id,
        calibration,
        row.accessory_type,
      );
    }
    // Sincroniza o metafield `omafit.ar_accessory_type` com o tipo guardado
    // em BD (re-detecção feita no loader). Assim o Liquid serve sempre o
    // tipo correcto ao widget, sem depender de tags/categoria em runtime.
    // Best-effort: nunca bloqueia o salvar da calibração.
    if (row?.accessory_type && row?.product_id) {
      try {
        await ensureArAccessoryTypeMetafieldDefinition(admin);
        await setProductArAccessoryTypeMetafield(
          admin,
          row.product_id,
          row.accessory_type,
        );
      } catch (metaErr) {
        console.warn(
          "[ar-eyewear.calibrate] setProductArAccessoryTypeMetafield falhou:",
          metaErr?.message || metaErr,
        );
      }
    }
    return Response.json({ ok: true, calibration, target, variantGid });
  } catch (e) {
    return Response.json(
      { error: e?.message || "save_failed" },
      { status: 500 },
    );
  }
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

  const [cal, setCal] = useState(() =>
    buildCalibrationForRotationEditor(
      data.defaultCalibration,
      initialCalibration,
      data.accessoryType,
    ),
  );
  const lastInitialRef = useRef(initialCalibration);

  useEffect(() => {
    if (lastInitialRef.current !== initialCalibration) {
      lastInitialRef.current = initialCalibration;
      setCal(
        buildCalibrationForRotationEditor(
          data.defaultCalibration,
          initialCalibration,
          data.accessoryType,
        ),
      );
    }
  }, [initialCalibration, data.defaultCalibration, data.accessoryType]);

  // Log o estado inicial da calibração. Se o lojista reportar que o slider
  // "Inclinar lateralmente" se comporta como "Girar esquerda/direita", o
  // primeiro suspeito é um `ry` não-zero herdado de uma calibração anterior
  // (a nossa pipeline agora rota em world-axis, mas é útil confirmar no
  // console qual o ponto de partida).
  useEffect(() => {
    if (typeof console !== "undefined") {
      // eslint-disable-next-line no-console
      console.info("[omafit-calibrate] calibração inicial (só rotação editável)", {
        target,
        rx: initialCalibration?.rx,
        ry: initialCalibration?.ry,
        rz: initialCalibration?.rz,
      });
    }
  }, [initialCalibration, target]);

  const isSaving = fetcher.state !== "idle";
  const saveResult = fetcher.data;

  const setField = (field) => (val) => {
    const v = Array.isArray(val) ? val[0] : val;
    setCal((prev) =>
      sanitizeArCalibrationInput({ ...prev, [field]: Number(v) }, data.accessoryType),
    );
  };

  const handleReset = () => {
    setCal(sanitizeArCalibrationInput({ ...data.defaultCalibration }, data.accessoryType));
  };

  const handleSave = () => {
    const toSave =
      data.accessoryType === "bracelet"
        ? sanitizeArCalibrationInput({ ...cal, rx: 0, ry: 0 }, data.accessoryType)
        : sanitizeArCalibrationInput(cal, data.accessoryType);
    fetcher.submit(
      {
        calibration: toSave,
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

  const hasChanges = useMemo(() => {
    const saved = buildCalibrationForRotationEditor(
      data.defaultCalibration,
      initialCalibration,
      data.accessoryType,
    );
    if (data.accessoryType === "bracelet") {
      return cal.rz !== saved.rz;
    }
    const hasRotationChanges = cal.rx !== saved.rx || cal.ry !== saved.ry || cal.rz !== saved.rz;
    if (data.accessoryType === "glasses") {
      return hasRotationChanges || cal.wearZ !== saved.wearZ || cal.scale !== saved.scale;
    }
    if (data.accessoryType === "necklace") {
      return (
        hasRotationChanges ||
        cal.scale !== saved.scale
      );
    }
    return hasRotationChanges;
  }, [cal, initialCalibration, data.defaultCalibration, data.accessoryType]);

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
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">
                  {data.productTitle || data.asset.product_name || t("arEyewear.productUnknown")}
                </Text>
                <InlineStack gap="200" wrap>
                  <Badge tone="info">{t(`arEyewear.status.${data.asset.status}`)}</Badge>
                  <Badge tone="attention">
                    {t(`arEyewear.accessoryType.${data.accessoryType}`) ||
                      data.accessoryType}
                  </Badge>
                </InlineStack>
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

              <CalibrationSliders
                cal={cal}
                setField={setField}
                setCal={setCal}
                t={t}
                accessoryType={data.accessoryType}
              />

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
/** Rotação −180°…180° em passos de 5° (todos os tipos de acessório). */
function RotationFineSlider({ label, helpText, value, onChange }) {
  const snapped = snapArRotationFineDeg(value);
  return (
    <BlockStack gap="200">
      <RangeSlider
        output
        label={label}
        helpText={helpText}
        min={AR_GLASSES_ROTATION_MIN_DEG}
        max={AR_GLASSES_ROTATION_MAX_DEG}
        step={AR_GLASSES_ROTATION_STEP_DEG}
        value={snapped}
        onChange={(v) => {
          const raw = Array.isArray(v) ? v[0] : v;
          onChange(snapArRotationFineDeg(raw));
        }}
        suffix={`${snapped}°`}
      />
    </BlockStack>
  );
}

/** Óculos: profundidade (distância do rosto) em metros. */
function DepthSlider({ label, helpText, value, onChange }) {
  const clamped = Math.max(
    AR_GLASSES_DEPTH_MIN_M,
    Math.min(AR_GLASSES_DEPTH_MAX_M, Number(value) || 0),
  );
  return (
    <BlockStack gap="200">
      <RangeSlider
        output
        label={label}
        helpText={helpText}
        min={AR_GLASSES_DEPTH_MIN_M}
        max={AR_GLASSES_DEPTH_MAX_M}
        step={AR_GLASSES_DEPTH_STEP_M}
        value={clamped}
        onChange={(v) => {
          const raw = Array.isArray(v) ? v[0] : v;
          onChange(Number(raw));
        }}
        suffix={`${(clamped * 1000).toFixed(0)}mm`}
      />
    </BlockStack>
  );
}

/** Óculos: escala (tamanho) — 50% = padrão da loja; 100% = 2× o padrão. */
function ScaleSlider({ label, helpText, value, onChange }) {
  const clamped = Math.max(
    AR_GLASSES_SCALE_MIN,
    Math.min(AR_GLASSES_SCALE_MAX, Number(value) || AR_GLASSES_SCALE_DEFAULT),
  );
  const percentage = Math.round(clamped * 100);
  return (
    <BlockStack gap="200">
      <RangeSlider
        output
        label={label}
        helpText={helpText}
        min={AR_GLASSES_SCALE_MIN}
        max={AR_GLASSES_SCALE_MAX}
        step={AR_GLASSES_SCALE_STEP}
        value={clamped}
        onChange={(v) => {
          const raw = Array.isArray(v) ? v[0] : v;
          onChange(Number(raw));
        }}
        suffix={`${percentage}%`}
      />
    </BlockStack>
  );
}

/** Colar: só "Tamanho" (escala fina sobre o fit automático ~36 cm). */
function NecklaceScaleSlider({ label, helpText, value, onChange }) {
  const clamped = Math.max(
    AR_NECKLACE_SCALE_MIN,
    Math.min(AR_NECKLACE_SCALE_MAX, Number(value) || 1),
  );
  const percentage = Math.round(clamped * 100);
  return (
    <BlockStack gap="200">
      <RangeSlider
        output
        label={label}
        helpText={helpText}
        min={AR_NECKLACE_SCALE_MIN}
        max={AR_NECKLACE_SCALE_MAX}
        step={AR_NECKLACE_SCALE_STEP}
        value={clamped}
        onChange={(v) => {
          const raw = Array.isArray(v) ? v[0] : v;
          onChange(Number(raw));
        }}
        suffix={`${percentage}%`}
      />
    </BlockStack>
  );
}

function CalibrationSliders({ cal, setField, setCal, t, accessoryType = "glasses" }) {
  const isBracelet = accessoryType === "bracelet";
  const isGlasses = accessoryType === "glasses";
  const isNecklace = accessoryType === "necklace";
  const RotationSlider = RotationFineSlider;
  const resetRotation = () => {
    const def = defaultArCalibration(accessoryType);
    setCal((prev) =>
      sanitizeArCalibrationInput(
        { ...prev, rx: def.rx, ry: def.ry, rz: def.rz },
        accessoryType,
      ),
    );
  };
  /**
   * Tenta primeiro a key tipada (sibling `${leaf}ByType.<type>`) e só cai
   * para a key genérica se a tipada devolver a própria key (sinal de que
   * não existe no dicionário). Exemplo:
   *   baseKey="arEyewear.calibrate.sliders.tilt.help"
   *   tipada="arEyewear.calibrate.sliders.tilt.helpByType.watch"
   */
  const tt = (baseKey) => {
    const parts = baseKey.split(".");
    const leaf = parts.pop();
    const typedKey = [...parts, `${leaf}ByType`, accessoryType].join(".");
    const typed = t(typedKey);
    if (typed && typed !== typedKey) return typed;
    return t(baseKey);
  };

  if (isNecklace) {
    return (
      <BlockStack gap="300">
        <Text as="p" tone="subdued">
          {t("arEyewear.calibrate.necklaceSlidersIntro")}
        </Text>
        <InlineStack align="space-between" blockAlign="center" gap="200">
          <Text as="h4" variant="headingSm">
            {t("arEyewear.calibrate.sliders.rotationGroup")}
          </Text>
          <Button size="slim" onClick={resetRotation}>
            {t("arEyewear.calibrate.sliders.rotationReset")}
          </Button>
        </InlineStack>
        <RotationFineSlider
          label={tt("arEyewear.calibrate.sliders.tilt.label")}
          helpText={tt("arEyewear.calibrate.sliders.tilt.help")}
          value={cal.rx}
          onChange={setField("rx")}
        />
        <RotationFineSlider
          label={tt("arEyewear.calibrate.sliders.pan.label")}
          helpText={tt("arEyewear.calibrate.sliders.pan.help")}
          value={cal.ry}
          onChange={setField("ry")}
        />
        <RotationFineSlider
          label={tt("arEyewear.calibrate.sliders.roll.label")}
          helpText={tt("arEyewear.calibrate.sliders.roll.help")}
          value={cal.rz}
          onChange={setField("rz")}
        />
        <NecklaceScaleSlider
          label={t("arEyewear.calibrate.sliders.scale.label")}
          helpText={tt("arEyewear.calibrate.sliders.scale.help")}
          value={cal.scale}
          onChange={setField("scale")}
        />
      </BlockStack>
    );
  }

  if (isBracelet) {
    return (
      <BlockStack gap="300">
        <Text as="p" tone="subdued">
          {t("arEyewear.calibrate.braceletSlidersIntro")}
        </Text>
        <InlineStack align="space-between" blockAlign="center" gap="200">
          <Text as="h4" variant="headingSm">
            {t("arEyewear.calibrate.sliders.rotationGroup")}
          </Text>
          <Button size="slim" onClick={resetRotation}>
            {t("arEyewear.calibrate.sliders.rotationReset")}
          </Button>
        </InlineStack>
        <RotationFineSlider
          label={tt("arEyewear.calibrate.sliders.roll.label")}
          helpText={tt("arEyewear.calibrate.sliders.roll.help")}
          value={cal.rz}
          onChange={setField("rz")}
        />
      </BlockStack>
    );
  }

  return (
    <BlockStack gap="300">
      <InlineStack align="space-between" blockAlign="center" gap="200">
        <Text as="h4" variant="headingSm">
          {t("arEyewear.calibrate.sliders.rotationGroup") || "Rotação"}
        </Text>
        <Button size="slim" onClick={resetRotation}>
          {t("arEyewear.calibrate.sliders.rotationReset") || "Reiniciar rotação"}
        </Button>
      </InlineStack>
      <RotationSlider
        label={tt("arEyewear.calibrate.sliders.tilt.label")}
        helpText={tt("arEyewear.calibrate.sliders.tilt.help")}
        value={cal.rx}
        onChange={setField("rx")}
      />
      <RotationSlider
        label={tt("arEyewear.calibrate.sliders.yaw.label")}
        helpText={tt("arEyewear.calibrate.sliders.yaw.help")}
        value={cal.ry}
        onChange={setField("ry")}
      />
      <RotationSlider
        label={tt("arEyewear.calibrate.sliders.roll.label")}
        helpText={tt("arEyewear.calibrate.sliders.roll.help")}
        value={cal.rz}
        onChange={setField("rz")}
      />
      {isGlasses && (
        <>
          <Divider />
          <ScaleSlider
            label={t("arEyewear.calibrate.sliders.scale.label") || "Tamanho do óculos"}
            helpText={
              t("arEyewear.calibrate.sliders.scale.help") ||
              "50% = tamanho padrão no provador; 100% = o dobro. O mesmo valor aplica-se na loja."
            }
            value={cal.scale}
            onChange={setField("scale")}
          />
          <DepthSlider
            label={t("arEyewear.calibrate.sliders.depth.label") || "Profundidade"}
            helpText={
              t("arEyewear.calibrate.sliders.depth.help") ||
              "Deslocamento em metros ao longo da frente da face (eixo profundidade). Negativo aproxima, positivo afasta — igual no widget."
            }
            value={cal.wearZ}
            onChange={setField("wearZ")}
          />
        </>
      )}
    </BlockStack>
  );
}

