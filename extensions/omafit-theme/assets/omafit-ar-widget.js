/**
 * MindAR óculos no tema (via bloco Omafit embed) — etapa "info" alinhada ao TryOnWidget + link como omafit-widget.js.
 * Fluxo: (1) modal info → (2) AR com câmera (MindAR.js face tracking + Three.js).
 *
 * Referência de UX (filtro de óculos no Instagram / Facebook): esses efeitos
 * usam Spark AR no app nativo — malha facial densa, oclusão e iluminação
 * próprias do runtime. No Web não há Spark AR; o equivalente prático aqui é
 * MindAR (MediaPipe Face Mesh + solvePnP + One Euro por landmark), com
 * calibração do lojista e defaults de filtro/resolução afinados para aproximar
 * a estabilidade “tipo Instagram” dentro do que o browser permite.
 *
 * @see https://github.com/hiukim/mind-ar-js
 * @see https://hiukim.github.io/mind-ar-js-doc/face-tracking-examples/tryon
 */
/**
 * Regras de renderização (AR face + try-on) que este ficheiro segue:
 *
 * 1) Um só runtime Three — o mesmo URL de módulo que GLTFLoader e MindAR puxam no esm.sh
 *    (`…/es2022/three.mjs` + `deps=three@VERSÃO`), sem `bundle` no MindAR.
 *
 * 2) Pipeline simples ("filtro do Instagram") — idêntica ao preview do admin:
 *      anchor.group (MindAR landmark 168)
 *        → wearPosition (offset XYZ em unidades de face: wearX/Y/Z)
 *          → calibRot (Euler YXZ do data-ar-canonical-fix-yxz, defaults 0,0,0)
 *            → glasses (GLB centrado (bbox→origem) e escalado para ~1 unidade de face).
 *
 *    Motivo desta simplificação (Abr/2026):
 *      A versão anterior tinha um `centerOffset` com `y = -bridgeY * sz.y * baseUnitScale`.
 *      Como o offset era calculado em unidades do GLB (sz.y) e estava FORA da calibRot,
 *      o comportamento dependia da geometria do GLB (altura da bbox) e criava um
 *      "braço de alavanca" vertical que provocava efeitos visuais contra-intuitivos
 *      quando a cabeça rotacionava (óculos pareciam "descer" quando a cabeça subia).
 *
 *      Agora TODO o deslocamento vertical é feito por `wearY` (em unidades de âncora,
 *      i.e. multiplicadas por ~14cm em mundo). `bridgeY` continua no schema por
 *      retro-compatibilidade mas é IGNORADO pelo pipeline. O lojista usa `wearY`
 *      (range alargado ±0.15 → ±2.1cm) para descer os óculos do landmark 168
 *      (ponte do nariz, tipicamente acima dos olhos) até à linha dos olhos.
 *
 *    Sem heurísticas (`glbWideAlign`, sign-fix, `ipdSnap`, `mirrorX`, `poseInvert`).
 *    A calibração do lojista é a única fonte de verdade para a orientação.
 *
 *    Nota sobre MindAR / MediaPipe:
 *      - Quando `flipFace=true` (default selfie), a MindAR inverte o frame ANTES da detecção
 *        (ver `controller.js: processVideo → scale(-1, 1)`). Em seguida o solvePnP é feito
 *        sobre imagem e modelo canónico com mesma convenção de eixos, e a `faceMatrix` final
 *        é construída negando as linhas Y e Z do `rvec` (converte OpenCV Y-down → Three Y-up
 *        e OpenCV +Z forward → Three -Z). Para uma cara olhando direito para a câmara,
 *        estes efeitos cancelam-se e `anchor.group.matrix` ≈ `Identity × Translation`.
 *        Por isso não precisamos de nenhum `mirrorX` aqui — aplicá-lo gera o "óculos virado
 *        pra esquerda" (reflexão horizontal extra).
 *
 * 3) Espelho selfie só via opções MindAR (`disableFaceMirror` / data attribute), sem CSS scaleX no vídeo.
 *
 * 4) Escala — CRÍTICO:
 *    `anchor.group.matrix` multiplica os filhos por `faceScale` (ver `controller.js:
 *    getLandmarkMatrix: fm * s`). `faceScale` vem do canonical face do MediaPipe e é
 *    ~14 "unidades canónicas" (largura da cara).
 *    Portanto, para obter óculos ~1× a largura da cara, o GLB precisa estar em ~1 unidade
 *    de largura no espaço local da âncora. Logo: `baseUnitScale = 1/maxDim × modelScaleMul`.
 *    (O `0.085` antigo produzia óculos com ~1cm num rosto de 14 — invisível.)
 *
 * 5) GLB tem qualquer orientação — o lojista calibra na ferramenta visual do admin.
 */
const ESM_THREE_VER = "0.150.1";
const ESM_SH = "https://esm.sh";
/** Mesmo ficheiro que o GLTFLoader do esm.sh importa — evita dois módulos `three`. */
const ESM_THREE_MJS = `${ESM_SH}/three@${ESM_THREE_VER}/es2022/three.mjs`;
const ESM_GLTF_MIND = `${ESM_SH}/three@${ESM_THREE_VER}/examples/jsm/loaders/GLTFLoader.js`;
/** Sem `bundle`: `three` deduplica com `ESM_THREE_MJS`. */
const ESM_MINDAR_FACE_THREE = `${ESM_SH}/mind-ar@1.2.5/dist/mindar-face-three.prod.js?deps=three@${ESM_THREE_VER}`;

/**
 * MediaPipe Tasks Vision para hand tracking (relógios, pulseiras).
 * Só é carregado sob demanda quando `data-ar-tracking-stack="hand"`.
 *
 * - `tasks-vision` expõe `HandLandmarker` com `detectForVideo`.
 * - Import directo do npm via jsDelivr (`vision_bundle.mjs`) — o URL bare no
 *   esm.sh (`…/tasks-vision@0.10.x` sem entry) passou a responder 404.
 * - WASM + modelo vêm do mesmo pacote em `/wasm` no jsDelivr.
 *
 * @see https://developers.google.com/mediapipe/solutions/vision/hand_landmarker/web_js
 */
const MEDIAPIPE_VISION_VER = "0.10.34";
/** Bundle ESM oficial do pacote npm (alinha com `module` em package.json). */
const MEDIAPIPE_VISION_BUNDLE =
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VISION_VER}/vision_bundle.mjs`;
const MEDIAPIPE_WASM_BASE =
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VISION_VER}/wasm`;
const MEDIAPIPE_HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task";

/**
 * Escala de mundo para relógio/pulseira após bbox (`baseScale = worldMax / maxDim`).
 *   - Relógio: 0,062 m → bbox máx. 62 mm (mostrador 40 mm + strap fino nos lados).
 *   - Pulseira: 0,068 m → bbox máx. 68 mm (pulseiras tipicamente mais largas).
 * **Não** usar 0,16 (isso é para óculos/colar no preview facial). Tem de coincidir
 * com `PreviewModel` em `app.ar-eyewear_.calibrate.$assetId.jsx` quando
 * `accessoryType` é watch/bracelet.
 *
 * Subi de 0,054/0,060 para 0,062/0,068 porque mesmo com GLBs justos o
 * utilizador reportou que o relógio ficava visivelmente pequeno no pulso.
 * O multiplicador de calibração (0,3–3×) continua disponível por cima.
 */
/**
 * Dimensão-alvo em mundo (metros) para o diâmetro efectivo do acessório
 * quando posto no pulso.
 *
 *  • Relógios — 0,072 m (72 mm) é o comprimento da maior dimensão do bbox
 *    (tipicamente o eixo da correia esticada + face). Um pulso adulto com
 *    perímetro 170-190 mm tem diâmetro 54-60 mm, por isso o GLB precisa
 *    de esticar ≈ 20 % para cobrir a maior parte da circunferência. Antes
 *    (0,062) sobrava pele visível no lado palmar; 0,072 fecha o gap.
 *  • Pulseiras — escaladas pela **MEDIANA** do bbox (ver `fitBraceletGlb`),
 *    não pelo máximo. Isto garante que o anel da pulseira tem diâmetro
 *    correcto para envolver o pulso em vez de ficar minúsculo porque a
 *    dimensão máxima do bbox é o "fim do fecho" esticado em algumas GLBs.
 */
const OMAFIT_WRIST_AR_WORLD_MAX_DIM = 0.072;
const OMAFIT_BRACELET_AR_WORLD_MEDIAN_DIM = 0.062;

/**
 * Comprimento real (m) do segmento punho→MCP-médio numa mão adulta.
 * Usado para estimar `zDist` a partir do tamanho aparente na imagem.
 * Fonte: anatomia média do adulto (9,5–10,5 cm).
 */
const OMAFIT_WRIST_TO_MCP_M = 0.10;

/**
 * Constantes de suavização exponencial para os eixos/posição da âncora da mão.
 * `alpha = 1 - exp(-dt / tau)` com `tau` em ms.
 * Valores maiores de `tau` = mais estável + maior latência.
 *
 * v11.3: tau eixos baixado 130→90 ms. Em rotações rápidas do pulso (180°/s),
 * 130 ms produz ~23° de lag perceptível entre o braço real e o GLB — o
 * utilizador vê o produto "atrás" do movimento. Com 90 ms, o lag cai para
 * ~16° — acompanha o braço em tempo quase real mantendo robustez contra
 * jitter de landmarks. Posição mantida em 120 ms (translação tolera mais
 * lag porque não é percepcionada tão intensamente como rotação).
 */
const OMAFIT_HAND_POS_TAU_MS = 120;
const OMAFIT_HAND_AXIS_TAU_MS = 90;

/**
 * Threshold angular (rad) acima do qual uma nova target quaternion é tratada
 * como "flip espúrio" (erro de handedness ou landmark outlier) em vez de
 * rotação real. 150° = 2.618 rad.
 *
 * Motivação: Quando MediaPipe classifica mal a lateralidade por um ou dois
 * frames (ex.: mão muito inclinada, oclusão parcial), a base (tmpX) inverte
 * de sinal e a quaternion target salta ~180°. Sem este guard, o SLERP
 * arrasta o GLB por esse arco de 180° durante ~120 ms, dando a ilusão de
 * "flip" súbito que o utilizador descreve como "rotação errada".
 *
 * Com o guard: saltos >150° são IGNORADOS em vez de aplicados, permitindo
 * ao handedness stabilizer (3-frame hysteresis) recuperar sem visual glitch.
 */
const OMAFIT_HAND_FLIP_GUARD_RAD = 2.618;

/**
 * ID de build visível em `console.log`. Se este valor NÃO aparecer na
 * consola do teu telemóvel/navegador, significa que o Shopify ainda está
 * a servir a versão ANTERIOR do asset (precisas correr `npm run deploy`
 * OU `shopify app deploy`). Sobe o sufixo sempre que editares este ficheiro.
 */
const OMAFIT_AR_WIDGET_BUILD = "2026-04-21_spark-ar-face-defaults-v11.5";

/**
 * MindAR face `Controller` (hiukim/mind-ar-js) usa One Euro em cada landmark.
 * Defaults da lib: filterMinCF=0.001, filterBeta=1. Valores ligeiramente mais
 * baixos em minCutOff reduzem micro-tremor (mais “filtro Instagram”), com
 * custo mínimo de latência. Override via data-ar-mindar-filter-min-cf / beta.
 */
const OMAFIT_MINDAR_DEFAULT_FILTER_MIN_CF = 0.00058;
const OMAFIT_MINDAR_DEFAULT_FILTER_BETA = 0.92;

/**
 * Loga o banner de build imediatamente ao carregar o módulo.
 * Faz isto no topo do ficheiro (antes de qualquer early-return noutras funções)
 * e apenas uma vez por sessão/origin para não poluir a consola.
 * Isto substitui o log que era feito em `bootOmafitArWidget()` — que nunca
 * disparava no fluxo iframe (Netlify) porque `hasArGlbUrlQueryParam()` cortava.
 */
if (typeof window !== "undefined" && !window.__OMAFIT_AR_BUILD_LOGGED__) {
  window.__OMAFIT_AR_BUILD_LOGGED__ = true;
  try {
    const flow = typeof location !== "undefined" && /omafit\.netlify\.app/i.test(location.host)
      ? "netlify-iframe"
      : "shopify-cdn-inline";
    console.log(
      `%c[omafit-ar] build: ${OMAFIT_AR_WIDGET_BUILD} (${flow})`,
      "color:#fff;background:#111;padding:2px 6px;border-radius:4px;font-weight:bold;",
    );
  } catch { /* ignore */ }
}

const Z_SHELL = 2147483640;

/**
 * Evita GLB “preso” em cache (Three.Cache + CDN) quando o URL do ficheiro não muda mas o conteúdo sim.
 * `data-ar-glb-version` no DOM deve mudar quando o produto é guardado (Liquid).
 */
/**
 * Bake + flatten das transformações de um GLB carregado.
 *
 * Aplica a `matrixWorld` de cada mesh (não-skinned, sem morph targets) ao
 * próprio `geometry` (clonado para preservar o cache do loader se o GLB for
 * reutilizado) e depois reparente todos os meshes directamente sob o root,
 * com `position/rotation/scale` em identity.
 *
 * Resultado: qualquer rotação intrínseca (root **ou** nós filhos) fica
 * bakeada na geometria. Depois disto, rotações aplicadas externamente
 * (p.ex. via `calibRot.rotation.set(x, y, z, "YXZ")`) actuam em torno dos
 * eixos do mundo — +X=direita, +Y=cima, +Z=frente — e correspondem
 * visualmente ao que o lojista espera dos sliders.
 *
 * Pula SkinnedMesh e meshes com `morphTargetInfluences`, porque bakear
 * a `matrixWorld` neles destruiria a correspondência com o esqueleto /
 * morphs. Para óculos estáticos normais, nenhum destes casos ocorre.
 *
 * O callback `onDone({ baked, skipped })` recebe contadores para debug.
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

function buildGlbLoaderUrl(baseUrl, version) {
  const u = String(baseUrl || "").trim();
  const v = String(version || "").trim();
  if (!u || !v) return u;
  try {
    const abs = typeof location !== "undefined" ? location.href : undefined;
    const x = new URL(u, abs);
    x.searchParams.set("omafit_ar_v", v);
    return x.toString();
  } catch {
    const sep = u.includes("?") ? "&" : "?";
    return `${u}${sep}omafit_ar_v=${encodeURIComponent(v)}`;
  }
}

/** Pré-carrega Three + GLTFLoader + MindAR no load da página — evita que o 1.º `await import()` no clique expire o gesto e bloqueie `getUserMedia` no desktop. */
function getOmafitArModuleBundle() {
  if (typeof window === "undefined") {
    return Promise.all([import(ESM_THREE_MJS), import(ESM_GLTF_MIND), import(ESM_MINDAR_FACE_THREE)]);
  }
  if (!window.__omafitArModuleBundlePromise) {
    window.__omafitArModuleBundlePromise = Promise.all([
      import(ESM_THREE_MJS),
      import(ESM_GLTF_MIND),
      import(ESM_MINDAR_FACE_THREE),
    ]).catch((e) => {
      window.__omafitArModuleBundlePromise = null;
      throw e;
    });
  }
  return window.__omafitArModuleBundlePromise;
}

/**
 * Lazy-load do bundle de hand tracking: Three.js + GLTFLoader + MediaPipe
 * Tasks Vision (HandLandmarker). Só chamado quando o produto é `watch` ou
 * `bracelet` — lojas só de óculos não pagam o custo (~1MB WASM + 5MB model).
 */
function getOmafitArHandModuleBundle() {
  if (typeof window === "undefined") {
    return Promise.all([
      import(ESM_THREE_MJS),
      import(ESM_GLTF_MIND),
      import(MEDIAPIPE_VISION_BUNDLE),
    ]);
  }
  if (!window.__omafitArHandModuleBundlePromise) {
    window.__omafitArHandModuleBundlePromise = Promise.all([
      import(ESM_THREE_MJS),
      import(ESM_GLTF_MIND),
      import(MEDIAPIPE_VISION_BUNDLE),
    ]).catch((e) => {
      window.__omafitArHandModuleBundlePromise = null;
      throw e;
    });
  }
  return window.__omafitArHandModuleBundlePromise;
}

/**
 * Deteção de tipo de acessório AR (client-side, sem módulos ES — este ficheiro
 * é servido pelo tema do Shopify).
 *
 * Espelho fiel de `app/ar-accessory-type.shared.js`. Mantém os mesmos padrões
 * e prioridade: (1) tag `ar:*`, (2) leaf da categoria Shopify, (3) caminho
 * completo da categoria, (4) fallback por texto agregado.
 *
 * Cobre variações de relógio: `Watches`, `Smart Watches`, `Wristwatches`,
 * `Watch Bands`, `Fitness Trackers`, `Relógios de Pulso`, `Relógios
 * Inteligentes`, `Relojes`, `Cronógrafos`, brand names (Apple Watch, Fitbit,
 * Garmin, Amazfit, Mi Band, Galaxy Watch).
 */
const OMAFIT_AR_WATCH_REGEX = [
  /\brel[oó]gio(s)?\b/i,
  /\brel[oó]gio(s)?\s+de\s+pulso\b/i,
  /\brel[oó]gio(s)?\s+(inteligente|digital|autom[aá]tico|anal[oó]gico)\b/i,
  /\bwatch(es|band|bands|straps?)?\b/i,
  /\bsmart[\s-]?watch(es)?\b/i,
  /\bwrist[\s-]?watch(es)?\b/i,
  /\btimepiece(s)?\b/i,
  /\bchronograph(s)?\b/i,
  /\bfitness[\s-]?tracker(s)?\b/i,
  /\bactivity[\s-]?tracker(s)?\b/i,
  /\bsmart[\s-]?band(s)?\b/i,
  /\breloj(es|er[ií]as?)?\b/i,
  /\bcron[oó]grafo(s)?\b/i,
  /\breloj(es)?\s+inteligente(s)?\b/i,
  /\bapple[\s-]?watch\b/i,
  /\bgalaxy[\s-]?watch\b/i,
  /\bfitbit\b/i,
  /\bgarmin\b/i,
  /\bamazfit\b/i,
  /\bmi[\s-]?band\b/i,
];
const OMAFIT_AR_BRACELET_REGEX = [
  /\bpulseira(s)?\b/i,
  /\bbracelete(s)?\b/i,
  /\bbracelet(s)?\b/i,
  /\bbangle(s)?\b/i,
  /\bcuff[\s-]?bracelet(s)?\b/i,
  /\btennis[\s-]?bracelet(s)?\b/i,
  /\bid[\s-]?bracelet(s)?\b/i,
  /\bcharm[\s-]?bracelet(s)?\b/i,
  /\banklet(s)?\b/i,
  /\bwristband(s)?\b/i,
  /\bpulsera(s)?\b/i,
  /\bmanilla(s)?\b/i,
  /\bbrazalete(s)?\b/i,
];
const OMAFIT_AR_NECKLACE_REGEX = [
  /\bcolar(es)?\b/i,
  /\bcord[aã]o(s|es)?\b/i,
  /\bgargantilha(s)?\b/i,
  /\bpingente(s)?\b/i,
  /\bnecklace(s)?\b/i,
  /\bpendant(s)?\b/i,
  /\bchoker(s)?\b/i,
  /\blocket(s)?\b/i,
  /\bcollar(es)?\b/i,
  /\bcolgante(s)?\b/i,
];
const OMAFIT_AR_GLASSES_REGEX = [
  /[oó]culos/i,
  /\boculos\b/i,
  /\barma[çc][aã]o(s|es|oes)?\b/i,
  /\blente(s)?\s+de\s+sol\b/i,
  /\bsunglass(es)?\b/i,
  /\beyeglass(es)?\b/i,
  /\beyewear\b/i,
  /\bspectacle(s)?\b/i,
  /\boptical\b/i,
  /\bglasses\b/i,
  /\breading[\s-]?glasses\b/i,
  /\bgafa(s)?\b/i,
  /\bmontura(s)?\b/i,
  /\banteojo(s)?\b/i,
  /\blente(s)?\s+(de\s+sol|graduada?s?)\b/i,
];

function omafitAnyMatch(list, text) {
  if (!text) return false;
  for (let i = 0; i < list.length; i++) {
    if (list[i].test(text)) return true;
  }
  return false;
}

function omafitClassifySegment(segment) {
  if (!segment) return null;
  if (omafitAnyMatch(OMAFIT_AR_WATCH_REGEX, segment)) return "watch";
  if (omafitAnyMatch(OMAFIT_AR_GLASSES_REGEX, segment)) return "glasses";
  if (omafitAnyMatch(OMAFIT_AR_NECKLACE_REGEX, segment)) return "necklace";
  if (omafitAnyMatch(OMAFIT_AR_BRACELET_REGEX, segment)) return "bracelet";
  return null;
}

function omafitCategoryLeaf(categoryFullName) {
  const s = String(categoryFullName || "").trim();
  if (!s) return "";
  const parts = s.split(">").map((p) => p.trim()).filter(Boolean);
  return parts[parts.length - 1] || "";
}

function omafitDetectAccessoryTypeFromContext({
  tags,
  productType,
  categoryFullName,
  title,
} = {}) {
  const AR_DEFAULT = "glasses";
  const tagList = (() => {
    if (Array.isArray(tags)) return tags;
    if (typeof tags === "string") return tags.split(",");
    return [];
  })()
    .map((t) => String(t || "").trim().toLowerCase())
    .filter(Boolean);

  for (const tag of tagList) {
    const m = tag.match(
      /^ar[:\-_]?(glasses|necklace|watch|bracelet|oculos|colar|relogio|pulseira)$/,
    );
    if (m) {
      const key = m[1];
      if (key === "oculos") return "glasses";
      if (key === "colar") return "necklace";
      if (key === "relogio") return "watch";
      if (key === "pulseira") return "bracelet";
      return key;
    }
  }

  const leaf = omafitCategoryLeaf(categoryFullName);
  const fromLeaf = omafitClassifySegment(leaf);
  if (fromLeaf) return fromLeaf;

  const fromCategoryFull = omafitClassifySegment(String(categoryFullName || ""));
  if (fromCategoryFull) return fromCategoryFull;

  const hay = [productType, title, tagList.join(" ")]
    .filter(Boolean)
    .join(" | ");
  const fromText = omafitClassifySegment(hay);
  if (fromText) return fromText;

  return AR_DEFAULT;
}

/**
 * Lê `data-ar-*` do embed + `#omafit-ar-root` e infere o tipo (sobrepõe só o
 * valor em cache do Liquid quando há categoria/título novos no DOM).
 */
function omafitResolveAccessoryType(cfgAttrFn) {
  const tagsCsv = cfgAttrFn("arProductTags", "");
  const tagList = tagsCsv
    ? String(tagsCsv)
        .split(",")
        .map((t) => String(t).trim().toLowerCase())
        .filter(Boolean)
    : [];
  return omafitDetectAccessoryTypeFromContext({
    tags: tagList,
    productType: cfgAttrFn("arProductType", ""),
    categoryFullName: cfgAttrFn("arCategoryPath", ""),
    title: cfgAttrFn("productTitle", ""),
  });
}

// #region agent log
/** Ativa com `window.__OMAFIT_AR_DEBUG_LOG__ = true` antes de abrir o AR (ingest local opcional). */
function __omafitArDbgLog(payload) {
  if (typeof window === "undefined" || !window.__OMAFIT_AR_DEBUG_LOG__) return;
  const base = {
    sessionId: "8c9070",
    timestamp: Date.now(),
    runId: typeof payload.runId === "string" ? payload.runId : "pre-fix",
    ...payload,
  };
  fetch("http://127.0.0.1:7744/ingest/736271b4-0216-42af-91db-7273b476c84e", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "8c9070" },
    body: JSON.stringify(base),
  }).catch(() => {});
}
// #endregion

function darkenHex(hex, amount = 20) {
  const h = String(hex || "#810707").replace("#", "");
  if (h.length !== 6) return "#6a0606";
  const r = Math.max(0, parseInt(h.slice(0, 2), 16) - amount);
  const g = Math.max(0, parseInt(h.slice(2, 4), 16) - amount);
  const b = Math.max(0, parseInt(h.slice(4, 6), 16) - amount);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function pickLocale(raw) {
  const v = String(raw || "pt").toLowerCase().split("-")[0];
  if (v === "en") return "en";
  if (v === "es") return "es";
  return "pt";
}

/**
 * Bundle de textos por idioma. O bloco `byType` sobrescreve chaves específicas
 * por tipo de acessório (glasses | necklace | watch | bracelet), permitindo
 * que o título, a descrição, o "como funciona" e as mensagens de erro sejam
 * específicos ao contexto (rosto, pescoço, pulso). Ver `resolveCopyForType`.
 */
const COPY = {
  pt: {
    title: "Provador AR de óculos",
    desc: "Veja como este modelo combina com o seu rosto em tempo real, usando a câmera do seu dispositivo.",
    howTitle: "Como funciona",
    howBody:
      "Na próxima etapa, autorize o uso da câmera. Posicione o rosto de frente para a tela — o óculos 3D acompanha o seu movimento. Os dados não são gravados nos nossos servidores.",
    cta: "Começar experiência AR",
    privacy: "Ao continuar, você concorda em usar a câmera apenas localmente no seu navegador para visualização.",
    close: "Fechar",
    linkTextFallback: "Experimentar óculos (AR)",
    arLoading: "A iniciar câmera e modelo 3D…",
    errCamera: "Permita o uso da câmera para o provador AR.",
    errFace: "Não foi possível carregar a detecção facial.",
    errGlb: "Não foi possível carregar o modelo 3D (GLB). Verifique se o ficheiro está público e acessível.",
    errGeneric: "AR indisponível neste dispositivo.",
    errHttps: "Abre a loja em HTTPS (ou localhost). Sem contexto seguro o browser não pede a câmera.",
    errMediaDevices: "Este browser não expõe a câmera aqui. Experimenta Chrome/Edge actualizado ou outro perfil.",
    addToCart: "Adicionar ao carrinho",
    addedToCart: "Adicionado!",
    addToCartError: "Erro ao adicionar",
    loadingModel: "Carregando modelo…",
    byType: {
      glasses: {},
      necklace: {
        title: "Provador AR de colares",
        desc: "Veja como este colar fica no seu pescoço em tempo real, usando a câmera do seu dispositivo.",
        howBody:
          "Na próxima etapa, autorize o uso da câmera. Deixe o rosto e a parte superior do peito visíveis na tela — o colar 3D acompanha o seu pescoço. Os dados não são gravados nos nossos servidores.",
        linkTextFallback: "Experimentar colar (AR)",
        arLoading: "A iniciar câmera e modelo 3D do colar…",
        errFace: "Não foi possível carregar a detecção do rosto/pescoço.",
      },
      watch: {
        title: "Provador AR de relógios",
        desc: "Veja como este relógio fica no seu pulso em tempo real, usando a câmera traseira do seu celular.",
        howBody:
          "Na próxima etapa, autorize o uso da câmera traseira. Mantenha a mão aberta ao centro da tela, com o pulso bem visível — o relógio 3D se encaixa no pulso. Os dados não são gravados nos nossos servidores.",
        linkTextFallback: "Experimentar relógio (AR)",
        arLoading: "A iniciar câmera e modelo 3D do relógio…",
        errCamera: "Permita o uso da câmera traseira para experimentar o relógio.",
        errFace: "Não foi possível carregar a detecção da mão.",
      },
      bracelet: {
        title: "Provador AR de pulseiras",
        desc: "Veja como esta pulseira fica no seu pulso em tempo real, usando a câmera traseira do seu celular.",
        howBody:
          "Na próxima etapa, autorize o uso da câmera traseira. Mantenha a mão aberta ao centro da tela, com o pulso bem visível — a pulseira 3D se encaixa no pulso. Os dados não são gravados nos nossos servidores.",
        linkTextFallback: "Experimentar pulseira (AR)",
        arLoading: "A iniciar câmera e modelo 3D da pulseira…",
        errCamera: "Permita o uso da câmera traseira para experimentar a pulseira.",
        errFace: "Não foi possível carregar a detecção da mão.",
      },
    },
  },
  en: {
    title: "AR eyewear try-on",
    desc: "See how this frame looks on your face in real time using your device camera.",
    howTitle: "How it works",
    howBody:
      "Next, allow camera access. Face the screen — the 3D glasses track your face. Video is processed locally and is not uploaded to our servers.",
    cta: "Start AR experience",
    privacy: "By continuing, you agree to use the camera locally in your browser for preview only.",
    close: "Close",
    linkTextFallback: "Try glasses on (AR)",
    arLoading: "Starting camera and 3D model…",
    errCamera: "Allow camera access for AR try-on.",
    errFace: "Could not load face detection.",
    errGlb: "Could not load the 3D model (GLB). Check that the file is public and reachable.",
    errGeneric: "AR unavailable on this device.",
    errHttps: "Open the store over HTTPS (or localhost). Without a secure context the browser won't prompt for the camera.",
    errMediaDevices: "This browser doesn't expose the camera here. Try an updated Chrome/Edge or another profile.",
    addToCart: "Add to cart",
    addedToCart: "Added!",
    addToCartError: "Error adding",
    loadingModel: "Loading model…",
    byType: {
      glasses: {},
      necklace: {
        title: "AR necklace try-on",
        desc: "See how this necklace looks on your neck in real time using your device camera.",
        howBody:
          "Next, allow camera access. Keep your face and upper chest visible on screen — the 3D necklace tracks your neckline. Video is processed locally and is not uploaded to our servers.",
        linkTextFallback: "Try necklace on (AR)",
        arLoading: "Starting camera and 3D necklace…",
        errFace: "Could not load face/neck detection.",
      },
      watch: {
        title: "AR watch try-on",
        desc: "See how this watch looks on your wrist in real time using your phone's rear camera.",
        howBody:
          "Next, allow rear-camera access. Keep your open hand centered on screen with your wrist clearly visible — the 3D watch snaps onto your wrist. Video is processed locally and is not uploaded to our servers.",
        linkTextFallback: "Try watch on (AR)",
        arLoading: "Starting rear camera and 3D watch…",
        errCamera: "Allow rear-camera access to try the watch on.",
        errFace: "Could not load hand detection.",
      },
      bracelet: {
        title: "AR bracelet try-on",
        desc: "See how this bracelet looks on your wrist in real time using your phone's rear camera.",
        howBody:
          "Next, allow rear-camera access. Keep your open hand centered on screen with your wrist clearly visible — the 3D bracelet snaps onto your wrist. Video is processed locally and is not uploaded to our servers.",
        linkTextFallback: "Try bracelet on (AR)",
        arLoading: "Starting rear camera and 3D bracelet…",
        errCamera: "Allow rear-camera access to try the bracelet on.",
        errFace: "Could not load hand detection.",
      },
    },
  },
  es: {
    title: "Probador AR de gafas",
    desc: "Mira cómo quedan estas gafas en tu rostro en tiempo real con la cámara de tu dispositivo.",
    howTitle: "Cómo funciona",
    howBody:
      "En el siguiente paso, autoriza la cámara. Mira de frente a la pantalla: el modelo 3D sigue tu rostro. El vídeo se procesa localmente y no se sube a nuestros servidores.",
    cta: "Empezar experiencia AR",
    privacy: "Al continuar, aceptas usar la cámara solo en tu navegador para la vista previa.",
    close: "Cerrar",
    linkTextFallback: "Probar gafas (AR)",
    arLoading: "Iniciando cámara y modelo 3D…",
    errCamera: "Permite el acceso a la cámara para el probador AR.",
    errFace: "No se pudo cargar la detección facial.",
    errGlb: "No se pudo cargar el modelo 3D (GLB). Comprueba que el archivo sea público y accesible.",
    errGeneric: "AR no disponible en este dispositivo.",
    errHttps: "Abre la tienda en HTTPS (o localhost). Sin contexto seguro el navegador no pedirá la cámara.",
    errMediaDevices: "Este navegador no expone la cámara aquí. Prueba Chrome/Edge actualizado u otro perfil.",
    addToCart: "Añadir al carrito",
    addedToCart: "¡Añadido!",
    addToCartError: "Error al añadir",
    loadingModel: "Cargando modelo…",
    byType: {
      glasses: {},
      necklace: {
        title: "Probador AR de collares",
        desc: "Mira cómo queda este collar en tu cuello en tiempo real con la cámara de tu dispositivo.",
        howBody:
          "En el siguiente paso, autoriza la cámara. Mantén el rostro y la parte superior del pecho visibles en pantalla: el collar 3D sigue tu cuello. El vídeo se procesa localmente y no se sube a nuestros servidores.",
        linkTextFallback: "Probar collar (AR)",
        arLoading: "Iniciando cámara y modelo 3D del collar…",
        errFace: "No se pudo cargar la detección del rostro/cuello.",
      },
      watch: {
        title: "Probador AR de relojes",
        desc: "Mira cómo queda este reloj en tu muñeca en tiempo real con la cámara trasera del móvil.",
        howBody:
          "En el siguiente paso, autoriza la cámara trasera. Mantén la mano abierta en el centro de la pantalla con la muñeca visible: el reloj 3D se ajusta a la muñeca. El vídeo se procesa localmente y no se sube a nuestros servidores.",
        linkTextFallback: "Probar reloj (AR)",
        arLoading: "Iniciando cámara trasera y reloj 3D…",
        errCamera: "Permite el acceso a la cámara trasera para probar el reloj.",
        errFace: "No se pudo cargar la detección de la mano.",
      },
      bracelet: {
        title: "Probador AR de pulseras",
        desc: "Mira cómo queda esta pulsera en tu muñeca en tiempo real con la cámara trasera del móvil.",
        howBody:
          "En el siguiente paso, autoriza la cámara trasera. Mantén la mano abierta en el centro de la pantalla con la muñeca visible: la pulsera 3D se ajusta a la muñeca. El vídeo se procesa localmente y no se sube a nuestros servidores.",
        linkTextFallback: "Probar pulsera (AR)",
        arLoading: "Iniciando cámara trasera y pulsera 3D…",
        errCamera: "Permite el acceso a la cámara trasera para probar la pulsera.",
        errFace: "No se pudo cargar la detección de la mano.",
      },
    },
  },
};

/**
 * Devolve o bundle de textos para (idioma, tipo de acessório), com merge raso
 * sobre o bundle base. Fallback: idioma → `pt`; tipo → `glasses`.
 */
function resolveCopyForType(lang, accessoryType) {
  const base = COPY[lang] || COPY.pt;
  const typeKey = ["glasses", "necklace", "watch", "bracelet"].includes(
    accessoryType,
  )
    ? accessoryType
    : "glasses";
  const override = (base.byType && base.byType[typeKey]) || {};
  return { ...base, ...override };
}

/** Estilo TryOnWidget: font-family com nomes entre aspas + !important em todo o subtree. */
function formatCssFontFamilyStack(raw) {
  const s = String(raw || "")
    .trim()
    .replace(/[<>]/g, "");
  if (!s) return "";
  return s
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) =>
      /^(serif|sans-serif|cursive|fantasy|monospace|system-ui)$/i.test(p)
        ? p
        : `'${p.replace(/'/g, "\\'")}'`,
    )
    .join(", ");
}

/** Lê fonte do tema: data attribute → variáveis CSS (Dawn) → body computado. */
function resolveArFontFamilyStack(root) {
  const fromAttr = (root?.dataset?.fontFamily || "").trim();
  if (fromAttr) return fromAttr;
  try {
    const el = document.documentElement;
    const v =
      (getComputedStyle(el).getPropertyValue("--font-body-family") || "").trim() ||
      (getComputedStyle(el).getPropertyValue("--font-heading-family") || "").trim();
    if (v) return v.replace(/^["']|["']$/g, "");
  } catch {
    /* ignore */
  }
  try {
    const b = document.body;
    if (b) {
      const ff = getComputedStyle(b).fontFamily;
      if (ff && ff !== "inherit" && ff !== "initial") return ff;
    }
  } catch {
    /* ignore */
  }
  return "";
}

/**
 * Cor / texto / logo vêm do admin (omafit-widget.js → data-omafit-admin-* no #omafit-widget-root).
 * O módulo AR pode arrancar antes do defer do widget; espera até timeout ou evento `omafit:widget-config`.
 */
function readWidgetRootAdminBranding() {
  const el = typeof document !== "undefined" ? document.getElementById("omafit-widget-root") : null;
  if (!el) return null;
  const primary = (el.getAttribute("data-omafit-admin-primary") || "").trim();
  const linkText = (el.getAttribute("data-omafit-admin-link-text") || "").trim();
  const storeLogo = (el.getAttribute("data-omafit-admin-store-logo") || "").trim();
  if (!primary && !linkText && !storeLogo) return null;
  return {
    primary: primary || "#810707",
    linkText: linkText || "Experimentar virtualmente",
    storeLogo: storeLogo || "",
  };
}

function waitForOmafitWidgetAdminBranding(maxMs = 8000) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v) => {
      if (settled) return;
      settled = true;
      if (typeof window !== "undefined") {
        window.removeEventListener("omafit:widget-config", onEvt);
      }
      resolve(v);
    };
    const onEvt = () => {
      const b = readWidgetRootAdminBranding();
      settle(
        b || {
          primary: "#810707",
          linkText: "Experimentar virtualmente",
          storeLogo: "",
        }
      );
    };
    if (typeof window !== "undefined") {
      window.addEventListener("omafit:widget-config", onEvt, { passive: true });
    }
    /**
     * Iframe Netlify (`WidgetPage.tsx`): não existe `#omafit-widget-root` — só
     * `#omafit-ar-root` com `data-*` da query. Sem este atalho, `readWidgetRootAdminBranding`
     * fica sempre null e o RAF espera o timeout completo (8s), deixando o ecrã em branco.
     * Na loja Shopify o div existe no Liquid (mesmo vazio até o defer do omafit-widget.js).
     */
    if (
      typeof document !== "undefined" &&
      !document.getElementById("omafit-widget-root")
    ) {
      settle({
        primary: "#810707",
        linkText: "Experimentar virtualmente",
        storeLogo: "",
      });
      return;
    }
    const first = readWidgetRootAdminBranding();
    if (first && first.primary) {
      settle(first);
      return;
    }
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const loop = () => {
      const b = readWidgetRootAdminBranding();
      if (b && b.primary) {
        settle(b);
        return;
      }
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (now - t0 >= maxMs) {
        settle(
          b || {
            primary: "#810707",
            linkText: "Experimentar óculos (AR)",
            storeLogo: "",
          }
        );
        return;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
}

function injectGlobalStyles(root, primaryOverride) {
  const old = document.getElementById("omafit-ar-styles");
  if (old) old.remove();

  const rawFont = resolveArFontFamilyStack(root);
  const stack = formatCssFontFamilyStack(rawFont);
  const appliedStack = stack || "'Outfit', system-ui, sans-serif";
  const fromOverride =
    typeof primaryOverride === "string" && primaryOverride.trim()
      ? primaryOverride.trim()
      : "";
  const primary =
    (fromOverride ||
      (root?.dataset?.primaryColor || "").trim() ||
      root?.style?.getPropertyValue("--omafit-ar-primary") ||
      "#810707")
      .replace(/[<>]/g, "") || "#810707";

  const s = document.createElement("style");
  s.id = "omafit-ar-styles";
  s.textContent = `
    @keyframes omafit-ar-fade-in { from { opacity: 0; } to { opacity: 1; } }
    /* Modal AR está em document.body (fora de #omafit-ar-root) — incluir .omafit-ar-shell como no TryOnWidget. */
    #omafit-ar-root, #omafit-ar-root *,
    .omafit-ar-shell, .omafit-ar-shell * {
      font-family: ${appliedStack} !important;
    }
    .omafit-ar-shell { animation: omafit-ar-fade-in 0.35s ease-out; }
    .omafit-ar-link:hover { opacity: 0.7; text-decoration-thickness: 2px; }
    .omafit-ar-try-on-link:focus { outline: 2px solid ${primary}; outline-offset: 2px; }
    /* Temas que metem x via ::before/::after em <button> — sem isto parecem dois X sobrepostos. */
    /* div[role=button] evita regras globais do tema em button::before (X duplicado). */
    .omafit-ar-shell .omafit-ar-close-btn {
      -webkit-appearance: none;
      appearance: none;
      background: transparent !important;
      background-image: none !important;
      box-shadow: none !important;
      font-size: 0;
      line-height: 0;
      list-style: none;
    }
    .omafit-ar-close-btn::before,
    .omafit-ar-close-btn::after {
      content: none !important;
      display: none !important;
    }
    .omafit-ar-close-btn svg {
      display: block;
      width: 24px;
      height: 24px;
    }
    /* MindAR: feed da câmara fica atrás do canvas; fundos opacos no canvas tapam o vídeo. */
    .omafit-ar-mindar-host canvas,
    .omafit-ar-shell .omafit-ar-mindar-host canvas {
      background: transparent !important;
      background-color: transparent !important;
    }
    /* NAO sobrepor width/height/top/left do video ou canvas do MindAR.    */
    /* A biblioteca calcula em _resize() posicoes em pixels para fazer       */
    /* object-fit: cover manual (top/left negativos para centrar overflow).  */
    /* Se forcarmos width/height:100% no canvas por CSS, o canvas "estica"   */
    /* ao container mas as projecoes 3D continuam calculadas para o aspect   */
    /* do video -> oculos aparecem rodados/offset ("virado pro lado").       */
  `;
  document.head.appendChild(s);
  const hasThemeFontFace = document.getElementById("omafit-ar-theme-font-face");
  if (
    !hasThemeFontFace &&
    !rawFont &&
    !document.querySelector('link[href*="Outfit"][href*="fonts.googleapis"]')
  ) {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href =
      "https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap";
    document.head.appendChild(l);
  }

  // #region agent log
  __omafitArDbgLog({
    location: "omafit-ar-widget.js:injectGlobalStyles",
    message: "styles injected",
    hypothesisId: "H1",
    data: {
      rawFontLen: String(rawFont || "").length,
      dataFontAttrLen: String(root?.dataset?.fontFamily || "").trim().length,
      hasThemeFontFace: Boolean(document.getElementById("omafit-ar-theme-font-face")),
      appliedStackPrefix: String(appliedStack || "").slice(0, 120),
    },
  });
  // #endregion
}

function createTriggerLink(text, primaryColor) {
  const link = document.createElement("a");
  link.href = "javascript:void(0);";
  link.className = "omafit-ar-try-on-link omafit-ar-link";
  link.textContent = text;
  link.setAttribute("role", "button");
  link.style.cssText = [
    "font-family: inherit",
    "font-size: inherit",
    "font-weight: inherit",
    "line-height: inherit",
    `color: ${primaryColor}`,
    "text-decoration: underline",
    `text-decoration-color: ${primaryColor}`,
    "text-underline-offset: 3px",
    "cursor: pointer",
    "transition: all 0.2s ease",
    "display: inline-block",
  ].join(";");
  return link;
}

function el(tag, props = {}, children = []) {
  const n = document.createElement(tag);
  const { style: styleObj, ...rest } = props;
  Object.assign(n, rest);
  if (styleObj && typeof styleObj === "object") {
    Object.assign(n.style, styleObj);
  }
  for (const c of children) {
    if (typeof c === "string") n.appendChild(document.createTextNode(c));
    else if (c) n.appendChild(c);
  }
  return n;
}

function svgArrowRight() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "22");
  svg.setAttribute("height", "22");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", "M5 12h14M12 5l7 7-7 7");
  svg.appendChild(p);
  return svg;
}

function svgX() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "24");
  svg.setAttribute("height", "24");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", "M18 6L6 18M6 6l12 12");
  svg.appendChild(p);
  return svg;
}

function buildInfoModal({
  primaryColor,
  logoUrl,
  shopName,
  productTitle,
  productImage,
  t,
  onClose,
  onStartAr,
}) {
  // #region agent log
  __omafitArDbgLog({
    location: "omafit-ar-widget.js:buildInfoModal",
    message: "modal header inputs",
    hypothesisId: "H3",
    data: {
      hasLogoUrl: Boolean(String(logoUrl || "").trim()),
      logoUrlLen: String(logoUrl || "").length,
      shopNameLen: String(shopName || "").trim().length,
    },
  });
  // #endregion

  const shell = el("div", { className: "omafit-ar-shell" });
  shell.style.cssText = [
    "position: fixed",
    "inset: 0",
    `z-index: ${Z_SHELL}`,
    "background: #fff",
    "display: flex",
    "flex-direction: column",
    "overflow: hidden",
  ].join(";");

  const header = el("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "16px",
      borderBottom: `1px solid ${primaryColor}`,
      flexShrink: "0",
    },
  });

  const leftPad = el("div", { style: { width: "40px", flexShrink: "0" } });
  const logoWrap = el("div", {
    style: {
      flex: "1",
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      minHeight: "48px",
    },
  });
  if (logoUrl) {
    const img = el("img", {
      src: logoUrl,
      alt: shopName || "",
      loading: "eager",
      decoding: "async",
      style: { maxHeight: "48px", width: "auto", maxWidth: "min(200px, 70vw)", objectFit: "contain" },
    });
    // #region agent log
    img.addEventListener("error", () => {
      let host = "";
      try {
        host = new URL(logoUrl, typeof location !== "undefined" ? location.href : undefined).hostname;
      } catch {
        host = "bad-url";
      }
      __omafitArDbgLog({
        location: "omafit-ar-widget.js:buildInfoModal",
        message: "logo img load error",
        hypothesisId: "H3",
        data: { logoHost: host },
      });
    });
    // #endregion
    logoWrap.appendChild(img);
  } else if (shopName) {
    logoWrap.appendChild(
      el("span", {
        textContent: shopName,
        style: {
          fontSize: "1.125rem",
          fontWeight: "600",
          color: primaryColor,
          textAlign: "center",
          lineHeight: "1.2",
          padding: "0 8px",
        },
      }),
    );
  }

  const closeBtn = el(
    "div",
    {
      role: "button",
      tabIndex: 0,
      className: "omafit-ar-close-btn",
      title: t.close,
      style: {
        width: "40px",
        height: "40px",
        border: "none",
        background: "transparent",
        cursor: "pointer",
        color: "#6b7280",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: "0",
        borderRadius: "8px",
      },
    },
    [svgX()],
  );
  closeBtn.setAttribute("data-omafit-ar-close-modal", "1");
  closeBtn.addEventListener("click", onClose);
  closeBtn.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      onClose();
    }
  });

  header.appendChild(leftPad);
  header.appendChild(logoWrap);
  header.appendChild(closeBtn);

  const mainRow = el("div", {
    style: {
      flex: "1",
      display: "flex",
      flexDirection: "row",
      overflow: "hidden",
      minHeight: "0",
    },
  });

  const colImg = el("div", {
    style: {
      display: "none",
      width: "50%",
      background: "#f9fafb",
      padding: "32px",
      alignItems: "center",
      justifyContent: "center",
      boxSizing: "border-box",
    },
  });
  colImg.className = "omafit-ar-col-desktop";

  const imgBox = el("div", {
    style: {
      width: "100%",
      maxWidth: "28rem",
      borderRadius: "16px",
      overflow: "hidden",
      background: "#f3f4f6",
    },
  });
  if (productImage) {
    const pi = el("img", {
      src: productImage,
      alt: productTitle,
      style: { width: "100%", height: "auto", display: "block", objectFit: "contain" },
    });
    imgBox.appendChild(pi);
  }
  colImg.appendChild(imgBox);

  const colContent = el("div", {
    style: {
      flex: "1",
      padding: "12px 16px 24px",
      overflowY: "auto",
      boxSizing: "border-box",
    },
  });

  const mobileImgWrap = el("div", {
    style: {
      display: "block",
      background: "#f9fafb",
      borderRadius: "12px",
      padding: "12px",
      marginBottom: "16px",
    },
    className: "omafit-ar-mobile-img",
  });
  if (productImage) {
    const mimg = el("div", {
      style: { borderRadius: "16px", overflow: "hidden", background: "#f3f4f6" },
    });
    mimg.appendChild(
      el("img", {
        src: productImage,
        alt: productTitle,
        style: { width: "100%", height: "auto", display: "block" },
      }),
    );
    mobileImgWrap.appendChild(mimg);
  }

  const titleBlock = el("div", { style: { textAlign: "center", marginBottom: "16px" } });
  titleBlock.appendChild(
    el("h3", {
      textContent: t.title,
      style: {
        margin: "0 0 8px 0",
        fontSize: "clamp(1.35rem, 4vw, 1.85rem)",
        fontWeight: "600",
        color: primaryColor,
      },
    }),
  );
  titleBlock.appendChild(
    el("p", {
      textContent: t.desc,
      style: { margin: 0, color: "#374151", fontSize: "clamp(1rem, 3vw, 1.2rem)", lineHeight: "1.45" },
    }),
  );

  const blueBox = el("div", {
    style: {
      background: "#eff6ff",
      border: "1px solid #bfdbfe",
      borderRadius: "8px",
      padding: "16px",
      marginBottom: "20px",
    },
  });
  const blueInner = el("div", { style: { textAlign: "center" } });
  blueInner.appendChild(
    el("h4", {
      textContent: t.howTitle,
      style: { margin: "0 0 8px 0", fontWeight: "600", color: "#1e40af", fontSize: "1.05rem" },
    }),
  );
  blueInner.appendChild(
    el("p", {
      textContent: t.howBody,
      style: { margin: 0, color: "#1d4ed8", fontSize: "clamp(0.95rem, 2.8vw, 1.05rem)", lineHeight: "1.5" },
    }),
  );
  blueBox.appendChild(blueInner);

  const cta = el(
    "button",
    {
      type: "button",
      style: {
        width: "100%",
        background: primaryColor,
        color: "#fff",
        border: "none",
        padding: "14px 20px",
        borderRadius: "8px",
        fontSize: "clamp(1rem, 3vw, 1.15rem)",
        fontWeight: "600",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
        fontFamily: "inherit",
        transition: "filter 0.2s ease, box-shadow 0.2s ease",
        marginBottom: "12px",
      },
    },
    [],
  );
  cta.appendChild(document.createTextNode(t.cta + " "));
  const arw = svgArrowRight();
  arw.style.color = "#fff";
  cta.appendChild(arw);
  cta.addEventListener("mouseenter", () => {
    cta.style.filter = "brightness(0.92)";
    cta.style.boxShadow = `0 4px 14px ${primaryColor}44`;
  });
  cta.addEventListener("mouseleave", () => {
    cta.style.filter = "none";
    cta.style.boxShadow = "none";
  });
  cta.addEventListener("click", () => onStartAr(shell, mainRow, colContent, header));

  const privacy = el("p", {
    textContent: t.privacy,
    style: { margin: 0, textAlign: "center", color: "#6b7280", fontSize: "0.875rem", lineHeight: "1.4" },
  });

  colContent.appendChild(mobileImgWrap);
  colContent.appendChild(titleBlock);
  colContent.appendChild(blueBox);
  colContent.appendChild(cta);
  colContent.appendChild(privacy);

  mainRow.appendChild(colImg);
  mainRow.appendChild(colContent);

  shell.appendChild(header);
  shell.appendChild(mainRow);

  const mq = window.matchMedia("(min-width: 768px)");
  function applyMq() {
    if (mq.matches) {
      colImg.style.display = "flex";
      mobileImgWrap.style.display = "none";
    } else {
      colImg.style.display = "none";
      mobileImgWrap.style.display = "block";
    }
  }
  mq.addEventListener("change", applyMq);
  applyMq();

  return shell;
}

/**
 * MindAR `_startVideo` chama `getUserMedia({ video: { facingMode: "user" } })` com
 * string curta. Em iOS / Edge / alguns Android isso falha (OverconstrainedError)
 * ou abre a câmara errada. Interceptamos só durante `start()` e tentamos
 * `facingMode: { ideal: … }` e depois `video: true` como último recurso.
 *
 * @see https://github.com/hiukim/mind-ar-js/issues/370
 */
async function startMindARFaceWithReliableCamera(mindarThree) {
  const md = navigator.mediaDevices;
  if (!md || typeof md.getUserMedia !== "function") {
    await mindarThree.start();
    return;
  }
  const orig = md.getUserMedia.bind(md);
  let patchActive = true;
  /** Pedido extra de resolução/frameRate: landmarks mais estáveis (mais próximo do nível “filtro Instagram”). */
  const faceVideoIdeal = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 },
  };
  md.getUserMedia = function (constraints) {
    if (!patchActive) return orig(constraints);
    try {
      const vid = constraints && constraints.video;
      if (vid && typeof vid === "object" && !vid.deviceId) {
        const fm = vid.facingMode;
        if (fm === "user" || fm === "face") {
          return orig({
            audio: false,
            video: { facingMode: { ideal: "user" }, ...faceVideoIdeal },
          })
            .catch(() =>
              orig({ audio: false, video: { facingMode: "user" } }),
            )
            .catch(() => orig({ audio: false, video: true }));
        }
        if (fm === "environment") {
          return orig({
            audio: false,
            video: { facingMode: { ideal: "environment" }, ...faceVideoIdeal },
          })
            .catch(() =>
              orig({ audio: false, video: { facingMode: "environment" } }),
            )
            .catch(() => orig({ audio: false, video: true }));
        }
      }
    } catch {
      /* usar pedido original */
    }
    return orig(constraints);
  };
  try {
    await mindarThree.start();
  } finally {
    patchActive = false;
    md.getUserMedia = orig;
  }
}

/**
 * MindAR coloca o `<video>` da câmara atrás do canvas (z-index -2). O fundo só
 * se vê se o WebGL limpar com **alpha 0**; caso contrário o canvas tapa o vídeo
 * com preto opaco — o GLB continua visível, mas o feed da câmara desaparece.
 * Reforça também estilos do vídeo/canvas contra regras agressivas do tema.
 */
function fixMindARFaceVideoBehindCanvas(mindarThree, mindarHost) {
  try {
    const { scene, renderer, cssRenderer } = mindarThree || {};
    if (scene && "background" in scene) scene.background = null;
    if (renderer && typeof renderer.setClearColor === "function") {
      renderer.setClearColor(0x000000, 0);
    }
    const cssEl = cssRenderer?.domElement;
    if (cssEl) {
      cssEl.style.backgroundColor = "transparent";
      cssEl.style.pointerEvents = "none";
    }
    const video = mindarHost?.querySelector?.("video");
    if (video) {
      video.setAttribute("playsinline", "");
      video.setAttribute("muted", "");
      video.playsInline = true;
      video.muted = true;
      video.style.opacity = "1";
      video.style.visibility = "visible";
      video.style.pointerEvents = "none";
      void video.play?.().catch?.(() => {});
    }
    const canvases = mindarHost?.querySelectorAll?.("canvas") || [];
    for (let i = 0; i < canvases.length; i++) {
      const c = canvases[i];
      c.style.backgroundColor = "transparent";
      c.style.pointerEvents = "none";
    }
  } catch (e) {
    console.warn("[omafit-ar] fixMindARFaceVideoBehindCanvas:", e?.message || e);
  }
}

async function runArSession({
  shell,
  mainRow,
  colContent,
  header,
  glbUrl,
  primaryColor,
  t,
  onClose,
  variants,
  productId,
}) {
  colContent.innerHTML = "";
  const desktopCol = shell.querySelector(".omafit-ar-col-desktop");
  if (desktopCol) desktopCol.style.display = "none";

  mainRow.style.flexDirection = "column";
  mainRow.style.padding = "0";

  const arWrap = el("div", {
    style: {
      flex: "1 1 auto",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "min(520px, 62dvh)",
      width: "100%",
      boxSizing: "border-box",
      background: "#111",
      position: "relative",
    },
  });

  /**
   * MindAR injeta `<video>` + canvas WebGL dentro de `mindarHost`.
   *
   * `overflow: hidden` é OBRIGATÓRIO: o MindAR dimensiona o `<video>` para
   * "cover" (maior que o container numa das direcções) e usa top/left
   * negativos para centrar. Se deixarmos `visible`, o vídeo transborda o
   * modal (parece maior que devia). Se medirmos o container ANTES da
   * animação/layout acabar, o MindAR calcula mal e a imagem fica "cortada
   * do lado direito". A correcção é executar `_resize()` várias vezes
   * depois do modal estabilizar (ver `lateMindarResizeTimerIds`).
   */
  const arFit = el("div", {
    style: {
      position: "relative",
      flex: "1 1 auto",
      width: "100%",
      minHeight: "min(520px, 62dvh)",
      overflow: "hidden",
      background: "#000",
      boxSizing: "border-box",
    },
  });

  const mindarHost = el("div", {
    className: "omafit-ar-mindar-host",
    style: {
      position: "absolute",
      inset: "0",
      overflow: "hidden",
      isolation: "isolate",
    },
  });
  arFit.appendChild(mindarHost);

  const loading = el("div", {
    style: {
      position: "absolute",
      inset: "0",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      color: "#fff",
      zIndex: "3",
      gap: "12px",
      fontSize: "1rem",
    },
  });
  loading.appendChild(document.createTextNode(t.arLoading));
  arFit.appendChild(loading);
  arWrap.appendChild(arFit);

  // --- Variant bar + Add to Cart ---
  const arVariants = Array.isArray(variants) ? variants.filter((v) => v.glbUrl || glbUrl) : [];
  let currentVariantId = arVariants.length > 0 ? arVariants[0].id : null;
  let currentGlbUrl = arVariants.length > 0 ? (arVariants[0].glbUrl || glbUrl) : glbUrl;
  let arBottomBar = null;

  if (arVariants.length > 1) {
    arBottomBar = el("div", {
      style: {
        position: "absolute",
        bottom: "0",
        left: "0",
        right: "0",
        background: "linear-gradient(transparent, rgba(0,0,0,0.7))",
        padding: "12px 8px 8px",
        zIndex: "5",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      },
    });

    const thumbRow = el("div", {
      style: {
        display: "flex",
        gap: "8px",
        overflowX: "auto",
        justifyContent: "center",
        padding: "0 4px 4px",
      },
    });

    arVariants.forEach((v) => {
      const thumb = el("button", {
        type: "button",
        title: v.title || "",
        style: {
          width: "56px",
          height: "56px",
          borderRadius: "10px",
          border: v.id === currentVariantId ? `3px solid ${primaryColor}` : "2px solid rgba(255,255,255,0.5)",
          background: "#fff",
          cursor: "pointer",
          padding: "2px",
          overflow: "hidden",
          flexShrink: "0",
          transition: "border-color 0.2s",
        },
      });
      thumb.dataset.variantId = v.id;
      if (v.imageUrl) {
        thumb.appendChild(el("img", {
          src: v.imageUrl,
          alt: v.title || "",
          style: { width: "100%", height: "100%", objectFit: "cover", borderRadius: "7px", display: "block" },
        }));
      } else {
        thumb.appendChild(el("span", {
          textContent: (v.title || "?").slice(0, 3),
          style: { fontSize: "11px", color: "#333", display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%" },
        }));
      }
      thumb.addEventListener("click", () => {
        if (String(v.id) === String(currentVariantId)) return;
        currentVariantId = v.id;
        currentGlbUrl = v.glbUrl || glbUrl;
        thumbRow.querySelectorAll("button").forEach((b) => {
          b.style.border = String(b.dataset.variantId) === String(currentVariantId)
            ? `3px solid ${primaryColor}`
            : "2px solid rgba(255,255,255,0.5)";
        });
        if (typeof window.__omafitArSwitchGlb === "function") {
          window.__omafitArSwitchGlb(currentGlbUrl, currentVariantId);
        }
      });
      thumbRow.appendChild(thumb);
    });

    arBottomBar.appendChild(thumbRow);

    const cartBtn = el("button", {
      type: "button",
      textContent: t.addToCart,
      style: {
        width: "100%",
        padding: "12px 16px",
        borderRadius: "8px",
        border: "none",
        background: primaryColor,
        color: "#fff",
        fontWeight: "600",
        fontSize: "1rem",
        cursor: "pointer",
        fontFamily: "inherit",
        transition: "filter 0.2s",
      },
    });
    cartBtn.addEventListener("mouseenter", () => { cartBtn.style.filter = "brightness(0.9)"; });
    cartBtn.addEventListener("mouseleave", () => { cartBtn.style.filter = "none"; });
    cartBtn.addEventListener("click", async () => {
      if (!currentVariantId) return;
      cartBtn.disabled = true;
      cartBtn.textContent = "…";
      try {
        const res = await fetch("/cart/add.js", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: [{ id: Number(currentVariantId), quantity: 1 }] }),
        });
        if (!res.ok) throw new Error(res.statusText);
        cartBtn.textContent = t.addedToCart || "Added!";
        setTimeout(() => { cartBtn.textContent = t.addToCart; cartBtn.disabled = false; }, 2000);
      } catch {
        cartBtn.textContent = t.addToCartError || "Error";
        setTimeout(() => { cartBtn.textContent = t.addToCart; cartBtn.disabled = false; }, 2000);
      }
    });
    arBottomBar.appendChild(cartBtn);
    arFit.appendChild(arBottomBar);
  } else if (productId) {
    const singleCartBar = el("div", {
      style: {
        position: "absolute",
        bottom: "0",
        left: "0",
        right: "0",
        background: "linear-gradient(transparent, rgba(0,0,0,0.7))",
        padding: "12px 8px 8px",
        zIndex: "5",
      },
    });
    const singleCartBtn = el("button", {
      type: "button",
      textContent: t.addToCart,
      style: {
        width: "100%",
        padding: "12px 16px",
        borderRadius: "8px",
        border: "none",
        background: primaryColor,
        color: "#fff",
        fontWeight: "600",
        fontSize: "1rem",
        cursor: "pointer",
        fontFamily: "inherit",
        transition: "filter 0.2s",
      },
    });
    singleCartBtn.addEventListener("mouseenter", () => { singleCartBtn.style.filter = "brightness(0.9)"; });
    singleCartBtn.addEventListener("mouseleave", () => { singleCartBtn.style.filter = "none"; });
    singleCartBtn.addEventListener("click", async () => {
      const vid = currentVariantId || (arVariants.length === 1 ? arVariants[0].id : null);
      if (!vid) return;
      singleCartBtn.disabled = true;
      singleCartBtn.textContent = "…";
      try {
        const res = await fetch("/cart/add.js", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: [{ id: Number(vid), quantity: 1 }] }),
        });
        if (!res.ok) throw new Error(res.statusText);
        singleCartBtn.textContent = t.addedToCart || "Added!";
        setTimeout(() => { singleCartBtn.textContent = t.addToCart; singleCartBtn.disabled = false; }, 2000);
      } catch {
        singleCartBtn.textContent = t.addToCartError || "Error";
        setTimeout(() => { singleCartBtn.textContent = t.addToCart; singleCartBtn.disabled = false; }, 2000);
      }
    });
    singleCartBar.appendChild(singleCartBtn);
    arFit.appendChild(singleCartBar);
  }

  colContent.style.padding = "0";
  /**
   * Contentor do modal: deixar `hidden` para que o conteúdo AR não transborde
   * a caixa. O "cortado do lado direito" era causado por medições em momento
   * errado no `_resize()` do MindAR — corrigido via `lateMindarResizeTimerIds`.
   */
  colContent.style.overflow = "hidden";
  colContent.style.overflowX = "hidden";
  colContent.style.flex = "1";
  colContent.style.display = "flex";
  colContent.style.flexDirection = "column";
  colContent.appendChild(arWrap);

  let mindarThree = null;
  let arResizeObserver = null;
  /**
   * Handler opcional instalado por motores alternativos (p.ex. MediaPipe
   * Hand Landmarker) para libertar câmara, rAF loop, landmarker, etc.
   * É chamado em cada `cleanup()` para garantir paridade com o face path.
   */
  let arEngineCleanup = null;
  /** Listeners de orientação/visibilidade adicionados dentro de `runArSession`. */
  let removeOrientationListeners = null;
  /** Timeouts de `_resize` tardio (layout do modal / safe-area) — limpar no cleanup. */
  let lateMindarResizeTimerIds = [];

  const cleanup = () => {
    try {
      arFit.style.transform = "";
      arFit.style.transformOrigin = "";
    } catch {
      /* ignore */
    }
    if (arResizeObserver) {
      arResizeObserver.disconnect();
      arResizeObserver = null;
    }
    if (mindarThree) {
      try {
        mindarThree.renderer?.setAnimationLoop(null);
      } catch {
        /* ignore */
      }
      try {
        mindarThree.stop();
      } catch {
        /* ignore */
      }
      mindarThree = null;
    }
    if (typeof arEngineCleanup === "function") {
      try {
        arEngineCleanup();
      } catch {
        /* ignore */
      }
      arEngineCleanup = null;
    }
    if (typeof removeOrientationListeners === "function") {
      try {
        removeOrientationListeners();
      } catch {
        /* ignore */
      }
      removeOrientationListeners = null;
    }
    if (Array.isArray(lateMindarResizeTimerIds) && lateMindarResizeTimerIds.length) {
      for (const tid of lateMindarResizeTimerIds) {
        try {
          clearTimeout(tid);
        } catch {
          /* ignore */
        }
      }
      lateMindarResizeTimerIds = [];
    }
  };

  const headerClose = header.querySelector("[data-omafit-ar-close-modal]");
  if (headerClose && headerClose.dataset.omafitArSessionClose !== "1") {
    headerClose.dataset.omafitArSessionClose = "1";
    headerClose.addEventListener(
      "click",
      (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        cleanup();
        onClose();
      },
      { capture: true },
    );
  }

  try {
    /**
     * Dispatcher de stack de tracking com base no tipo de acessório emitido
     * pelo Liquid em `data-ar-accessory-type` / `data-ar-tracking-stack`:
     *   - glasses, necklace → MindAR Face (abaixo, stack legado)
     *   - watch, bracelet  → MediaPipe Hand Landmarker (`runHandArSession`)
     *
     * Fallback: se o atributo vier vazio (temas antigos) assumimos `glasses`
     * para não quebrar lojas existentes.
     */
    const arCfg = typeof document !== "undefined" ? document.getElementById("omafit-ar-root") : null;
    const embedCfg = typeof document !== "undefined" ? document.getElementById("omafit-widget-root") : null;
    function cfgAttrDispatch(camelKey, fallback = "") {
      const ek = embedCfg?.dataset?.[camelKey];
      if (ek !== undefined && String(ek).trim() !== "") return String(ek).trim();
      const ak = arCfg?.dataset?.[camelKey];
      if (ak !== undefined && String(ak).trim() !== "") return String(ak).trim();
      return String(fallback ?? "").trim();
    }
    /**
     * Resolução alinhada com `main()` — se o cliente detectou um tipo
     * específico a partir de categoria/tags/título REAIS e esse difere do
     * Liquid, o cliente ganha (o metafield pode estar desactualizado).
     */
    const AR_VALID_TYPES = ["glasses", "necklace", "watch", "bracelet"];
    const liquidAccessoryType = String(
      cfgAttrDispatch("arAccessoryType", ""),
    )
      .trim()
      .toLowerCase();
    const clientDetected = omafitResolveAccessoryType(cfgAttrDispatch);
    const dispatchCategoryPath = cfgAttrDispatch("arCategoryPath", "");
    const dispatchProductType = cfgAttrDispatch("arProductType", "");
    const dispatchProductTags = cfgAttrDispatch("arProductTags", "");
    const dispatchProductTitle = cfgAttrDispatch("productTitle", "");
    const clientHasStrongSignal = (() => {
      if (!AR_VALID_TYPES.includes(clientDetected)) return false;
      if (clientDetected !== "glasses") return true;
      const hay = `${dispatchCategoryPath} ${dispatchProductType} ${dispatchProductTitle} ${dispatchProductTags}`.toLowerCase();
      return /\b(oculo|óculos|glasses|sunglass|eyewear|eyeglass|spectacle|optical|gafa|montura|anteojo|armaç)/i.test(
        hay,
      );
    })();

    let accessoryType;
    let accessoryTypeSource;
    if (clientHasStrongSignal && clientDetected !== liquidAccessoryType) {
      accessoryType = clientDetected;
      accessoryTypeSource = `client-override (liquid=${liquidAccessoryType || "∅"} ≠ client=${clientDetected})`;
    } else if (AR_VALID_TYPES.includes(liquidAccessoryType)) {
      accessoryType = liquidAccessoryType;
      accessoryTypeSource = "liquid-metafield";
    } else if (AR_VALID_TYPES.includes(clientDetected)) {
      accessoryType = clientDetected;
      accessoryTypeSource = "client-fallback";
    } else {
      accessoryType = "glasses";
      accessoryTypeSource = "default";
    }

    const trackingStackRaw = String(
      (embedCfg?.dataset?.arTrackingStack ?? arCfg?.dataset?.arTrackingStack ?? "")
        .toString()
        .trim()
        .toLowerCase(),
    );
    /**
     * Se o `accessoryType` resolvido aqui não bate com o stack emitido pelo
     * Liquid (e.g. override de cliente), recalculamos o stack em vez de
     * respeitar um valor de tema desactualizado.
     */
    const inferredStack =
      accessoryType === "watch" || accessoryType === "bracelet"
        ? "hand"
        : "face";
    const liquidStackValid =
      trackingStackRaw === "hand" || trackingStackRaw === "face";
    const trackingStack =
      liquidStackValid && accessoryTypeSource === "liquid-metafield"
        ? trackingStackRaw
        : inferredStack;

    console.log("[omafit-ar] dispatcher snapshot", {
      build: OMAFIT_AR_WIDGET_BUILD,
      accessoryType,
      source: accessoryTypeSource,
      trackingStack,
      liquidAccessoryType,
      clientDetected,
      clientHasStrongSignal,
      arAccessoryTypeAttr: cfgAttrDispatch("arAccessoryType", ""),
      arTrackingStackAttr: trackingStackRaw,
      arCategoryPath: dispatchCategoryPath || "(empty — product.category not set)",
      arProductType: dispatchProductType || "(empty)",
      arProductTags: dispatchProductTags ? dispatchProductTags.slice(0, 180) : "(empty)",
      productTitle: dispatchProductTitle.slice(0, 80),
      arPreferredCamera: cfgAttrDispatch("arPreferredCamera", ""),
    });

    if (trackingStack === "hand") {
      const [threeModHand, gltfModuleHand, visionMod] = await getOmafitArHandModuleBundle();
      const THREEHand =
        threeModHand.default && typeof threeModHand.default.Group === "function"
          ? threeModHand.default
          : threeModHand;
      const { GLTFLoader: GLTFLoaderHand } = gltfModuleHand;
      const handCleanup = await runHandArSession({
        THREE: THREEHand,
        GLTFLoader: GLTFLoaderHand,
        vision: visionMod,
        arCfg,
        embedCfg,
        accessoryType,
        arFit,
        mindarHost,
        loading,
        glbUrl,
        t,
        variants,
        productId,
      });
      if (typeof handCleanup === "function") {
        arEngineCleanup = handCleanup;
      }
      return;
    }

    const [threeMod, gltfModule, mindFaceMod] = await getOmafitArModuleBundle();
    const THREE =
      threeMod.default && typeof threeMod.default.Group === "function" ? threeMod.default : threeMod;
    const { GLTFLoader } = gltfModule;
    const MindARThree = mindFaceMod.MindARThree || mindFaceMod.default;
    /** Valor não vazio em `#omafit-widget-root` sobrepõe `#omafit-ar-root` (evita só o wear no embed e o resto “partido”). */
    function cfgAttr(camelKey, fallback = "") {
      const ek = embedCfg?.dataset?.[camelKey];
      if (ek !== undefined && String(ek).trim() !== "") return String(ek).trim();
      const ak = arCfg?.dataset?.[camelKey];
      if (ak !== undefined && String(ak).trim() !== "") return String(ak).trim();
      return String(fallback ?? "").trim();
    }

    /**
     * Calibração salva pelo lojista no admin (metafield `omafit.ar_calibration`).
     * O Liquid tenta emitir os valores nos data-attrs específicos, mas nem sempre
     * consegue (algumas versões do Shopify Liquid não expõem hash parseado para
     * metafields tipo json). Então também emitimos o JSON bruto em
     * `data-ar-omafit-calibration` — aqui fazemos o parse e, se o Liquid não
     * populou os campos, populamos a partir do JSON. Variant override via
     * `window.__omafitArSwitchGlb` chama `applyOmafitCalibration(calObj)`.
     */
    function parseOmafitCalibrationRaw(raw) {
      if (!raw) return null;
      let v = raw;
      try { v = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return null; }
      if (v && typeof v === "object" && v.value !== undefined) {
        try { v = typeof v.value === "string" ? JSON.parse(v.value) : v.value; } catch { /* noop */ }
      }
      if (v && typeof v === "object" && !Array.isArray(v)) return v;
      return null;
    }
    function applyOmafitCalibration(cal, el) {
      const target = el || arCfg;
      if (!target || !cal || typeof cal !== "object") return false;
      const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : null);
      const rx = num(cal.rx), ry = num(cal.ry), rz = num(cal.rz);
      const bridgeY = num(cal.bridgeY);
      const wearX = num(cal.wearX), wearY = num(cal.wearY), wearZ = num(cal.wearZ);
      const scale = num(cal.scale);
      if (rx !== null && ry !== null && rz !== null) {
        target.dataset.arCanonicalFixYxz = `${rx}, ${ry}, ${rz}`;
      }
      if (wearX !== null && wearY !== null && wearZ !== null) {
        target.dataset.arMindarWearPosition = `${wearX} ${wearY} ${wearZ}`;
      }
      if (bridgeY !== null) target.dataset.arBridgeYFactor = String(bridgeY);
      if (scale !== null && scale > 0) target.dataset.arMindarModelScale = String(scale);
      target.dataset.arOmafitCalSource = "metafield:applied";
      return true;
    }
    try {
      const rawCal = arCfg?.dataset?.arOmafitCalibration || "";
      const parsed = parseOmafitCalibrationRaw(rawCal);
      if (parsed) applyOmafitCalibration(parsed, arCfg);
    } catch (e) {
      console.warn("[omafit-ar] applyOmafitCalibration failed", e?.message || e);
    }
    const rad = (d) => (d * Math.PI) / 180;
    /**
     * Três números em graus: **ângulo em X, ângulo em Y, ângulo em Z** (não “ordem YXZ” dos números).
     * Em cada `Group` usamos `rotation.order = "YXZ"` (composição Three.js dos três ângulos).
     */
    function parseEulerDegComponents(raw, defX, defY, defZ) {
      const str = String(raw || "").trim();
      if (!str) return { x: defX, y: defY, z: defZ };
      const parts = str.split(/[\s,;]+/).map((t) => Number(t.trim()));
      if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return { x: defX, y: defY, z: defZ };
      return { x: parts[0], y: parts[1], z: parts[2] };
    }
    /** Três números em metros (deslocamento do GLB no espaço local após `glbBind`). */
    function parseXyzMeters(raw, defX, defY, defZ) {
      const str = String(raw || "").trim();
      if (!str) return { x: defX, y: defY, z: defZ };
      const parts = str.split(/[\s,;]+/).map((t) => Number(t.trim()));
      if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return { x: defX, y: defY, z: defZ };
      return { x: parts[0], y: parts[1], z: parts[2] };
    }

    const anchorRaw = cfgAttr("arMindarAnchor", "168");
    const anchorIndex = Math.max(0, Math.min(477, Math.floor(Number(anchorRaw)) || 168));
    const mindarDmRaw = cfgAttr("arMindarDisableMirror", "");
    const mindarDmExplicit = mindarDmRaw.length > 0;
    const mindarDmOff = /^1|true|on$/i.test(mindarDmRaw.toLowerCase());
    const legacyMsRaw = cfgAttr("arMirrorSelfie", "");
    const legacyMs = legacyMsRaw.toLowerCase();
    /** MindAR: espelho selfie no vídeo. `ar_mindar_disable_mirror` tem prioridade se preenchido. */
    let disableFaceMirror = false;
    if (mindarDmExplicit) {
      disableFaceMirror = mindarDmOff;
    } else if (legacyMs === "1" || legacyMs === "true" || legacyMs === "on") {
      disableFaceMirror = false;
    } else if (legacyMs === "0" || legacyMs === "false" || legacyMs === "off") {
      disableFaceMirror = true;
    }

    const fMinStr = String(cfgAttr("arMindarFilterMinCf", "")).trim();
    const fBetaStr = String(cfgAttr("arMindarFilterBeta", "")).trim();
    const fMinParsed = fMinStr.length > 0 ? Number(fMinStr) : NaN;
    const fBetaParsed = fBetaStr.length > 0 ? Number(fBetaStr) : NaN;
    const mindarOpts = {
      container: mindarHost,
      uiLoading: "no",
      uiScanning: "no",
      uiError: "no",
      disableFaceMirror,
      filterMinCF: Number.isFinite(fMinParsed)
        ? fMinParsed
        : OMAFIT_MINDAR_DEFAULT_FILTER_MIN_CF,
      filterBeta: Number.isFinite(fBetaParsed)
        ? fBetaParsed
        : OMAFIT_MINDAR_DEFAULT_FILTER_BETA,
    };

    mindarThree = new MindARThree(mindarOpts);
    /** Óculos/colar: câmara frontal; só `environment` se o tema pedir explicitamente. */
    {
      const arPreferredCam = String(cfgAttr("arPreferredCamera", "user"))
        .trim()
        .toLowerCase();
      mindarThree.shouldFaceUser = arPreferredCam !== "environment";
    }
    mindarThree.scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    mindarThree.scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.45));

    const anchor = mindarThree.addAnchor(anchorIndex);
    /** Grupos sob `anchor.group` devem ser da mesma classe `Group` que o MindAR usa (mesmo `three`). */
    const GroupCtor = anchor.group.constructor;
    if (!(anchor.group instanceof THREE.Group)) {
      console.warn(
        "[omafit-ar] O grupo da âncora MindAR não é instanceof THREE.Group deste bundle — possível segundo runtime de three; o modelo pode ficar torto ou invisível.",
      );
    }

    /**
     * `getUserMedia` tem de correr ainda dentro do gesto do utilizador (clique “Começar AR”).
     * Antes o `start()` vinha depois do download do GLB e o Chrome deixava de mostrar o pedido de permissão no desktop.
     */
    if (!window.isSecureContext) {
      loading.textContent = t.errHttps || t.errGeneric;
      throw new Error("omafit-ar: contexto não seguro (HTTPS).");
    }
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
      loading.textContent = t.errMediaDevices || t.errGeneric;
      throw new Error("omafit-ar: mediaDevices/getUserMedia indisponível.");
    }

    /**
     * MindAR liga-se apenas ao evento `window.resize`. Se o `mindarHost`
     * mudar de tamanho (modal a abrir/fechar, teclado virtual, rotação,
     * orientação), o `_resize` interno não corre sozinho e o vídeo fica
     * posicionado com os `top/left` da medição inicial → parece “cortado
     * à direita/em baixo”. Aqui disparamos o `resize` do window E, quando
     * possível, chamamos o próprio `_resize` do MindAR directamente.
     */
    const triggerMindarResize = () => {
      try {
        window.dispatchEvent(new Event("resize"));
      } catch {
        /* ignore */
      }
      try {
        if (mindarThree && typeof mindarThree._resize === "function") {
          mindarThree._resize();
        }
      } catch (e) {
        console.warn("[omafit-ar] mindarThree._resize falhou", e?.message || e);
      }
      try {
        if (mindarThree) fixMindARFaceVideoBehindCanvas(mindarThree, mindarHost);
      } catch {
        /* ignore */
      }
    };
    /**
     * `ResizeObserver` + `resize` + timeouts tardios: o MindAR mede `clientWidth`
     * do container; se o modal ainda não terminou layout, o vídeo fica descentrado
     * e parece “cortado” num dos lados.
     */
    arResizeObserver = new ResizeObserver(triggerMindarResize);
    arResizeObserver.observe(arWrap);
    arResizeObserver.observe(mindarHost);
    requestAnimationFrame(triggerMindarResize);
    requestAnimationFrame(() => requestAnimationFrame(triggerMindarResize));
    /** Timers espalhados até 2.5s para cobrir:
     *  - fade-in do modal (~350ms);
     *  - idle do layout (flexbox grid estabiliza);
     *  - iOS Safari que pode reflowar após o `<video>` receber metadata.
     *  Sem isto, o MindAR mede o container no momento errado e o vídeo
     *  fica com `top/left` fora → aparece "cortado do lado direito". */
    for (const ms of [32, 96, 220, 500, 900, 1500, 2500]) {
      lateMindarResizeTimerIds.push(
        setTimeout(() => {
          triggerMindarResize();
        }, ms),
      );
    }
    try {
      window.addEventListener("orientationchange", triggerMindarResize);
      if (screen?.orientation?.addEventListener) {
        screen.orientation.addEventListener("change", triggerMindarResize);
      }
      removeOrientationListeners = () => {
        try { window.removeEventListener("orientationchange", triggerMindarResize); } catch { /* ignore */ }
        try { screen?.orientation?.removeEventListener?.("change", triggerMindarResize); } catch { /* ignore */ }
      };
    } catch {
      /* ignore */
    }

    await startMindARFaceWithReliableCamera(mindarThree);
    /**
     * Não usar `scene.background` + VideoTexture: isso altera o pipeline WebGL do
     * MindAR e opacity 0 no elemento video pode quebrar faceMesh/detect (drawImage).
     * Mantemos vídeo DOM atrás do canvas com limpeza transparente (ver loop).
     */
    fixMindARFaceVideoBehindCanvas(mindarThree, mindarHost);

    /**
     * Pipeline simples: rotação vem inteiramente do `data-ar-canonical-fix-yxz`
     * (calibração do lojista). Os antigos `arGlbYxz` / `arModelYxz` /
     * `arPoseCorrYxz` foram removidos — toda rotação concentra-se em `calibRot`.
     */
    /**
     * `arMindarModelScale` = multiplicador ao redor de **1 face-width**
     * (MindAR `faceScale ≈ largura da cara em cm`). O UI do admin mostra
     * 30 %–300 % (0,3 a 3,0). Se algum metafield antigo gravou um valor
     * fora destes limites (p.ex. 14 por herança do código anterior),
     * corrigir aqui evita óculos “gigantes” no store sem nova calibração.
     */
    const scaleMulRaw = cfgAttr("arMindarModelScale", "");
    const nScale = Number(scaleMulRaw);
    let modelScaleMul = Number.isFinite(nScale) && nScale > 0 ? nScale : 1;
    if (modelScaleMul < 0.3 || modelScaleMul > 3) {
      console.warn(
        `[omafit-ar] arMindarModelScale=${modelScaleMul} fora de [0.3,3] — a clampar (possível calibração antiga).`,
      );
      modelScaleMul = Math.max(0.3, Math.min(3, modelScaleMul || 1));
    }

    const fromDom = (() => {
      const r = typeof document !== "undefined" ? document.getElementById("omafit-ar-root") : null;
      const u = r ? (r.dataset.glbUrl || r.getAttribute("data-glb-url") || "").trim() : "";
      const v = r
        ? String(r.dataset.arGlbVersion || r.getAttribute("data-ar-glb-version") || "").trim()
        : "";
      return { u, v };
    })();
    const sessionGlbUrl = fromDom.u || glbUrl;
    const glbVersion =
      fromDom.v ||
      String(arCfg?.dataset?.arGlbVersion || arCfg?.getAttribute?.("data-ar-glb-version") || "").trim();
    const glbLoadUrl = buildGlbLoaderUrl(sessionGlbUrl, glbVersion) || sessionGlbUrl;

    const loader = new GLTFLoader();
    loader.setCrossOrigin("anonymous");
    try {
      if (THREE.Cache && typeof THREE.Cache.remove === "function") {
        THREE.Cache.remove(glbLoadUrl);
        THREE.Cache.remove(sessionGlbUrl);
        THREE.Cache.remove(glbUrl);
      }
    } catch {
      /* ignore */
    }
    const gltf = await new Promise((resolve, reject) => {
      loader.load(glbLoadUrl, resolve, undefined, reject);
    });
    const glasses = gltf.scene;
    if (!(glasses instanceof THREE.Object3D)) {
      console.warn(
        "[omafit-ar] gltf.scene não é instanceof THREE.Object3D deste bundle — verificar loader/CDN.",
      );
    }
    glasses.frustumCulled = false;
    glasses.traverse((child) => {
      if (!child.isMesh) return;
      child.frustumCulled = false;
      const colorAttr =
        child.geometry && child.geometry.getAttribute ? child.geometry.getAttribute("color") : null;
      if (!child.material && colorAttr) {
        child.material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true });
      }
      if (!child.material) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of mats) {
        if (!mat) continue;
        if (mat.map && THREE.sRGBEncoding !== undefined) mat.map.encoding = THREE.sRGBEncoding;
        if (mat.emissiveMap && THREE.sRGBEncoding !== undefined) mat.emissiveMap.encoding = THREE.sRGBEncoding;
        if (colorAttr && "vertexColors" in mat) mat.vertexColors = true;
        if ("metalness" in mat) mat.metalness = 0;
        if ("roughness" in mat) mat.roughness = 1;
        if ("envMapIntensity" in mat) mat.envMapIntensity = 0;
        if ("emissiveIntensity" in mat) mat.emissiveIntensity = 1;
        mat.toneMapped = false;
        mat.needsUpdate = true;
      }
    });

    /**
     * Pipeline simples ("filtro do Instagram"): idêntica ao preview do admin.
     * Hierarquia mínima: anchor.group → wearPosition → calibRot → GLB.
     *   - calibRot:     rotação YXZ da calibração (defaults 0,0,0)
     *   - wearPosition: offset em unidades de âncora (≈14cm/unit) via wearX/Y/Z
     *   - escala:       ~1× largura da cara × modelScaleMul
     * Sem heurísticas (glbWideAlign / bake / ipdSnap / mirrorX / poseInvert /
     * centerOffset / bridgeY). O lojista calibra na ferramenta visual e o
     * resultado bate exato no AR.
     */
    let hasOmafitCanonicalNode = false;
    glasses.traverse((obj) => {
      if (obj && obj.name === "omafit_ar_canonical") hasOmafitCanonicalNode = true;
    });

    /** Frame de assentamento (materiais/morphs/skin) antes do bbox. */
    await new Promise((resolve) => requestAnimationFrame(resolve));
    glasses.updateMatrixWorld(true);

    /** 1) Normalizar COMPLETAMENTE a orientação do GLB (bake + flatten).
     *
     *    Porquê: GLBs exportados de Blender/Maya (ou convertidos via FBX/OBJ)
     *    costumam ter rotações não só no scene root mas também em nós
     *    filhos intermediários (pivot groups, armatures, export rigs). Se
     *    qualquer uma dessas rotações permanecer, a Euler YXZ do `calibRot`
     *    não roda em torno dos eixos do mundo/âncora — roda em torno dos
     *    eixos rodados do GLB, o que faz com que sliders distintos colapsem
     *    visualmente para o mesmo movimento (p.ex. "Girar esq/dir" e
     *    "Inclinar lateralmente" a produzirem o mesmo efeito).
     *
     *    A solução robusta é fazer **bake**: aplicar a matrixWorld de cada
     *    mesh ao próprio geometry (clonado para não mutar o cache do GLTF
     *    se for reutilizado) e depois resetar todas as transformações
     *    locais para identity. O resultado: cada mesh está no frame do
     *    MUNDO, com +X=direita, +Y=cima, +Z=frente das lentes, e a
     *    Euler YXZ do `calibRot` sempre corresponde aos eixos visuais
     *    esperados (rz = roll puro, ry = yaw puro, rx = pitch puro).
     *
     *    Skinned meshes e morph targets não são bakeáveis deste modo
     *    (destruir-se-ia a correspondência com o esqueleto). Saltamos
     *    esses casos — não fazem sentido para óculos estáticos. */
    const originalQuat = glasses.quaternion.clone();
    let bakedMeshCount = 0;
    let skippedAnimatedMeshCount = 0;
    try {
      bakeGLBTransforms(THREE, glasses, (info) => {
        bakedMeshCount = info.baked;
        skippedAnimatedMeshCount = info.skipped;
      });
    } catch (e) {
      console.warn(
        "[omafit-ar] bake do GLB falhou, seguindo só com reset do root:",
        e?.message || e,
      );
      glasses.rotation.set(0, 0, 0);
      glasses.quaternion.identity();
      glasses.scale.setScalar(1);
    }
    glasses.updateMatrix();
    glasses.updateMatrixWorld(true);

    /** 2) Bbox + centro depois de normalizar. Centramos a bbox na origem
     *    para que `calibRot` rode o GLB em torno do seu centro geométrico. */
    const box = new THREE.Box3().setFromObject(glasses);
    if (typeof box.isEmpty === "function" && box.isEmpty()) {
      throw new Error(
        "omafit-ar: GLB sem geometria visível (cena vazia ou só nós sem vértices).",
      );
    }
    const center = box.getCenter(new THREE.Vector3());
    const sz = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(sz.x, sz.y, sz.z, 1e-6);
    if (!Number.isFinite(maxDim) || maxDim < 1e-9) {
      throw new Error("omafit-ar: dimensões do GLB inválidas (NaN ou zero).");
    }
    glasses.position.sub(center);

    /** 2) Calibração do lojista (fallback para produtos sem metafield: 0,0,0,
     *    i.e. GLB na orientação nativa do autor). O lojista calibra visualmente
     *    na ferramenta do admin — não há heurística "default correcto" que
     *    funcione para todos os GLBs, porque cada autor exporta em convenções
     *    diferentes. */
    const calRotDeg = parseEulerDegComponents(
      cfgAttr("arCanonicalFixYxz", "0, 0, 0"),
      0, 0, 0,
    );
    const wearPosM = parseXyzMeters(cfgAttr("arMindarWearPosition", ""), 0, 0, 0);

    /** 4) Escala base — óculos com ~1× a largura da cara (depois da multiplicação do
     *    `anchor.group.matrix` por `faceScale` ≈ largura da cara em cm).
     *    Ver header no topo e o código fonte do MindAR 1.2.5 em
     *    `src/face-target/controller.js:getLandmarkMatrix` (`fm[i]*s`). */
    const baseUnitScale = (1 / maxDim) * modelScaleMul;
    glasses.scale.setScalar(baseUnitScale);
    console.log("[omafit-ar] face scale resolved", {
      maxDim,
      modelScaleMul,
      baseUnitScale,
      wearPosM,
      calRotDeg,
      anchorIndex,
      disableFaceMirror,
      sizeBbox: { x: sz.x, y: sz.y, z: sz.z },
    });

    /** 4) Hierarquia mínima (idêntica ao preview do admin):
     *       anchor.group → wearPosition → calibRot → glasses
     *
     *     - `calibRot` roda o GLB em torno do seu centro (bbox centrada).
     *     - `wearPosition` translada em unidades de âncora (≈ 14cm/unit em mundo).
     *
     *     SEM `centerOffset`/`bridgeY`: o comportamento anterior dependia da
     *     altura (sz.y) do GLB, e como estava por FORA de `calibRot` mas em
     *     unidades do GLB, o efeito variava conforme a geometria. Agora tudo
     *     se reduz a wearX/Y/Z em unidades de âncora (previsíveis).
     */
    /**
     * Rotação da calibração: usada `rotateOnWorldAxis` em vez de Euler YXZ
     * (ver comentário extenso em `app.ar-eyewear_.calibrate.$assetId.jsx` →
     * `applyCalibrationToState`). Cada axis é sempre do MUNDO — o slider
     * "Inclinar lateralmente" (rz) sempre roda em Z do mundo, mesmo que rx/ry
     * tenham valores herdados de calibrações anteriores.
     *
     * Ordem de composição (premultiply): Y → X → Z, igual ao preview.
     */
    const calibRot = new GroupCtor();
    {
      const ryRad = rad(calRotDeg.y);
      const rxRad = rad(calRotDeg.x);
      const rzRad = rad(calRotDeg.z);
      const ax = new THREE.Vector3(1, 0, 0);
      const ay = new THREE.Vector3(0, 1, 0);
      const az = new THREE.Vector3(0, 0, 1);
      if (ryRad) calibRot.rotateOnWorldAxis(ay, ryRad);
      if (rxRad) calibRot.rotateOnWorldAxis(ax, rxRad);
      if (rzRad) calibRot.rotateOnWorldAxis(az, rzRad);
      calibRot.updateMatrix();
      calibRot.updateMatrixWorld(true);
    }
    calibRot.add(glasses);

    const wearPosition = new GroupCtor();
    wearPosition.position.set(wearPosM.x, wearPosM.y, wearPosM.z);
    /**
     * SEM espelho de cena por defeito. O MindAR já inverte o frame antes da
     * detecção quando `flipFace=true` (selfie default), e entrega a matriz
     * da âncora no mesmo sistema de coordenadas do vídeo mostrado. Aplicar
     * `scale.x = -1` a `wearPosition` duplicava o espelho e empurrava os
     * óculos para fora do rosto (rodados e deslocados).
     *
     * Só respeitamos um override explícito em `data-ar-scene-x-mirror="1"`
     * para lojas que precisem dele por causa de GLBs não-simétricos.
     */
    try {
      const sxAttr = String(cfgAttr("arSceneXMirror", "")).trim().toLowerCase();
      let flipSceneX = false;
      if (/^(1|true|yes|on)$/.test(sxAttr)) flipSceneX = true;
      try {
        const q = new URLSearchParams(window.location?.search || "");
        const qs = (q.get("omafit_ar_scene_x_mirror") || "").trim().toLowerCase();
        if (qs === "1" || qs === "true") flipSceneX = true;
        if (qs === "0" || qs === "false") flipSceneX = false;
      } catch {
        /* noop */
      }
      wearPosition.scale.set(flipSceneX ? -1 : 1, 1, 1);
    } catch {
      wearPosition.scale.set(1, 1, 1);
    }
    wearPosition.add(calibRot);

    anchor.group.add(wearPosition);

    /** 4.1) Modo debug — activado por `?omafit_ar_debug=1` na URL OU
     *       `data-ar-debug="1"` no elemento embed. Adiciona ao anchor:
     *       - AxesHelper GRANDE (X=vermelho/Y=verde/Z=azul) a mostrar onde fica
     *         o frame do landmark 168 (ponte do nariz) durante o tracking.
     *       - BBox wireframe ciano à volta do GLB para ver o centro/escala.
     *       - Cubo sólido minúsculo no anchor origin (referência visual).
     *       - Face mesh wireframe (contorno do rosto detectado pela MindAR)
     *         para diagnosticar desalinhamentos entre rosto real e GLB.
     *       Útil para confirmar que o widget desenha IDÊNTICO ao preview do
     *       admin quando há queixas de mismatch. Desligado por padrão. */
    let debugEnabled = false;
    try {
      const qs = new URLSearchParams(window.location?.search || "");
      const qDebug = qs.get("omafit_ar_debug");
      const aDebug = cfgAttr("arDebug", "");
      debugEnabled =
        /^(1|true|on|yes)$/i.test(String(qDebug || "").trim()) ||
        /^(1|true|on|yes)$/i.test(String(aDebug || "").trim());
    } catch { /* noop */ }
    /** 4.0) Painel de debug ON-SCREEN — essencial em mobile (iPhone) onde
     *       não temos acesso fácil à consola do Safari. Sobreposto ao vídeo,
     *       mostra em tempo real os logs `[omafit-ar]` formatados, com botão
     *       para copiar. Só é criado quando `debugEnabled=true`. */
    let debugHud = null;
    let debugHudBody = null;
    const debugLines = [];
    const appendDebugLine = (label, payload) => {
      try {
        const text = typeof payload === "string"
          ? payload
          : JSON.stringify(payload, null, 2);
        const entry = `--- ${label} ---\n${text}\n`;
        debugLines.push(entry);
        if (debugHudBody) {
          const pre = document.createElement("pre");
          pre.style.margin = "0 0 8px 0";
          pre.style.whiteSpace = "pre-wrap";
          pre.style.wordBreak = "break-all";
          pre.textContent = entry;
          debugHudBody.appendChild(pre);
          debugHudBody.scrollTop = debugHudBody.scrollHeight;
        }
      } catch { /* no-op */ }
    };
    if (debugEnabled) {
      try {
        debugHud = el("div", {
          style: {
            position: "absolute",
            top: "8px",
            left: "8px",
            right: "8px",
            maxHeight: "55%",
            background: "rgba(0,0,0,0.78)",
            color: "#b5f7c6",
            fontFamily: "ui-monospace, Menlo, Consolas, monospace",
            fontSize: "10px",
            lineHeight: "1.35",
            padding: "8px",
            borderRadius: "8px",
            zIndex: "5",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            pointerEvents: "auto",
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
          },
        });
        const hudHeader = el("div", {
          style: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            color: "#fff",
            fontWeight: "600",
            fontSize: "11px",
          },
        });
        hudHeader.appendChild(document.createTextNode("OMAFIT AR · DEBUG"));
        const hudActions = el("div", { style: { display: "flex", gap: "6px" } });
        const btnStyle = {
          background: "#0ea5e9",
          color: "#fff",
          border: "none",
          borderRadius: "4px",
          padding: "4px 8px",
          fontSize: "10px",
          cursor: "pointer",
          fontFamily: "inherit",
        };
        const copyBtn = el("button", { style: btnStyle });
        copyBtn.type = "button";
        copyBtn.textContent = "Copiar";
        copyBtn.onclick = async () => {
          const full = debugLines.join("\n");
          try {
            await navigator.clipboard.writeText(full);
            copyBtn.textContent = "Copiado!";
            setTimeout(() => { copyBtn.textContent = "Copiar"; }, 1500);
          } catch {
            const ta = document.createElement("textarea");
            ta.value = full;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand("copy"); } catch { /* noop */ }
            document.body.removeChild(ta);
            copyBtn.textContent = "Copiado!";
            setTimeout(() => { copyBtn.textContent = "Copiar"; }, 1500);
          }
        };
        const clearBtn = el("button", {
          style: { ...btnStyle, background: "#6b7280" },
        });
        clearBtn.type = "button";
        clearBtn.textContent = "Limpar";
        clearBtn.onclick = () => {
          debugLines.length = 0;
          if (debugHudBody) debugHudBody.innerHTML = "";
        };
        const hideBtn = el("button", {
          style: { ...btnStyle, background: "#dc2626" },
        });
        hideBtn.type = "button";
        hideBtn.textContent = "X";
        hideBtn.onclick = () => {
          if (debugHud) debugHud.style.display = "none";
        };
        hudActions.appendChild(copyBtn);
        hudActions.appendChild(clearBtn);
        hudActions.appendChild(hideBtn);
        hudHeader.appendChild(hudActions);

        debugHudBody = el("div", {
          style: {
            overflowY: "auto",
            flex: "1 1 auto",
            background: "rgba(255,255,255,0.04)",
            borderRadius: "4px",
            padding: "6px",
          },
        });

        debugHud.appendChild(hudHeader);
        debugHud.appendChild(debugHudBody);
        arFit.appendChild(debugHud);

        /** Intercepta console.log/warn/error que começam com "[omafit-ar]"
         *  e replica no painel para visualização em mobile. */
        const origLog = console.log.bind(console);
        const origWarn = console.warn.bind(console);
        const origErr = console.error.bind(console);
        const isOmafit = (args) =>
          args && args[0] && typeof args[0] === "string" &&
          /^\[omafit-ar/i.test(args[0]);
        const hookLog = (origFn, label) => (...args) => {
          try {
            if (isOmafit(args)) {
              const [head, ...rest] = args;
              const payload = rest.length === 1 ? rest[0] : rest;
              appendDebugLine(`${label} ${head}`, payload);
            }
          } catch { /* no-op */ }
          return origFn(...args);
        };
        console.log = hookLog(origLog, "LOG");
        console.warn = hookLog(origWarn, "WARN");
        console.error = hookLog(origErr, "ERR");
      } catch (e) {
        console.warn("[omafit-ar] HUD debug falhou:", e?.message || e);
      }
    }

    if (debugEnabled) {
      try {
        if (THREE.AxesHelper) {
          const dbgAxes = new THREE.AxesHelper(1.0);
          dbgAxes.name = "omafit-ar-debug-axes";
          anchor.group.add(dbgAxes);
        }
        if (THREE.Box3Helper) {
          const dbgBbox = new THREE.Box3Helper(
            new THREE.Box3(
              new THREE.Vector3(-sz.x / 2, -sz.y / 2, -sz.z / 2),
              new THREE.Vector3(sz.x / 2, sz.y / 2, sz.z / 2),
            ),
            0x00e0ff,
          );
          dbgBbox.name = "omafit-ar-debug-bbox";
          dbgBbox.scale.setScalar(baseUnitScale);
          calibRot.add(dbgBbox);
        }
        const dbgCube = new THREE.Mesh(
          new THREE.BoxGeometry(0.05, 0.05, 0.05),
          new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: false }),
        );
        dbgCube.name = "omafit-ar-debug-cube";
        anchor.group.add(dbgCube);

        if (typeof mindarThree.addFaceMesh === "function") {
          const faceMesh = mindarThree.addFaceMesh();
          faceMesh.material = new THREE.MeshBasicMaterial({
            color: 0x00ff66,
            wireframe: true,
            transparent: true,
            opacity: 0.35,
          });
          faceMesh.name = "omafit-ar-debug-face";
        }
      } catch (e) {
        console.warn("[omafit-ar] debug helpers falharam:", e?.message || e);
      }
    }

    /** 4.2) Log dos eixos do calibRot após as rotações aplicadas —
     *       útil para verificar visualmente que rz=90 põe o Y do GLB a apontar
     *       para o Z/X do mundo (roll esperado), e assim por diante.
     *       Replica o log em console que o preview do admin produz. */
    try {
      const dbgAxX = new THREE.Vector3(1, 0, 0).applyQuaternion(calibRot.quaternion);
      const dbgAxY = new THREE.Vector3(0, 1, 0).applyQuaternion(calibRot.quaternion);
      const dbgAxZ = new THREE.Vector3(0, 0, 1).applyQuaternion(calibRot.quaternion);
      console.log("[omafit-ar] calibração aplicada", {
        rxDeg: calRotDeg.x,
        ryDeg: calRotDeg.y,
        rzDeg: calRotDeg.z,
        wearPosM,
        modelScaleMul,
        baseUnitScale,
        calibRotXinWorld: [
          dbgAxX.x.toFixed(3), dbgAxX.y.toFixed(3), dbgAxX.z.toFixed(3),
        ],
        calibRotYinWorld: [
          dbgAxY.x.toFixed(3), dbgAxY.y.toFixed(3), dbgAxY.z.toFixed(3),
        ],
        calibRotZinWorld: [
          dbgAxZ.x.toFixed(3), dbgAxZ.y.toFixed(3), dbgAxZ.z.toFixed(3),
        ],
        calSource: arCfg?.dataset?.arOmafitCalSource || "unknown",
      });
    } catch { /* no-op */ }

    /** 5) Loop de render — captura o primeiro faceMatrix recebido para log
     *     de diagnóstico. Permite confirmar que a âncora chega ao widget com
     *     o frame esperado (identidade + translação, para rosto frontal). */
    const { renderer, scene, camera } = mindarThree;
    let firstAnchorMatrixLogged = false;
    renderer.setAnimationLoop(() => {
      try {
        if (scene && scene.background != null) scene.background = null;
        if (renderer && typeof renderer.setClearColor === "function") {
          renderer.setClearColor(0x000000, 0);
        }
      } catch {
        /* ignore */
      }
      if (!firstAnchorMatrixLogged) {
        try {
          const m = anchor.group.matrix?.elements;
          const nonIdentity =
            m && (
              Math.abs(m[0] - 1) > 1e-4 || Math.abs(m[5] - 1) > 1e-4 ||
              Math.abs(m[10] - 1) > 1e-4 || Math.abs(m[12]) > 1e-4 ||
              Math.abs(m[13]) > 1e-4 || Math.abs(m[14]) > 1e-4
            );
          if (nonIdentity) {
            firstAnchorMatrixLogged = true;
            console.log("[omafit-ar] primeiro faceMatrix recebido:", {
              basisX: [m[0].toFixed(3), m[1].toFixed(3), m[2].toFixed(3)],
              basisY: [m[4].toFixed(3), m[5].toFixed(3), m[6].toFixed(3)],
              basisZ: [m[8].toFixed(3), m[9].toFixed(3), m[10].toFixed(3)],
              translation: [
                m[12].toFixed(3), m[13].toFixed(3), m[14].toFixed(3),
              ],
              hint:
                "Para rosto frontal, basisX≈(1,0,0), basisY≈(0,1,0), basisZ≈(0,0,1). " +
                "Qualquer coisa muito diferente indica problema no tracking.",
            });
          }
        } catch { /* no-op */ }
      }
      renderer.render(scene, camera);
    });
    fixMindARFaceVideoBehindCanvas(mindarThree, mindarHost);

    loading.style.display = "none";

    __omafitArDbgLog({
      location: "omafit-ar-widget.js:runArSession",
      message: "mindar face started (simple pipeline)",
      hypothesisId: "H6-simple-pipeline",
      data: {
        pipeline: "simple-instagram-filter",
        anchorIndex,
        disableFaceMirror,
        mirrorSelfieLegacy: legacyMsRaw || null,
        mindarDisableMirrorExplicit: mindarDmExplicit,
        calibrationDeg: calRotDeg,
        wearPositionM: wearPosM,
        debugEnabled,
        modelScaleMul,
        baseUnitScale,
        glbMaxDim: maxDim,
        hasOmafitCanonicalNode,
        glbRootQuatOriginal: {
          x: originalQuat.x, y: originalQuat.y,
          z: originalQuat.z, w: originalQuat.w,
        },
        glbRootWasRotated:
          Math.abs(originalQuat.x) > 1e-4 ||
          Math.abs(originalQuat.y) > 1e-4 ||
          Math.abs(originalQuat.z) > 1e-4 ||
          Math.abs(originalQuat.w - 1) > 1e-4,
        bakedMeshCount,
        skippedAnimatedMeshCount,
        calSource: arCfg?.dataset?.arOmafitCalSource || "unknown",
      },
    });
  } catch (e) {
    console.error("[omafit-ar]", e);
    const isCam =
      e.name === "NotAllowedError" ||
      e.name === "PermissionDeniedError" ||
      e.name === "OverconstrainedError" ||
      e.name === "NotFoundError" ||
      e.name === "AbortError";
    const msg = String(e?.message || e || "");
    const isGlb =
      /glb|gltf|fetch|load|404|403|network|failed to fetch|http/i.test(msg) &&
      !/face|landmarker|wasm|vision|tensorflow|mind|tfjs|facemesh/i.test(msg);
    if (/omafit-ar: contexto não seguro|insecure context/i.test(msg)) {
      loading.textContent = t.errHttps || t.errGeneric;
    } else if (/mediaDevices|getUserMedia/i.test(msg)) {
      loading.textContent = t.errMediaDevices || t.errGeneric;
    } else {
      loading.textContent = isCam ? t.errCamera : isGlb ? t.errGlb : t.errFace;
    }
    cleanup();
  }
}

/**
 * Sessão AR para acessórios de pulso (relógios, pulseiras) usando
 * MediaPipe Hand Landmarker + Three.js directamente (sem MindAR).
 *
 * Hierarquia Three.js igual à do face path:
 *   anchorGroup → wearPosition → calibRot → glbRoot
 *
 * `anchorGroup` é re-orientado a cada frame a partir de 3 landmarks:
 *   - 0  (wrist)
 *   - 5  (index finger MCP)
 *   - 17 (pinky finger MCP)
 * Estes três pontos definem um plano (costas/palma da mão) e uma base
 * ortonormada {X, Y, Z} consistente com a face path:
 *   - X = direcção pinky→index (largura do pulso, eixo lateral)
 *   - Y = normal do plano da mão (costas/palma, “para cima”)
 *   - Z = Y × X (perpendicular, “para a frente”)
 *
 * Retorna um callback de cleanup que é wired em `runArSession`.
 */
async function runHandArSession({
  THREE,
  GLTFLoader,
  vision,
  arCfg,
  embedCfg,
  accessoryType,
  arFit,
  mindarHost,
  loading,
  glbUrl,
  t,
  variants: _variants, // reservado para futura UI de variantes na hand path
  productId: _productId,
}) {
  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;

  function cfgAttr(camelKey, fallback = "") {
    const ek = embedCfg?.dataset?.[camelKey];
    if (ek !== undefined && String(ek).trim() !== "") return String(ek).trim();
    const ak = arCfg?.dataset?.[camelKey];
    if (ak !== undefined && String(ak).trim() !== "") return String(ak).trim();
    return String(fallback ?? "").trim();
  }

  function parseEulerDegComponents(raw, defX, defY, defZ) {
    const str = String(raw || "").trim();
    if (!str) return { x: defX, y: defY, z: defZ };
    const parts = str.split(/[\s,;]+/).map((t) => Number(t.trim()));
    if (parts.length < 3 || parts.some((n) => Number.isNaN(n)))
      return { x: defX, y: defY, z: defZ };
    return { x: parts[0], y: parts[1], z: parts[2] };
  }
  function parseXyzMeters(raw, defX, defY, defZ) {
    const str = String(raw || "").trim();
    if (!str) return { x: defX, y: defY, z: defZ };
    const parts = str.split(/[\s,;]+/).map((t) => Number(t.trim()));
    if (parts.length < 3 || parts.some((n) => Number.isNaN(n)))
      return { x: defX, y: defY, z: defZ };
    return { x: parts[0], y: parts[1], z: parts[2] };
  }

  if (!window.isSecureContext) {
    loading.textContent = t.errHttps || t.errGeneric;
    throw new Error("omafit-ar: contexto não seguro (HTTPS).");
  }
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    loading.textContent = t.errMediaDevices || t.errGeneric;
    throw new Error("omafit-ar: getUserMedia indisponível.");
  }

  const debug = /[?&]omafit_ar_debug=1\b/.test(String(location?.search || ""));

  loading.textContent = t.loadingCamera || t.loading || "A carregar câmara...";

  /**
   * Relógio / pulseira: câmara traseira no telemóvel (filmar a mão).
   * Óculos / colar usam stack face (MindAR) com câmara frontal — não passa aqui.
   */
  const preferredCam = String(cfgAttr("arPreferredCamera", "") || "").toLowerCase();
  const wantRearCamera =
    preferredCam === "environment" ||
    accessoryType === "watch" ||
    accessoryType === "bracelet";

  const video = document.createElement("video");
  video.setAttribute("playsinline", "");
  video.muted = true;
  video.autoplay = true;
  mindarHost.appendChild(video);

  let stream = null;
  /** Espelho horizontal do vídeo: selfie frontal costuma espelhar; câmara traseira não. */
  let mirrorVideoX = true;

  const baseVideoConstraint = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
  };

  try {
    if (wantRearCamera) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { ...baseVideoConstraint, facingMode: { ideal: "environment" } },
          audio: false,
        });
        mirrorVideoX = false;
      } catch (e1) {
        console.warn("[omafit-ar] câmara traseira indisponível, a tentar frontal:", e1?.message || e1);
        stream = await navigator.mediaDevices.getUserMedia({
          video: { ...baseVideoConstraint, facingMode: { ideal: "user" } },
          audio: false,
        });
        mirrorVideoX = true;
      }
    } else {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { ...baseVideoConstraint, facingMode: { ideal: "user" } },
        audio: false,
      });
      mirrorVideoX = true;
    }
  } catch (e) {
    loading.textContent = t.errCamera || t.errGeneric;
    throw e;
  }

  try {
    const track = stream.getVideoTracks?.()?.[0];
    const fm = track?.getSettings?.()?.facingMode;
    if (fm === "environment") mirrorVideoX = false;
    if (fm === "user") mirrorVideoX = true;
  } catch {
    /* ignore */
  }

  Object.assign(video.style, {
    position: "absolute",
    inset: "0",
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transform: mirrorVideoX ? "scaleX(-1)" : "scaleX(1)",
    zIndex: "1",
  });

  video.srcObject = stream;
  await new Promise((resolve, reject) => {
    const onLoaded = () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onErr);
      resolve();
    };
    const onErr = (e) => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onErr);
      reject(e);
    };
    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("error", onErr);
  });
  await video.play().catch(() => {});
  console.log("[omafit-ar] hand video ready", {
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
    videoAspect: video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : null,
    mirrorVideoX,
  });

  loading.textContent = t.loadingTracking || t.loading || "A carregar tracking...";

  const { FilesetResolver, HandLandmarker } = vision;
  const filesetResolver = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_BASE);
  const handLandmarker = await HandLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath: MEDIAPIPE_HAND_MODEL_URL,
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 1,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  const canvas = document.createElement("canvas");
  Object.assign(canvas.style, {
    position: "absolute",
    inset: "0",
    width: "100%",
    height: "100%",
    zIndex: "2",
    pointerEvents: "none",
  });
  mindarHost.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: false,
  });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  const hostRect = () => mindarHost.getBoundingClientRect();
  /**
   * Canvas backing store = vídeo intrínseco; CSS via `object-fit: cover` no
   * CSS global (mesmo tratamento do face path). Camera.aspect = vídeo aspect
   * ⇒ um landmark em (lm.x, lm.y) é desenhado no mesmo pixel CSS que o
   * pixel (lm.x·vW, lm.y·vH) do vídeo, independentemente das proporções do
   * contentor. Isto elimina o "relógio sempre deslocado para um lado" que
   * acontecia quando camera.aspect ≠ videoAspect.
   */
  const resizeRenderer = () => {
    const r = hostRect();
    const cssW = Math.max(1, Math.floor(r.width));
    const cssH = Math.max(1, Math.floor(r.height));
    const vW = video.videoWidth || cssW;
    const vH = video.videoHeight || cssH;
    renderer.setSize(vW, vH, false);
    if (camera) {
      camera.aspect = vW / vH;
      camera.updateProjectionMatrix();
    }
    void cssW;
    void cssH;
  };

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.45));

  const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 100);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);

  /**
   * Hierarquia espelha a face path para paridade com o preview do admin:
   *   anchor → wearPosition → calibRot → glbRoot
   */
  const anchor = new THREE.Group();
  /** Matriz escrita em `updateAnchorFromHand` — não deixar o Three interpolar. */
  anchor.matrixAutoUpdate = false;
  scene.add(anchor);

  const wearPosition = new THREE.Group();
  anchor.add(wearPosition);

  const calibRot = new THREE.Group();
  wearPosition.add(calibRot);

  const glbRoot = new THREE.Group();
  glbRoot.visible = false;
  calibRot.add(glbRoot);

  /**
   * === OCCLUDER DO ANTEBRAÇO ===
   * Cilindro invisível que representa o braço do utilizador. Escreve no
   * depth buffer mas NÃO pinta cor. Quando o GLB do relógio/pulseira
   * renderiza, a sua metade de trás (strap que passa por detrás do pulso)
   * falha o depth test e é descartada — dando a ilusão de estar DENTRO do
   * braço em vez de flutuar à frente dele.
   *
   * Técnica: "ghost mesh occluder" — padrão em WebAR (AR.js, 8th Wall).
   *
   * Requisitos para funcionar:
   *  • `colorWrite: false` + `depthWrite: true` → escreve só depth.
   *  • `renderOrder` negativo → desenha ANTES do GLB.
   *  • Raio do cilindro ≤ raio do pulso → strap dorsal (à frente) passa o
   *    depth test; strap palmar (atrás) é ocluído. Z-fighting evitado com
   *    `polygonOffset` + raio ligeiramente inferior ao do pulso real.
   *  • Âncora com `matrixAutoUpdate = false` mas o occluder é filho, logo
   *    herda a matriz via `updateMatrixWorld(true)`.
   */
  const OMAFIT_ARM_OCCLUDER_RADIUS_M = 0.022; // 22 mm (< pulso adulto típico 25-30 mm)
  const OMAFIT_ARM_OCCLUDER_LENGTH_M = 0.4;   // 40 cm (cobre antebraço completo)
  /** Offset do eixo do antebraço em relação à âncora (dorso do pulso).
   *  Âncora está a +6 mm do dorso; eixo do braço está armRadius abaixo do dorso. */
  const OMAFIT_ARM_OCCLUDER_Y_OFFSET_M = -(OMAFIT_ARM_OCCLUDER_RADIUS_M + 0.006);

  const armOccluderGeom = new THREE.CylinderGeometry(
    OMAFIT_ARM_OCCLUDER_RADIUS_M,
    OMAFIT_ARM_OCCLUDER_RADIUS_M,
    OMAFIT_ARM_OCCLUDER_LENGTH_M,
    24,
    1,
    false,
  );
  const armOccluderMat = new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: true,
    depthTest: true,
    side: THREE.DoubleSide,
    transparent: false,
    /**
     * polygonOffset POSITIVO empurra o depth do cilindro LIGEIRAMENTE
     * para trás (z-value maior). Efeito: fragmentos do GLB que estão
     * mesmo à frente do cilindro (strap dorsal tangencial) passam sempre
     * o depth test (strap_z < cyl_z_offset). Fragmentos atrás do
     * cilindro continuam a ser ocluídos (strap_z > cyl_z_offset).
     * Elimina o z-fighting típico quando strap toca na superfície do
     * braço sem impedir que a metade traseira seja ocluída.
     */
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const armOccluder = new THREE.Mesh(armOccluderGeom, armOccluderMat);
  armOccluder.renderOrder = -100;
  armOccluder.frustumCulled = false;
  /** Eixo +Y do cilindro (default do Three) deve alinhar com -Z local da âncora
   *  (direcção do cotovelo). setFromUnitVectors calcula o quaternion exacto. */
  armOccluder.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, -1),
  );
  /** Centro do cilindro: (0, −armR−6 mm, −L/2) em coord. locais da âncora.
   *  Isto põe o eixo do braço abaixo do dorso por `armR+6 mm` (atravessando
   *  o centro do pulso) e projecta-se para trás `L/2` a partir do pulso. */
  armOccluder.position.set(
    0,
    OMAFIT_ARM_OCCLUDER_Y_OFFSET_M,
    -OMAFIT_ARM_OCCLUDER_LENGTH_M / 2,
  );
  armOccluder.visible = false; // Só visível quando `anchor.visible = true`.
  anchor.add(armOccluder);

  // Apply stored calibration to the transform hierarchy.
  const fix = parseEulerDegComponents(cfgAttr("arCanonicalFixYxz", "0, 0, 0"), 0, 0, 0);
  const wearXYZ = parseXyzMeters(cfgAttr("arMindarWearPosition", "0 0 0"), 0, 0, 0);
  const userScale = Number(cfgAttr("arMindarModelScale", "1")) || 1;

  const applyCalibRot = () => {
    calibRot.rotation.set(0, 0, 0);
    calibRot.quaternion.identity();
    const axisX = new THREE.Vector3(1, 0, 0);
    const axisY = new THREE.Vector3(0, 1, 0);
    const axisZ = new THREE.Vector3(0, 0, 1);
    calibRot.rotateOnWorldAxis(axisY, rad(fix.y));
    calibRot.rotateOnWorldAxis(axisX, rad(fix.x));
    calibRot.rotateOnWorldAxis(axisZ, rad(fix.z));
  };
  applyCalibRot();

  wearPosition.position.set(wearXYZ.x, wearXYZ.y, wearXYZ.z);

  /**
   * Dobra os vértices de uma GLB em torno de um cilindro virtual com eixo
   * `armAxis` e raio `localR`. Coordenada ao longo de `bendAxis` vira ângulo
   * à volta do cilindro; coordenada ao longo de `dorsalAxis` vira distância
   * radial. O `armAxis` mantém-se inalterado.
   *
   * Math por vértice (pseudocódigo):
   *   θ  = bendComp / localR
   *   r  = localR + dorsalComp
   *   newBend    = r · sin(θ)
   *   newDorsal  = r · cos(θ) − localR
   *   newArm     = armComp (unchanged)
   *
   * Isto transforma uma correia plana (X lateral) numa correia curva que
   * envolve o pulso à medida que |x|/localR aumenta (ângulo cresce). O
   * mostrador do relógio (perto de x=0) mantém-se praticamente plano
   * (sin(θ)≈θ, cos(θ)≈1 para θ pequeno).
   *
   * Recomputa normais + bbox de cada mesh após a dobra.
   */
  function bendGeometryCylinder(glbScene, bendAxis, armAxis, dorsalAxis, localR) {
    const bA = bendAxis.clone().normalize();
    const aA = armAxis.clone().normalize();
    const dA = dorsalAxis.clone().normalize();
    const v = new THREE.Vector3();
    glbScene.traverse((obj) => {
      if (!obj.isMesh || !obj.geometry) return;
      const pos = obj.geometry.attributes.position;
      if (!pos) return;
      const arr = pos.array;
      for (let i = 0; i < arr.length; i += 3) {
        v.set(arr[i], arr[i + 1], arr[i + 2]);
        const bendC = v.dot(bA);
        const armC = v.dot(aA);
        const dorsalC = v.dot(dA);
        const theta = bendC / localR;
        const r = localR + dorsalC;
        const newBend = r * Math.sin(theta);
        const newDorsal = r * Math.cos(theta) - localR;
        v.copy(bA).multiplyScalar(newBend)
          .addScaledVector(aA, armC)
          .addScaledVector(dA, newDorsal);
        arr[i] = v.x;
        arr[i + 1] = v.y;
        arr[i + 2] = v.z;
      }
      pos.needsUpdate = true;
      obj.geometry.computeBoundingBox();
      obj.geometry.computeBoundingSphere();
      obj.geometry.computeVertexNormals();
    });
  }

  /**
   * Default wrist radius (m) usado no load até termos leitura estável do
   * raio real via landmarks. Escala é depois re-ajustada por frame em
   * `updateAnchorFromHand` para `smoothWristRadius`.
   */
  const OMAFIT_DEFAULT_WRIST_R_M = 0.026;
  /**
   * Folga radial (m) entre pele e face INTERNA do GLB após escala adaptativa.
   * Pulseira: 2,5 mm (v11.4 — subir de 2 mm porque utilizadores ainda viam
   * anel visualmente mais estreito que o pulso). Relógio: 1 mm (correia firme).
   */
  const OMAFIT_BRACELET_WRIST_GAP_M = 0.0025;
  const OMAFIT_WATCH_WRIST_GAP_M = 0.001;
  /**
   * Ratio knuckle-span → raio do pulso (landmarks 5–17). Pulseira usa valor
   * mais alto que relógio: feedback persistente de pulseira sub-dimensionada
   * mesmo com 0.34 único em v11.3.
   */
  const OMAFIT_BRACELET_KNUCKLE_TO_WRIST_R = 0.36;
  const OMAFIT_WATCH_KNUCKLE_TO_WRIST_R = 0.34;

  /**
   * === CÁLCULO DO RAIO INTERNO REAL DO ANEL ===
   *
   * Depois de `fitWristGlb` ter alinhado o eixo do cilindro/anel com +Z
   * local do GLB, esta função percorre TODOS os vértices das meshes e
   * devolve a menor distância radial (√(x²+y²)) ao eixo — o RAIO INTERNO
   * do anel.
   *
   * Diferença crucial vs `localRingR = medianDim/2`:
   *   • `localRingR` é o raio do EIXO / SUPERFÍCIE EXTERNA (bbox)
   *   • `localInnerR` é a face INTERNA (a que toca a pele)
   *
   * Escalar pelo eixo deixa a superfície interna dentro do pulso
   * (material "enterrado" na pele). Escalar pelo raio INTERNO faz com
   * que o anel encoste na pele com precisão milimétrica, do jeito que
   * um relógio/pulseira real encaixa.
   *
   * Usa 2º percentil (não mínimo absoluto) para ignorar outliers
   * como charms a pender dentro do anel, geometria de detalhe, etc.
   * Assume que o eixo do anel passa pelo centro do bbox.
   */
  function computeLocalInnerRadius(glbScene, bbox) {
    const center = new THREE.Vector3();
    bbox.getCenter(center);
    const distances = [];
    const v = new THREE.Vector3();
    glbScene.updateMatrixWorld(true);
    glbScene.traverse((obj) => {
      if (!obj.isMesh || !obj.geometry) return;
      const pos = obj.geometry.attributes.position;
      if (!pos) return;
      obj.updateMatrixWorld(true);
      const arr = pos.array;
      for (let i = 0; i < arr.length; i += 3) {
        v.set(arr[i], arr[i + 1], arr[i + 2]).applyMatrix4(obj.matrixWorld);
        const dx = v.x - center.x;
        const dy = v.y - center.y;
        distances.push(Math.sqrt(dx * dx + dy * dy));
      }
    });
    if (distances.length < 10) return null;
    distances.sort((a, b) => a - b);
    const idx = Math.max(0, Math.floor(distances.length * 0.02));
    return distances[idx];
  }

  /**
   * Ajusta uma GLB de pulso ao pulso em 3 passos:
   *
   *   1. Pulseira: detecta eixo do anel (dim mínima) e roda 90° para o
   *      alinhar com +Z local.
   *   2. Relógio plano (max/median > 2): dobra a correia à volta de um
   *      cilindro local de raio `strap/(2π·wrapFraction)`. Depois roda
   *      o eixo do braço (originalmente o "médio" do bbox) para +Z local.
   *   3. Calcula `localRingR` (raio no espaço GLB) e `baseScale` inicial
   *      assumindo pulso médio (26 mm). O caller ajusta por frame a partir
   *      do raio real detectado.
   */
  function fitWristGlb(glbScene, glbRoot, accessoryType, calScale) {
    let bbox = new THREE.Box3().setFromObject(glbScene);
    const size = new THREE.Vector3();
    bbox.getSize(size);

    let didBend = false;
    let bendLocalR = 0;

    if (accessoryType === "bracelet") {
      const sx = size.x;
      const sy = size.y;
      const sz = size.z;
      let smallestAxis = "z";
      if (sx <= sy && sx <= sz) smallestAxis = "x";
      else if (sy <= sx && sy <= sz) smallestAxis = "y";

      let rotApplied = false;
      if (smallestAxis === "x") {
        glbScene.quaternion.setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          -Math.PI / 2,
        );
        rotApplied = true;
      } else if (smallestAxis === "y") {
        glbScene.quaternion.setFromAxisAngle(
          new THREE.Vector3(1, 0, 0),
          Math.PI / 2,
        );
        rotApplied = true;
      }
      if (rotApplied) {
        glbScene.updateMatrixWorld(true);
        bbox = new THREE.Box3().setFromObject(glbScene);
        bbox.getSize(size);
      }
    } else {
      /**
       * === DETECÇÃO DE RELÓGIO PLANO ===
       *
       * Um relógio plano (correia esticada a direito) tem ratio max/median
       * tipicamente 4-7. Um relógio já enrolado (correia curva) tem ratio
       * próximo de 1. Threshold 2.0 distingue os dois com margem.
       *
       * Eixos após ordenação por tamanho:
       *   • bend axis (MAX)   = comprimento da correia esticada → vai envolver
       *   • arm axis (MEDIAN) = largura do mostrador / direcção do antebraço
       *   • dorsal axis (MIN) = espessura (normal da face do mostrador)
       */
      const axes = [
        { name: "x", size: size.x, vec: new THREE.Vector3(1, 0, 0) },
        { name: "y", size: size.y, vec: new THREE.Vector3(0, 1, 0) },
        { name: "z", size: size.z, vec: new THREE.Vector3(0, 0, 1) },
      ];
      axes.sort((a, b) => a.size - b.size);
      const dorsal = axes[0];
      const arm = axes[1];
      const bend = axes[2];
      const flatRatio = bend.size / Math.max(arm.size, 1e-6);
      if (flatRatio > 2.0) {
        /**
         * wrapFraction = 0.83 → correia cobre ~300° da circunferência
         * (buckle gap ~60° no lado palmar). Resulta num visual natural
         * onde se vê o overlap da fivela quando a mão roda.
         */
        const wrapFraction = 0.83;
        const localR = bend.size / (2 * Math.PI * wrapFraction);

        /**
         * === DETECÇÃO AUTO DO SENTIDO DORSAL ===
         *
         * O bbox dá-nos a magnitude mas não o sentido (±) do eixo dorsal.
         * Se errarmos, a face do relógio acaba no interior do cilindro
         * (invisível). Heurística: o centro do bbox tem projecção maior
         * no lado onde há mais massa (o corpo do relógio tipicamente é
         * mais volumoso no lado da face do que no lado da correia).
         *
         * Se center · dorsal_candidate < 0, invertemos o sentido.
         */
        const bboxCenter = new THREE.Vector3();
        bbox.getCenter(bboxCenter);
        const dorsalN = dorsal.vec.clone();
        if (bboxCenter.dot(dorsalN) < 0) dorsalN.negate();

        /**
         * === BASE ORTONORMAL RIGHT-HANDED ===
         *
         * Para a mudança de base para o frame da âncora ser uma ROTAÇÃO
         * própria (det+1, sem reflexão), precisamos que (bend, dorsal, arm)
         * forme base right-handed:   bend × dorsal = +arm
         *
         * Se a detecção inicial de `arm` estiver no sentido oposto
         * (depois de possivelmente termos invertido dorsal), invertê-lo
         * garante a base correcta.
         */
        const bendN = bend.vec.clone();
        const armN = arm.vec.clone();
        const expectedArm = new THREE.Vector3().crossVectors(bendN, dorsalN);
        if (expectedArm.dot(armN) < 0) armN.negate();

        bendGeometryCylinder(glbScene, bendN, armN, dorsalN, localR);
        didBend = true;
        bendLocalR = localR;

        /**
         * === MUDANÇA DE BASE PARA FRAME DA ÂNCORA ===
         *
         * Queremos que (bend, dorsal, arm) do GLB → (X, Y, Z) da âncora
         * (lateral, dorsal, antebraço). Construímos M com colunas
         * (bend, dorsal, arm); a rotação desejada é M^T (= M^-1 pois M
         * é ortonormal), que leva cada vector base ao eixo canónico.
         *
         * Três casos comuns:
         *   Watch face-up (Y up):  bend=X, dorsal=Y, arm=Z → M=I, q=identity
         *   Watch face-fwd (Z up): bend=X, dorsal=Z, arm=−Y → rot −90° em X
         *   Watch face-side (X):   bend=Y ou Z, dorsal=X, arm=outro → rot apropriada
         */
        const M = new THREE.Matrix4().makeBasis(bendN, dorsalN, armN);
        const invM = new THREE.Matrix4().copy(M).transpose();
        const q = new THREE.Quaternion().setFromRotationMatrix(invM);
        if (Math.abs(q.x) + Math.abs(q.y) + Math.abs(q.z) > 1e-6) {
          glbScene.quaternion.premultiply(q);
          glbScene.updateMatrixWorld(true);
        }
        bbox = new THREE.Box3().setFromObject(glbScene);
        bbox.getSize(size);
        console.log("[omafit-ar] watch strap bent around cylinder", {
          armAxis: arm.name,
          bendAxis: bend.name,
          dorsalAxis: dorsal.name,
          armFlipped: armN.dot(arm.vec) < 0,
          preBbox: { max: bend.size, mid: arm.size, min: dorsal.size },
          localR,
          wrapFraction,
          postBbox: { x: size.x, y: size.y, z: size.z },
        });
      }
    }

    /**
     * Após bracelete rodada OU relógio plano dobrado, o GLB é cilindrico
     * com eixo ao longo de +Z local. A mediana do bbox ≈ 2·localRingR
     * (raio do eixo central). Para relógio NÃO-plano (já enrolado pela
     * autoria, ratio < 2), usamos median/2 como estimativa do raio.
     */
    const sorted = [size.x, size.y, size.z].sort((a, b) => a - b);
    const medianDim = sorted[1] || 1;
    const maxDim = sorted[2] || 1;
    const localRingR = didBend
      ? bendLocalR
      : Math.max(medianDim / 2, 1e-6);

    /**
     * === MEDIR O RAIO INTERNO REAL DO ANEL (v11.2) ===
     *
     * `localRingR` é o raio do EIXO central. A superfície INTERNA do
     * anel (a que toca a pele) fica em `localRingR − espessura_radial`.
     * Se escalarmos por `localRingR`, a superfície interna fica DENTRO
     * do pulso (enterrada ~1-5 mm). Se escalarmos por `localInnerR`,
     * a superfície interna fica exactamente na pele (encaixe perfeito).
     *
     * Usamos o mínimo real da geometria (2º percentil p/ ignorar outliers).
     * Se falhar, fallback para `localRingR * 0.90` (estimativa conservadora
     * de 10% de espessura radial).
     */
    const computedInner = computeLocalInnerRadius(glbScene, bbox);
    const localInnerR =
      computedInner && computedInner > localRingR * 0.5 && computedInner < localRingR * 0.99
        ? computedInner
        : Math.max(localRingR * 0.9, 1e-6);

    /**
     * === baseScale: ENCAIXE PELA SUPERFÍCIE INTERNA ===
     *
     * targetInnerR = wristR_default + gap (onde fica a face interna no mundo).
     * scale = targetInnerR / localInnerR   (escalar pela INTERNA, não pelo eixo).
     *
     * Relógio: gap = 1 mm (folga mínima para a correia não enterrar na pele).
     * Pulseira: gap = 2,5 mm (v11.4 — alinha com runtime + preview calibrate).
     */
    const gapOffset =
      accessoryType === "bracelet"
        ? OMAFIT_BRACELET_WRIST_GAP_M
        : OMAFIT_WATCH_WRIST_GAP_M;
    const targetInnerR = OMAFIT_DEFAULT_WRIST_R_M + gapOffset;
    const calcBaseScale = targetInnerR / localInnerR;

    const finalMul =
      Number.isFinite(Number(calScale)) && Number(calScale) > 0
        ? Number(calScale)
        : 1;
    glbRoot.scale.setScalar(calcBaseScale * finalMul);

    const center = new THREE.Vector3();
    bbox.getCenter(center);
    glbScene.position.sub(center);

    return {
      baseScale: calcBaseScale,
      size,
      bbox,
      maxDim,
      medianDim,
      localRingR,
      localInnerR,
      didBend,
    };
  }

  // Load the GLB.
  const glbLoader = new GLTFLoader();
  const versionHint =
    arCfg?.dataset?.arGlbVersion || arCfg?.getAttribute?.("data-ar-glb-version") || "";
  const finalGlbUrl = buildGlbLoaderUrl(glbUrl, versionHint);
  let baseScale = 0.1;
  /** Raio local do anel/cilindro wrap (EIXO), em unidades GLB (pré-scale). */
  let localRingR = 0.025;
  /** Raio local INTERNO real (superfície que toca a pele), unidades GLB.
   *  Usado no ajuste adaptativo por frame: targetInnerR_mundo / localInnerR
   *  dá o scale exacto para a face interna encostar à pele. */
  let localInnerR = 0.022;
  /** Sinaliza se o relógio foi geometricamente dobrado à volta dum cilindro
   *  (GLB plano detectado). Usado só para logging. */
  let didBendWatch = false;
  await new Promise((resolve, reject) => {
    glbLoader.load(
      finalGlbUrl,
      (gltf) => {
        const glbScene = gltf.scene || gltf.scenes?.[0];
        if (!glbScene) {
          reject(new Error("GLB sem cena"));
          return;
        }
        bakeGLBTransforms(THREE, glbScene, ({ baked, skipped }) => {
          console.log(
            `[omafit-ar] hand GLB baked meshes=${baked} skipped=${skipped}`,
          );
        });
        glbRoot.add(glbScene);

        const fitRes = fitWristGlb(glbScene, glbRoot, accessoryType, userScale);
        baseScale = fitRes.baseScale;
        localRingR = fitRes.localRingR;
        localInnerR = fitRes.localInnerR || fitRes.localRingR * 0.9;
        didBendWatch = Boolean(fitRes.didBend);

        console.log("[omafit-ar] hand GLB fit", {
          accessoryType,
          strategy: fitRes.didBend
            ? "watch BENT → scale by INNER surface radius"
            : accessoryType === "bracelet"
              ? "bracelet → scale by INNER surface radius"
              : "watch wrapped → scale by INNER surface radius",
          baseScale: fitRes.baseScale,
          maxDim: fitRes.maxDim,
          medianDim: fitRes.medianDim,
          localRingR_mm: (fitRes.localRingR * 1000).toFixed(1),
          localInnerR_mm: ((fitRes.localInnerR || 0) * 1000).toFixed(1),
          ringThickness_mm: (
            (fitRes.localRingR - (fitRes.localInnerR || 0)) *
            1000
          ).toFixed(1),
          didBend: fitRes.didBend,
          defaultWristR_mm: Math.round(OMAFIT_DEFAULT_WRIST_R_M * 1000),
          effMaxMm: Math.round(
            fitRes.maxDim * fitRes.baseScale * (userScale > 0 ? userScale : 1) * 1000,
          ),
          effMedianMm: Math.round(
            fitRes.medianDim * fitRes.baseScale * (userScale > 0 ? userScale : 1) * 1000,
          ),
          bbox: { x: fitRes.size.x, y: fitRes.size.y, z: fitRes.size.z },
        });

        glbRoot.visible = true;
        resolve();
      },
      undefined,
      (err) => reject(err),
    );
  });

  if (debug) {
    anchor.add(new THREE.AxesHelper(0.1));
    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(0.01, 0.01, 0.01),
      new THREE.MeshBasicMaterial({ color: 0xff00ff }),
    );
    anchor.add(marker);
  }

  // Size + start animation loop.
  resizeRenderer();
  const ro = new ResizeObserver(() => resizeRenderer());
  ro.observe(mindarHost);

  const tmpMat = new THREE.Matrix4();
  const tmpX = new THREE.Vector3();
  const tmpY = new THREE.Vector3();
  const tmpZ = new THREE.Vector3();
  const tmpPos = new THREE.Vector3();
  /** Triângulo punho→MCP índice / mindinho: normal ≈ palma vs dorso (só relógio). */
  const wristTriA = new THREE.Vector3();
  const wristTriB = new THREE.Vector3();
  const palmTriN = new THREE.Vector3();

  /** Estado suavizado (EMA) dos eixos/posição — aproxima o filtro OneEuro do MindAR. */
  const smX = new THREE.Vector3();
  const smY = new THREE.Vector3();
  const smZ = new THREE.Vector3();
  const smPos = new THREE.Vector3();
  /** Quaternion suavizada (v11.2): SLERP em vez de LERP vector-a-vector.
   *  SLERP preserva unit-length, mantém velocidade angular constante e
   *  produz trajectórias geodésicas na esfera (= rotação visualmente
   *  natural). LERP passa pelo interior da esfera, criando falsos
   *  "escorregares" quando o utilizador roda o pulso. */
  const smoothedQuat = new THREE.Quaternion();
  const tmpQuat = new THREE.Quaternion();
  const basisMat = new THREE.Matrix4();
  let smoothInitialized = false;
  let lastFrameTs = -1;

  /** Estado suavizado (EMA lenta) do occluder: raio do pulso e comprimento
   *  do antebraço estimados por landmark-spacing. tau ≈ 800 ms (pessoa não
   *  muda de pulso entre frames; suavizar fortemente elimina pulsar). */
  let smoothWristRadius = OMAFIT_ARM_OCCLUDER_RADIUS_M;
  let smoothForearmLength = OMAFIT_ARM_OCCLUDER_LENGTH_M;
  let smoothOccluderInitialized = false;

  let running = true;
  let lastHandTimestamp = -1;
  let rafId = 0;
  let missedFrames = 0;
  const MISSED_HIDE_THRESHOLD = 6;

  /**
   * === ESTABILIDADE DE HANDEDNESS (v11.2) ===
   *
   * MediaPipe devolve "Left" | "Right" por frame com um score [0,1].
   * Em frames raros a classificação oscila (ex.: pulso virado 90°, palm
   * perpendicular à câmara), o que causa um flip de 180° no GLB porque
   * `tmpX.negate()` inverte a paridade da base ortonormal.
   *
   * Estratégia de 2 camadas:
   *   1) Threshold de confiança: só aceita nova label se score ≥ 0.75.
   *      Frames com score baixo mantêm a última label conhecida.
   *   2) Histerese por persistência: nova label só substitui a antiga
   *      depois de 3 frames consecutivos concordantes. Flicker isolado
   *      é ignorado.
   *
   * `lastHandScore` é exposto para debug/logging. */
  let stableHandLabel = "Right";
  let pendingHandLabel = "";
  let pendingHandCount = 0;
  let lastHandScore = 0;
  const HANDEDNESS_SCORE_THRESHOLD = 0.75;
  const HANDEDNESS_PERSIST_FRAMES = 3;

  /**
   * Desprojecta um landmark normalizado do MediaPipe (x,y ∈ [0,1]) para
   * espaço da câmara Three.js, assumindo `camera.aspect = videoAspect`
   * (garantido em `resizeRenderer`). Assim o mapeamento é 1:1 com o que
   * o browser pinta via `object-fit: cover` no vídeo.
   *
   * Com vídeo espelhado (`mirrorVideoX`, típico da frontal), invertemos x
   * para alinhar ao que o utilizador vê. Com câmara traseira, não espelhamos.
   */
  function videoAspect() {
    const vw = video.videoWidth || 0;
    const vh = video.videoHeight || 0;
    if (vw > 0 && vh > 0) return vw / vh;
    return camera.aspect;
  }
  function unprojectLandmark(lm, zDist) {
    const fov = rad(camera.fov);
    const hView = 2 * Math.tan(fov / 2) * zDist;
    const wView = hView * camera.aspect;
    const xNorm = mirrorVideoX ? 1 - lm.x : lm.x;
    return new THREE.Vector3((xNorm - 0.5) * wView, -(lm.y - 0.5) * hView, -zDist);
  }

  function updateAnchorFromHand(lms, dtMs, handLabel) {
    /**
     * Profundidade: `zDist = L * focalNormalY / spanY`, onde:
     *   - L = 0,10 m (comprimento real punho→MCP-médio em adulto)
     *   - focalNormalY = 1 / (2·tan(fov_v/2))  (focal normalizada vertical)
     *   - spanY = distância punho→MCP-médio convertida para unidades
     *             verticais normalizadas (dx * videoAspect + dy).
     *
     * Derivação: um segmento de comprimento L a distância Z projecta-se
     * com tamanho aparente (L · focal / Z). Resolvendo: Z = L · focal / span.
     */
    const wristN = lms[0];
    const middleMcpN = lms[9] || lms[5];
    const dx = (middleMcpN.x - wristN.x) * videoAspect();
    const dy = middleMcpN.y - wristN.y;
    const spanY = Math.sqrt(dx * dx + dy * dy);
    const fov = rad(camera.fov);
    const focalN = 1 / (2 * Math.tan(fov / 2));
    let zDist = (OMAFIT_WRIST_TO_MCP_M * focalN) / Math.max(0.02, spanY);
    zDist = Math.max(0.15, Math.min(1.5, zDist));
    /** Usar o mesmo zDist para todos os landmarks evita escala relativa errada ao combinar. */
    const w0 = unprojectLandmark(wristN, zDist);
    const w5 = unprojectLandmark(lms[5], zDist);
    const w9 = unprojectLandmark(lms[9], zDist);
    const w17 = unprojectLandmark(lms[17], zDist);

    /**
     * === BASE ORTONORMAL DO PULSO (v11.1) ===
     *
     *   X = mindinho (17) → índice (5)         largura do pulso
     *   Y = normal do plano palmar/dorsal       (cross de toMcp com X)
     *   Z = X × Y                               ao longo do antebraço
     *
     * LATERALIDADE: `Y = toMcp × X` dá a normal DORSAL apenas quando X
     * está no sentido anatómico da mão direita. Numa mão ESQUERDA, a
     * ordem invert-se e Y passa a apontar PALMAR → flip de X corrige.
     *
     * === POR QUE NÃO HÁ MAIS O FALLBACK "tmpY.z < −0.05" ===
     *
     * A versão anterior tinha um fallback que forçava `tmpY.z > 0`
     * (dorso sempre virado à câmara). Matematicamente correcto em
     * poses normais, mas NEFASTO quando o utilizador roda o antebraço:
     *
     *   • A rodar para mostrar a palma → tmpY passa a apontar para
     *     −Z (dorso vira-se PARA LONGE da câmara, correcto anatomicamente).
     *   • O fallback dispara e FAZ FLIP de 180° → o relógio "salta"
     *     para o outro lado do pulso e fica sempre virado à câmara.
     *   • O utilizador vê descontinuidade em vez de rotação suave e
     *     nunca consegue ver a lateral/traseira do GLB.
     *
     * Removido: o MediaPipe Hand Landmarker moderno dá lateralidade
     * com >99 % de fiabilidade, tornando o fallback mais prejudicial
     * do que útil. Agora o GLB gira naturalmente com o braço — rodas
     * o pulso, vês a lateral do relógio/pulseira como se fosse real.
     */
    tmpX.subVectors(w5, w17).normalize();
    const toMcp = new THREE.Vector3().subVectors(w9, w0);
    if (handLabel === "Left") tmpX.negate();
    tmpY.crossVectors(toMcp, tmpX).normalize();
    /**
     * === RELÓGIO: refinamento dorso vs palma (v11.4) ===
     *
     * `toMcp × X` segue bem o antebraço, mas em algumas poses o vector
     * punho→MCP-médio oscila e o eixo Y (normal palmar/dorsal) deixa de
     * separar tão bem a "face" do relógio (dorso) do lado da palma.
     *
     * A normal do triângulo (w5−w0) × (w17−w0) é aproximadamente perpendicular
     * ao plano da prega do pulso — mais estável para distinguir lado de cima
     * (dorso, mostrador) vs lado de baixo (palma, fecho). Misturamos ~52 %
     * desta normal com o Y clássico e projectamos de volta no plano ⊥ a X
     * para manter base ortonormal.
     */
    if (accessoryType === "watch") {
      wristTriA.subVectors(w5, w0);
      wristTriB.subVectors(w17, w0);
      palmTriN.copy(wristTriA).cross(wristTriB);
      const triLen = palmTriN.length();
      if (triLen > 1e-7) {
        palmTriN.multiplyScalar(1 / triLen);
        if (palmTriN.dot(tmpY) < 0) palmTriN.negate();
        tmpY.lerp(palmTriN, 0.52).normalize();
        tmpY.addScaledVector(tmpX, -tmpY.dot(tmpX));
        const yLen = tmpY.length();
        if (yLen > 1e-7) tmpY.multiplyScalar(1 / yLen);
      }
    }
    tmpZ.crossVectors(tmpX, tmpY).normalize();

    /**
     * Posição: directamente no landmark do pulso (w0). Antes usava-se 30 %
     * do vector punho→MCP, mas isso colocava o relógio na base dos nós dos
     * dedos (na mão, não no pulso). MediaPipe `landmark[0]` está na prega
     * do pulso, onde anatomicamente se usa o relógio. Elevar ~6 mm na
     * normal dorsal para o mostrador assentar POR CIMA da pele, não dentro.
     * Calibrações `wearZ` do lojista continuam a permitir ajuste fino.
     */
    tmpPos.copy(w0).addScaledVector(tmpY, 0.006);

    /**
     * === SUAVIZAÇÃO DA ORIENTAÇÃO (v11.3: SLERP + Anti-Flip Guard) ===
     *
     * Constrói quaternion do target (tmpX, tmpY, tmpZ) e interpola
     * esfericamente da quaternion suavizada actual para o target — EXCEPTO
     * quando a variação angular instantânea excede `OMAFIT_HAND_FLIP_GUARD_RAD`,
     * nesses frames rejeitamos o target (evita "flips" de 180° causados por
     * classificação errada da lateralidade pelo MediaPipe).
     *
     * SLERP vs LERP-vector-a-vector:
     *   • SLERP move no arco mais curto da esfera → rotação natural,
     *     sem variação aparente de escala durante a transição.
     *   • LERP passa pelo CORDA da esfera → durante a transição, os
     *     eixos deixam de ser unitários (antes do .normalize()); depois
     *     da normalização, a velocidade angular não é constante (mais
     *     rápida no meio, lenta no início/fim). Visualmente, o GLB
     *     "atrasa" no início e "ultrapassa" no fim do giro.
     *
     * Anti-flip guard:
     *   • `angle = 2 · acos(|dot(currentQuat, targetQuat)|)` dá o ângulo
     *     geodésico da rotação restante.
     *   • Se > 2.618 rad (150°), provável handedness flip espúrio; reject.
     *   • Rotações reais do braço (mesmo rápidas) raramente excedem 90°
     *     em 16 ms (que seria 5625°/s = impossível anatomicamente).
     *
     * Resultado: a rotação lateral do pulso (ex.: thumb para cima,
     * thumb horizontal) é seguida de forma geodésica, MAS sem saltos
     * súbitos de 180° quando o MediaPipe se engana momentaneamente.
     *
     * Posição continua com EMA linear (mais estável para translação).
     */
    const clampDt = Math.max(8, Math.min(80, Number.isFinite(dtMs) ? dtMs : 16));
    basisMat.makeBasis(tmpX, tmpY, tmpZ);
    tmpQuat.setFromRotationMatrix(basisMat);
    if (!smoothInitialized) {
      smoothedQuat.copy(tmpQuat);
      smPos.copy(tmpPos);
      smoothInitialized = true;
    } else {
      const aPos = 1 - Math.exp(-clampDt / OMAFIT_HAND_POS_TAU_MS);
      const aAxis = 1 - Math.exp(-clampDt / OMAFIT_HAND_AXIS_TAU_MS);
      smPos.lerp(tmpPos, aPos);
      /**
       * Anti-flip guard: medir ângulo entre smoothedQuat e tmpQuat.
       * dot < 0 significa que estão no hemisfério oposto da esfera 4D
       * (ambíguo mas ok — Three.js SLERP inverte internamente para shortest
       * path). Usamos |dot| para medir o arco real.
       */
      const dotQ =
        smoothedQuat.x * tmpQuat.x +
        smoothedQuat.y * tmpQuat.y +
        smoothedQuat.z * tmpQuat.z +
        smoothedQuat.w * tmpQuat.w;
      const absDot = Math.min(1, Math.abs(dotQ));
      const angleBetween = 2 * Math.acos(absDot);
      if (angleBetween > OMAFIT_HAND_FLIP_GUARD_RAD) {
        /** Flip espúrio: ignorar este frame (não actualiza smoothedQuat). */
        if (debug) {
          console.debug("[omafit-ar] flip rejected", {
            angleDeg: ((angleBetween * 180) / Math.PI).toFixed(1),
            hand: handLabel || "?",
          });
        }
      } else {
        smoothedQuat.slerp(tmpQuat, aAxis);
      }
    }

    /** Extrai eixos da quaternion suavizada (para debug e para
     *  componentes que dependam de smX/smY/smZ, como o fallback de escala). */
    basisMat.makeRotationFromQuaternion(smoothedQuat);
    smX.set(basisMat.elements[0], basisMat.elements[1], basisMat.elements[2]);
    smY.set(basisMat.elements[4], basisMat.elements[5], basisMat.elements[6]);
    smZ.set(basisMat.elements[8], basisMat.elements[9], basisMat.elements[10]);

    tmpMat.copy(basisMat);
    tmpMat.setPosition(smPos);
    anchor.matrix.copy(tmpMat);
    anchor.matrixWorldNeedsUpdate = true;
    anchor.updateMatrixWorld(true);

    /**
     * === ESCALA DINÂMICA DO OCCLUDER ===
     * Estimar raio real do pulso do utilizador a partir da largura detectada
     * entre knuckle-indicador (w5) e knuckle-mindinho (w17). Razão anatómica
     * típica: raio do pulso ≈ 35-40 % da largura entre knuckles.
     *
     * Clamp do raio (ver bloco wristRadiusRaw) cobre criança a adulto.
     * Actualiza o scale Y do cilindro (ao longo do braço) para se manter
     * proporcional — antebraços curtos (crianças) ficam com cilindro mais
     * curto para não "flutuar" para lá do cotovelo virtual.
     *
     * EMA lento (tau = 800 ms) para não pulsar com o jitter dos landmarks.
     */
    const handKnuckleSpan = w5.distanceTo(w17);
    /**
     * === ESTIMATIVA ANTROPOMÉTRICA DO RAIO DO PULSO (v11.4) ===
     *
     * Dados reais (WHO/NHANES adult hand anthropometry) dão um ratio
     * muitíssimo consistente entre raio do pulso e distância entre knuckles
     * (landmarks MediaPipe 5 e 17):
     *
     *   Percentil   KnuckleSpan   WristCirc   WristR    Ratio
     *   F 5º        67 mm         140 mm      22.3 mm   0.333
     *   Médio       78 mm         160 mm      25.5 mm   0.327
     *   M 95º       92 mm         190 mm      30.2 mm   0.328
     *   M 99º       98 mm         210 mm      33.4 mm   0.341
     *
     * v11.4: ratio depende do produto — pulseira 0.36, relógio 0.34.
     *   Feedback: pulseira ainda parecia mais estreita que o pulso com 0.34
     *   único; relógio mantém ratio conservador.
     *
     * Clamp [18, 42] mm: lower cobre percentil 3 feminino + crianças;
     *   upper cobre percentil 99.5 masculino + atletas (pulso muito largo).
     *   v11.2 tinha 34 mm (clipava pulsos largos → utilizador via "GLB
     *   menor que o pulso"). Subida para 42 mm resolve este clipping.
     */
    const knuckleToWristRatio =
      accessoryType === "bracelet"
        ? OMAFIT_BRACELET_KNUCKLE_TO_WRIST_R
        : OMAFIT_WATCH_KNUCKLE_TO_WRIST_R;
    const wristRadiusRaw = Math.max(
      0.018,
      Math.min(0.042, handKnuckleSpan * knuckleToWristRatio),
    );
    /**
     * Comprimento do antebraço (para occluder): ratio ≈ 3.2 × knuckleSpan
     * (comprimento médio de antebraço adulto 25-30 cm vs knuckleSpan 78-92 mm).
     * Mantemos clamp [0.3, 0.6] m para robustez contra outliers — o occluder
     * pode ser um pouco mais comprido que o antebraço real sem problema
     * (depth-write extra para trás não afecta render da cena).
     */
    const forearmLengthRaw = Math.max(0.3, Math.min(0.6, handKnuckleSpan * 4.0));
    if (!smoothOccluderInitialized) {
      smoothWristRadius = wristRadiusRaw;
      smoothForearmLength = forearmLengthRaw;
      smoothOccluderInitialized = true;
    } else {
      const clampDtOcc = Math.max(8, Math.min(80, Number.isFinite(dtMs) ? dtMs : 16));
      const aOcc = 1 - Math.exp(-clampDtOcc / 800);
      smoothWristRadius += (wristRadiusRaw - smoothWristRadius) * aOcc;
      smoothForearmLength += (forearmLengthRaw - smoothForearmLength) * aOcc;
    }
    /**
     * Scale X,Z = raio (geometria tem raio=base 0.022; aplicamos factor).
     *
     * v11.3: occluder raio = smoothWristR + 4 mm (não apenas wristR). Motivo:
     *   • Estimativa antropométrica pode subestimar o braço real em 1-3 mm.
     *   • Braço humano é ligeiramente ELÍPTICO (mais largo no sentido palmar-dorsal
     *     que no ulnar-radial), enquanto occluder é CIRCULAR. Margem cobre a
     *     dimensão maior da elipse.
     *   • Manter raio < raio externo da pulseira (≈ wristR + 7 mm) — assim o
     *     OUTER do GLB continua à frente do occluder e é visível; apenas o
     *     INNER/BACK fica atrás do occluder e é ocluído.
     *   • Resolve "vejo a parte debaixo" quando o GLB está em ângulo: a parte
     *     de trás da pulseira que o utilizador vê sobreposta ao braço real é
     *     apanhada pelo depth buffer do occluder e fica invisível (mostrando
     *     o braço real da câmara em vez do back-face do GLB).
     */
    const occluderR = smoothWristRadius + 0.004;
    const radiusScale = occluderR / OMAFIT_ARM_OCCLUDER_RADIUS_M;
    const lengthScale = smoothForearmLength / OMAFIT_ARM_OCCLUDER_LENGTH_M;
    armOccluder.scale.set(radiusScale, lengthScale, radiusScale);
    /**
     * Re-posicionar: Y offset coloca o EIXO do cilindro no centro do braço.
     * Âncora está a +6 mm do dorso (tmpY direction). O eixo do braço está a
     * `smoothWristRadius` por baixo do dorso. Logo em anchor local Y:
     *   eixo = −(smoothWristRadius + 6 mm)
     *
     * (NÃO usamos occluderR aqui — usamos o raio do BRAÇO real, que é o que
     * determina a posição do eixo. occluderR é só a ESPESSURA visual do
     * cilindro para cobertura defensiva.)
     */
    armOccluder.position.y = -(smoothWristRadius + 0.006);
    /** Z offset: centrar o cilindro atrás do pulso (−L/2). */
    armOccluder.position.z = -smoothForearmLength / 2;
    armOccluder.updateMatrix();
    armOccluder.updateMatrixWorld(true);

    /**
     * === ESCALA ADAPTATIVA PELA SUPERFÍCIE INTERNA (v11.2) ===
     *
     * O `baseScale` já é `targetInnerR_default / localInnerR` (calculado
     * em `fitWristGlb`). Agora que temos leitura estável do raio real
     * deste utilizador, multiplicamos por
     *
     *     adaptMul = (smoothWristR + gap) / (defaultWristR + gap)
     *
     * para que a superfície INTERNA do GLB encoste à pele do utilizador.
     * O resultado: não há "gap" visível porque o anel envolve o pulso
     * exactamente à superfície, como um produto real no braço.
     *
     * gap: ver OMAFIT_*_WRIST_GAP_M (relógio 1 mm, pulseira 2,5 mm v11.4).
     */
    if (glbRoot && localInnerR > 1e-6) {
      const gapOffset =
        accessoryType === "bracelet"
          ? OMAFIT_BRACELET_WRIST_GAP_M
          : OMAFIT_WATCH_WRIST_GAP_M;
      const targetInnerR = smoothWristRadius + gapOffset;
      const defaultTargetR = OMAFIT_DEFAULT_WRIST_R_M + gapOffset;
      const adaptMul = targetInnerR / defaultTargetR;
      const userMul =
        Number.isFinite(Number(userScale)) && Number(userScale) > 0
          ? Number(userScale)
          : 1;
      glbRoot.scale.setScalar(baseScale * userMul * adaptMul);
    }

    if (debug) {
      const userMul =
        Number.isFinite(Number(userScale)) && Number(userScale) > 0
          ? Number(userScale)
          : 1;
      const gapOffset =
        accessoryType === "bracelet"
          ? OMAFIT_BRACELET_WRIST_GAP_M
          : OMAFIT_WATCH_WRIST_GAP_M;
      const adaptMul =
        (smoothWristRadius + gapOffset) /
        (OMAFIT_DEFAULT_WRIST_R_M + gapOffset);
      console.debug("[omafit-ar] hand anchor v11.4", {
        hand: handLabel || "?",
        handScore: (lastHandScore || 0).toFixed(2),
        anchor: "w0 (wrist)",
        /** Raw knuckle span (medida bruta MediaPipe landmarks 5-17). */
        knuckleSpan_mm: (handKnuckleSpan * 1000).toFixed(1),
        /** wristR DEPOIS de aplicar ratio 0.34 + clamp [18, 42] mm. */
        wristR_mm: (smoothWristRadius * 1000).toFixed(1),
        /** Occluder raio (= wristR + 4 mm buffer). */
        occluderR_mm: ((smoothWristRadius + 0.004) * 1000).toFixed(1),
        forearmL_cm: (smoothForearmLength * 100).toFixed(1),
        bent: didBendWatch,
        /** Raio INTERNO do GLB (superfície que toca a pele em unidades GLB). */
        localInnerR_mm: (localInnerR * 1000).toFixed(1),
        /** Raio do EIXO do GLB (metade da mediana do bbox). */
        localRingR_mm: (localRingR * 1000).toFixed(1),
        adaptScale: adaptMul.toFixed(3),
        glbScale: (baseScale * userMul * adaptMul).toFixed(4),
        /** Raio INTERNO final do GLB no mundo (deve ≈ wristR + gap).
         *  Se este valor for MENOR que smoothWristR, o GLB clipa no braço!
         *  Se for MAIOR que smoothWristR + 5mm, o GLB fica flutuando. */
        finalInnerR_mm: (localInnerR * baseScale * userMul * adaptMul * 1000).toFixed(1),
        zDist: zDist.toFixed(3),
        Yz: tmpY.z.toFixed(3),
      });
    }
  }

  function tick() {
    if (!running) return;
    rafId = requestAnimationFrame(tick);
    if (video.readyState < 2) {
      renderer.render(scene, camera);
      return;
    }
    const nowTs = performance.now();
    if (nowTs === lastHandTimestamp) {
      renderer.render(scene, camera);
      return;
    }
    const dtMs = lastFrameTs < 0 ? 16 : nowTs - lastFrameTs;
    lastFrameTs = nowTs;
    lastHandTimestamp = nowTs;

    let res = null;
    try {
      res = handLandmarker.detectForVideo(video, nowTs);
    } catch (e) {
      console.warn("[omafit-ar] handLandmarker.detectForVideo:", e?.message || e);
    }

    const landmarks = res?.landmarks?.[0];
    /**
     * Lateralidade estabilizada (v11.2). Passa por 2 filtros antes de
     * aceitar mudança: confiança ≥ 0.75 e persistência ≥ 3 frames. Isto
     * impede que flicker de 1-2 frames cause flip de 180° no GLB quando
     * o utilizador roda o pulso (pose lateral com palma perpendicular
     * à câmara é tipicamente onde o score do MediaPipe cai).
     */
    try {
      const hn = res?.handednesses?.[0]?.[0] || res?.handedness?.[0]?.[0];
      if (hn && typeof hn.categoryName === "string") {
        const newLabel = hn.categoryName === "Left" ? "Left" : "Right";
        const score = Number(hn.score) || 0;
        lastHandScore = score;
        if (score >= HANDEDNESS_SCORE_THRESHOLD) {
          if (newLabel === stableHandLabel) {
            pendingHandLabel = "";
            pendingHandCount = 0;
          } else {
            if (newLabel === pendingHandLabel) {
              pendingHandCount += 1;
            } else {
              pendingHandLabel = newLabel;
              pendingHandCount = 1;
            }
            if (pendingHandCount >= HANDEDNESS_PERSIST_FRAMES) {
              stableHandLabel = newLabel;
              pendingHandLabel = "";
              pendingHandCount = 0;
            }
          }
        }
      }
    } catch {
      /* ignore */
    }
    const handLabel = stableHandLabel;
    if (landmarks && landmarks.length >= 18) {
      missedFrames = 0;
      updateAnchorFromHand(landmarks, dtMs, handLabel);
      anchor.visible = true;
      /** Occluder só é útil quando há mão detectada. Evita deixar cilindro
       *  invisível a escrever depth no meio do ecrã quando a mão desaparece. */
      armOccluder.visible = true;
    } else {
      missedFrames += 1;
      if (missedFrames > MISSED_HIDE_THRESHOLD) {
        anchor.visible = false;
        armOccluder.visible = false;
        smoothInitialized = false;
        smoothOccluderInitialized = false;
      }
    }

    renderer.render(scene, camera);
  }

  loading.style.display = "none";
  rafId = requestAnimationFrame(tick);

  // Live variant override hook: compatível com o face path.
  const prevSwitch = window.__omafitArSwitchGlb || null;
  window.__omafitArSwitchGlb = async (nextUrl, cal) => {
    try {
      if (cal && typeof cal === "object") {
        if (Number.isFinite(Number(cal.rx))) fix.x = Number(cal.rx);
        if (Number.isFinite(Number(cal.ry))) fix.y = Number(cal.ry);
        if (Number.isFinite(Number(cal.rz))) fix.z = Number(cal.rz);
        applyCalibRot();
        if (Number.isFinite(Number(cal.wearX))) wearPosition.position.x = Number(cal.wearX);
        if (Number.isFinite(Number(cal.wearY))) wearPosition.position.y = Number(cal.wearY);
        if (Number.isFinite(Number(cal.wearZ))) wearPosition.position.z = Number(cal.wearZ);
        if (Number.isFinite(Number(cal.scale)) && Number(cal.scale) > 0) {
          glbRoot.scale.setScalar(baseScale * Number(cal.scale));
        }
      }
      if (nextUrl && typeof nextUrl === "string") {
        await new Promise((resolve) => {
          glbLoader.load(
            buildGlbLoaderUrl(nextUrl, versionHint),
            (gltf) => {
              const next = gltf.scene || gltf.scenes?.[0];
              if (!next) return resolve();
              bakeGLBTransforms(THREE, next, () => {});
              while (glbRoot.children.length) glbRoot.remove(glbRoot.children[0]);
              glbRoot.add(next);
              const fitRes = fitWristGlb(next, glbRoot, accessoryType, cal?.scale);
              baseScale = fitRes.baseScale;
              localRingR = fitRes.localRingR;
              localInnerR = fitRes.localInnerR || fitRes.localRingR * 0.9;
              didBendWatch = Boolean(fitRes.didBend);
              resolve();
            },
            undefined,
            () => resolve(),
          );
        });
      }
    } catch (e) {
      console.warn("[omafit-ar] hand switchGlb falhou:", e?.message || e);
    }
  };

  return function cleanupHand() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    try {
      ro.disconnect();
    } catch {
      /* ignore */
    }
    try {
      handLandmarker.close?.();
    } catch {
      /* ignore */
    }
    try {
      renderer.dispose();
    } catch {
      /* ignore */
    }
    try {
      if (canvas?.parentNode) canvas.parentNode.removeChild(canvas);
    } catch {
      /* ignore */
    }
    try {
      if (video?.parentNode) video.parentNode.removeChild(video);
    } catch {
      /* ignore */
    }
    try {
      stream?.getTracks()?.forEach((tr) => tr.stop());
    } catch {
      /* ignore */
    }
    if (window.__omafitArSwitchGlb && prevSwitch == null) {
      window.__omafitArSwitchGlb = null;
    }
    void arFit;
    void deg;
  };
}

let __omafitArMainStarted = false;
/** Assinatura glbUrl + versão Liquid; permite reiniciar após `shopify:section:load` ou novo GLB. */
let __omafitArLastRootSig = "";

async function main() {
  const root = document.getElementById("omafit-ar-root");
  if (!root) return;

  const glbUrl = (
    root.dataset.glbUrl ||
    root.getAttribute("data-glb-url") ||
    ""
  ).trim();
  const glbVer = String(
    root.dataset.arGlbVersion || root.getAttribute("data-ar-glb-version") || "",
  ).trim();
  const rootSig = `${glbUrl}\n${glbVer}`;

  if (__omafitArMainStarted && __omafitArLastRootSig === rootSig) return;

  if (__omafitArMainStarted && __omafitArLastRootSig !== rootSig) {
    root.querySelector(".omafit-ar-widget-wrap")?.remove();
    document.querySelector(".omafit-ar-shell")?.remove();
    document.getElementById("omafit-ar-styles")?.remove();
  }

  if (!glbUrl) {
    __omafitArMainStarted = false;
    __omafitArLastRootSig = "";
    disconnectArRootObserver();
    return;
  }

  __omafitArMainStarted = true;
  __omafitArLastRootSig = rootSig;

  const adminBrand = await waitForOmafitWidgetAdminBranding();
  /** `#omafit-ar-root` (Liquid / iframe) e `#omafit-widget-root` (`data-omafit-admin-primary`) antes do fallback. */
  const widgetRootEl =
    typeof document !== "undefined" ? document.getElementById("omafit-widget-root") : null;
  const embedPrimary = String(
    widgetRootEl?.getAttribute("data-omafit-admin-primary") || "",
  ).trim();
  const rootPrimary = String(root.dataset.primaryColor || "").trim().replace(/[<>]/g, "");
  const primaryColor =
    (rootPrimary || embedPrimary || adminBrand?.primary || "#810707")
      .trim()
      .replace(/[<>]/g, "") || "#810707";
  const productTitle = root.dataset.productTitle || "Produto";
  const productImage = root.dataset.productImage || "";
  const rootLogo = (root.dataset.storeLogo || root.getAttribute("data-store-logo") || "").trim();
  let logoUrl = (rootLogo || adminBrand?.storeLogo || "").trim();
  if (logoUrl.startsWith("//")) logoUrl = `https:${logoUrl}`;
  const shopName = (root.dataset.shopName || root.getAttribute("data-shop-name") || "").trim();
  const lang = pickLocale(root.dataset.locale);

  /**
   * Tipo de acessório do produto actual. Prioridade: (1) valor calculado pelo
   * Liquid em `data-ar-accessory-type` (tem acesso a `product.category.ancestors`),
   * (2) re-deteção no cliente a partir de `data-ar-product-tags/type/category-path`
   * e título, (3) fallback `glasses`. Determina o bundle de textos do modal e o
   * link trigger. O dispatcher de stack (face/hand) usa a mesma lógica em
   * `runArSession`.
   */
  const AR_VALID_TYPES = ["glasses", "necklace", "watch", "bracelet"];
  function cfgAttrMain(camelKey, fallback = "") {
    const ek = (typeof document !== "undefined"
      ? document.getElementById("omafit-widget-root")
      : null)?.dataset?.[camelKey];
    if (ek !== undefined && String(ek).trim() !== "") return String(ek).trim();
    const rk = root?.dataset?.[camelKey];
    if (rk !== undefined && String(rk).trim() !== "") return String(rk).trim();
    return String(fallback ?? "").trim();
  }
  const liquidArType = String(cfgAttrMain("arAccessoryType", ""))
    .trim()
    .toLowerCase();
  const clientArType = omafitResolveAccessoryType(cfgAttrMain);
  const arCategoryPath = cfgAttrMain("arCategoryPath", "");
  const arProductType = cfgAttrMain("arProductType", "");
  const arProductTags = cfgAttrMain("arProductTags", "");
  const productTitleAttr = cfgAttrMain("productTitle", "");

  /**
   * Resolução do tipo de acessório — hierarquia robusta:
   *   A) Se o cliente detecta um tipo específico (não-default) a partir de
   *      categoria/tags/title REAIS do DOM, esse tem prioridade — o metafield
   *      pode estar desactualizado (e.g. foi gravado antes da deteção cobrir
   *      "Smart Watches" ou "Apple Watch").
   *   B) Caso contrário, usa o valor do metafield via Liquid.
   *   C) Por fim, fallback default (glasses).
   *
   * "Cliente detectou tipo específico" = clientArType != "glasses" OU
   * clientArType === "glasses" mas há evidência textual explícita de óculos.
   */
  const clientHasStrongSignal = (() => {
    if (!AR_VALID_TYPES.includes(clientArType)) return false;
    if (clientArType !== "glasses") return true;
    const hay = `${arCategoryPath} ${arProductType} ${productTitleAttr} ${arProductTags}`.toLowerCase();
    return /\b(oculo|óculos|glasses|sunglass|eyewear|eyeglass|spectacle|optical|gafa|montura|anteojo|armaç)/i.test(
      hay,
    );
  })();

  let accessoryType;
  let accessoryTypeSource;
  if (clientHasStrongSignal && clientArType !== liquidArType) {
    accessoryType = clientArType;
    accessoryTypeSource = `client-override (liquid=${liquidArType || "∅"} ≠ client=${clientArType})`;
  } else if (AR_VALID_TYPES.includes(liquidArType)) {
    accessoryType = liquidArType;
    accessoryTypeSource = "liquid-metafield";
  } else if (AR_VALID_TYPES.includes(clientArType)) {
    accessoryType = clientArType;
    accessoryTypeSource = "client-fallback";
  } else {
    accessoryType = "glasses";
    accessoryTypeSource = "default";
  }

  /** Log prominente — aparece sempre (não só com ?omafit_ar_debug=1),
   *  pois é essencial para diagnosticar mismatches reportados pelo lojista. */
  console.log("[omafit-ar] accessory type resolved", {
    accessoryType,
    source: accessoryTypeSource,
    liquidArType: liquidArType || "(empty)",
    clientArType,
    clientHasStrongSignal,
    arCategoryPath: arCategoryPath || "(empty — product.category not set in Shopify)",
    arProductType: arProductType || "(empty)",
    arProductTags: arProductTags ? arProductTags.slice(0, 180) : "(empty)",
    productTitle: productTitleAttr.slice(0, 80),
    lang,
  });

  // Disponibiliza no window para debug rápido via devtools mobile/desktop.
  try {
    window.__OMAFIT_AR_RESOLVED__ = {
      accessoryType,
      source: accessoryTypeSource,
      liquidArType,
      clientArType,
      arCategoryPath,
      arProductType,
      arProductTags,
      productTitle: productTitleAttr,
    };
  } catch { /* no-op */ }

  const t = resolveCopyForType(lang, accessoryType);
  const rootLink = String(root.dataset.linkText || "").trim();
  const linkText =
    (rootLink ||
      adminBrand?.linkText ||
      t.linkTextFallback ||
      "Experimentar (AR)").trim() ||
    t.linkTextFallback ||
    "Experimentar (AR)";
  const autoOpen =
    root.dataset.autoOpen === "1" || root.getAttribute("data-auto-open") === "1";

  // #region agent log
  let glbHost = "";
  try {
    glbHost = new URL(glbUrl, typeof location !== "undefined" ? location.href : undefined).hostname;
  } catch {
    glbHost = "invalid";
  }
  __omafitArDbgLog({
    location: "omafit-ar-widget.js:main",
    message: "main entry dataset snapshot",
    hypothesisId: "H1",
    data: {
      glbHost,
      fontAttrLen: String(root.dataset.fontFamily || "").trim().length,
      fontAttrRawPrefix: String(root.getAttribute("data-font-family") || "").slice(0, 80),
      logoDataLen: String(logoUrl || "").length,
      hasLogo: Boolean(String(logoUrl || "").trim()),
    },
  });
  // #endregion

  injectGlobalStyles(root, primaryColor);
  getOmafitArModuleBundle().catch(() => {});

  let modal = null;

  function closeModal() {
    if (modal?.parentNode) modal.parentNode.removeChild(modal);
    modal = null;
    document.body.style.overflow = "";
  }

  function openModal() {
    if (modal) return;
    document.body.style.overflow = "hidden";
    const arVariants = Array.isArray(window.__OMAFIT_AR_VARIANTS__) ? window.__OMAFIT_AR_VARIANTS__ : [];
    const arProductId = root.dataset.productId || root.getAttribute("data-product-id") || "";
    modal = buildInfoModal({
      primaryColor,
      logoUrl,
      shopName,
      productTitle,
      productImage,
      t,
      onClose: closeModal,
      onStartAr: (shell, mainRow, colContent, header) => {
        runArSession({
          shell,
          mainRow,
          colContent,
          header,
          glbUrl,
          primaryColor,
          t,
          onClose: closeModal,
          variants: arVariants,
          productId: arProductId,
        });
      },
    });
    document.body.appendChild(modal);
    // #region agent log
    requestAnimationFrame(() => {
      const probe = modal.querySelector("h3");
      let ff = "";
      try {
        ff = probe ? getComputedStyle(probe).fontFamily : "";
      } catch {
        ff = "err";
      }
      __omafitArDbgLog({
        location: "omafit-ar-widget.js:openModal",
        message: "h3 computed font after modal mount",
        hypothesisId: "H2",
        data: { fontFamilySample: String(ff).slice(0, 200) },
      });
    });
    // #endregion
  }

  if (autoOpen) {
    openModal();
  } else {
    const wrap = el("div", {
      className: "omafit-ar-widget-wrap",
      style: { textAlign: "center", marginTop: "16px", marginBottom: "24px" },
    });
    const link = createTriggerLink(linkText, primaryColor);
    wrap.appendChild(link);
    root.appendChild(wrap);
    link.addEventListener("click", (e) => {
      e.preventDefault();
      openModal();
    });
  }

  ensureArRootDomObserver();
}

function hasArGlbUrlQueryParam() {
  try {
    const q = new URLSearchParams(
      typeof window !== "undefined" ? window.location.search : "",
    );
    const v = q.get("arGlbUrl") || q.get("ar_glb_url");
    return Boolean(v && String(v).trim());
  } catch {
    return false;
  }
}

let __omafitArSectionTimer;

let __omafitArRootObserver = null;
let __omafitArDomMutationTimer = 0;

function disconnectArRootObserver() {
  if (__omafitArRootObserver) {
    __omafitArRootObserver.disconnect();
    __omafitArRootObserver = null;
  }
}

/** Quando o Liquid/JS actualiza `data-glb-url` ou `data-ar-glb-version` sem reload completo. */
function ensureArRootDomObserver() {
  if (typeof MutationObserver === "undefined" || typeof document === "undefined") return;
  const root = document.getElementById("omafit-ar-root");
  if (!root) return;
  disconnectArRootObserver();
  __omafitArRootObserver = new MutationObserver(() => {
    window.clearTimeout(__omafitArDomMutationTimer);
    __omafitArDomMutationTimer = window.setTimeout(() => {
      const r = document.getElementById("omafit-ar-root");
      if (!r) return;
      const g = (r.dataset.glbUrl || r.getAttribute("data-glb-url") || "").trim();
      const v = String(r.dataset.arGlbVersion || r.getAttribute("data-ar-glb-version") || "").trim();
      const sig = `${g}\n${v}`;
      if (!g) return;
      const hasUi =
        Boolean(r.querySelector(".omafit-ar-widget-wrap")) ||
        Boolean(document.querySelector(".omafit-ar-shell"));
      if (sig === __omafitArLastRootSig && hasUi) return;
      __omafitArMainStarted = false;
      r.querySelector(".omafit-ar-widget-wrap")?.remove();
      document.querySelector(".omafit-ar-shell")?.remove();
      startOmafitAr().catch(() => {});
    }, 180);
  });
  __omafitArRootObserver.observe(root, {
    attributes: true,
    attributeFilter: ["data-glb-url", "data-ar-glb-version"],
  });
}

function startOmafitAr() {
  return main().catch((e) => {
    console.error("[omafit-ar]", e);
    __omafitArMainStarted = false;
    __omafitArLastRootSig = "";
  });
}

if (typeof document !== "undefined") {
  document.addEventListener("shopify:section:load", () => {
    window.clearTimeout(__omafitArSectionTimer);
    __omafitArSectionTimer = window.setTimeout(() => {
      const r = document.getElementById("omafit-ar-root");
      const g = r && (r.dataset.glbUrl || r.getAttribute("data-glb-url") || "").trim();
      if (!r || !g) return;
      __omafitArMainStarted = false;
      r.querySelector(".omafit-ar-widget-wrap")?.remove();
      document.querySelector(".omafit-ar-shell")?.remove();
      startOmafitAr().catch(() => {});
    }, 160);
  });
}

if (typeof window !== "undefined") {
  window.__omafitArStart = startOmafitAr;
}

/**
 * Arranque fiável: o módulo pode executar antes do bloco body injetar #omafit-ar-root;
 * `injectGlobalStyles` antigo com `return` impedia fontes novas após refresh parcial.
 */
function bootOmafitArWidget() {
  if (hasArGlbUrlQueryParam()) return;
  if (typeof window !== "undefined") {
    if (window.__OMAFIT_AR_WIDGET_BOOT__) return;
    window.__OMAFIT_AR_WIDGET_BOOT__ = true;
    try {
      console.log(
        `%c[omafit-ar] build: ${OMAFIT_AR_WIDGET_BUILD}`,
        "color:#fff;background:#111;padding:2px 6px;border-radius:4px;font-weight:bold;",
      );
    } catch {
      /* ignore */
    }
  }
  // #region agent log
  const scr =
    typeof document !== "undefined"
      ? document.querySelector('script[src*="omafit-ar-widget"]')
      : null;
  __omafitArDbgLog({
    location: "omafit-ar-widget.js:bootOmafitArWidget",
    message: "boot start",
    hypothesisId: "H4",
    data: {
      readyState: typeof document !== "undefined" ? document.readyState : "n/a",
      scriptSrcSuffix: scr && scr.src ? String(scr.src).slice(-140) : "",
    },
  });
  // #endregion
  let rafBoot = 0;
  const maxRaf = 720;
  function tick() {
    const root = document.getElementById("omafit-ar-root");
    const glb = root
      ? (root.dataset.glbUrl || root.getAttribute("data-glb-url") || "").trim()
      : "";
    if (root && glb) {
      // #region agent log
      let h = "";
      try {
        h = new URL(glb, typeof location !== "undefined" ? location.href : undefined).hostname;
      } catch {
        h = "bad";
      }
      __omafitArDbgLog({
        location: "omafit-ar-widget.js:boot.tick",
        message: "root+glb ready calling start",
        hypothesisId: "H4",
        data: { rafBoot, glbHost: h },
      });
      // #endregion
      startOmafitAr().catch((e) => {
        console.error("[omafit-ar]", e);
      });
      return;
    }
    if (++rafBoot > maxRaf) {
      // #region agent log
      __omafitArDbgLog({
        location: "omafit-ar-widget.js:boot.tick",
        message: "boot timeout without root+glb",
        hypothesisId: "H4",
        data: {
          rafBoot,
          hasRootEl: Boolean(document.getElementById("omafit-ar-root")),
        },
      });
      // #endregion
      return;
    }
    requestAnimationFrame(tick);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => requestAnimationFrame(tick));
  } else {
    requestAnimationFrame(tick);
  }
}

bootOmafitArWidget();
