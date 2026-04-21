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
  ensureArAccessoryTypeMetafieldDefinition,
  setProductArCalibrationMetafield,
  setProductArAccessoryTypeMetafield,
  setVariantArCalibrationMetafield,
  sanitizeArCalibrationInput,
  defaultArCalibration,
  detectAccessoryType,
  normalizeAccessoryType,
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
    productTitle: productContext?.title || row.product_name || "",
    productImageUrl: productContext?.featuredImageUrl || "",
    glbPreviewUrl,
    productCalibration,
    variants,
    defaultCalibration: defaultArCalibration(accessoryType),
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

/**
 * Three.js via esm.sh — mesma versão e mesmo caminho de módulo que o widget
 * (omafit-ar-widget.js usa 0.150.1 via esm.sh). Usar outra versão traria dois
 * "three" diferentes no navegador, o que quebra instanceof checks no GLTFLoader.
 */
const ESM_THREE_VER = "0.150.1";
const ESM_SH = "https://esm.sh";
const ESM_THREE_URL = `${ESM_SH}/three@${ESM_THREE_VER}/es2022/three.mjs`;
const ESM_GLTF_URL = `${ESM_SH}/three@${ESM_THREE_VER}/examples/jsm/loaders/GLTFLoader.js`;

function loadThreeModules() {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  if (!window.__omafitAdminThreeBundle) {
    window.__omafitAdminThreeBundle = Promise.all([
      import(/* @vite-ignore */ ESM_THREE_URL),
      import(/* @vite-ignore */ ESM_GLTF_URL),
    ]).then(([threeMod, gltfMod]) => ({
      THREE: threeMod,
      GLTFLoader: gltfMod.GLTFLoader,
    })).catch((e) => {
      window.__omafitAdminThreeBundle = null;
      throw e;
    });
  }
  return window.__omafitAdminThreeBundle;
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

  const [cal, setCal] = useState(initialCalibration);
  const lastInitialRef = useRef(initialCalibration);

  useEffect(() => {
    if (lastInitialRef.current !== initialCalibration) {
      lastInitialRef.current = initialCalibration;
      setCal(initialCalibration);
    }
  }, [initialCalibration]);

  // Log o estado inicial da calibração. Se o lojista reportar que o slider
  // "Inclinar lateralmente" se comporta como "Girar esquerda/direita", o
  // primeiro suspeito é um `ry` não-zero herdado de uma calibração anterior
  // (a nossa pipeline agora rota em world-axis, mas é útil confirmar no
  // console qual o ponto de partida).
  useEffect(() => {
    if (typeof console !== "undefined") {
      // eslint-disable-next-line no-console
      console.info("[omafit-calibrate] calibração inicial", {
        target,
        rx: initialCalibration?.rx,
        ry: initialCalibration?.ry,
        rz: initialCalibration?.rz,
        wearX: initialCalibration?.wearX,
        wearY: initialCalibration?.wearY,
        wearZ: initialCalibration?.wearZ,
        scale: initialCalibration?.scale,
      });
    }
  }, [initialCalibration, target]);

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
                  {data.accessoryType === "watch" || data.accessoryType === "bracelet" ? (
                    <HandSilhouette />
                  ) : (
                    <FaceSilhouette />
                  )}
                  <PreviewModel
                    src={data.glbPreviewUrl}
                    cal={cal}
                    accessoryType={data.accessoryType}
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

/**
 * Preview 3D com Three.js puro — usa EXATAMENTE a mesma cadeia de transformações
 * que o widget da loja (mesma versão de three, mesma ordem Euler YXZ, mesmo eixo
 * de rotação por componente). Assim, o que o lojista vê aqui é o que o cliente
 * vai ver no AR.
 *
 * Hierarquia mínima (idêntica ao widget):
 *   scene                                           (widget: anchor.group)
 *     → wearPosition(group, pos=wearX/Y/Z)
 *       → calibRot(group, Euler(rx, ry, rz, "YXZ"))
 *         → glb (bbox centrada na origem e escalado para ~face-width * cal.scale)
 *
 * SEM `centerOffset`/`bridgeY`: todo o deslocamento vertical é controlado por
 * `wearY` em unidades de âncora. A versão anterior tinha `centerOffset` com
 * `pos.y=-bridgeY*size.y`, o que dependia da altura do GLB e criava um braço
 * de alavanca vertical que dava efeitos visuais contra-intuitivos no AR
 * (óculos "acima dos olhos" e "movimentação invertida" quando a cabeça rotava).
 *
 * Não há `mirrorX` em nenhum dos dois lados — análise do código-fonte da MindAR
 * (Estimator.js / face-data.js) confirma que, para cara a olhar para a câmara com
 * `flipFace=true`, `faceMatrix` colapsa para identidade de rotação, logo a âncora
 * já entrega o frame certo. Adicionar um espelho introduziria o "óculos virado
 * pra esquerda" que o lojista via.
 *
 * Diagnósticos (dev-only, visíveis no preview):
 *   - AxesHelper (X vermelho, Y verde, Z azul)
 *   - Bbox wireframe (azul ciano) a envolver o GLB
 *   - URL completa do GLB loggada em caso de erro
 *
 * Escala do preview: `baseScale = 0.16 / maxDim` faz os óculos ocuparem
 * ~face-width no viewport (silhueta de ~240 px num viewport de 400 px, câmara
 * a z=0.45 com FOV 35° → ~0.168 unidades visíveis em mundo = face-width).
 */
/**
 * Tamanho do placeholder (cubo wireframe ciano) que aparece sempre no calibRot:
 * 0.14 × 0.04 × 0.04 m — uma "caixa de óculos" aproximada com as proporções de
 * uma armação típica (~14 cm de largura, ~4 cm de altura/profundidade).
 * Fica semi-transparente por baixo do GLB quando este carrega, mostrando ao
 * lojista a bbox esperada; se o GLB falhar a carregar, serve de referência
 * visual para o lojista conseguir pelo menos experimentar a calibração.
 */
const PLACEHOLDER_SIZE = { x: 0.14, y: 0.04, z: 0.04 };

/**
 * Coincidir COM `OMAFIT_WRIST_AR_WORLD_MAX_DIM` e `OMAFIT_BRACELET_AR_WORLD_MAX_DIM`
 * em `extensions/omafit-theme/assets/omafit-ar-widget.js`. Se mudares aqui,
 * muda também lá (e vice-versa) — senão o tamanho no admin deixa de bater
 * certo com o tamanho no widget da loja.
 */
const PREVIEW_WORLD_MAX_DIM_FACE = 0.16;
const PREVIEW_WORLD_MAX_DIM_WRIST = 0.054;
const PREVIEW_WORLD_MAX_DIM_BRACELET = 0.06;

function PreviewModel({ src, cal, accessoryType = "glasses" }) {
  const hostRef = useRef(null);
  const stateRef = useRef({
    THREE: null,
    renderer: null,
    scene: null,
    camera: null,
    calibRot: null,
    wearPosition: null,
    model: null,
    placeholder: null,
    bboxHelper: null,
    size: null,
    baseScale: 1,
    raf: 0,
    ro: null,
    disposed: false,
  });
  const calRef = useRef(cal);
  const [phase, setPhase] = useState(src ? "loading" : "empty");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!src || typeof window === "undefined") {
      setPhase(src ? "loading" : "empty");
      return undefined;
    }
    const host = hostRef.current;
    if (!host) return undefined;
    stateRef.current.disposed = false;
    setPhase("loading");
    setErrorMsg("");

    let cancelled = false;

    loadThreeModules()
      .then(({ THREE, GLTFLoader }) => {
        if (cancelled) return;
        const s = stateRef.current;
        s.THREE = THREE;

        const width = host.clientWidth || 400;
        const height = host.clientHeight || 500;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(35, width / height, 0.01, 10);
        camera.position.set(0, 0, 0.45);
        camera.lookAt(0, 0, 0);

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(width, height, false);
        renderer.outputEncoding = THREE.sRGBEncoding || renderer.outputEncoding;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.1;
        renderer.domElement.style.position = "absolute";
        renderer.domElement.style.inset = "0";
        renderer.domElement.style.width = "100%";
        renderer.domElement.style.height = "100%";
        renderer.domElement.style.zIndex = "1";
        host.appendChild(renderer.domElement);

        scene.add(new THREE.AmbientLight(0xffffff, 0.85));
        const key = new THREE.DirectionalLight(0xffffff, 0.9);
        key.position.set(0.5, 0.8, 1.2);
        scene.add(key);
        const fill = new THREE.DirectionalLight(0xffffff, 0.35);
        fill.position.set(-0.8, -0.2, 0.6);
        scene.add(fill);

        const wearPosition = new THREE.Group();
        wearPosition.name = "wearPosition";
        scene.add(wearPosition);

        const calibRot = new THREE.Group();
        calibRot.name = "calibRot";
        calibRot.rotation.order = "YXZ";
        wearPosition.add(calibRot);

        // Diagnóstico 1: eixos do MUNDO (fixos na cena, não rodam com a
        // calibração). Servem de referência absoluta para o lojista ver
        // onde é +X (direita), +Y (cima), +Z (fora do ecrã). Ficam um
        // pouco atenuados (depthTest activo) para não poluírem.
        const worldAxes = new THREE.AxesHelper(0.12);
        worldAxes.name = "omafit-world-axes";
        scene.add(worldAxes);

        // Diagnóstico 2: eixos DO MODELO (dentro do calibRot, rodam com
        // ele). São o que indica ao lojista para onde "aponta" o frente
        // (+Z), cima (+Y), direita (+X) do GLB depois de aplicadas as
        // rotações. Usamos depthTest: false e renderOrder alto para que
        // fiquem SEMPRE visíveis, mesmo por cima do GLB opaco — era este
        // o bug anterior: o AxesHelper ficava oculto dentro do modelo
        // opaco, e o lojista só via as rotações sem saber em torno de
        // que eixo estavam a acontecer.
        const modelAxes = new THREE.AxesHelper(0.14);
        modelAxes.name = "omafit-model-axes";
        modelAxes.renderOrder = 999;
        // AxesHelper tem 1 material partilhado por via de LineBasicMaterial:
        // set depthTest:false para o eixo ser desenhado por cima de tudo.
        if (modelAxes.material) {
          modelAxes.material.depthTest = false;
          modelAxes.material.transparent = true;
        }
        calibRot.add(modelAxes);

        // Placeholder: cubo wireframe ciano com proporções de armação
        // real (~14×4×4 cm). Fica SEMPRE visível enquanto o GLB não
        // carrega, e semi-transparente depois (acompanha a rotação e
        // dá contexto de "tamanho e orientação esperados").
        const placeholder = new THREE.Group();
        placeholder.name = "omafit-placeholder";

        const phGeom = new THREE.BoxGeometry(
          PLACEHOLDER_SIZE.x, PLACEHOLDER_SIZE.y, PLACEHOLDER_SIZE.z,
        );
        const phEdges = new THREE.EdgesGeometry(phGeom);
        const phBox = new THREE.LineSegments(
          phEdges,
          new THREE.LineBasicMaterial({
            color: 0x00e0ff,
            transparent: true,
            opacity: 0.8,
          }),
        );
        placeholder.add(phBox);

        calibRot.add(placeholder);
        placeholder.userData.boxMaterial = phBox.material;

        s.renderer = renderer;
        s.scene = scene;
        s.camera = camera;
        s.wearPosition = wearPosition;
        s.calibRot = calibRot;
        s.placeholder = placeholder;
        s.baseScale = 1; // placeholder usa escala 1

        renderer.setAnimationLoop(() => {
          const st = stateRef.current;
          if (st.disposed || !st.renderer) return;
          st.renderer.render(st.scene, st.camera);
        });

        const ro = new ResizeObserver(() => {
          const st = stateRef.current;
          if (!st.renderer || !st.camera) return;
          const w = host.clientWidth || 400;
          const h = host.clientHeight || 500;
          st.camera.aspect = w / h;
          st.camera.updateProjectionMatrix();
          st.renderer.setSize(w, h, false);
        });
        ro.observe(host);
        s.ro = ro;

        // Aplicar calibração imediatamente ao placeholder — dá ao lojista
        // feedback visual dos sliders mesmo antes do GLB carregar.
        applyCalibrationToState(s, calRef.current || cal);

        const loader = new GLTFLoader();
        loader.setCrossOrigin("anonymous");
        console.log("[omafit-calibrate] loading GLB:", src);
        loader.load(
          src,
          (gltf) => {
            if (cancelled || stateRef.current.disposed) return;
            try {
              const root = gltf.scene || gltf.scenes?.[0];
              if (!root) {
                console.warn("[omafit-calibrate] GLB sem cena:", src);
                setErrorMsg("O arquivo 3D não contém cena visível.");
                setPhase("error");
                return;
              }

              // Bake + flatten das transformações do GLB (root + nós filhos).
              // Aplica a matrixWorld de cada mesh (não-skinned, sem morphs)
              // ao próprio geometry clonado e reseta todas as rotações.
              // Resultado: qualquer rotação intrínseca fica bakeada na
              // geometria, e as rotações do calibRot passam a actuar em
              // torno dos eixos do mundo — rz = roll puro (uma ponta sobe,
              // outra desce), ry = yaw puro, rx = pitch puro. Ver comentário
              // paralelo em omafit-ar-widget.js.
              const originalQuat = root.quaternion.clone();
              const rootWasRotated =
                Math.abs(originalQuat.x) > 1e-4 ||
                Math.abs(originalQuat.y) > 1e-4 ||
                Math.abs(originalQuat.z) > 1e-4 ||
                Math.abs(originalQuat.w - 1) > 1e-4;
              let bakedMeshCount = 0;
              let skippedAnimatedMeshCount = 0;
              try {
                bakeGLBTransforms(THREE, root, (info) => {
                  bakedMeshCount = info.baked;
                  skippedAnimatedMeshCount = info.skipped;
                });
              } catch (bakeErr) {
                console.warn(
                  "[omafit-calibrate] bake do GLB falhou, seguindo só com reset do root:",
                  bakeErr?.message || bakeErr,
                );
                root.rotation.set(0, 0, 0);
                root.quaternion.identity();
                root.scale.setScalar(1);
              }
              root.updateMatrix();
              root.updateMatrixWorld(true);

              const box = new THREE.Box3().setFromObject(root);
              if (typeof box.isEmpty === "function" && box.isEmpty()) {
                console.warn("[omafit-calibrate] GLB sem geometria:", src);
                setErrorMsg("O arquivo 3D não contém geometria renderizável.");
                setPhase("error");
                return;
              }
              const size = new THREE.Vector3();
              const center = new THREE.Vector3();
              box.getSize(size);
              box.getCenter(center);
              root.position.sub(center);
              const maxDim = Math.max(size.x, size.y, size.z, 1e-4);
              const worldMax =
                accessoryType === "bracelet"
                  ? PREVIEW_WORLD_MAX_DIM_BRACELET
                  : accessoryType === "watch"
                    ? PREVIEW_WORLD_MAX_DIM_WRIST
                    : PREVIEW_WORLD_MAX_DIM_FACE;
              const baseScale = worldMax / maxDim;
              root.scale.setScalar(baseScale);
              s.model = root;
              s.size = size.clone().multiplyScalar(baseScale);
              s.baseScale = baseScale;
              calibRot.add(root);

              // Placeholder fica mais discreto quando GLB carrega (20% opacity).
              // Mantemos os AxesHelper visíveis (não mexemos) para o lojista
              // continuar a ver +X/+Y/+Z enquanto calibra.
              const phMat = s.placeholder?.userData?.boxMaterial;
              if (phMat) phMat.opacity = 0.2;

              applyCalibrationToState(stateRef.current, calRef.current || cal);
              setPhase("ready");
              console.log("[omafit-calibrate] GLB carregado:", {
                src, maxDim, baseScale, sizeRaw: size.toArray(),
                childMeshCount: countVisibleMeshes(root),
                rootWasRotated,
                rootQuatOriginal: {
                  x: originalQuat.x, y: originalQuat.y,
                  z: originalQuat.z, w: originalQuat.w,
                },
                bakedMeshCount,
                skippedAnimatedMeshCount,
              });
            } catch (e) {
              console.error("[omafit-calibrate] erro no setup do GLB:", e, src);
              setErrorMsg(`Erro ao processar o modelo: ${e?.message || e}`);
              setPhase("error");
            }
          },
          (ev) => {
            if (ev && ev.lengthComputable && ev.total > 0) {
              const pct = Math.round((ev.loaded / ev.total) * 100);
              console.log(`[omafit-calibrate] GLB a descarregar: ${pct}%`);
            }
          },
          (err) => {
            console.warn("[omafit-calibrate] GLTFLoader falhou:", err, src);
            if (!cancelled) {
              const status = err?.target?.status;
              const statusTxt = err?.target?.statusText;
              const msg =
                err?.message ||
                (status ? `HTTP ${status} ${statusTxt || ""}`.trim() : null) ||
                String(err) ||
                "falha desconhecida";
              setErrorMsg(msg);
              setPhase("error");
            }
          },
        );
      })
      .catch((e) => {
        if (cancelled) return;
        console.warn("[omafit-calibrate] falha a carregar Three.js:", e);
        setErrorMsg(`Falha ao carregar o motor 3D: ${e?.message || e}`);
        setPhase("error");
      });

    return () => {
      cancelled = true;
      const s = stateRef.current;
      s.disposed = true;
      if (s.raf) cancelAnimationFrame(s.raf);
      try { s.ro?.disconnect(); } catch { /* no-op */ }
      try {
        if (s.renderer) {
          try { s.renderer.setAnimationLoop(null); } catch { /* no-op */ }
          s.renderer.dispose();
          if (s.renderer.domElement?.parentElement === host) {
            host.removeChild(s.renderer.domElement);
          }
        }
      } catch { /* no-op */ }
      stateRef.current = {
        THREE: null, renderer: null, scene: null, camera: null,
        calibRot: null, wearPosition: null,
        model: null, placeholder: null, bboxHelper: null,
        size: null, baseScale: 1, raf: 0, ro: null, disposed: true,
      };
    };
  }, [src, accessoryType]);

  useEffect(() => {
    calRef.current = cal;
    applyCalibrationToState(stateRef.current, cal);
  }, [cal]);

  return (
    <div ref={hostRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      {/*
        Overlay de status/erro — zIndex: 2 para garantir que fica ACIMA do
        canvas WebGL (o canvas é inserido via appendChild no useEffect, depois
        deste JSX, então sem zIndex explicito o canvas cobria esta div).
      */}
      {phase === "loading" ? (
        <div style={{ ...overlayTopStyle, color: "rgba(255,255,255,0.85)" }}>
          Carregando modelo 3D…
        </div>
      ) : null}
      {phase === "error" ? (
        <div style={{ ...overlayTopStyle, background: "rgba(220,38,38,0.92)" }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            Não foi possível carregar o modelo 3D.
          </div>
          {errorMsg ? (
            <div style={{ fontSize: "11px", opacity: 0.95, wordBreak: "break-word" }}>
              {errorMsg}
            </div>
          ) : null}
          {src ? (
            <div style={{
              fontSize: "10px",
              opacity: 0.8,
              marginTop: 4,
              wordBreak: "break-all",
              fontFamily: "monospace",
            }}>
              URL: {src}
            </div>
          ) : null}
          <div style={{ fontSize: "11px", opacity: 0.9, marginTop: 6 }}>
            Continue a calibrar usando a caixa ciano como referência — os seus
            ajustes serão aplicados ao modelo real no AR.
          </div>
        </div>
      ) : null}
      {phase === "empty" ? (
        <div style={{ ...overlayTopStyle, color: "rgba(255,255,255,0.7)" }}>—</div>
      ) : null}
      {/*
        Legenda de eixos (canto inferior direito). Ajuda o lojista a
        interpretar o que cada slider de rotação faz visualmente.
        Os eixos coloridos aparecem dentro do próprio preview 3D.
      */}
      <div style={legendStyle}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Eixos</div>
        <div><span style={{ color: "#ff4a4a", fontWeight: 700 }}>X</span> vermelho — direita</div>
        <div><span style={{ color: "#3cf06c", fontWeight: 700 }}>Y</span> verde — cima</div>
        <div><span style={{ color: "#4a9bff", fontWeight: 700 }}>Z</span> azul — frente</div>
      </div>
    </div>
  );
}

const legendStyle = {
  position: "absolute",
  right: 10,
  bottom: 10,
  padding: "6px 10px",
  borderRadius: 6,
  background: "rgba(0,0,0,0.55)",
  color: "#fff",
  fontSize: "10px",
  lineHeight: 1.45,
  pointerEvents: "none",
  zIndex: 2,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
};

function countVisibleMeshes(root) {
  let n = 0;
  root.traverse((obj) => {
    if (obj.isMesh && obj.visible) n += 1;
  });
  return n;
}

const overlayTopStyle = {
  position: "absolute",
  top: 12,
  left: 12,
  right: 12,
  padding: "8px 12px",
  borderRadius: 6,
  color: "#fff",
  fontSize: "12px",
  background: "rgba(0,0,0,0.6)",
  pointerEvents: "none",
  zIndex: 2,
  maxHeight: "60%",
  overflow: "auto",
};

/**
 * Bake + flatten das transformações intrínsecas de um GLB.
 *
 * Versão idêntica à do widget AR (`omafit-ar-widget.js`) — mantém as duas
 * pipelines a produzir exactamente o mesmo resultado visual. Ver comentário
 * extenso no widget para detalhes sobre o "porquê" e nas implicações para
 * os sliders de rotação (rz=roll puro, ry=yaw puro, rx=pitch puro).
 */
function bakeGLBTransforms(THREE, root, onDone) {
  if (!root || typeof root.traverse !== "function") return;
  root.updateMatrixWorld(true);

  const meshes = [];
  const skinnedOrMorph = [];
  root.traverse((obj) => {
    if (!obj || !obj.isMesh) return;
    const isSkinned = !!obj.isSkinnedMesh;
    const hasMorph =
      Array.isArray(obj.morphTargetInfluences) &&
      obj.morphTargetInfluences.length > 0;
    if (isSkinned || hasMorph) skinnedOrMorph.push(obj);
    else meshes.push(obj);
  });

  for (const mesh of meshes) {
    mesh.updateMatrixWorld(true);
    const clonedGeom = mesh.geometry.clone();
    clonedGeom.applyMatrix4(mesh.matrixWorld);
    mesh.geometry = clonedGeom;
  }

  for (const mesh of meshes) {
    if (mesh.parent && mesh.parent !== root) mesh.parent.remove(mesh);
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(0, 0, 0);
    mesh.scale.set(1, 1, 1);
    mesh.quaternion.identity();
    mesh.updateMatrix();
    if (mesh.parent !== root) root.add(mesh);
  }

  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.scale.set(1, 1, 1);
  root.quaternion.identity();
  root.updateMatrix();
  root.updateMatrixWorld(true);

  if (typeof onDone === "function") {
    onDone({ baked: meshes.length, skipped: skinnedOrMorph.length });
  }
}

/**
 * Aplica a calibração ao estado do preview.
 *
 * Rotação: usa `rotateOnWorldAxis` em vez de Euler YXZ. Porquê?
 *
 *   Com Euler YXZ (convenção Three.js), `rotation.set(rx, ry, rz, "YXZ")`
 *   aplica rotações INTRÍNSECAS: primeiro em torno de Y do mundo, depois
 *   em torno de X *já rodado por Y*, depois em torno de Z *duplamente
 *   rodado*. Se `ry` é não-zero, o eixo Z "local" deixa de estar
 *   alinhado com Z do mundo — o slider "Inclinar lateralmente" deixa
 *   de produzir roll puro e passa a produzir uma mistura que visualmente
 *   parece yaw (especialmente se `ry` herdou um valor de calibrações
 *   anteriores do mesmo produto).
 *
 *   Com `rotateOnWorldAxis`, cada rotação é sempre em torno de um eixo
 *   FIXO do mundo, independentemente dos outros sliders. Resultado:
 *     • Slider "Rodar cima/baixo" (rx) → sempre pitch em torno do X mundo.
 *     • Slider "Rodar esquerda/direita" (ry) → sempre yaw em torno do Y mundo.
 *     • Slider "Inclinar lateralmente" (rz) → sempre roll em torno do Z mundo.
 *
 *   Ordem de composição: Y → X → Z (mantém intuição de "primeiro enquadro
 *   horizontal, depois afino vertical, depois incliner"). Duas calibrações
 *   com os mesmos 3 valores produzem exactamente a mesma orientação — os
 *   produtos já guardados continuam a render igual.
 */
function applyCalibrationToState(s, cal) {
  if (!s || !s.THREE || !s.calibRot) return;
  const THREE = s.THREE;
  const toRad = (d) => (Number(d) || 0) * Math.PI / 180;
  const rxRad = toRad(cal.rx);
  const ryRad = toRad(cal.ry);
  const rzRad = toRad(cal.rz);

  if (!s.worldAxes) {
    s.worldAxes = {
      X: new THREE.Vector3(1, 0, 0),
      Y: new THREE.Vector3(0, 1, 0),
      Z: new THREE.Vector3(0, 0, 1),
    };
  }
  s.calibRot.quaternion.identity();
  if (ryRad) s.calibRot.rotateOnWorldAxis(s.worldAxes.Y, ryRad);
  if (rxRad) s.calibRot.rotateOnWorldAxis(s.worldAxes.X, rxRad);
  if (rzRad) s.calibRot.rotateOnWorldAxis(s.worldAxes.Z, rzRad);
  s.calibRot.updateMatrix();
  s.calibRot.updateMatrixWorld(true);

  s.wearPosition.position.set(
    Number(cal.wearX) || 0,
    Number(cal.wearY) || 0,
    Number(cal.wearZ) || 0,
  );
  const sc = Number(cal.scale);
  const mul = Number.isFinite(sc) && sc > 0 ? sc : 1;

  if (s.model) {
    s.model.scale.setScalar(s.baseScale * mul);
  }
  if (s.placeholder) {
    s.placeholder.scale.setScalar(mul);
  }

  if (typeof console !== "undefined" && console.debug) {
    // Exporta onde cada axis do calibRot aponta actualmente, em world-space.
    // Ajuda a confirmar visualmente: se rz=45°, o eixo Z do calibRot deve
    // continuar a apontar ~paralelo ao Z do mundo (não rodar para o lado).
    const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(s.calibRot.quaternion);
    const ay = new THREE.Vector3(0, 1, 0).applyQuaternion(s.calibRot.quaternion);
    const az = new THREE.Vector3(0, 0, 1).applyQuaternion(s.calibRot.quaternion);
    console.debug("[omafit-calibrate] apply", {
      rxDeg: cal.rx, ryDeg: cal.ry, rzDeg: cal.rz,
      calibRotXinWorld: [ax.x.toFixed(3), ax.y.toFixed(3), ax.z.toFixed(3)],
      calibRotYinWorld: [ay.x.toFixed(3), ay.y.toFixed(3), ay.z.toFixed(3)],
      calibRotZinWorld: [az.x.toFixed(3), az.y.toFixed(3), az.z.toFixed(3)],
    });
  }
}


function CalibrationSliders({ cal, setField, setCal, t, accessoryType = "glasses" }) {
  const resetRotation = () => {
    setCal((prev) => ({ ...prev, rx: 0, ry: 0, rz: 0 }));
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
      <RangeSlider
        output
        label={tt("arEyewear.calibrate.sliders.tilt.label")}
        helpText={tt("arEyewear.calibrate.sliders.tilt.help")}
        min={-180}
        max={180}
        step={1}
        value={cal.rx}
        onChange={setField("rx")}
        suffix={`${cal.rx}°`}
      />
      <RangeSlider
        output
        label={tt("arEyewear.calibrate.sliders.yaw.label")}
        helpText={tt("arEyewear.calibrate.sliders.yaw.help")}
        min={-180}
        max={180}
        step={1}
        value={cal.ry}
        onChange={setField("ry")}
        suffix={`${cal.ry}°`}
      />
      <RangeSlider
        output
        label={tt("arEyewear.calibrate.sliders.roll.label")}
        helpText={tt("arEyewear.calibrate.sliders.roll.help")}
        min={-180}
        max={180}
        step={1}
        value={cal.rz}
        onChange={setField("rz")}
        suffix={`${cal.rz}°`}
      />

      {/*
        Altura/Y: agora é o único controlo vertical (bridgeY removido do pipeline).
        Range ±0.15 em unidades de âncora ≈ ±2.1 cm em mundo (1 unit ≈ 14 cm).
        Isso dá margem para descer os óculos da ponte do nariz (landmark 168)
        até à linha dos olhos sem precisar de outros controlos.
      */}
      <RangeSlider
        output
        label={tt("arEyewear.calibrate.sliders.nudgeY.label")}
        helpText={tt("arEyewear.calibrate.sliders.nudgeY.help")}
        min={-0.15}
        max={0.15}
        step={0.005}
        value={cal.wearY}
        onChange={setField("wearY")}
        suffix={formatCm(cal.wearY)}
      />
      <RangeSlider
        output
        label={tt("arEyewear.calibrate.sliders.depth.label")}
        helpText={tt("arEyewear.calibrate.sliders.depth.help")}
        min={-0.05}
        max={0.05}
        step={0.001}
        value={cal.wearZ}
        onChange={setField("wearZ")}
        suffix={formatCm(cal.wearZ)}
      />
      <RangeSlider
        output
        label={tt("arEyewear.calibrate.sliders.nudgeX.label")}
        helpText={tt("arEyewear.calibrate.sliders.nudgeX.help")}
        min={-0.05}
        max={0.05}
        step={0.001}
        value={cal.wearX}
        onChange={setField("wearX")}
        suffix={formatCm(cal.wearX)}
      />
      <RangeSlider
        output
        label={tt("arEyewear.calibrate.sliders.scale.label")}
        helpText={tt("arEyewear.calibrate.sliders.scale.help")}
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

/**
 * Formata offsets expressos em unidades de âncora da MindAR (≈14 cm/unit em mundo).
 * Mostrar em cm é mais intuitivo para o lojista do que mm ou fracções.
 */
function formatCm(n) {
  const cm = n * 14;
  const rounded = Math.round(cm * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toFixed(1)} cm`;
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

function HandSilhouette() {
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
        <radialGradient id="handGrad" cx="50%" cy="50%" r="55%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.18)" />
          <stop offset="60%" stopColor="rgba(255,255,255,0.08)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
      </defs>
      {/* Forearm */}
      <rect x="150" y="330" width="100" height="160" rx="50" fill="url(#handGrad)" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" />
      {/* Wrist line (reference for watch/bracelet) */}
      <line x1="140" y1="340" x2="260" y2="340" stroke="rgba(255,255,255,0.45)" strokeWidth="2" strokeDasharray="6 4" />
      {/* Palm */}
      <path
        d="M170 335 Q162 260 178 200 Q188 170 200 170 Q214 170 220 200 Q236 260 230 335 Z"
        fill="url(#handGrad)"
        stroke="rgba(255,255,255,0.25)"
        strokeWidth="1.5"
      />
      {/* Thumb */}
      <path d="M172 300 Q130 270 128 230 Q130 210 148 212 Q168 218 178 250" fill="url(#handGrad)" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" />
      {/* Index */}
      <path d="M184 200 Q180 130 188 100 Q196 90 200 100 Q204 130 200 200" fill="url(#handGrad)" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" />
      {/* Middle */}
      <path d="M200 200 Q198 115 206 80 Q214 72 218 82 Q222 115 216 200" fill="url(#handGrad)" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" />
      {/* Ring */}
      <path d="M216 200 Q216 125 224 95 Q232 88 234 98 Q236 125 230 200" fill="url(#handGrad)" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" />
      {/* Pinky */}
      <path d="M230 205 Q232 150 238 128 Q244 122 246 130 Q248 160 240 205" fill="url(#handGrad)" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" />
      {/* Center dot (wrist anchor reference) */}
      <circle cx="200" cy="340" r="4" fill="rgba(255,255,255,0.55)" />
    </svg>
  );
}
