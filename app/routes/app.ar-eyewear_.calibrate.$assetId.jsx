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
                  <FaceSilhouette />
                  <PreviewModel src={data.glbPreviewUrl} cal={cal} />
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
function PreviewModel({ src, cal }) {
  const hostRef = useRef(null);
  const stateRef = useRef({
    THREE: null,
    renderer: null,
    scene: null,
    camera: null,
    calibRot: null,
    wearPosition: null,
    model: null,
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

        // Diagnóstico: eixos (X vermelho, Y verde, Z azul) no origin da cena.
        // Ajuda o lojista a perceber que o preview está a renderizar, mesmo
        // antes do GLB carregar, e também evidencia se o GLB está a ir para
        // dentro do volume visível depois de carregar.
        const axes = new THREE.AxesHelper(0.08);
        axes.name = "omafit-axes";
        scene.add(axes);

        s.renderer = renderer;
        s.scene = scene;
        s.camera = camera;
        s.wearPosition = wearPosition;
        s.calibRot = calibRot;

        const renderOnce = () => {
          const st = stateRef.current;
          if (st.disposed || !st.renderer) return;
          st.renderer.render(st.scene, st.camera);
        };
        s.renderOnce = renderOnce;

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

        const loader = new GLTFLoader();
        loader.setCrossOrigin("anonymous");
        console.log("[calibrate] loading GLB from:", src);
        loader.load(
          src,
          (gltf) => {
            if (cancelled || stateRef.current.disposed) return;
            try {
              const root = gltf.scene || gltf.scenes?.[0];
              if (!root) {
                console.warn("[calibrate] GLB without scene", { src });
                setErrorMsg("O arquivo 3D não contém cena visível.");
                setPhase("error");
                return;
              }
              const box = new THREE.Box3().setFromObject(root);
              if (typeof box.isEmpty === "function" && box.isEmpty()) {
                console.warn("[calibrate] GLB bbox empty", { src });
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
              const baseScale = 0.16 / maxDim;
              root.scale.setScalar(baseScale);
              s.model = root;
              s.size = size.clone().multiplyScalar(baseScale);
              s.baseScale = baseScale;
              calibRot.add(root);

              // Diagnóstico: bbox wireframe azul ciano à volta do GLB. Está
              // dentro de calibRot, portanto roda com o modelo — confirma
              // visualmente que o centro e a escala estão correctos.
              try {
                const bboxHelper = new THREE.Box3Helper(
                  new THREE.Box3(
                    new THREE.Vector3(-size.x / 2, -size.y / 2, -size.z / 2),
                    new THREE.Vector3(size.x / 2, size.y / 2, size.z / 2),
                  ),
                  0x00e0ff,
                );
                bboxHelper.name = "omafit-bbox";
                calibRot.add(bboxHelper);
                s.bboxHelper = bboxHelper;
              } catch (_e) { /* diagnóstico opcional */ }

              applyCalibrationToState(stateRef.current, calRef.current || cal);
              setPhase("ready");
              console.log("[calibrate] GLB loaded ok", {
                src, maxDim, baseScale, size: size.toArray(),
              });
            } catch (e) {
              console.error("[calibrate] gltf setup error", e, { src });
              setErrorMsg(`Erro ao processar o modelo: ${e?.message || e}`);
              setPhase("error");
            }
          },
          (ev) => {
            if (ev && ev.lengthComputable && ev.total > 0) {
              const pct = Math.round((ev.loaded / ev.total) * 100);
              console.log(`[calibrate] GLB loading… ${pct}%`);
            }
          },
          (err) => {
            console.warn("[calibrate] GLTFLoader error", err, { src });
            if (!cancelled) {
              const status = err?.target?.status;
              const statusTxt = err?.target?.statusText;
              const msg =
                err?.message ||
                (status ? `HTTP ${status} ${statusTxt || ""}`.trim() : null) ||
                String(err) ||
                "falha desconhecida";
              setErrorMsg(
                `Não foi possível baixar o arquivo 3D (${msg}). URL: ${src}`,
              );
              setPhase("error");
            }
          },
        );
      })
      .catch((e) => {
        if (cancelled) return;
        console.warn("[calibrate] loadThreeModules error", e);
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
        model: null, bboxHelper: null, size: null, baseScale: 1,
        raf: 0, ro: null, disposed: true,
      };
    };
    
  }, [src]);

  useEffect(() => {
    calRef.current = cal;
    const s = stateRef.current;
    if (!s.renderer || !s.model) return;
    applyCalibrationToState(s, cal);
  }, [cal]);

  return (
    <div ref={hostRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      {phase === "empty" ? (
        <div style={centeredMsgStyle}>—</div>
      ) : phase === "loading" ? (
        <div style={centeredMsgStyle}>Carregando visualizador 3D…</div>
      ) : phase === "error" ? (
        <div style={{ ...centeredMsgStyle, flexDirection: "column", padding: "16px", textAlign: "center" }}>
          <div style={{ marginBottom: 6 }}>Não foi possível carregar o modelo.</div>
          {errorMsg ? (
            <div style={{ fontSize: "11px", opacity: 0.8, maxWidth: "100%", wordBreak: "break-word" }}>
              {errorMsg}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const centeredMsgStyle = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "rgba(255,255,255,0.8)",
  fontSize: "13px",
  pointerEvents: "none",
};

function applyCalibrationToState(s, cal) {
  if (!s || !s.THREE || !s.calibRot || !s.model) return;
  const toRad = (d) => (Number(d) || 0) * Math.PI / 180;
  s.calibRot.rotation.set(toRad(cal.rx), toRad(cal.ry), toRad(cal.rz), "YXZ");
  s.wearPosition.position.set(
    Number(cal.wearX) || 0,
    Number(cal.wearY) || 0,
    Number(cal.wearZ) || 0,
  );
  const sc = Number(cal.scale);
  const effScale = s.baseScale * (Number.isFinite(sc) && sc > 0 ? sc : 1);
  s.model.scale.setScalar(effScale);
  // bbox wireframe precisa ser re-escalado para acompanhar o model.
  if (s.bboxHelper && s.size && s.THREE) {
    const ratio = effScale / s.baseScale;
    s.bboxHelper.scale.setScalar(ratio);
  }
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
        min={-90}
        max={90}
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
        label={t("arEyewear.calibrate.sliders.nudgeY.label")}
        helpText={t("arEyewear.calibrate.sliders.nudgeY.help")}
        min={-0.15}
        max={0.15}
        step={0.005}
        value={cal.wearY}
        onChange={setField("wearY")}
        suffix={formatCm(cal.wearY)}
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
        suffix={formatCm(cal.wearZ)}
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
        suffix={formatCm(cal.wearX)}
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
