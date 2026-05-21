import {
  applyGlassesAutoBind,
  computeGlassesCanonicalOffsetQuat,
  omafitApplyGlassesTripoOffsetContainer,
} from "./omafit-glasses-orient.js";
import {
  omafitComputeGlassesLensAnchorPoint,
  omafitRecenterObject3OnGlassesLensFront,
} from "./omafit-glb-bbox-center.js";
import {
  createOmafitBraceletWristPlacementState,
  omafitBraceletWristAlignStep,
  omafitBraceletWristMetricsStep,
  omafitBraceletWristScaleWearStep,
  resetOmafitBraceletWristPlacementState,
} from "./omafit-bracelet-wrist-placement.js";
import {
  createMindarGlassesPivotSmoother,
  mindarGlassesPivotSmootherStep,
  resetMindarGlassesPivotSmoother,
} from "./omafit-mindar-glasses-pivot-rig.js";
import {
  OMAFIT_GLASSES_DEPTH_FORWARD_DEFAULT_M,
  OMAFIT_GLASSES_SCALE_IPD_MUL_SIMPLE_FACE,
  composeGlassesMerchantWearOffsetM,
  computeGlassesAutoFitMeshScale,
  computeGlassesPreviewBaseScale,
} from "./omafit-glasses-calibration.js";
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
 * Desempenho (30–60 FPS): GLB com Draco (`import` lazy do decoder WASM),
 * `data-ar-renderer-max-dpr` (cap opcional; sem valor usa tecto por perfil de dispositivo),
 * `data-ar-performance-profile` (auto | quality | balanced | performance),
 * anisotropia limitada (`arTextureMaxAnisotropy` + perfil), FOV/câmara ajustados ao
 * aspecto do contentor e ao tipo de ecrã, aviso se triângulos >50k, opcional
 * `data-ar-defer-module-preload="1"` para adiar o bundle Three/MindAR até ao 1.º AR.
 * Micro-UX (`data-ar-micro-ux`, default `1`): entrada fade+scale, anel de tracking,
 * snap ao detectar rosto/mão, transição ao trocar variante (mão) / calibração (face).
 * Padronização GLB (`data-ar-glasses-glb-standardize="1"`): pós-bake, centro + largura→1
 * + `Group` + avanço **+Z** fixo (defeito **0,05** m) + **Ry** no container; cada frame
 * `q_container = q_Ry * q_makeBasis(263/33)` (não toca no `anchor` MindAR); **Escala IPD:** `wideDimPreScale = 1`;
 * attrs `…-forward-z-m`, `…-ry-deg`. Incompatível: manual / estrutural / canónico / geometria (compose).
 * GLB canónico Blender (`data-ar-glasses-canonical-blender-export="1"`): origem na ponte
 * (nariz), frente −Z, rotação zero no root; desliga centro bbox, Tripo/bind automáticos
 * e re-centro pós-bind — ver comentário em `normalizeGlassesModel` e guia em `omafit-glasses-orient.js`.
 * Alinhamento lateral ao nariz: `data-ar-glasses-nose-align-offset-x-m` (metros no **mesh**
 * dentro de `omafit-ar-glasses-model-wrap`, **sem** rotação); default **−0.03**; típico **−0.06…−0.02**.
 * Centro geométrico opcional no grupo: `data-ar-glasses-model-center-offset-m` (`x y z` m no mesh).
 * **Centro facial (auto):** pose do mesh `glasses` (`position` + `quaternion`) derivada só da matriz da
 * malha facial MindAR (`faceMeshes`, mesmo `faceMatrix` do PnP), convertida para o espaço local do pai do GLB;
 * escala uniforme **IPD 3D em mundo** × **2** (landmarks 33/263 → `applyMatrix4(face.matrixWorld)` → `distanceTo`).
 * `wearPosition` mantém apenas `wearPosM` base.
 * **Debug visual:** `data-ar-glasses-eye-mid-debug-visual="1"` — esfera verde no
 * mid olhos vs ciano no **pivô** do mesh (origem pós-centro lentes, local âncora).
 * **Âncora MindAR (óculos):** sempre **168** (ponte nasal / eixo médio na malha 468). O atributo
 * `data-ar-mindar-anchor` **não** substitui 168 para óculos — evita origens laterais (ex. 33, 263).
 * **Rotação do mesh `glasses`:** só no load (`normalizeGlassesModel` / canónico / identidade);
 * sem `rotation.y +=` por frame. `data-ar-glasses-anatomy-yaw-deg` funde-se em **Y** de
 * `data-ar-glasses-pivot-rot-deg` no init — o pivot usa um **Euler fixo** por frame (smoother ou `setFromEuler`).
 *
 * Iluminação adaptativa (face): amostragem do vídeo → ambiente + hemisfério + luz chave
 * + exposição ACES; sombras de contacto ajustam opacidade; PBR (`toneMapped`, IBL).
 * Opt-out: `data-ar-face-ambient-adaptive="0"`. Mão: cor do hemisfério segue média do feed.
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
 * 2) Pipeline estável (óculos): load GLB → normalizar (centro + bind) → `glassesPivot`
 *    → modelo (`omafit-ar-glasses-model`). **Escala anatómica** (largura no rosto) no
 *    **mesh**; **escala da loja** (`cfg.scale`) + posição/rotação no `glassesPivot`.
 *    Em runtime MindAR:
 *      anchor.group → wearPosition → … → calibRot → [tripOffsetGroup] →
 *      glassesPivot → [micro-ux wrap] → **glassesModelWrap** → [**glassesTrackingWrap**] →
 *      [**glassesStaticBindWrap**] → glasses (GLB).
 *      Com **tracking wrap** (automático, sem manual MindAR / sem `glb-standardize`): pose facial
 *      no wrap; bind eixo GLB no grupo estático; o mesh mantém offsets (`position`); em cada nó,
 *      preferir escrita **S → R → T** (`scale`, `quaternion`, `position`) antes de `updateMatrix`
 *      para alinhar à composição típica e evitar estados intermédios estranhos.
 *      Modo `data-ar-glasses-geometry-anchor="1"`: `glassesPivot` filho directo de
 *      `anchor.group` (sem `wear`/`calibRot` intermédios nesse ramo).
 *    O pivot é nivelado cada frame (só yaw Y em YXZ; sem roll).
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
 *    Sem heurísticas antigas (`glbWideAlign`, sign-fix, `ipdSnap`, `mirrorX`,
 *    `poseInvert`). Orientação: `calibRot` + correcção opcional MindAR/glTF
 *    (`omafitApplyGlassesMindarBindFix` quando cal=0,0,0 — ver
 *    `data-ar-glasses-mindar-bind-fix`).
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
 * 4) Escala — CRÍTICO (óculos):
 *    Distância **euclidiana 3D** entre cantos externos dos olhos (LM 33 / 263) em
 *    `metricLandmarks`, depois `Vector3.applyMatrix4(face.matrixWorld)` — mesmo espaço
 *    que a malha no mundo —; `ipd = leftEye.distanceTo(rightEye)`.
 *    Pipeline **mínimo** (`glassesTrackingWrap` + `glassesSimpleFaceOnly`): pose só no wrapper
 *    (`position` + quaternion da malha facial); mesh **sem** base rotation (`model.rotation.set(0,0,0)`).
 *    Escala uniforme **ipd × 1,0** no modo simples (`OMAFIT_GLASSES_SCALE_IPD_MUL_SIMPLE_FACE`);
 *    legado **ipd × 1,5** (`OMAFIT_GLASSES_SCALE_IPD_MUL`). Ramo standardize sem wrap:
 *    **ipd × 2** (`OMAFIT_GLASSES_SCALE_IPD_METRIC_MUL`), com bump Z / q_base opcionais.
 *    Modo geometria: o mesmo `s` reparte-se entre mesh e escala do pivot.
 *
 * 5) GLB tem qualquer orientação — o lojista calibra na ferramenta visual do admin.
 *
 * Oclusão WebAR (Three.js): **óculos** — por defeito malha facial 468 só depth + extensões
 * temporais (`data-ar-glasses-face-depth-occluder`, default `1`); `renderOrder`/`polygonOffset`
 * por mesh (hastes vs lentes) para z-test estável atrás do rosto. `arFaceOccluderNoseAhead`
 * empurra a máscara µm para a câmara quando oclusão activa (default ~0,0012 m). Opt-out:
 * `data-ar-glasses-face-depth-occluder="0"`. Limitações: sem stencil cabelo fino; ver
 * https://threejs.org/docs/#api/en/materials/Material.depthWrite e MindAR `addFaceMesh`.
 *
 * Rig estrutural opcional (`data-ar-glasses-structural-mindar-rig="1"`): desliga Tripo/bind
 * no mesh; uma única rotação base **`Ry(π)`** no load (`normalizeGlassesModel`); escala anatómica
 * no `glassesPivot` (clamp 80–150 por defeito); pivot travado a horizonte (só yaw Y).
 *
 * Rig **100% manual** (`data-ar-glasses-manual-mindar-rig="1"`): mesh com escala inicial 1;
 * escala no pivot = **IPD × 1,5** (mesma regra que o automático; IPD = |x263−x33| suavizado).
 * Tripo, bind automático, strip roll desligados. `calibRot` identidade; `wearPosition` (0,0,0);
 * pivot filho directo de `anchor.group`.
 * **Mesh** `glasses`: identidade após centrar (orientação **só** no `glassesPivot`). **Pivot** manual:
 * **Posição** = `((lm[263]+lm[33])/2) − lm[168]` + trim `data-ar-glasses-manual-face-basis-offset-m` + `arGlassesDepthForwardM` no Z
 * (coords. métricas da âncora; **sem** `quat*(ox,oy,oz)`). **Rotação** do pivot: `makeBasis(eyeDir,trueUp,forward)`.
 * Bloqueio NDC `wear`: vector mundo → local da âncora com `transformDirection(inverse(matrixWorld))`, não `quat*offset`.
 * **Centro geométrico**: após bake, centróide da **face frontal** (vértices com menor Z local,
 * não centro da bbox) em `glasses.position.sub(frontCenter)`; offsets finos só em `glasses.position`.
 * Trim: `data-ar-glasses-manual-face-basis-offset-m` (default `0 -0.02 -0.05`) em xyz landmark; escala IPD no pivot. **Âncora** MindAR **168**.
 * Suavização pivot: `data-ar-glasses-manual-pivot-smooth` (lerp pos + slerp quat, default 0,72; intervalo típico 0,6–0,85).
 * **Offset final** (m, eixos do pai do pivot): `data-ar-glasses-offset-final-m` — última camada.
 * Incompatível com estrutural e geometria.
 */
const ESM_THREE_VER = "0.150.1";
const ESM_SH = "https://esm.sh";
/** Mesmo ficheiro que o GLTFLoader do esm.sh importa — evita dois módulos `three`. */
const ESM_THREE_MJS = `${ESM_SH}/three@${ESM_THREE_VER}/es2022/three.mjs`;
const ESM_GLTF_MIND = `${ESM_SH}/three@${ESM_THREE_VER}/examples/jsm/loaders/GLTFLoader.js`;
/** Carregado só ao abrir sessão AR / carregar GLB — não entra no bundle inicial MindAR+Three. */
const ESM_DRACO_LOADER_MJS = `${ESM_SH}/three@${ESM_THREE_VER}/examples/jsm/loaders/DRACOLoader.js`;
/** WASM Draco alinhado às builds `three` recentes (CDN Google, cacheável). */
const OMAFIT_DRACO_DECODER_BASE =
  "https://www.gstatic.com/draco/versioned/decoders/1.5.7/";
/** Aviso único em consola se o GLB exceder triângulos alvo (performance mobile). */
const OMAFIT_AR_GLB_TRIANGLE_WARN = 50_000;
/** Sem `bundle`: `three` deduplica com `ESM_THREE_MJS`. */
const ESM_MINDAR_FACE_THREE = `${ESM_SH}/mind-ar@1.2.5/dist/mindar-face-three.prod.js?deps=three@${ESM_THREE_VER}`;

let __omafitSharedDracoLoader = null;
let __omafitSharedDracoLoaderPromise = null;
/** URL já avisada por excesso de triângulos (evita spam na consola). */
let __omafitGlbTriWarnUrl = null;

/**
 * DracoLoader partilhado (lazy `import()` da primeira vez) — descodifica GLB Draco sem duplicar WASM.
 * @returns {Promise<any>}
 */
function omafitGetSharedDracoLoader() {
  if (__omafitSharedDracoLoader) return Promise.resolve(__omafitSharedDracoLoader);
  if (!__omafitSharedDracoLoaderPromise) {
    __omafitSharedDracoLoaderPromise = import(ESM_DRACO_LOADER_MJS)
      .then((mod) => {
        const DRACOLoader = mod.DRACOLoader || mod.default;
        const draco = new DRACOLoader();
        draco.setDecoderPath(OMAFIT_DRACO_DECODER_BASE);
        try {
          if (typeof draco.preload === "function") draco.preload();
        } catch {
          /* ignore */
        }
        __omafitSharedDracoLoader = draco;
        return draco;
      })
      .catch((e) => {
        __omafitSharedDracoLoaderPromise = null;
        throw e;
      });
  }
  return __omafitSharedDracoLoaderPromise;
}

/**
 * @param {import("three").Object3D} root
 * @returns {number}
 */
function omafitCountGltfTriangles(root) {
  let total = 0;
  if (!root || typeof root.traverse !== "function") return 0;
  root.traverse((o) => {
    const g = o.geometry;
    if (!g || !g.attributes || !g.attributes.position) return;
    const idx = g.index;
    const start = g.drawRange?.start ?? 0;
    const count =
      g.drawRange?.count != null
        ? g.drawRange.count
        : idx
          ? idx.count
          : g.attributes.position.count;
    if (count <= 0) return;
    if (idx) total += Math.floor(count / 3);
    else total += Math.floor(count / 3);
  });
  return total;
}

/**
 * Limita anisotropia das texturas do GLB (VRAM + filtragem em GPUs médias).
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root
 * @param {number} maxAniso pedido (1–16); clampado ao máximo do renderer.
 */
/**
 * @param {string} urlHint
 * @param {number} triCount
 */
function omafitMaybeWarnGltfTriangleBudget(urlHint, triCount) {
  if (!Number.isFinite(triCount) || triCount < OMAFIT_AR_GLB_TRIANGLE_WARN) return;
  const key = String(urlHint || "").slice(0, 512);
  if (__omafitGlbTriWarnUrl === key) return;
  __omafitGlbTriWarnUrl = key;
  console.warn(
    "[omafit-ar] GLB com muitos triângulos (objectivo <50k para 30–60 FPS em dispositivos médios)",
    {
      url: urlHint,
      triangles: triCount,
      hint: "Reduza polígonos no DCC e exporte com compressão Draco/meshopt.",
    },
  );
}

function omafitApplyGltfTextureAnisotropy(THREE, root, renderer, maxAniso) {
  if (!THREE || !root?.traverse || !renderer?.capabilities) return;
  const cap = Math.min(
    Math.max(1, Number(maxAniso) || 4),
    renderer.capabilities.getMaxAnisotropy?.() || 4,
  );
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (let mi = 0; mi < mats.length; mi++) {
      const m = mats[mi];
      if (!m || typeof m !== "object") continue;
      for (const key of [
        "map",
        "normalMap",
        "roughnessMap",
        "metalnessMap",
        "aoMap",
        "emissiveMap",
        "clearcoatNormalMap",
      ]) {
        const tex = m[key];
        if (tex && tex.isTexture) tex.anisotropy = cap;
      }
    }
  });
}

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
/** Pose (ombros) — mesmo runtime WASM que HandLandmarker / ImageSegmenter. */
const MEDIAPIPE_POSE_LANDMARKER_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";

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
const OMAFIT_WRIST_AR_WORLD_MAX_DIM = 0.066;
const OMAFIT_BRACELET_AR_WORLD_MEDIAN_DIM = 0.06;

/**
 * Comprimento real (m) do segmento punho→MCP-médio numa mão adulta.
 * Usado para estimar `zDist` a partir do tamanho aparente na imagem.
 * Fonte: anatomia média do adulto (9,5–10,5 cm).
 */
const OMAFIT_WRIST_TO_MCP_M = 0.10;

/**
 * Largura de referência MCP5–MCP17 (punho) em adulto ~78 mm (NHANES / antropometria).
 * Usada como “valor base” para o ratio span_medido / span_ref no ajuste da correia.
 */
const OMAFIT_BASE_KNUCKLE_SPAN_M = 0.078;
/**
 * Após `fitWristGlb` centrar o GLB, empurra o mesh em **−Y local** (sentido
 * "para dentro" do braço pós-bind) para encostar o anel ao pulso e reduzir
 * flutuação visual. Metros.
 */
const OMAFIT_HAND_GLB_LOCAL_Y_BIND_M = 0;
/** Offset vertical local proporcional ao tamanho do GLB (sweet spot ~0.4-0.5). */
const OMAFIT_BRACELET_GLB_LOCAL_Y_SIZE_MUL = 0.42;
/** Recuo local em profundidade para reduzir efeito de flutuar à frente. */
const OMAFIT_BRACELET_GLB_LOCAL_Z_SIZE_MUL = 0.5;
/** Inset adicional pela normal do pulso (wrapper quaternion), em metros. */
const OMAFIT_BRACELET_WRIST_NORMAL_INSET_M = 0.006;
/** Offset base pedido para recuar pulso para o braço. */
const OMAFIT_BRACELET_WRIST_OFFSET_BASE_M = 0.006;
/** Offset dinâmico por largura do punho (LM5–LM17). */
const OMAFIT_BRACELET_WRIST_OFFSET_WIDTH_MUL = 0.08;
const OMAFIT_BRACELET_WRIST_OFFSET_MIN_M = 0.004;
const OMAFIT_BRACELET_WRIST_OFFSET_MAX_M = 0.012;
/** Compensação de escala após reduzir recuo do pulso. */
const OMAFIT_BRACELET_SCALE_BOOST = 0.94;
/** Micro-ajuste local para evitar efeito "afundado". */
const OMAFIT_BRACELET_GLB_MICRO_POS_Y_M = 0.005;
const OMAFIT_BRACELET_GLB_MICRO_POS_Z_M = 0.003;
const OMAFIT_BRACELET_AXIS_DEBUG_ENABLED = false;
const OMAFIT_BRACELET_OCC_NORMAL_DEBUG_ENABLED = false;

/** Linha verde punho→B: `?omafit_ar_bracelet_b_axis=1` na URL do PDP. */
function omafitBraceletBAxisDebugFromQuery() {
  try {
    return (
      new URLSearchParams(typeof window !== "undefined" ? window.location.search || "" : "").get(
        "omafit_ar_bracelet_b_axis",
      ) === "1"
    );
  } catch {
    return false;
  }
}
/** Oclusão adaptativa por angulação anatómica do pulso. */
const OMAFIT_BRACELET_OCCLUSION_SMOOTH_LERP = 0.1;
const OMAFIT_BRACELET_OCCLUSION_STRENGTH = 0.38;
const OMAFIT_BRACELET_OCCLUSION_SIDE_BACK_MUL = 0.5;
/** Proteção do topo da pulseira (não deixar “sumir” em excesso). */
const OMAFIT_BRACELET_OCCLUSION_TOP_MIN_OPACITY = 0.72;
/** Evitar transparência artificial na pulseira; oclusão fica só no depth. */
const OMAFIT_BRACELET_MATERIAL_OCCLUSION_ENABLED = true;
/** Occluder usa mesma regra de lado para todos os acessórios. */
const OMAFIT_WATCH_OCCLUDER_INVERT_SIDE = false;
/** Relógio: evitar depender da label Left/Right (pode oscilar por mirror). */
const OMAFIT_WATCH_USE_HANDEDNESS_LABEL = false;
/**
 * Depth occluder cilíndrico para pulseira.
 * Ativo para rigid slot (bangle sólido): escreve depth no cilindro do braço
 * e esconde a metade posterior do anel — dá volume de "envolver o pulso".
 */
const OMAFIT_BRACELET_DEPTH_OCCLUDER_ENABLED = true;
/**
 * Amarra a escala ao *wrist width* 3D `distance(LM5, LM17)` (já unprojected):
 * factor ≈ `(span_m × k) / OMAFIT_BASE_KNUCKLE_SPAN_M` (equivalente ao teu
 * `scale = wristWidth * 1,2` quando a referência de escala do runtime é a
 * largura antropométrica base). *Clamp* evita saltos com landmarks instáveis.
 */
const OMAFIT_HAND_KNUCKLE_SPAN_SCALE_K = 1.2;
const OMAFIT_HAND_KNUCKLE_SPAN_SCALE_MIN = 0.78;
const OMAFIT_HAND_KNUCKLE_SPAN_SCALE_MAX = 1.32;
/** Suavização da escala radial da correia (ms) — evita saltos quando zDist muda. */
const OMAFIT_WATCH_STRAP_BIOMETRIC_TAU_MS = 220;
/** PBR metais Tripo: roughness base e intensidade IBL (look “luxo”). */
const OMAFIT_METAL_ROUGHNESS_DEFAULT = 0.22;
const OMAFIT_METAL_ENV_MAP_INTENSITY = 1.5;
/** Inércia da “zona de deslize” da pulseira ao longo do antebraço (ms). */
const OMAFIT_BRACELET_SLIDE_TAU_FAST_MS = 90;
const OMAFIT_BRACELET_SLIDE_TAU_LAG_MS = 230;
/**
 * Referência (m) do segmento punho (LM0) → MCP médio (LM9) em adulto (~9,4 cm).
 * Usada na escala Y (espessura ao longo do dorso) e no factor de alcance em Z.
 */
const OMAFIT_BRACELET_REF_FOREARM_REACH_M = 0.094;
/** Deslocamento em −Y local da âncora (em direcção à palma) para encostar ao pulso. */
const OMAFIT_BRACELET_SKIN_SINK_TARGET_M = 0.004;
const OMAFIT_BRACELET_METRICS_EMA_MS = 210;
const OMAFIT_BRACELET_SINK_EMA_MS = 260;
/** Expoente suave para ajuste fino ao longo do antebraço (eixo Z do GLB). */
const OMAFIT_BRACELET_Z_SCALE_EXP = 0.38;

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
/** EMA rápida (pré-filtro) na posição da âncora — reduz jitter do landmark antes do tau principal. */
const OMAFIT_HAND_POS_PRETAU_MS = 52;
const OMAFIT_HAND_AXIS_TAU_MS = 90;

/**
 * v12.0: EMA fixa na âncora da mão (pedido produto — “peso” físico).
 * Posição α=0.15, rotação SLERP t=0.10 (substitui tau exponencial neste path).
 */
const OMAFIT_HAND_EMA_POS_ALPHA = 0.17;
const OMAFIT_HAND_EMA_ROT_ALPHA = 0.115;
/** Filtro adaptativo (inspirado em One-Euro): menos jitter parado, menos lag em movimento. */
const OMAFIT_HAND_POS_ALPHA_MIN = 0.06;
const OMAFIT_HAND_POS_ALPHA_MAX = 0.28;
const OMAFIT_HAND_POS_ALPHA_SPEED_GAIN = 0.12;
const OMAFIT_HAND_ROT_ALPHA_MIN = 0.05;
const OMAFIT_HAND_ROT_ALPHA_MAX = 0.22;
const OMAFIT_HAND_ROT_ALPHA_SPEED_GAIN = 0.016;
/** Quanto da rotação axial (normal 0–5–17 vs base) entra no quaternion final. */
const OMAFIT_HAND_WRIST_ROLL_GAIN = 0.5;
/**
 * Raio efectivo do cilindro oclusor = scale × raio biométrico do pulso.
 * Valor < 1: ligeiramente mais estreito que a estimativa da pulseira — corta só
 * a metade posterior do GLB “fechado” sem comer o dorso (padrão tipo Banuba).
 */
const OMAFIT_HAND_OCCLUDER_RADIUS_SCALE = 0.93;
/** Tau (ms) para a referência de span 5–17 descer quando a mão afasta (só EMA a descida). */
const OMAFIT_HAND_KNUCKLE_SPAN_REF_TAU_MS = 420;

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
const OMAFIT_AR_WIDGET_BUILD = "2026-05-20-glasses-calibration-v39";

try {
  console.info("[omafit-ar] asset carregado:", OMAFIT_AR_WIDGET_BUILD);
} catch {
  /* ignore */
}

/**
 * Quando `true`, **não** cria malha facial 468 só-depth nem extensões temporais (óculos).
 * Serve para isolar problemas: óculos **dentro da cara** → provável Z; **invisível** → escala/rotação.
 * Temporariamente `true` até escala/posição estarem validadas; voltar a `false` depois.
 */
const OMAFIT_GLASSES_FACE_OCCLUSION_DEBUG_OFF = true;

/**
 * Quando `true`, ignora offsets/rotação/escala vindos dos data-attrs para o
 * `glassesPivot` e usa `OMAFIT_GLASSES_PIVOT_TEST_OVERRIDES` — só para debug local.
 * Em produção deve ser `false` senão o GLB pode ficar fora do sítio esperado.
 */
const OMAFIT_GLASSES_PIVOT_DIRECT_TEST = false;
const OMAFIT_GLASSES_PIVOT_TEST_OVERRIDES = {
  offsetX: -0.015,
  offsetY: -0.01,
  offsetZ: -0.04,
  rotX: 0,
  rotY: 180,
  /** 0,05 rad ≈ 2,866° */
  rotZ: (0.05 * 180) / Math.PI,
  scale: 1.1,
};

/** FOV vertical da `PerspectiveCamera` alinhado à webcam típica (laptop / telemóvel). */
const OMAFIT_FACE_CAMERA_FOV_DEFAULT = 63;

/**
 * Form factor do browser (mobile / tablet / desktop) — heurística UA + touch + viewport.
 * @returns {"mobile"|"tablet"|"desktop"}
 */
function omafitDetectArFormFactor() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return "desktop";
  const ua = String(navigator.userAgent || "");
  const maxTp = Number(navigator.maxTouchPoints) || 0;
  const isIpad =
    /iPad/i.test(ua) ||
    (maxTp > 1 && /Macintosh/i.test(ua) && typeof document !== "undefined" && "ontouchend" in document);
  const isMobileUa =
    /Mobi|Android.*Mobile|iPhone|webOS|BlackBerry|IEMobile|Opera Mini|Mobile\/\w+/i.test(ua);
  const ww = Math.max(0, Number(window.innerWidth) || 0);
  const wh = Math.max(0, Number(window.innerHeight) || 0);
  const shortSide = ww > 0 && wh > 0 ? Math.min(ww, wh) : 0;
  const longSide = ww > 0 && wh > 0 ? Math.max(ww, wh) : 0;
  if (isIpad) return "tablet";
  if (isMobileUa || (shortSide > 0 && shortSide <= 560 && longSide <= 1100)) return "mobile";
  if (maxTp > 1 && shortSide >= 600 && shortSide <= 1100 && longSide <= 1400) return "tablet";
  return "desktop";
}

/**
 * Escalão de performance heurístico (CPU/RAM/DPR/rede). Sobrescrito por `data-ar-performance-profile`.
 * @param {"mobile"|"tablet"|"desktop"} formFactor
 * @returns {"low"|"medium"|"high"}
 */
function omafitDetectArPerfTier(formFactor) {
  let score = 0;
  try {
    const hc = Number(navigator.hardwareConcurrency);
    if (hc >= 8) score += 2;
    else if (hc >= 4) score += 1;
    else score -= 1;
  } catch {
    /* ignore */
  }
  try {
    const dm = Number(navigator.deviceMemory);
    if (dm >= 8) score += 2;
    else if (dm >= 4) score += 1;
    else score -= 1;
  } catch {
    /* ignore */
  }
  try {
    const dpr = Number(window.devicePixelRatio) || 1;
    if (dpr >= 3) score -= 1;
    if (dpr <= 1.25 && formFactor !== "desktop") score += 1;
  } catch {
    /* ignore */
  }
  try {
    const c = navigator.connection;
    if (c && c.saveData) score -= 2;
    const et = c && c.effectiveType;
    if (et === "slow-2g" || et === "2g") score -= 1;
  } catch {
    /* ignore */
  }
  if (formFactor === "desktop") score += 1;
  if (formFactor === "mobile") score -= 1;

  if (score <= 0) return "low";
  if (score <= 2) return "medium";
  return "high";
}

/**
 * Perfil unificado para paths face (MindAR) e mão (MediaPipe + Three).
 * @param {{ perfMode?: string }} opts `auto` | `quality` | `high` | `balanced` | `medium` | `performance` | `low`
 * @returns {{
 *   formFactor: "mobile"|"tablet"|"desktop",
 *   perfTier: "low"|"medium"|"high",
 *   maxDprCap: number,
 *   maxTextureAnisotropy: number,
 *   webglAntialias: boolean,
 *   faceVideoIdealMax: { w: number, h: number },
 * }}
 */
function omafitResolveArDeviceRuntimeProfile(opts) {
  const formFactor = omafitDetectArFormFactor();
  const mode = String(opts?.perfMode || "auto").trim().toLowerCase();
  let perfTier;
  if (mode === "quality" || mode === "high") perfTier = "high";
  else if (mode === "balanced" || mode === "medium") perfTier = "medium";
  else if (mode === "performance" || mode === "low") perfTier = "low";
  else perfTier = omafitDetectArPerfTier(formFactor);

  let maxDprCap = 1.5;
  let maxAniso = 4;
  let webglAntialias = true;
  /** Tecto pedido ao `getUserMedia` no path face (MindAR patch). */
  let faceVideoIdealMax = { w: 1280, h: 720 };

  if (formFactor === "mobile") {
    if (perfTier === "low") {
      maxDprCap = 1;
      maxAniso = 2;
      webglAntialias = false;
      faceVideoIdealMax = { w: 960, h: 540 };
    } else if (perfTier === "medium") {
      maxDprCap = 1.25;
      maxAniso = 4;
      webglAntialias = true;
      faceVideoIdealMax = { w: 1280, h: 720 };
    } else {
      maxDprCap = 1.5;
      maxAniso = 6;
      webglAntialias = true;
      faceVideoIdealMax = { w: 1280, h: 720 };
    }
  } else if (formFactor === "tablet") {
    if (perfTier === "low") {
      maxDprCap = 1.15;
      maxAniso = 2;
      webglAntialias = true;
      faceVideoIdealMax = { w: 1280, h: 720 };
    } else if (perfTier === "medium") {
      maxDprCap = 1.35;
      maxAniso = 5;
      webglAntialias = true;
      faceVideoIdealMax = { w: 1280, h: 720 };
    } else {
      maxDprCap = 2;
      maxAniso = 8;
      webglAntialias = true;
      faceVideoIdealMax = { w: 1280, h: 720 };
    }
  } else {
    if (perfTier === "low") {
      maxDprCap = 1.25;
      maxAniso = 4;
      webglAntialias = true;
    } else if (perfTier === "medium") {
      maxDprCap = 1.75;
      maxAniso = 8;
      webglAntialias = true;
    } else {
      maxDprCap = 2;
      maxAniso = 12;
      webglAntialias = true;
    }
  }

  return {
    formFactor,
    perfTier,
    maxDprCap,
    maxTextureAnisotropy: maxAniso,
    webglAntialias,
    faceVideoIdealMax,
  };
}

/**
 * @param {typeof import("three")} THREE
 * @param {string} cfgValStr valor de `data-ar-renderer-max-dpr` ou `""` para só perfil
 * @param {ReturnType<typeof omafitResolveArDeviceRuntimeProfile>} profile
 */
function omafitEffectiveArRendererMaxDpr(THREE, cfgValStr, profile) {
  if (!THREE) return 1.5;
  const raw = String(cfgValStr ?? "").trim();
  const userRaw = raw.length ? Number(raw) : NaN;
  const user = Number.isFinite(userRaw) ? THREE.MathUtils.clamp(userRaw, 1, 3) : NaN;
  const capRaw = Number(profile?.maxDprCap);
  const cap = Number.isFinite(capRaw) && capRaw >= 1 ? capRaw : 1.5;
  if (!Number.isFinite(user)) return THREE.MathUtils.clamp(cap, 1, 3);
  return THREE.MathUtils.clamp(Math.min(user, cap), 1, 3);
}

/**
 * @param {string} cfgValStr `data-ar-texture-max-anisotropy`
 * @param {ReturnType<typeof omafitResolveArDeviceRuntimeProfile>} profile
 * @param {number} capHard tecto absoluto (p.ex. 16)
 */
function omafitEffectiveArTextureMaxAnisotropy(cfgValStr, profile, capHard = 16) {
  const raw = Number(String(cfgValStr ?? "").trim());
  const user = Number.isFinite(raw) ? raw : 4;
  const pMax = Number(profile?.maxTextureAnisotropy);
  const tierCap = Number.isFinite(pMax) && pMax >= 1 ? pMax : 8;
  return Math.min(Math.max(1, user), tierCap, Math.max(1, capHard));
}

/** Constraints de vídeo para o patch `getUserMedia` do path face. */
function omafitBuildFaceUserMediaVideoIdeal(profile) {
  const m = profile?.faceVideoIdealMax || { w: 1280, h: 720 };
  const w = Math.max(480, Math.min(1920, Math.floor(Number(m.w) || 1280)));
  const h = Math.max(360, Math.min(1080, Math.floor(Number(m.h) || 720)));
  const low = profile?.perfTier === "low";
  return {
    width: { ideal: w, max: w, min: 480 },
    height: { ideal: h, max: h, min: 360 },
    frameRate: { ideal: low ? 24 : 30, max: 30, min: 12 },
  };
}

/**
 * Ajuste fino de FOV vertical (graus) a partir do aspecto CSS do host AR — rotação / modais estreitos.
 * Escrito em `opts.responsiveLayoutFovAdjustDeg`; lido em `omafitSyncMindARFaceProjection`.
 * @param {Record<string, unknown>} opts `faceProjectionOpts`
 * @param {HTMLElement | null} host
 * @param {ReturnType<typeof omafitResolveArDeviceRuntimeProfile> | null} profile
 */
function omafitRefreshFaceProjectionLayoutFovNudge(opts, host, profile) {
  if (!opts || !host) return;
  let adj = 0;
  try {
    const r = host.getBoundingClientRect();
    const aw = Math.max(1, r.width || 1);
    const ah = Math.max(1, r.height || 1);
    const layoutAspect = aw / ah;
    if (layoutAspect < 0.42) adj += 2;
    else if (layoutAspect < 0.52) adj += 1;
    else if (layoutAspect > 1.85) adj -= 1.5;
    else if (layoutAspect > 1.25) adj -= 0.5;
    if (profile?.formFactor === "mobile" && profile?.perfTier === "low") adj -= 0.75;
  } catch {
    /* ignore */
  }
  opts.responsiveLayoutFovAdjustDeg = adj;
}

/**
 * FOV vertical (graus) no path mão — buffer de vídeo + perfil.
 * @param {typeof import("three")} THREE
 */
function omafitHandPathCameraFovDeg(THREE, bufferAspect, profile) {
  let f = 55;
  if (!THREE || !Number.isFinite(bufferAspect) || bufferAspect <= 0) return f;
  if (bufferAspect > 1.35) f -= 4;
  else if (bufferAspect < 0.72) f += 3;
  if (profile?.formFactor === "tablet") f += 1;
  if (profile?.perfTier === "low") f -= 2;
  return THREE.MathUtils.clamp(f, 48, 62);
}

/**
 * MindAR face `Controller` (hiukim/mind-ar-js) usa One Euro em cada landmark.
 * Defaults da lib: filterMinCF=0.001, filterBeta=1. Valores ligeiramente mais
 * baixos em minCutOff reduzem micro-tremor (mais “filtro Instagram”), com
 * custo mínimo de latência. Override via data-ar-mindar-filter-min-cf / beta.
 */
const OMAFIT_MINDAR_DEFAULT_FILTER_MIN_CF = 0.00052;
const OMAFIT_MINDAR_DEFAULT_FILTER_BETA = 0.91;
/**
 * Óculos: MindAR **o mais estável possível** (menos jitter na âncora 168 / malha 468).
 * `filterMinCF` mais baixo = filtro One Euro interno mais forte (latência ~2–4 frames).
 * Override: `data-ar-mindar-filter-min-cf` / `data-ar-mindar-filter-beta`.
 */
const OMAFIT_MINDAR_GLASSES_FILTER_MIN_CF = 0.00011;
const OMAFIT_MINDAR_GLASSES_FILTER_BETA = 0.94;

/** Suavização extra (pós One Euro do MindAR) — interpolação de matriz âncora/malha facial. */
const OMAFIT_FACE_MATRIX_EXTRA_SMOOTH = 0.2;
/**
 * Óculos: λ na `omafitDampMatrix4` (malha facial + âncora quando sem One Euro no 168).
 * Valor mais baixo = mais suavização (menos jitter na base do rosto).
 */
const OMAFIT_FACE_MATRIX_EXTRA_SMOOTH_GLASSES = 0.22;
/** Lerp/slerp pivot manual óculos: fração do **alvo** por frame (0.6–0.85 típico). */
const OMAFIT_GLASSES_MANUAL_PIVOT_LERP_DEFAULT = 0.72;
/** Colar: λ mais conservador que óculos (menos “colado” à malha; evita puxar o colar com o mesmo agressivo). */
const OMAFIT_FACE_MATRIX_EXTRA_SMOOTH_NECKLACE = 0.18;
/** EMA nos marcos 168/33/263/234/454 (ms) — legado; óculos usam One Euro (abaixo). */
const OMAFIT_FACE_LANDMARK_EMA_TAU_MS = 68;
/**
 * Filtro One Euro (Casiez et al.) nos marcos métricos — menos jitter que EMA pura,
 * com baixo lag em movimento rápido (beta controla o cutoff dinâmico).
 * `minCutoff`/`dCutoff` em Hz; tempos internos em segundos.
 */
const OMAFIT_FACE_ONE_EURO_MIN_CUTOFF = 0.85;
const OMAFIT_FACE_ONE_EURO_BETA = 0.009;
const OMAFIT_FACE_ONE_EURO_D_CUTOFF = 1.05;
/** One Euro só no path **óculos** (168/33/263/bochechas/orelhas/testa/queixo) — mais suave que o colar. */
/** minCutoff mais baixo = mais “colado” em repouso; beta mais alto = reacção a movimento rápido. */
const OMAFIT_FACE_ONE_EURO_GLASSES_MIN_CUTOFF = 0.36;
const OMAFIT_FACE_ONE_EURO_GLASSES_BETA = 0.035;
const OMAFIT_FACE_ONE_EURO_GLASSES_D_CUTOFF = 0.98;
/** One Euro na descomposição posição+quaternion da âncora 168 (pós MindAR). */
const OMAFIT_GLASSES_ANCHOR_ONE_EURO_MIN_CUTOFF = 0.24;
const OMAFIT_GLASSES_ANCHOR_ONE_EURO_BETA = 0.052;
const OMAFIT_GLASSES_ANCHOR_ONE_EURO_D_CUTOFF = 1.02;
/** Largura da armação = `factor` × distância métrica 234–454 (bochechas). Override: `data-ar-glasses-anatomic-width-factor`. */
const OMAFIT_GLASSES_ANATOMIC_WIDTH_FACTOR = 1.05;
/** Modo manual MindAR: largura alvo dos óculos = interpupilar × factor. Override: `data-ar-glasses-manual-target-width-factor`. */
const OMAFIT_GLASSES_MANUAL_FACE_WIDTH_TO_FRAME_FACTOR_DEFAULT = 1.1;
/**
 * Modo manual MindAR: `metricLandmarks` interpupilar (bruto) → metros. Empírico; **não** usar
 * `baseUnitScale` nesta conversão. Objectivo típico ~0,06–0,08 m.
 */
const OMAFIT_GLASSES_MANUAL_MINDAR_TO_METERS = 0.0065;
/**
 * GLB em escala pequena: a largura no rosto vem do `glasses.scale` = **IPD × 1,5** (e ramos
 * estrutural / geometria com o pivot de loja quando aplicável).
 */
const OMAFIT_GLASSES_PIVOT_FACE_SCALE_BASE = 120;
const OMAFIT_GLASSES_PIVOT_FACE_SCALE_MIN = 80;
const OMAFIT_GLASSES_PIVOT_FACE_SCALE_MAX = 150;

/** @param {number} s */
function omafitClampGlassesPivotFaceScale(s) {
  if (!Number.isFinite(s) || s <= 0) return OMAFIT_GLASSES_PIVOT_FACE_SCALE_BASE;
  return Math.min(
    OMAFIT_GLASSES_PIVOT_FACE_SCALE_MAX,
    Math.max(OMAFIT_GLASSES_PIVOT_FACE_SCALE_MIN, s),
  );
}

/** EMA só na largura bochecha (estabilidade da escala anatómica). */
const OMAFIT_FACE_CHEEK_WIDTH_SMOOTH = 0.18;
/** Lerp do `faceScale` MindAR (mesmo espaço que `metricLandmarks`) — reduz jitter na escala. */
const OMAFIT_FACE_FS_SCALE_SMOOTH = 0.2;
/** EMA na distância interpupilar (landmarks 263–33) para escala anatómica estável. */
const OMAFIT_FACE_IPD_SMOOTH = 0.2;
/**
 * Em `metricLandmarks`, largura bochecha–bochecha mediana ≈ `OMAFIT_GLASSES_IPD_CHEEK_EQUIV` × IPD.
 * Usado para que `ipd×equiv / faceScale` substitua `cw/faceScale` sem saltar de tamanho.
 */
const OMAFIT_GLASSES_IPD_CHEEK_EQUIV = 2.1;
/** Óculos (legado referência): factor antigo só em comentários / outros ramos não usados aqui. */
const OMAFIT_GLASSES_SCALE_IPD_MUL = 1.5;
/** IPD em **espaço mundo da face**: `distanceTo` após `applyMatrix4(face.matrixWorld)` × este factor no mesh. */
const OMAFIT_GLASSES_SCALE_IPD_METRIC_MUL = 2;
/** Clamp absoluto na escala uniforme do mesh (óculos após IPD×factor). */
const OMAFIT_GLASSES_MESH_SCALE_ABS_MIN = 0.04;
const OMAFIT_GLASSES_MESH_SCALE_ABS_MAX = 2.5;
/**
 * Avanço +Z local (m) no espaço do rosto: `Vector3(0,0,m).applyQuaternion(model.quaternion)` + `position.add`.
 * Aplicado após `glasses.position` / `glasses.quaternion` vindos da faceMatrix.
 */
const OMAFIT_GLASSES_FACE_LOCAL_FORWARD_M = 0.03;

/**
 * Teste visual: `?omafit_ar_glasses_absurd=1` força posição/escala absurdas no mesh para validar que o runtime controla o modelo.
 */
function omafitArIsGlassesAbsurdTransformTest() {
  try {
    const q = new URLSearchParams(typeof window !== "undefined" ? window.location.search || "" : "");
    return q.get("omafit_ar_glasses_absurd") === "1";
  } catch {
    return false;
  }
}

/** Modelo Image Segmenter (multiclasse: cabelo, pele, roupa, …) — mesmo runtime WASM que HandLandmarker. */
const OMAFIT_IMAGE_SEG_SELFIE_MULTICLASS_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite";
/** Marcos MediaPipe 468: bochechas para largura de rosto (escala X da armação). */
const OMAFIT_FACE_LM_LEFT_CHEEK = 454;
const OMAFIT_FACE_LM_RIGHT_CHEEK = 234;
/** Cantos dos olhos + ponte (referência de tilt). */
const OMAFIT_FACE_LM_EYE_L_OUT = 263;
const OMAFIT_FACE_LM_EYE_R_OUT = 33;
/** Ponte nasal (Face Mesh 468) — origem MindAR **central** para óculos; não usar 33/263 (olhos) como âncora. */
const OMAFIT_FACE_LM_NOSE_BRIDGE = 168;
/** Topo da testa (glabela) + queixo: eixo vertical do rosto. */
const OMAFIT_FACE_LM_FOREHEAD_TOP = 10;
/** Região pré-auricular para prolongar oclusor (hastes “atrás da orelha”). */
const OMAFIT_FACE_LM_EAR_L = 127;
const OMAFIT_FACE_LM_EAR_R = 356;
/** Colar: queixo + largura mandíbula (interpolação âncora pescoço). */
const OMAFIT_FACE_LM_CHIN = 152;
/** MediaPipe Pose (33 landmarks full body) — ombros. */
const OMAFIT_POSE_L_SHOULDER = 11;
const OMAFIT_POSE_R_SHOULDER = 12;
/** Física mola + amortecimento (colar). */
const OMAFIT_NECKLACE_SPRING_K = 42;
const OMAFIT_NECKLACE_SPRING_DAMP = 8.2;
const OMAFIT_NECKLACE_ROT_K = 28;
const OMAFIT_NECKLACE_ROT_DAMP = 6.5;
/** Mistura rotação cabeça vs inclinação ombros (0 = só face). */
const OMAFIT_NECKLACE_SHOULDER_ROT_BLEND = 0.38;
/** Lerp posição queixo → base pescoço (espaço métrico face). */
const OMAFIT_NECKLACE_CHIN_TO_THROAT = 0.42;

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
/**
 * MindAR `getLandmarkMatrix` usa o mesmo `faceMatrix` que a malha facial
 * canónica: o eixo “para fora do rosto / câmara” alinha com **+Z local** da
 * âncora (espaço Three.js após `diag(1,-1,-1)·[R|t]` aplicado ao `rvec`
 * OpenCV — ver `mind-ar@1.2.5/controller`). `+Y` âncora = cima do rosto.
 *
 * **GLB canonicalizado Omafit** (`workers/ar-eyewear-tripo/postprocess.py`
 *  + `shared/ar-eyewear-glb-canonicalize.mjs`): `+X` largura (hastes),
 *  `+Y` topo do aro, `+Z` **atrás** da cabeça (temple tips em +Z).
 *
 * ⇒ a **frente das lentes está em `-Z` GLB**. Para alinhar com âncora
 *    (`+Z` = para fora do rosto / para a câmara) precisamos de **`Ry(180)`**
 *    (inverte +X e +Z; óculos simétricos em X ⇒ sem artefacto visível).
 *
 * Binds legacy (como `Rx(-90)+Rz(180)`) compõem para uma rotação em torno
 * de `(0, 1, 1)/√2`, que deixa o aro a apontar para a câmara e as pontas
 * das hastes apontadas para o tecto — reportado como “virado pra direita
 * e de cabeça pra baixo”.
 *
 * Override: `data-ar-glasses-mindar-bind-fix="rx,ry,rz"` em graus.
 * Use `none` / `0` para desligar. Vazio / `auto` + calib ~0 → fallback `Ry` via
 * `data-ar-glasses-model-base-rotation-y-deg` (defeito **90°**).
 */
function omafitApplyGlassesMindarBindFix(THREE, glasses, bindRxDeg, bindRyDeg, bindRzDeg) {
  if (!glasses || !THREE) return;
  const rx = Number(bindRxDeg) || 0;
  const ry = Number(bindRyDeg) || 0;
  const rz = Number(bindRzDeg) || 0;
  if (Math.abs(rx) < 1e-6 && Math.abs(ry) < 1e-6 && Math.abs(rz) < 1e-6) return;
  const rad = (d) => (d * Math.PI) / 180;
  glasses.rotation.set(0, 0, 0);
  glasses.quaternion.identity();
  const ax = new THREE.Vector3(1, 0, 0);
  const ay = new THREE.Vector3(0, 1, 0);
  const az = new THREE.Vector3(0, 0, 1);
  const ryr = rad(ry);
  const rxr = rad(rx);
  const rzr = rad(rz);
  if (ryr) glasses.rotateOnWorldAxis(ay, ryr);
  if (rxr) glasses.rotateOnWorldAxis(ax, rxr);
  if (rzr) glasses.rotateOnWorldAxis(az, rzr);
  glasses.updateMatrix();
}

/**
 * Nivela o `glassesPivot` com o horizonte: extrai só o yaw em ordem **YXZ** e fixa
 * `rotation.x` e `rotation.z` a **0** (sem roll / inclinação lateral), mesmo após
 * `quaternion` composto (anatomia + calib + smoother).
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} pivot
 */
function omafitLockGlassesPivotHorizon(THREE, pivot) {
  if (!THREE || !pivot) return;
  if (!omafitLockGlassesPivotHorizon._e) {
    omafitLockGlassesPivotHorizon._e = new THREE.Euler(0, 0, 0, "YXZ");
  }
  const e = omafitLockGlassesPivotHorizon._e;
  e.setFromQuaternion(pivot.quaternion, "YXZ");
  pivot.rotation.order = "YXZ";
  pivot.rotation.set(0, e.y, 0);
}

/**
 * Após bind: decompõe o quaternion do mesh em **YXZ** e deixa só **yaw (Y)** —
 * `rotation.x` e `rotation.z` a zero (sem pitch/roll local), óculos nivelados no plano.
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} mesh
 */
function omafitStripGlassesMeshRollYxz(THREE, mesh) {
  if (!THREE || !mesh) return;
  if (!omafitStripGlassesMeshRollYxz._e) {
    omafitStripGlassesMeshRollYxz._e = new THREE.Euler(0, 0, 0, "YXZ");
  }
  const e = omafitStripGlassesMeshRollYxz._e;
  e.setFromQuaternion(mesh.quaternion, "YXZ");
  mesh.rotation.order = "YXZ";
  mesh.rotation.set(0, e.y, 0);
}

/**
 * Modo manual MindAR: **uma vez** no load — o centro da bbox já foi aplicado no root (`glasses.position.sub(center)` pós-bake).
 * **Ordem:** `scale` → `rotation.set(0,π,0)` (base) → `quaternion` (sync Three); não altera translação Z da profundidade (só via pivot).
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} mesh root do GLB (`gltf.scene`)
 */
function omafitApplyGlassesManualMindarCenterMesh(THREE, mesh) {
  if (!THREE || !mesh) return;
  mesh.scale.set(1, 1, 1);
  mesh.rotation.order = "XYZ";
  mesh.rotation.set(0, Math.PI, 0);
  mesh.updateMatrix();
  mesh.updateMatrixWorld(true);
  if (!__omafitManualModelCenterFixLogged) {
    __omafitManualModelCenterFixLogged = true;
    try {
      console.log("[omafit-ar] glasses manual mesh prep (bbox no root; identidade, sem bump Z)");
    } catch {
      /* ignore */
    }
  }
}

/**
 * Alinhamento heurístico do root `gltf.scene` **uma vez** no load (não usar em `onUpdate`).
 * Largura no eixo X quando `size.x >= size.z`; caso contrário `Ry(π/2)`. Depois tenta
 * orientar a frente para **−Z** (centróide Z positivo → `Ry(π)`) e evitar cabeça para
 * baixo (centróide Y negativo → `Rx(π)`). Opt-in: `data-ar-glasses-auto-align-model="1"`.
 *
 * Nota: num `THREE.Box3` válido `min ≤ max` por componente; `min.z > max.z` nunca ocorre.
 *
 * @param {import("three").Object3D} glasses
 * @param {typeof import("three")} THREE
 * @returns {null | { widthAxis: string, widthValue: number, heightAxis: string, heightValue: number, rotationApplied: { x: number, y: number, z: number } }}
 */
function omafitAutoAlignGlassesModel(glasses, THREE) {
  if (!glasses || !THREE) return null;
  glasses.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(glasses);
  if (typeof box.isEmpty === "function" && box.isEmpty()) {
    console.warn("[omafit-ar] omafitAutoAlignGlassesModel: bbox vazia");
    return null;
  }
  const size = new THREE.Vector3();
  box.getSize(size);
  const widthValue = Math.max(size.x, size.z);
  const heightValue = size.y;
  const widthAxis = size.x >= size.z ? "x" : "z";
  const heightAxis = "y";

  let rotX = 0;
  let rotY = 0;
  const rotZ = 0;

  /** CASO 1: `size.x >= size.z` — sem Ry extra. CASO 2: largura em Z → `Ry(π/2)`. */
  if (size.z > size.x) {
    rotY += Math.PI / 2;
  }

  glasses.rotation.order = "XYZ";
  glasses.rotation.set(rotX, rotY, rotZ);
  glasses.updateMatrix();
  glasses.updateMatrixWorld(true);

  const box2 = new THREE.Box3().setFromObject(glasses);
  const c2 = new THREE.Vector3();
  box2.getCenter(c2);
  const spanZ = box2.max.z - box2.min.z;
  if (Number.isFinite(spanZ) && spanZ > 1e-8 && c2.z > 1e-4 * spanZ) {
    rotY += Math.PI;
  }

  glasses.rotation.set(rotX, rotY, rotZ);
  glasses.updateMatrix();
  glasses.updateMatrixWorld(true);

  const box3 = new THREE.Box3().setFromObject(glasses);
  const c3 = new THREE.Vector3();
  box3.getCenter(c3);
  const size3 = new THREE.Vector3();
  box3.getSize(size3);
  const spanY = box3.max.y - box3.min.y;
  if (Number.isFinite(spanY) && spanY > 1e-8 && c3.y < -1e-4 * spanY) {
    rotX += Math.PI;
  }

  glasses.rotation.set(rotX, rotY, rotZ);
  glasses.updateMatrix();
  glasses.updateMatrixWorld(true);

  console.log("[omafit-ar] omafitAutoAlignGlassesModel", {
    widthAxisDetected: widthAxis,
    widthValue,
    heightAxisDetected: heightAxis,
    heightValueInitial: heightValue,
    heightValueAfter: size3.y,
    sizeInitial: { x: size.x, y: size.y, z: size.z },
    rotationAppliedRad: { x: rotX, y: rotY, z: rotZ },
    rotationAppliedDeg: {
      x: (rotX * 180) / Math.PI,
      y: (rotY * 180) / Math.PI,
      z: (rotZ * 180) / Math.PI,
    },
  });

  return {
    widthAxis,
    widthValue,
    heightAxis,
    heightValue,
    rotationApplied: { x: rotX, y: rotY, z: rotZ },
  };
}

/**
 * Normaliza o root do GLB de óculos **antes** de ancorar no MindAR.
 * Uma única rotação base **`rotation.set(0, π, 0)`** (sem stacks Rx/Ry/Rz configuráveis).
 * **Ordem espacial (não inverter):** `scale` → `rotation` (base) → `quaternion` (sincronizado
 * com o Euler; sem face no load) → `position` (âncora lentes: midpoint interpupilar ou centróide frontal; não bbox).
 * Em runtime, o contentor standardize combina face em `omafitGlassesStandardizeComposeContainerQuat`.
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} model Raiz `gltf.scene`
 * @param {{
 *   recenterAfterRotation?: boolean,
 *   skipBboxCenter?: boolean,
 * }} [opts]
 * @returns {import("three").Object3D} O mesmo `model` (mutado)
 */
function normalizeGlassesModel(THREE, model, opts = {}) {
  if (!THREE || !model) return model;
  model.scale.set(1, 1, 1);
  model.rotation.order = "XYZ";
  model.rotation.set(0, Math.PI, 0);
  model.position.set(0, 0, 0);
  if (typeof model.updateMatrix === "function") model.updateMatrix();
  model.updateMatrixWorld(true);

  if (!opts.skipBboxCenter) {
    let fc = omafitComputeGlassesLensAnchorPoint(THREE, model);
    if (!fc) {
      const box = new THREE.Box3().setFromObject(model);
      if (!(typeof box.isEmpty === "function" && box.isEmpty())) {
        fc = box.getCenter(new THREE.Vector3());
      }
    }
    if (fc) model.position.sub(fc);
    model.updateMatrixWorld(true);

    if (opts.recenterAfterRotation !== false) {
      let fc2 = omafitComputeGlassesLensAnchorPoint(THREE, model);
      if (!fc2) {
        const box2 = new THREE.Box3().setFromObject(model);
        if (!(typeof box2.isEmpty === "function" && box2.isEmpty())) {
          fc2 = box2.getCenter(new THREE.Vector3());
        }
      }
      if (fc2) model.position.sub(fc2);
    }
  }
  return model;
}

/**
 * Padronização opcional do GLB de óculos **após** `bakeGLBTransforms`, **antes** de
 * Tripo/bind/IPD. **Mesh interno:** `scale` → `rotation` (identidade) → `quaternion` → `position`
 * (centrar, escalar, re-centrar, +Z). **Contentor** `omafit-ar-glb-standardize`: `scale` →
 * `rotation.set(0,π,0)` → `position` (0) → `add` do filho. Em cada frame: `omafitGlassesStandardizeComposeContainerQuat`.
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} model Root do GLB (ex. `gltf.scene`)
 * @param {{
 *   widthMode?: "x" | "maxXZ",
 *   forwardZM?: number,
 * }} [opts]
 * @returns {{ root: import("three").Group, inner: import("three").Object3D }}
 */
function omafitStandardizeGlassesGlbRootForAr(THREE, model, opts = {}) {
  const widthMode = opts.widthMode === "x" ? "x" : "maxXZ";
  /** Base fixa — mesmo `Ry(π)` que `normalizeGlassesModel` (sem override por attr). */
  const ryRad = Math.PI;
  const forwardZM = Number.isFinite(opts.forwardZM) ? opts.forwardZM : 0.05;
  const GroupCtor = THREE.Group;
  if (!THREE || !model) {
    const empty = new GroupCtor();
    empty.name = "omafit-ar-glb-standardize";
    return { root: empty, inner: model };
  }

  model.scale.set(1, 1, 1);
  model.rotation.order = "XYZ";
  model.rotation.set(0, 0, 0);
  model.quaternion.identity();
  model.position.set(0, 0, 0);
  model.updateMatrixWorld(true);

  const box0 = new THREE.Box3().setFromObject(model);
  if (typeof box0.isEmpty === "function" && box0.isEmpty()) {
    const container = new GroupCtor();
    container.name = "omafit-ar-glb-standardize";
    container.scale.set(1, 1, 1);
    container.rotation.order = "XYZ";
    container.rotation.set(0, ryRad, 0);
    container.position.set(0, 0, 0);
    container.add(model);
    container.updateMatrix();
    return { root: container, inner: model };
  }

  const c0 = box0.getCenter(new THREE.Vector3());
  model.position.set(-c0.x, -c0.y, -c0.z);
  model.updateMatrixWorld(true);

  const box1 = new THREE.Box3().setFromObject(model);
  const size = box1.getSize(new THREE.Vector3());
  const w =
    widthMode === "x"
      ? Math.max(size.x, 1e-8)
      : Math.max(size.x, size.z, 1e-8);

  model.scale.setScalar(1 / w);
  model.rotation.set(0, 0, 0);
  model.quaternion.identity();
  model.updateMatrixWorld(true);

  const box2 = new THREE.Box3().setFromObject(model);
  if (!(typeof box2.isEmpty === "function" && box2.isEmpty())) {
    const c2 = box2.getCenter(new THREE.Vector3());
    model.position.sub(c2);
  }
  model.updateMatrixWorld(true);

  /** À frente da malha de oclusão (depth-only); +Z local fixo. */
  if (forwardZM > 0) {
    model.position.set(model.position.x, model.position.y, forwardZM);
    model.updateMatrixWorld(true);
  }

  const container = new GroupCtor();
  container.name = "omafit-ar-glb-standardize";
  container.scale.set(1, 1, 1);
  container.rotation.order = "XYZ";
  container.rotation.set(0, ryRad, 0);
  container.position.set(0, 0, 0);
  container.add(model);
  container.updateMatrix();
  return { root: container, inner: model };
}

/**
 * Modo `glassesGlbStandardize`: combina **uma** rotação base fixa **`Ry(π)`** com o quaternion
 * da base facial dos landmarks (`makeBasis` — mesmo que o rig manual) **sem** alterar `anchor.group`.
 * **Ordem (não inverter):** `scale` → `rotation.set(0,π,0)` (base) → `quaternion.multiply(faceQuat)`.
 * Não escrever `position` aqui.
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} container Root `omafit-ar-glb-standardize`
 * @param {any} lm `metricLandmarks`
 * @param {{ get(i: number): { x: number, y: number, z: number } | null } | null} smoother
 */
function omafitGlassesStandardizeComposeContainerQuat(THREE, container, lm, smoother) {
  if (!THREE || !container || !lm) return;
  if (!_omafitManualEyeDir) _omafitManualEyeDir = new THREE.Vector3();
  if (!_omafitManualEyeTrueUp) _omafitManualEyeTrueUp = new THREE.Vector3();
  if (!_omafitManualEyeFwd) _omafitManualEyeFwd = new THREE.Vector3();
  if (!_omafitStdComposeFace) _omafitStdComposeFace = new THREE.Quaternion();
  if (!_omafitStdComposeMat) _omafitStdComposeMat = new THREE.Matrix4();
  const faceQ = _omafitStdComposeFace;
  const mat = _omafitStdComposeMat;
  if (
    omafitGlassesManualFaceBasisFromLm(
      THREE,
      lm,
      smoother,
      _omafitManualEyeDir,
      _omafitManualEyeTrueUp,
      _omafitManualEyeFwd,
    )
  ) {
    mat.makeBasis(_omafitManualEyeDir, _omafitManualEyeTrueUp, _omafitManualEyeFwd);
    faceQ.setFromRotationMatrix(mat);
  } else {
    faceQ.identity();
  }
  container.scale.set(1, 1, 1);
  container.rotation.order = "XYZ";
  container.rotation.set(0, Math.PI, 0);
  container.quaternion.multiply(faceQ);
  container.quaternion.normalize();
  container.updateMatrix();
}

/** @see `omafit-glasses-orient.js` (detecção de eixos, rim top/bottom, quaternion de bind) */

/**
 * UI mínima (sliders) para afinar `offsetGroup` (Â° em eixos mundo Y→X→Z,
 * mesma função `omafitApplyGlassesTripoOffsetContainer`). Activa com
 * `?omafit_ar_glasses_tripo_debug=1` ou `data-ar-glasses-tripto-debug="1"`.
 * @returns {() => void} cleanup
 */
function installOmafitGlassesTripoDebugPanel(layerHost, THREE, offsetGroup, y0, x0, z0) {
  if (!layerHost || !offsetGroup) return () => {};
  const wrap = document.createElement("div");
  wrap.setAttribute("data-omafit", "tripto-debug");
  Object.assign(wrap.style, {
    position: "absolute",
    left: "max(8px, env(safe-area-inset-left, 0px))",
    bottom: "max(8px, calc(8px + env(safe-area-inset-bottom, 0px)))",
    zIndex: "48",
    maxWidth: "240px",
    padding: "10px 12px",
    background: "rgba(0,0,0,0.75)",
    color: "#eee",
    fontFamily: "system-ui,sans-serif",
    fontSize: "11px",
    lineHeight: "1.3",
    borderRadius: "8px",
    boxShadow: "0 2px 12px rgba(0,0,0,0.5)",
    pointerEvents: "auto",
  });
  const title = document.createElement("div");
  title.textContent = "Tripo offset (eixos mundo Y→X→Z, °)";
  title.style.fontWeight = "600";
  title.style.marginBottom = "6px";
  wrap.appendChild(title);
  const mk = (label, v0) => {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "6px";
    row.style.marginBottom = "4px";
    const lab = document.createElement("span");
    lab.textContent = label;
    lab.style.minWidth = "18px";
    const inp = document.createElement("input");
    inp.type = "range";
    inp.min = "-180";
    inp.max = "180";
    inp.step = "1";
    inp.value = String(v0);
    inp.style.flex = "1";
    const num = document.createElement("input");
    num.type = "number";
    num.min = "-180";
    num.max = "180";
    num.step = "1";
    num.value = String(v0);
    num.style.width = "48px";
    num.style.fontSize = "10px";
    return { row, lab, inp, num };
  };
  const mY = mk("Y", y0);
  const mX = mk("X", x0);
  const mZ = mk("Z", z0);
  for (const m of [mY, mX, mZ]) {
    m.row.append(m.lab, m.inp, m.num);
    wrap.appendChild(m.row);
  }
  const apply = () => {
    const y = parseFloat(mY.inp.value) || 0;
    const x = parseFloat(mX.inp.value) || 0;
    const z = parseFloat(mZ.inp.value) || 0;
    mY.num.value = String(y);
    mX.num.value = String(x);
    mZ.num.value = String(z);
    omafitApplyGlassesTripoOffsetContainer(THREE, offsetGroup, y, x, z);
  };
  for (const m of [mY, mX, mZ]) {
    m.inp.addEventListener("input", apply);
    m.num.addEventListener("change", () => {
      m.inp.value = m.num.value;
      apply();
    });
  }
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Copiar para consola (data-attr)";
  Object.assign(btn.style, {
    marginTop: "8px",
    width: "100%",
    padding: "6px",
    cursor: "pointer",
    fontSize: "11px",
    borderRadius: "6px",
    border: "1px solid #555",
    background: "#2a2a2a",
    color: "#fff",
  });
  btn.addEventListener("click", () => {
    const y = parseFloat(mY.inp.value) || 0;
    const x = parseFloat(mX.inp.value) || 0;
    const z = parseFloat(mZ.inp.value) || 0;
    const s = `data-ar-glasses-tripto-offset-world-deg=\"${y},${x},${z}\"`;
    console.log(
      "%c[omafit-ar] "+s,
      "color:#0cf;font-weight:bold;",
      "— adiciona no bloco Omafit embed (atributo no div #omafit-ar-widget-mindar).",
    );
    try {
      void navigator.clipboard.writeText(
        `arGlassesTripoOffsetWorldDeg: \"${y},${x},${z}\"`,
      );
    } catch {
      /* ignore */
    }
  });
  wrap.appendChild(btn);
  layerHost.appendChild(wrap);
  return () => {
    try {
      wrap.remove();
    } catch {
      /* ignore */
    }
  };
}

/**
 * Calibração do `glassesPivot`: posição local e escala (rotação manual desactivada no runtime).
 * Activa UI com `?omafit_ar_glasses_manual_calib=1` ou `data-ar-glasses-manual-calib-ui="1"`.
 * Expõe `window.__omafitGlassesPivotConfig` (alias `__omafitGlassesManualCalib`).
 * @param {HTMLElement} layerHost
 * @param {{ offsetX: number, offsetY: number, offsetZ: number, scale: number }} calib
 * @returns {() => void}
 */
function installOmafitGlassesManualCalibPanel(layerHost, calib) {
  if (!layerHost || !calib) return () => {};
  const wrap = document.createElement("div");
  wrap.setAttribute("data-omafit", "glasses-pivot-calib");
  Object.assign(wrap.style, {
    position: "absolute",
    left: "max(8px, env(safe-area-inset-left, 0px))",
    top: "max(48px, env(safe-area-inset-top, 0px))",
    zIndex: "49",
    width: "min(260px, 92vw)",
    padding: "10px 12px",
    background: "rgba(0,0,0,0.88)",
    color: "#eee",
    fontFamily: "system-ui,sans-serif",
    fontSize: "11px",
    lineHeight: "1.35",
    borderRadius: "10px",
    boxShadow: "0 4px 16px rgba(0,0,0,0.55)",
    pointerEvents: "auto",
    touchAction: "manipulation",
  });
  const title = document.createElement("div");
  title.textContent = "glassesPivot (pos · escala)";
  Object.assign(title.style, { fontWeight: "600", marginBottom: "6px" });
  wrap.appendChild(title);

  const mkRange = (label, key, min, max, step) => {
    const row = document.createElement("div");
    row.style.marginBottom = "6px";
    const lab = document.createElement("div");
    lab.textContent = label;
    lab.style.opacity = "0.85";
    lab.style.marginBottom = "2px";
    const inp = document.createElement("input");
    inp.type = "range";
    inp.min = String(min);
    inp.max = String(max);
    inp.step = String(step);
    inp.value = String(calib[key]);
    inp.style.width = "100%";
    const num = document.createElement("input");
    num.type = "number";
    num.step = String(step);
    num.value = String(calib[key]);
    num.style.width = "100%";
    num.style.marginTop = "2px";
    num.style.fontSize = "11px";
    const apply = () => {
      let v = parseFloat(inp.value);
      if (!Number.isFinite(v)) v = 0;
      v = Math.max(min, Math.min(max, v));
      calib[key] = v;
      inp.value = String(v);
      num.value = String(v);
    };
    inp.addEventListener("input", apply);
    num.addEventListener("change", () => {
      inp.value = num.value;
      apply();
    });
    row.append(lab, inp, num);
    return row;
  };

  wrap.appendChild(mkRange("offsetX (local)", "offsetX", -0.08, 0.08, 0.0005));
  wrap.appendChild(mkRange("offsetY (local)", "offsetY", -0.08, 0.08, 0.0005));
  wrap.appendChild(mkRange("offsetZ (local)", "offsetZ", -0.08, 0.08, 0.0005));
  wrap.appendChild(mkRange("scale (×)", "scale", 0.5, 1.5, 0.002));

  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Copiar data-attrs (consola + clipboard)";
  Object.assign(btn.style, {
    marginTop: "8px",
    width: "100%",
    padding: "6px",
    cursor: "pointer",
    fontSize: "11px",
    borderRadius: "6px",
    border: "1px solid #555",
    background: "#2a2a2a",
    color: "#fff",
  });
  btn.addEventListener("click", () => {
    const ox = calib.offsetX;
    const oy = calib.offsetY;
    const oz = calib.offsetZ;
    const sm = calib.scale;
    const a0 = `data-ar-glasses-local-fine-xyz="0 0 0"`;
    const a1 = `data-ar-glasses-manual-calib-offset="${ox} ${oy} ${oz}"`;
    const a2 = `data-ar-glasses-manual-calib-scale="${sm}"`;
    console.log(`%c[omafit-ar] ${a0}\n${a1}\n${a2}`, "color:#0cf;font-weight:bold;");
    try {
      void navigator.clipboard.writeText(`${a0}\n${a1}\n${a2}`);
    } catch {
      /* ignore */
    }
  });
  wrap.appendChild(btn);
  layerHost.appendChild(wrap);
  return () => {
    try {
      wrap.remove();
    } catch {
      /* ignore */
    }
  };
}

/**
 * Painel flutuante com **6 sliders** (rotX, rotY, rotZ em graus + posX, posY,
 * posZ em metros) que actualizam directamente o objecto `glassesOffset`. O
 * *loop de render* lê `glassesOffset` e aplica:
 *   `offsetGroup.rotation.set(rotX, rotY, rotZ)`
 *   `offsetGroup.position.set(posX, posY, posZ)`
 *
 * Valores iniciais = snapshot do `offsetGroup` no momento da criação do painel
 * (o auto-orient determinístico já está aplicado). Cada movimento de slider
 * loga os valores na consola; o botão "Copiar" copia para o clipboard num
 * formato pronto a colar no código.
 *
 * @param {HTMLElement} layerHost `arWrap` (irmão de `arFit`, fora de `overflow:hidden`).
 * @param {any} THREE
 * @param {{ rotX: number, rotY: number, rotZ: number, posX: number, posY: number, posZ: number }} glassesOffset
 *   mutável; rot em radianos, pos em metros.
 * @returns {() => void} cleanup
 */
function installOmafitGlassesOffsetPanel(layerHost, THREE, glassesOffset) {
  if (!layerHost || !glassesOffset) return () => {};
  const wrap = document.createElement("div");
  wrap.setAttribute("data-omafit", "glasses-offset");
  wrap.className = "omafit-ar-glasses-screen-rot";
  Object.assign(wrap.style, {
    position: "absolute",
    right: "max(8px, env(safe-area-inset-right, 0px))",
    bottom: "max(8px, calc(8px + env(safe-area-inset-bottom, 0px)))",
    zIndex: "50",
    width: "min(260px, 92vw)",
    maxHeight: "calc(100% - 16px)",
    overflowY: "auto",
    padding: "10px 12px",
    background: "rgba(0,0,0,0.88)",
    color: "#eee",
    fontFamily: "system-ui,sans-serif",
    fontSize: "11px",
    lineHeight: "1.35",
    borderRadius: "10px",
    boxShadow: "0 4px 16px rgba(0,0,0,0.55)",
    pointerEvents: "auto",
    touchAction: "manipulation",
  });

  const title = document.createElement("div");
  title.textContent = "Ajustar óculos (offsetGroup)";
  Object.assign(title.style, { fontWeight: "600", marginBottom: "4px", fontSize: "12px" });
  wrap.appendChild(title);

  const hint = document.createElement("div");
  hint.textContent = "rot em graus · pos em metros";
  Object.assign(hint.style, { opacity: "0.7", fontSize: "10px", marginBottom: "8px" });
  wrap.appendChild(hint);

  /** Log ritmado para não inundar a consola quando o dedo arrasta o slider. */
  let lastLogTs = 0;
  const logOffset = (source) => {
    const now = performance.now();
    if (now - lastLogTs < 80) return;
    lastLogTs = now;
    const toDeg = (r) => (r * 180) / Math.PI;
    const snap = {
      rotX: glassesOffset.rotX,
      rotY: glassesOffset.rotY,
      rotZ: glassesOffset.rotZ,
      posX: glassesOffset.posX,
      posY: glassesOffset.posY,
      posZ: glassesOffset.posZ,
    };
    console.log(
      `%c[omafit-ar] glassesOffset (${source})`,
      "color:#0cf;font-weight:bold;",
      {
        rot_deg: {
          x: toDeg(snap.rotX).toFixed(1),
          y: toDeg(snap.rotY).toFixed(1),
          z: toDeg(snap.rotZ).toFixed(1),
        },
        pos_m: {
          x: snap.posX.toFixed(4),
          y: snap.posY.toFixed(4),
          z: snap.posZ.toFixed(4),
        },
        raw: snap,
      },
    );
  };
  try {
    window.__omafitGlassesOffset = glassesOffset;
    window.__omafitLogGlassesOffset = () => logOffset("manual");
  } catch {
    /* ignore */
  }

  /**
   * @param {string} label
   * @param {"rotX"|"rotY"|"rotZ"|"posX"|"posY"|"posZ"} key
   * @param {number} min
   * @param {number} max
   * @param {number} step
   * @param {(r:number)=>number} [reader] extrai valor para UI (ex.: rad→deg)
   * @param {(ui:number)=>number} [writer] converte valor UI → glassesOffset
   * @param {number} [digits]
   */
  const addSlider = (label, key, min, max, step, reader, writer, digits = 2) => {
    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      marginBottom: "4px",
    });
    const lab = document.createElement("span");
    lab.textContent = label;
    Object.assign(lab.style, {
      minWidth: "34px",
      fontWeight: "500",
      fontSize: "11px",
    });
    const rd = reader || ((v) => v);
    const wr = writer || ((v) => v);
    const inp = document.createElement("input");
    inp.type = "range";
    inp.min = String(min);
    inp.max = String(max);
    inp.step = String(step);
    inp.value = String(rd(glassesOffset[key]).toFixed(digits));
    Object.assign(inp.style, { flex: "1", minWidth: "0" });
    const num = document.createElement("input");
    num.type = "number";
    num.min = String(min);
    num.max = String(max);
    num.step = String(step);
    num.value = inp.value;
    Object.assign(num.style, {
      width: "56px",
      fontSize: "10px",
      padding: "2px 4px",
      borderRadius: "4px",
      border: "1px solid #555",
      background: "#222",
      color: "#fff",
    });

    const apply = (uiVal, source) => {
      const v = Number(uiVal);
      if (!Number.isFinite(v)) return;
      glassesOffset[key] = wr(v);
      inp.value = String(v);
      num.value = String(v);
      logOffset(`${key}:${source}`);
    };
    inp.addEventListener("input", () => apply(inp.value, "slider"));
    num.addEventListener("change", () => apply(num.value, "number"));
    row.append(lab, inp, num);
    wrap.appendChild(row);
  };

  const radToDeg = (r) => (r * 180) / Math.PI;
  const degToRad = (d) => (d * Math.PI) / 180;
  addSlider("rotX°", "rotX", -180, 180, 1, radToDeg, degToRad, 1);
  addSlider("rotY°", "rotY", -180, 180, 1, radToDeg, degToRad, 1);
  addSlider("rotZ°", "rotZ", -180, 180, 1, radToDeg, degToRad, 1);
  const divider = document.createElement("div");
  Object.assign(divider.style, {
    height: "1px",
    background: "rgba(255,255,255,0.15)",
    margin: "6px 0",
  });
  wrap.appendChild(divider);
  addSlider("posX m", "posX", -0.5, 0.5, 0.001, null, null, 3);
  addSlider("posY m", "posY", -0.5, 0.5, 0.001, null, null, 3);
  addSlider("posZ m", "posZ", -0.5, 0.5, 0.001, null, null, 3);

  const btnRow = document.createElement("div");
  Object.assign(btnRow.style, { display: "flex", gap: "6px", marginTop: "6px" });
  const btnBase = {
    flex: "1",
    padding: "8px 4px",
    cursor: "pointer",
    fontSize: "11px",
    borderRadius: "6px",
    border: "1px solid #555",
    background: "#2a2a2a",
    color: "#fff",
    WebkitTapHighlightColor: "transparent",
  };
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.textContent = "Zerar";
  Object.assign(resetBtn.style, btnBase);
  resetBtn.addEventListener("click", (e) => {
    e.preventDefault();
    glassesOffset.rotX = 0;
    glassesOffset.rotY = 0;
    glassesOffset.rotZ = 0;
    glassesOffset.posX = 0;
    glassesOffset.posY = 0;
    glassesOffset.posZ = 0;
    const ranges = wrap.querySelectorAll("input");
    for (const el of ranges) {
      if (el.type === "range" || el.type === "number") el.value = "0";
    }
    logOffset("reset");
  });
  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.textContent = "Copiar valores";
  Object.assign(copyBtn.style, btnBase, { background: "#0a5d9e" });
  copyBtn.addEventListener("click", (e) => {
    e.preventDefault();
    const snapRaw = JSON.stringify(glassesOffset, null, 2);
    const snapDeg = {
      rotX_deg: +radToDeg(glassesOffset.rotX).toFixed(2),
      rotY_deg: +radToDeg(glassesOffset.rotY).toFixed(2),
      rotZ_deg: +radToDeg(glassesOffset.rotZ).toFixed(2),
      posX: +glassesOffset.posX.toFixed(4),
      posY: +glassesOffset.posY.toFixed(4),
      posZ: +glassesOffset.posZ.toFixed(4),
    };
    console.log(
      "%c[omafit-ar] glassesOffset (copiar)",
      "color:#0cf;font-weight:bold;",
      "\n// Radianos (colar directo em `const glassesOffset = ...`):\n",
      snapRaw,
      "\n// Graus (só informativo):\n",
      JSON.stringify(snapDeg, null, 2),
    );
    try {
      void navigator.clipboard.writeText(snapRaw);
      copyBtn.textContent = "Copiado!";
      setTimeout(() => {
        copyBtn.textContent = "Copiar valores";
      }, 1500);
    } catch {
      /* ignore */
    }
  });
  btnRow.append(resetBtn, copyBtn);
  wrap.appendChild(btnRow);
  layerHost.appendChild(wrap);
  logOffset("init");
  return () => {
    try {
      wrap.remove();
      delete window.__omafitGlassesOffset;
      delete window.__omafitLogGlassesOffset;
    } catch {
      /* ignore */
    }
  };
}

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

/**
 * Iframe Netlify: `omafit-widget.js` envia `omafit_mode=eyewear_ar` ao abrir o provador com GLB
 * **só** para acessórios de rosto (não watch/bracelet / hand). Isto força `glasses` no query
 * e evita classificação errada de óptica como `watch` em algumas lojas.
 */
function isOmafitEyewearArForcedFromQuery() {
  try {
    const q = new URLSearchParams(typeof window !== "undefined" ? window.location.search || "" : "");
    const mode = (q.get("omafit_mode") || "").toLowerCase().trim();
    if (mode === "eyewear_ar" || mode === "ar_eyewear") return true;
    const leg = (q.get("blockClothingTryon") || q.get("omafit_block_clothing") || "").toLowerCase();
    return leg === "1" || leg === "true" || leg === "yes";
  } catch {
    return false;
  }
}

/**
 * `GLTFLoader` no Netlify resolve URLs relativas (`/cdn/shop/...`) contra o **origin do iframe**
 * → 404. Só reescrevemos paths típicos da CDN Shopify; outros `/…` mantêm-se (p.ex. proxy próprio).
 */
function omafitAbsolutizeGlbUrlMaybe(raw) {
  const u = String(raw || "").trim();
  if (!u) return u;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith("//")) return `https:${u}`;
  if (u.startsWith("/")) {
    const shopifyPath =
      /^\/(cdn\/shop|s\/files|files\/)/i.test(u) ||
      /^\/\d+\/\d+\/files\//i.test(u);
    if (!shopifyPath) return u;
    try {
      return new URL(u, "https://cdn.shopify.com").href;
    } catch {
      return u;
    }
  }
  return u;
}

/** Evita mixed content no iframe HTTPS (imagem do produto às vezes vem em `http://cdn.shopify.com`). */
function omafitUpgradeShopifyMediaToHttps(url) {
  const s = String(url || "").trim();
  if (!s) return s;
  if (s.startsWith("//")) return `https:${s}`;
  try {
    if (/^http:\/\/cdn\.shopify\.com\//i.test(s)) {
      return `https://${s.slice("http://".length)}`;
    }
    const u = new URL(s);
    if (u.protocol === "http:" && /\.shopify\.com$/i.test(u.hostname)) {
      u.protocol = "https:";
      return u.toString();
    }
  } catch {
    /* ignore */
  }
  return s;
}

/**
 * Garante `data-ar-glasses-manual-mindar-rig` no `#omafit-ar-root` **antes** de `cfgAttr`:
 * query `?arGlassesManualMindarRig=1|0`; se vazio → `"0"` (pipeline só face mesh + tracking wrap).
 *
 * @param {HTMLElement | null} root
 */
function omafitHydrateArRootManualRigFromUrl(root) {
  if (!root || !root.dataset) return;
  try {
    const q = new URLSearchParams(typeof window !== "undefined" ? window.location.search || "" : "");
    const fromQ = (q.get("arGlassesManualMindarRig") || q.get("ar_glasses_manual_mindar_rig") || "").trim();
    if (fromQ && /^(1|true|yes|on)$/i.test(fromQ)) {
      root.dataset.arGlassesManualMindarRig = "1";
      return;
    }
    if (fromQ && /^(0|false|off|no)$/i.test(fromQ)) {
      root.dataset.arGlassesManualMindarRig = "0";
      return;
    }
  } catch {
    /* ignore */
  }
  /** Pipeline único (faceMatrix + wrap): não preencher modo manual por defeito. */
  const cur = String(root.dataset.arGlassesManualMindarRig ?? "").trim();
  if (!cur) {
    root.dataset.arGlassesManualMindarRig = "0";
  }
}

/**
 * Iframe Netlify / HTML mínimo: `omafit-widget.js` envia `arAccessoryType`, `arTrackingStack`,
 * tags, etc. na query. Se o DOM não espelhou os `data-ar-*`, o runtime assumia `glasses` +
 * MindAR — pulseiras/relógios não entravam em `runHandArSession` e o GLB parecia “invisível”.
 *
 * Só preenche campos ainda vazios no dataset (Liquid da loja continua prioritário quando presente).
 *
 * @param {HTMLElement | null} arRootEl `#omafit-ar-root`
 * @param {HTMLElement | null} widgetRootEl `#omafit-widget-root`
 */
function omafitHydrateArTelemetryDatasetFromSearchParams(arRootEl, widgetRootEl) {
  if (typeof window === "undefined") return;
  try {
    const q = new URLSearchParams(window.location.search || "");
    const defs = [
      ["arAccessoryType", ["arAccessoryType", "ar_accessory_type"]],
      ["arTrackingStack", ["arTrackingStack", "ar_tracking_stack"]],
      ["arCategoryPath", ["arCategoryPath", "ar_category_path"]],
      ["arProductType", ["arProductType", "ar_product_type"]],
      ["arProductTags", ["arProductTags", "ar_product_tags"]],
      ["arPreferredCamera", ["arPreferredCamera", "ar_preferred_camera"]],
      ["productTitle", ["productTitle", "product_title"]],
    ];
    function pickQuery(keys) {
      for (let i = 0; i < keys.length; i++) {
        const raw = q.get(keys[i]);
        if (raw != null && String(raw).trim() !== "") return String(raw).trim();
      }
      return "";
    }
    function patchEl(el) {
      if (!el?.dataset) return;
      for (let di = 0; di < defs.length; di++) {
        const camel = defs[di][0];
        const queryKeys = defs[di][1];
        const incoming = pickQuery(queryKeys);
        if (!incoming) continue;
        const cur = el.dataset[camel];
        /**
         * Iframe: query `arTrackingStack=hand` deve ganhar sobre tema desactualizado (`face`).
         */
        if (camel === "arTrackingStack") {
          const inc = incoming.trim().toLowerCase();
          const cu = cur !== undefined ? String(cur).trim().toLowerCase() : "";
          if (inc === "hand" && cu === "face") {
            el.dataset[camel] = incoming.trim();
            continue;
          }
        }
        if (cur !== undefined && String(cur).trim() !== "") continue;
        el.dataset[camel] = incoming;
      }
    }
    patchEl(arRootEl);
    patchEl(widgetRootEl);
  } catch {
    /* ignore */
  }
}

/**
 * `#omafit-ar-root` pode falhar intermitentemente no iframe React; a query `arGlbUrl`
 * (enviada pelo tema) serve de fallback antes de desistir do arranque.
 */
function omafitReadGlbUrlFromRootOrQuery() {
  try {
    const r = typeof document !== "undefined" ? document.getElementById("omafit-ar-root") : null;
    let u = r ? (r.dataset.glbUrl || r.getAttribute("data-glb-url") || "").trim() : "";
    if (!u && typeof window !== "undefined") {
      const q = new URLSearchParams(window.location.search || "");
      const raw = q.get("arGlbUrl") || q.get("ar_glb_url");
      if (raw && String(raw).trim()) {
        u = String(raw).trim();
        try {
          u = decodeURIComponent(u);
        } catch {
          /* manter u */
        }
      }
    }
    return omafitAbsolutizeGlbUrlMaybe(u);
  } catch {
    return "";
  }
}

/**
 * GLBs com `opacity` ~0, `transparent` sem necessidade, ou materiais especiais podem
 * renderizar “invisíveis” no pipeline AR lite (sem PMREM / transmissão completa).
 */
function omafitEnsureGlassesMeshesRenderable(THREE, root) {
  if (!root || typeof root.traverse !== "function") return;
  root.traverse((child) => {
    if (!child || !child.isMesh) return;
    child.visible = true;
    child.frustumCulled = false;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const mat of mats) {
      if (!mat) continue;
      if ("visible" in mat) mat.visible = true;
      if ("opacity" in mat) {
        const o = Number(mat.opacity);
        if (!Number.isFinite(o) || o < 0.02) {
          mat.opacity = 1;
          mat.transparent = false;
        }
      }
      if (mat.transparent && "opacity" in mat && Number(mat.opacity) >= 0.98) {
        mat.transparent = false;
      }
      if ("depthWrite" in mat && mat.depthWrite === false && !mat.transparent) {
        mat.depthWrite = true;
      }
      mat.needsUpdate = true;
    }
  });
}

/**
 * URL do Ajax Cart da Shopify. No tema é relativo (`/cart/add.js`); no iframe
 * Netlify o origin é outro — precisa de `data-shop-domain` (ex. loja.myshopify.com).
 */
function omafitShopifyCartAddJsUrlFromArRoot() {
  try {
    const r = typeof document !== "undefined" ? document.getElementById("omafit-ar-root") : null;
    const raw = String(r?.dataset?.shopDomain || r?.getAttribute?.("data-shop-domain") || "").trim();
    if (!raw) return "/cart/add.js";
    const host = raw.replace(/^https?:\/\//i, "").split("/")[0].trim();
    if (!host) return "/cart/add.js";
    return `https://${host}/cart/add.js`;
  } catch {
    return "/cart/add.js";
  }
}

/**
 * Carrinho no iframe Netlify: `fetch` cross-origin para `…/cart/add.js` falha (CORS).
 * Quando há `window.parent` (widget aberto na loja Shopify), pedimos ao tema
 * (`omafit-widget.js`) que faça `POST /cart/add.js` na mesma origem da loja.
 */
function omafitArPostCartAddVariant(variantId) {
  const vid = Number(variantId);
  if (!Number.isFinite(vid) || vid < 1) {
    return Promise.reject(new Error("variantId inválido"));
  }
  if (typeof window === "undefined" || !window.parent || window.parent === window) {
    const cartUrl = omafitShopifyCartAddJsUrlFromArRoot();
    return fetch(cartUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ id: vid, quantity: 1 }] }),
      mode: "cors",
      credentials: "omit",
    }).then((res) => {
      if (!res.ok) throw new Error(res.statusText || String(res.status));
      return { success: true };
    });
  }
  const requestId = `ar-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn) => {
      if (settled) return;
      settled = true;
      try {
        window.removeEventListener("message", onMsg);
      } catch {
        /* ignore */
      }
      try {
        clearTimeout(tid);
      } catch {
        /* ignore */
      }
      fn();
    };
    const onMsg = (ev) => {
      if (!ev || !ev.data || ev.data.type !== "omafit-ar-cart-add-result") return;
      if (String(ev.data.requestId || "") !== requestId) return;
      if (ev.data.success) {
        done(() => resolve({ success: true, message: ev.data.message || "" }));
      } else {
        done(() => reject(new Error(ev.data.message || "carrinho_recusado")));
      }
    };
    window.addEventListener("message", onMsg, false);
    const tid = window.setTimeout(() => {
      done(() => reject(new Error("carrinho_timeout")));
    }, 15000);
    try {
      window.parent.postMessage(
        { type: "omafit-ar-cart-add-variant", payload: { requestId, variantId: vid, quantity: 1 } },
        "*",
      );
    } catch (e) {
      done(() => reject(e));
    }
  });
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
 * Vidro / mostrador: promove para MeshPhysicalMaterial com transmissão estável
 * sob IBL (PMREM). Chamado após carregar o GLB no path mão.
 */
function upgradeHandArGlassMaterials(THREE, root) {
  if (!root || typeof root.traverse !== "function") return;
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const next = mats.map((m) => {
      if (!m) return m;
      const name = String(m.name || "").toLowerCase();
      const glassy =
        /glass|vidro|lens|lente|cristal|crystal|sapphire|display/i.test(name) ||
        (m.transparent && Number(m.opacity) < 0.99) ||
        (m.transmission !== undefined && Number(m.transmission) > 0.01);
      if (!glassy) return m;
      const pm = new THREE.MeshPhysicalMaterial({
        color: m.color ? m.color.clone() : new THREE.Color(0xffffff),
        roughness: Math.min(0.95, Math.max(0.04, Number(m.roughness) || 0.08)),
        metalness: Math.min(1, Math.max(0, Number(m.metalness) || 0)),
        transmission: Math.min(1, Math.max(0.75, Number(m.transmission) || 0.92)),
        thickness: Math.min(2, Math.max(0.08, Number(m.thickness) || 0.4)),
        ior: Math.min(2.5, Math.max(1, Number(m.ior) || 1.5)),
        transparent: true,
        opacity: 1,
        side: m.side != null ? m.side : THREE.FrontSide,
        envMapIntensity: Math.max(0.5, Number(m.envMapIntensity) || 1),
        clearcoat: Number(m.clearcoat) || 0,
        clearcoatRoughness: Number(m.clearcoatRoughness) || 0,
      });
      if (m.map) pm.map = m.map;
      if (m.normalMap) pm.normalMap = m.normalMap;
      if (m.roughnessMap) pm.roughnessMap = m.roughnessMap;
      if (m.metalnessMap) pm.metalnessMap = m.metalnessMap;
      if (m.alphaMap) pm.alphaMap = m.alphaMap;
      pm.needsUpdate = true;
      return pm;
    });
    obj.material = Array.isArray(obj.material) ? next : next[0];
  });
}

/**
 * Lentes + armação (óculos, path MindAR): vidro físico com IBL + metais com envMap.
 * `envTexture` = `scene.environment` (PMREM).
 */
function upgradeFaceArEyewearRendering(THREE, root, envTexture) {
  if (!root || typeof root.traverse !== "function" || !envTexture) return;
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const next = mats.map((m) => {
      if (!m) return m;
      const name = String(m.name || "").toLowerCase();
      const isLens =
        /lens|lentes|glass|vidro|cristal|crystal|mica|shield|visor|transparent/i.test(name) ||
        (m.transmission !== undefined && Number(m.transmission) > 0.02) ||
        (m.transparent && Number(m.opacity) < 0.97);
      if (isLens) {
        const pm = new THREE.MeshPhysicalMaterial({
          color: m.color ? m.color.clone() : new THREE.Color(0xffffff),
          transmission: 0.9,
          thickness: 0.5,
          ior: 1.5,
          roughness: 0.05,
          metalness: 0,
          transparent: true,
          opacity: 1,
          side: m.side != null ? m.side : THREE.DoubleSide,
          envMap: envTexture,
          envMapIntensity: 1.15,
          specularIntensity: 0.5,
          attenuationDistance: 1,
          clearcoat: 0.06,
          clearcoatRoughness: 0.08,
        });
        if ("reflectivity" in pm) pm.reflectivity = 0.5;
        if (m.map) pm.map = m.map;
        if (m.normalMap) pm.normalMap = m.normalMap;
        if (m.alphaMap) pm.alphaMap = m.alphaMap;
        if (m.roughnessMap) pm.roughnessMap = m.roughnessMap;
        pm.toneMapped = true;
        pm.needsUpdate = true;
        return pm;
      }
      if (m.isMeshStandardMaterial === true || m.isMeshPhysicalMaterial === true) {
        const o = m.clone();
        o.envMap = envTexture;
        o.envMapIntensity = Math.max(Number(o.envMapIntensity) || 1, 0.85);
        o.metalness = Math.min(1, Math.max(Number(o.metalness) || 0, 0.88));
        o.roughness = Math.min(0.45, Math.max(0.05, Number(o.roughness) || 0.18));
        o.toneMapped = true;
        o.needsUpdate = true;
        return o;
      }
      return m;
    });
    obj.material = Array.isArray(obj.material) ? next : next[0];
  });
}

/**
 * Joias (colar): metais preciosos, pingente com anisotropia; cristais tipo diamante.
 */
function upgradeFaceArNecklaceJewelryMaterials(THREE, root, envTexture) {
  if (!root || typeof root.traverse !== "function" || !envTexture) return;
  const gemRe =
    /diamond|diamant|gem|pedra|stone|cristal|crystal|zircon|zirc[oô]nia|opal|ruby|rubi|sapphire|esmeralda|emerald|topaz|pearl|p[eé]rola/i;
  const pendantRe =
    /pendant|pingente|charm|solitaire|drop|dangle|medal|medalha|locket|heart/i;
  const metalRe =
    /gold|ouro|silver|prata|platinum|platina|chain|corrente|link|elo|metal|mesh|bezel/i;
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const next = mats.map((m) => {
      if (!m) return m;
      const name = String(m.name || "").toLowerCase();
      const isGem =
        gemRe.test(name) ||
        (m.transmission !== undefined && Number(m.transmission) > 0.45);
      const isPendant = pendantRe.test(name) || isGem;
      if (isGem && (m.isMeshPhysicalMaterial === true || m.isMeshStandardMaterial === true)) {
        const pm = new THREE.MeshPhysicalMaterial({
          color: m.color ? m.color.clone() : new THREE.Color(0xffffff),
          metalness: Math.min(1, Number(m.metalness) || 0),
          roughness: Math.min(0.35, Math.max(0.02, Number(m.roughness) || 0.06)),
          transmission: 1,
          thickness: Math.max(0.15, Number(m.thickness) || 0.35),
          ior: 2.4,
          transparent: true,
          opacity: 1,
          side: m.side != null ? m.side : THREE.DoubleSide,
          envMap: envTexture,
          envMapIntensity: Math.max(1.85, Number(m.envMapIntensity) || 2.2),
          attenuationDistance: 0.35,
          clearcoat: 0.12,
          clearcoatRoughness: 0.06,
        });
        if (m.map) pm.map = m.map;
        if (m.normalMap) pm.normalMap = m.normalMap;
        if (m.roughnessMap) pm.roughnessMap = m.roughnessMap;
        if ("anisotropy" in pm) pm.anisotropy = Math.min(1, Math.max(0.35, Number(m.anisotropy) || 0.55));
        pm.toneMapped = true;
        pm.needsUpdate = true;
        return pm;
      }
      if (
        isPendant &&
        (m.isMeshPhysicalMaterial === true || m.isMeshStandardMaterial === true)
      ) {
        const o =
          m.isMeshPhysicalMaterial === true
            ? m.clone()
            : new THREE.MeshPhysicalMaterial().copy(m);
        o.envMap = envTexture;
        o.envMapIntensity = Math.max(1.65, Number(o.envMapIntensity) || 1.85);
        o.metalness = Math.min(1, Math.max(0.75, Number(o.metalness) || 0.92));
        o.roughness = Math.min(0.28, Math.max(0.04, Number(o.roughness) || 0.12));
        if ("anisotropy" in o) o.anisotropy = Math.min(1, Math.max(0.25, Number(o.anisotropy) || 0.45));
        o.toneMapped = true;
        o.needsUpdate = true;
        return o;
      }
      if (
        metalRe.test(name) &&
        (m.isMeshStandardMaterial === true || m.isMeshPhysicalMaterial === true)
      ) {
        const o = m.clone();
        o.envMap = envTexture;
        o.envMapIntensity = Math.max(1.2, Number(o.envMapIntensity) || 1.45);
        o.metalness = Math.min(1, Math.max(0.82, Number(o.metalness) || 0.95));
        o.roughness = Math.min(0.42, Math.max(0.06, Number(o.roughness) || 0.16));
        o.toneMapped = true;
        o.needsUpdate = true;
        return o;
      }
      return m;
    });
    obj.material = Array.isArray(obj.material) ? next : next[0];
  });
}

/**
 * Separa malhas nomeadas corrente vs pingente para escala (k,1,k) só na corrente.
 * @returns {{ chain: THREE.Group, pendant: THREE.Group } | null}
 */
function omafitPartitionNecklaceChainPendant(THREE, root) {
  if (!root) return null;
  const chain = new THREE.Group();
  chain.name = "omafit_necklace_chain_scale";
  const pendant = new THREE.Group();
  pendant.name = "omafit_necklace_pendant_hold";
  const loose = [];
  /** @type {THREE.Mesh[]} */
  const meshes = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (o.isMesh && o !== root) meshes.push(o);
  });
  for (const o of meshes) {
    const n = String(o.name || "").toLowerCase();
    const isP = /pendant|pingente|charm|gem|stone|diamond|pedra|cristal|crystal|pearl|p[eé]rola|solitaire|drop|dangle|medal|medalha|locket|heart/i.test(n);
    const isC = /chain|corrente|link|elo|strand|cord|mesh_ring/i.test(n);
    if (isP) pendant.attach(o);
    else if (isC) chain.attach(o);
    else loose.push(o);
  }
  for (const o of loose) chain.attach(o);
  if (chain.children.length === 0 && pendant.children.length === 0) return null;
  root.add(chain);
  root.add(pendant);
  return { chain, pendant };
}

/**
 * Cilindro só-depth entre dois centros (espaço local da âncora). Recria geometria se r/h mudarem muito.
 */
function omafitUpdateNeckCylinderOccluder(THREE, mesh, state, top, bottom, rTop, rBot) {
  if (!mesh || !top || !bottom) return;
  const axis = new THREE.Vector3().subVectors(bottom, top);
  const h = axis.length();
  if (!Number.isFinite(h) || h < 1e-5) return;
  const mid = new THREE.Vector3().addVectors(top, bottom).multiplyScalar(0.5);
  const yUp = new THREE.Vector3(0, 1, 0);
  const quat = new THREE.Quaternion().setFromUnitVectors(yUp, axis.clone().normalize());
  mesh.position.copy(mid);
  mesh.quaternion.copy(quat);
  const prev = state || {};
  const eps = 0.002;
  if (
    !prev.geom ||
    Math.abs(prev.h - h) > eps ||
    Math.abs(prev.rTop - rTop) > eps ||
    Math.abs(prev.rBot - rBot) > eps
  ) {
    try {
      const old = mesh.geometry;
      if (old && old !== prev.geom) old.dispose();
      else prev.geom?.dispose?.();
    } catch {
      /* ignore */
    }
    prev.geom = new THREE.CylinderGeometry(rTop, rBot, h, 20, 1, true);
    mesh.geometry = prev.geom;
    prev.h = h;
    prev.rTop = rTop;
    prev.rBot = rBot;
  }
  mesh.scale.set(1, 1, 1);
  mesh.updateMatrix();
}

/** Sombra tipo U no peito (contact shadow aproximado). */
function omafitCreateNecklaceChestDropShadow(THREE) {
  const canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
  const size = 128;
  if (canvas) {
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const g = ctx.createRadialGradient(size * 0.5, size * 0.42, 4, size * 0.5, size * 0.52, size * 0.48);
      g.addColorStop(0, "rgba(24,18,28,0.5)");
      g.addColorStop(0.45, "rgba(18,12,20,0.22)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = "rgba(10,8,12,0.18)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(size * 0.5, size * 0.44, size * 0.28, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }
  }
  const tex = canvas
    ? new THREE.CanvasTexture(canvas)
    : new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  if (tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    depthTest: true,
    blending: THREE.MultiplyBlending,
  });
  const geo = new THREE.PlaneGeometry(0.42, 0.36);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -2;
  mesh.name = "omafit-ar-necklace-chest-shadow";
  mesh.rotation.x = -1.25;
  mesh.position.set(0, -0.14, 0.06);
  return { mesh, geo, mat, tex };
}

/**
 * Fade de opacidade na zona da nuca (object space Z típico Tripo: corrente atrás).
 */
function installNecklaceNapeFadeOnMaterial(THREE, material) {
  if (!material || material.userData?.omafitNapeFadeInstalled) return;
  material.userData = material.userData || {};
  material.userData.omafitNapeFadeInstalled = true;
  material.transparent = true;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = function onBeforeCompileNape(shader, renderer) {
    if (typeof prev === "function") prev.call(this, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <output_fragment>",
      [
        "float __nape = mix(0.2, 1.0, smoothstep(-0.48, 0.22, vViewPosition.z));",
        "gl_FragColor.a *= __nape;",
        "#include <output_fragment>",
      ].join("\n"),
    );
  };
  material.needsUpdate = true;
}

function omafitIsNecklaceHairMeshName(name) {
  const s = String(name || "").toLowerCase();
  if (!s) return false;
  if (/lens|glass|vidro|shadow|debug/i.test(s)) return false;
  return (
    /\b(chain|corrente|link|elo|strand|necklace|pendant|pingente|charm|metal|mesh)\b/i.test(s) ||
    /chain|corrente|necklace|colar/i.test(s)
  );
}

function installNecklaceHairMaskOnGlb(THREE, root, hairUniforms) {
  if (!root || !hairUniforms) return 0;
  let n = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    if (!omafitIsNecklaceHairMeshName(o.name)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      installGlassesTempleHairMaskOnMaterial(THREE, m, hairUniforms);
      n += 1;
    }
  });
  return n;
}

function installNecklaceNapeFadeOnGlb(THREE, root) {
  if (!root) return 0;
  let n = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    if (!omafitIsNecklaceHairMeshName(o.name)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      installNecklaceNapeFadeOnMaterial(THREE, m);
      n += 1;
    }
  });
  return n;
}

/**
 * Integração mola 2ª ordem (posição + rotação euler pequena) para o grupo do colar.
 */
function omafitNecklaceSpringStep(THREE, st, dtSec, targetPos, targetRx, targetRy) {
  if (!st?.necklaceSwing?.swingGroup || dtSec <= 0 || dtSec > 0.25) return;
  const g = st.necklaceSwing;
  const k = OMAFIT_NECKLACE_SPRING_K;
  const d = OMAFIT_NECKLACE_SPRING_DAMP;
  const rk = OMAFIT_NECKLACE_ROT_K;
  const rd = OMAFIT_NECKLACE_ROT_DAMP;
  for (const c of ["x", "y", "z"]) {
    const err = targetPos[c] - g.pos[c];
    g.vel[c] += err * k * dtSec;
    g.vel[c] *= Math.exp(-d * dtSec);
    g.pos[c] += g.vel[c] * dtSec;
  }
  const erx = targetRx - g.euler.x;
  const ery = targetRy - g.euler.y;
  g.eVel.x += erx * rk * dtSec;
  g.eVel.y += ery * rk * dtSec;
  g.eVel.x *= Math.exp(-rd * dtSec);
  g.eVel.y *= Math.exp(-rd * dtSec);
  g.euler.x += g.eVel.x * dtSec;
  g.euler.y += g.eVel.y * dtSec;
  g.swingGroup.position.copy(g.pos);
  g.swingGroup.rotation.x = g.euler.x;
  g.swingGroup.rotation.y = g.euler.y;
}

/**
 * Atualiza textura da máscara de cabelo (multiclasse) a partir do vídeo.
 */
function omafitFaceArUpdateHairCategoryMask(THREE, st, video, timestampMs) {
  if (!st?.hairSegmenter || !video || st.hairCategoryIndex < 0) return;
  try {
    const seg =
      typeof st.hairSegmenter.segmentForVideo === "function"
        ? st.hairSegmenter.segmentForVideo(video, timestampMs)
        : st.hairSegmenter.segment?.(video, timestampMs);
    if (seg && typeof seg.then === "function") return;
    const cat = seg?.categoryMask;
    if (!cat || typeof cat.getAsUint8Array !== "function") return;
    const w = cat.width;
    const h = cat.height;
    const u8 = cat.getAsUint8Array();
    if (!u8 || !w || !h) return;
    const hairIdx = st.hairCategoryIndex;
    let tex = st.hairMaskTexture;
    if (!tex || tex.image?.width !== w || tex.image?.height !== h) {
      try {
        tex?.dispose?.();
      } catch {
        /* ignore */
      }
      const data = new Uint8Array(w * h * 4);
      tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.flipY = false;
      tex.needsUpdate = true;
      st.hairMaskTexture = tex;
      if (st.hairUniforms?.uOmafitHairMask) st.hairUniforms.uOmafitHairMask.value = tex;
    }
    const data = tex.image.data;
    const n = w * h;
    for (let i = 0; i < n; i++) {
      const c = u8[i];
      const v = c === hairIdx ? 255 : 0;
      const j = i * 4;
      data[j] = v;
      data[j + 1] = v;
      data[j + 2] = v;
      data[j + 3] = 255;
    }
    tex.needsUpdate = true;
  } catch {
    /* throttle falhas silenciosas */
  }
}

/**
 * Distância euclidiana entre dois landmarks MediaPipe (metric space).
 */
function omafitFaceLandmarkDist3(lm, i, j) {
  const a = lm[i];
  const b = lm[j];
  if (!a || !b) return NaN;
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Distância 3D entre cantos externos dos olhos (landmarks 263 e 33) em `metricLandmarks`.
 * @param {any} lm `metricLandmarks`
 * @param {{ get(i: number): { x: number, y: number, z: number } | null } | null} smoother
 */
function omafitGlassesManualInterpupillaryDistance(lm, smoother) {
  const eL = smoother?.get(OMAFIT_FACE_LM_EYE_L_OUT);
  const eR = smoother?.get(OMAFIT_FACE_LM_EYE_R_OUT);
  if (eL && eR) {
    const dx = eL.x - eR.x;
    const dy = eL.y - eR.y;
    const dz = eL.z - eR.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return omafitFaceLandmarkDist3(lm, OMAFIT_FACE_LM_EYE_L_OUT, OMAFIT_FACE_LM_EYE_R_OUT);
}

/**
 * IPD só no eixo **X** entre cantos externos (263 olho esq., 33 olho dir.) em `metricLandmarks`.
 * @param {any} lm
 * @param {{ get(i: number): { x: number, y: number, z: number } | null } | null} smoother
 * @returns {number}
 */
function omafitGlassesInterpupillaryAbsDx(lm, smoother) {
  const eL = smoother?.get(OMAFIT_FACE_LM_EYE_L_OUT);
  const eR = smoother?.get(OMAFIT_FACE_LM_EYE_R_OUT);
  if (eL && eR && Number.isFinite(eL.x) && Number.isFinite(eR.x)) {
    return Math.abs(eL.x - eR.x);
  }
  const a = lm?.[OMAFIT_FACE_LM_EYE_L_OUT];
  const b = lm?.[OMAFIT_FACE_LM_EYE_R_OUT];
  if (a && b && a.length >= 3 && b.length >= 3) {
    return Math.abs(a[0] - b[0]);
  }
  return Number.NaN;
}

/** Scratch: base olhos → rotação do pivot manual (evita alocações por frame). */
let _omafitManualEyeL = null;
let _omafitManualEyeR = null;
let _omafitManualNose168 = null;
let _omafitManualEyeMid = null;
let _omafitManualEyeDir = null;
let _omafitManualEyeFwd = null;
let _omafitManualEyeTrueUp = null;
let _omafitManualBasisM4 = null;
/** Log único orientação manual (quat + escala + ortogonalidade). */
let __omafitManualFinalOrientationLogged = false;
/** Uma vez: produtos escalares da base (devem ≈ 0). */
let __omafitManualOrthoCheckLogged = false;
/** Uma vez: log prep mesh modo manual (após bbox no root). */
let __omafitManualModelCenterFixLogged = false;
/** Alvo de posição do pivot manual em coords. `metricLandmarks` (mid olhos − 168 + trim + Z forward). */
let _omafitManualFaceBasisOffParent = null;
/** Alvo de quaternion do pivot manual (evita slerp a partir de `glassesPivot` antes de actualizar). */
let _omafitManualPivotTargetQuat = null;

/** Reuso: `omafitWriteMeshUniformScaleKeepQuaternionPosition` (ver política S→R→Q→T no doc de `normalizeGlassesModel`). */
let _omafitMeshSrtPosScratch = null;
let _omafitMeshSrtQuatScratch = null;
/** Reuso: `glassesGlbStandardize` — `q_face` em `multiply` sobre base Euler `Ry(π)`. */
let _omafitStdComposeFace = null;
let _omafitStdComposeMat = null;

/**
 * Actualiza `mesh.scale` uniforme preservando orientação e posição.
 * **Ordem de escrita:** `scale` → `quaternion` (mantém rotação/inclui face) → `position`.
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} mesh
 * @param {number} sUniform
 */
function omafitWriteMeshUniformScaleKeepQuaternionPosition(THREE, mesh, sUniform) {
  if (!THREE || !mesh) return;
  if (!_omafitMeshSrtPosScratch) _omafitMeshSrtPosScratch = new THREE.Vector3();
  if (!_omafitMeshSrtQuatScratch) _omafitMeshSrtQuatScratch = new THREE.Quaternion();
  _omafitMeshSrtPosScratch.copy(mesh.position);
  _omafitMeshSrtQuatScratch.copy(mesh.quaternion);
  const u = Number(sUniform);
  if (Number.isFinite(u) && u > 0) mesh.scale.set(u, u, u);
  else mesh.scale.set(1, 1, 1);
  mesh.quaternion.copy(_omafitMeshSrtQuatScratch);
  mesh.position.copy(_omafitMeshSrtPosScratch);
}

/**
 * Escreve **escala → quaternion → posição** num `Object3D` (sem inverter).
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} obj
 * @param {number} scaleUniform
 * @param {import("three").Quaternion} quat
 * @param {import("three").Vector3} pos
 */
function omafitWriteObject3dUniformScaleQuaternionPosition(THREE, obj, scaleUniform, quat, pos) {
  if (!THREE || !obj || !quat || !pos) return;
  const u = Number(scaleUniform);
  if (Number.isFinite(u) && u > 0) obj.scale.set(u, u, u);
  else obj.scale.set(1, 1, 1);
  obj.quaternion.copy(quat);
  obj.position.copy(pos);
}

/** Euler reutilizado para pivot geometria / estrutural (YXZ, só yaw em Y). */
let _omafitPivotYawEulerScratch = null;

/** Scratch: alinhar óculos à `matrixWorld` da face mesh (`faceMatrix` MindAR), no espaço local do pai. */
let _omafitSimpleGlassesFaceAlignScratch = null;

/**
 * Base facial manual a partir de `metricLandmarks` — **mesmos** `eyeDir`, `trueUp`, `forward`
 * que `omafitGlassesManualPivotApplyEyeBasis` / `makeBasis`.
 *
 * @param {typeof import("three")} THREE
 * @param {any} lm
 * @param {{ get(i: number): { x: number, y: number, z: number } | null } | null} smoother
 * @param {import("three").Vector3} outEyeDir
 * @param {import("three").Vector3} outTrueUp
 * @param {import("three").Vector3} outForward
 * @returns {boolean}
 */
function omafitGlassesManualFaceBasisFromLm(THREE, lm, smoother, outEyeDir, outTrueUp, outForward) {
  if (!THREE || !lm || !outEyeDir || !outTrueUp || !outForward) return false;
  if (!_omafitManualEyeL) _omafitManualEyeL = new THREE.Vector3();
  if (!_omafitManualEyeR) _omafitManualEyeR = new THREE.Vector3();

  const fillEye = (idx, out) => {
    const p = smoother?.get(idx);
    if (p) {
      out.set(p.x, p.y, p.z);
      return true;
    }
    const a = lm[idx];
    if (!a) return false;
    out.set(a[0], a[1], a[2]);
    return true;
  };
  if (!fillEye(OMAFIT_FACE_LM_EYE_L_OUT, _omafitManualEyeL)) return false;
  if (!fillEye(OMAFIT_FACE_LM_EYE_R_OUT, _omafitManualEyeR)) return false;

  const leftEye = _omafitManualEyeL;
  const rightEye = _omafitManualEyeR;
  const eyeDir = outEyeDir.subVectors(rightEye, leftEye);
  if (eyeDir.lengthSq() < 1e-14) return false;
  eyeDir.normalize();
  if (eyeDir.x < 0) {
    eyeDir.multiplyScalar(-1);
  }
  eyeDir.normalize();

  const forward = outForward.set(0, 0, -1);
  const trueUp = outTrueUp.crossVectors(forward, eyeDir);
  if (trueUp.lengthSq() < 1e-14) return false;
  trueUp.normalize();

  forward.crossVectors(eyeDir, trueUp);
  if (forward.lengthSq() < 1e-14) return false;
  forward.normalize();

  if (trueUp.y < 0) {
    trueUp.multiplyScalar(-1);
    forward.crossVectors(eyeDir, trueUp);
    if (forward.lengthSq() < 1e-14) return false;
    forward.normalize();
  }
  return true;
}

/**
 * Garante caminho mais curto no `slerp` entre quaternions (evita salto 180°).
 * @param {import("three").Quaternion} qFrom
 * @param {import("three").Quaternion} qTo mutável; pode ser negado in-place
 */
function omafitQuatShortestPathToward(qFrom, qTo) {
  if (qFrom.dot(qTo) < 0) qTo.set(-qTo.x, -qTo.y, -qTo.z, -qTo.w);
}

/**
 * Modo manual MindAR — orientação **só** no `glassesPivot`: base ortonormal RHS estável,
 * **independente** da orientação do GLB Tripo. Sem rotação correctiva no mesh, sem `y180`/quat extra,
 * sem escala negativa.
 *
 * - **X** = `eyeDir` = canto direito − esquerdo (33−263), `eyeDir.x ≥ 0`.
 * - **Z** = frente da câmara em **−Z** mundo: começa por `(0,0,−1)`, depois `eyeDir × trueUp` para fechar RHS.
 * - **Y** = `trueUp` = `forward × eyeDir`, depois re-`forward = eyeDir × trueUp`.
 * - `Matrix4.makeBasis(eyeDir, trueUp, forward)` → `pivot.quaternion.setFromRotationMatrix`; `setScalar(finalScale)`.
 * - **Posição** (âncora 168, espaço `metricLandmarks`): coords. **absolutas** como
 *   `(lm[263]+lm[33])/2 − lm[168]` + trim `faceBasisOffsetM` + `eyeDepthForwardM` no **Z** —
 *   **sem** `pivotQuat * (ox,oy,oz)`; só soma escalar nos eixos do referencial da âncora.
 *
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} glassesPivot
 * @param {any} lm `metricLandmarks`
 * @param {{ get(i: number): { x: number, y: number, z: number } | null } | null} smoother
 * @param {number | null} [pivotUniformScale=null] escala uniforme do pivot; se omitido, `max(|sx|,|sy|,|sz|, 1e-8)`.
 * @param {{ x: number, y: number, z: number } | null} [faceBasisOffsetM=null] soma em **xyz** no mesmo referencial que `mid−168`.
 * @param {{ initialized: boolean, alpha: number } | null} [pivotSmooth=null] lerp posição + slerp quat + escala por frame.
 * @param {number} [eyeDepthForwardM=0.025] avanço positivo no **Z** do landmark (clamp no attr `arGlassesDepthForwardM`).
 * @returns {boolean} `true` se a rotação do pivot foi actualizada
 */
function omafitGlassesManualPivotApplyEyeBasis(
  THREE,
  glassesPivot,
  lm,
  smoother,
  pivotUniformScale = null,
  faceBasisOffsetM = null,
  pivotSmooth = null,
  eyeDepthForwardM = 0.025,
) {
  if (!THREE || !glassesPivot || !lm) return false;
  if (!_omafitManualEyeDir) _omafitManualEyeDir = new THREE.Vector3();
  if (!_omafitManualEyeFwd) _omafitManualEyeFwd = new THREE.Vector3();
  if (!_omafitManualEyeTrueUp) _omafitManualEyeTrueUp = new THREE.Vector3();
  if (!_omafitManualBasisM4) _omafitManualBasisM4 = new THREE.Matrix4();

  if (
    !omafitGlassesManualFaceBasisFromLm(
      THREE,
      lm,
      smoother,
      _omafitManualEyeDir,
      _omafitManualEyeTrueUp,
      _omafitManualEyeFwd,
    )
  ) {
    return false;
  }
  const eyeDir = _omafitManualEyeDir;
  const trueUp = _omafitManualEyeTrueUp;
  const forward = _omafitManualEyeFwd;

  if (!_omafitManualNose168) _omafitManualNose168 = new THREE.Vector3();
  if (!_omafitManualEyeMid) _omafitManualEyeMid = new THREE.Vector3();
  const pickLm = (idx, out) => {
    const p = smoother?.get?.(idx);
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) {
      out.set(p.x, p.y, p.z);
      return true;
    }
    const a = lm[idx];
    if (!a || a.length < 3) return false;
    out.set(a[0], a[1], a[2]);
    return true;
  };
  if (!pickLm(OMAFIT_FACE_LM_NOSE_BRIDGE, _omafitManualNose168)) return false;
  _omafitManualEyeMid.copy(_omafitManualEyeL).add(_omafitManualEyeR).multiplyScalar(0.5);

  const sx0 = glassesPivot.scale.x;
  const sy0 = glassesPivot.scale.y;
  const sz0 = glassesPivot.scale.z;

  const matrix = _omafitManualBasisM4;
  matrix.makeBasis(eyeDir, trueUp, forward);
  if (!_omafitManualPivotTargetQuat) _omafitManualPivotTargetQuat = new THREE.Quaternion();
  _omafitManualPivotTargetQuat.setFromRotationMatrix(matrix);

  const finalScale =
    pivotUniformScale != null &&
    Number.isFinite(pivotUniformScale) &&
    pivotUniformScale > 0
      ? pivotUniformScale
      : Math.max(Math.abs(sx0), Math.abs(sy0), Math.abs(sz0), 1e-8);

  const ux =
    faceBasisOffsetM && Number.isFinite(faceBasisOffsetM.x) ? faceBasisOffsetM.x : 0;
  const uy =
    faceBasisOffsetM && Number.isFinite(faceBasisOffsetM.y) ? faceBasisOffsetM.y : -0.02;
  const uz =
    faceBasisOffsetM && Number.isFinite(faceBasisOffsetM.z) ? faceBasisOffsetM.z : -0.05;
  const df =
    Number.isFinite(eyeDepthForwardM) && eyeDepthForwardM >= 0 ? eyeDepthForwardM : 0.025;
  if (!_omafitManualFaceBasisOffParent) _omafitManualFaceBasisOffParent = new THREE.Vector3();
  /** Centro interpupilar já em `_omafitManualEyeMid`; pivot = (mid − 168) + trim — sem quaternion em offsets. */
  _omafitManualFaceBasisOffParent.copy(_omafitManualEyeMid).sub(_omafitManualNose168);
  _omafitManualFaceBasisOffParent.x += ux;
  _omafitManualFaceBasisOffParent.y += uy;
  _omafitManualFaceBasisOffParent.z += uz + df;

  const alpha =
    pivotSmooth &&
    Number.isFinite(pivotSmooth.alpha) &&
    pivotSmooth.alpha > 0 &&
    pivotSmooth.alpha <= 1
      ? pivotSmooth.alpha
      : 1;

  if (!pivotSmooth || !pivotSmooth.initialized || alpha >= 1 - 1e-6) {
    glassesPivot.scale.setScalar(finalScale);
    glassesPivot.quaternion.copy(_omafitManualPivotTargetQuat);
    glassesPivot.position.copy(_omafitManualFaceBasisOffParent);
    if (pivotSmooth && !pivotSmooth.initialized) pivotSmooth.initialized = true;
  } else {
    const sPrev = glassesPivot.scale.x;
    const sLerp = Number.isFinite(sPrev)
      ? THREE.MathUtils.lerp(sPrev, finalScale, alpha)
      : finalScale;
    glassesPivot.scale.setScalar(sLerp);
    omafitQuatShortestPathToward(glassesPivot.quaternion, _omafitManualPivotTargetQuat);
    glassesPivot.quaternion.slerp(_omafitManualPivotTargetQuat, alpha);
    glassesPivot.quaternion.normalize();
    glassesPivot.position.lerp(_omafitManualFaceBasisOffParent, alpha);
  }
  glassesPivot.updateMatrix();

  const qw = glassesPivot.quaternion.w;
  if (
    !Number.isFinite(glassesPivot.quaternion.x) ||
    !Number.isFinite(glassesPivot.quaternion.y) ||
    !Number.isFinite(glassesPivot.quaternion.z) ||
    !Number.isFinite(qw) ||
    Math.abs(qw) > 2
  ) {
    glassesPivot.quaternion.identity();
    return false;
  }

  if (!__omafitManualOrthoCheckLogged) {
    __omafitManualOrthoCheckLogged = true;
    try {
      console.log("ORTHO CHECK", {
        dotXY: eyeDir.dot(trueUp),
        dotXZ: eyeDir.dot(forward),
        dotYZ: trueUp.dot(forward),
      });
    } catch {
      /* ignore */
    }
  }

  if (!__omafitManualFinalOrientationLogged) {
    __omafitManualFinalOrientationLogged = true;
    try {
      const q = glassesPivot.quaternion;
      console.log("[omafit-ar] manual pivot basis", {
        eyeDir: { x: eyeDir.x, y: eyeDir.y, z: eyeDir.z },
        trueUp: { x: trueUp.x, y: trueUp.y, z: trueUp.z },
        forward: { x: forward.x, y: forward.y, z: forward.z },
        quat: { x: q.x, y: q.y, z: q.z, w: q.w },
        scale: glassesPivot.scale.x,
        pivotPosLm: {
          x: _omafitManualFaceBasisOffParent.x,
          y: _omafitManualFaceBasisOffParent.y,
          z: _omafitManualFaceBasisOffParent.z,
        },
      });
    } catch {
      /* ignore */
    }
  }
  return true;
}

/**
 * Interpolação exponencial de matrizes 4×4 (posição + quaternion + escala).
 */
function omafitDampMatrix4(THREE, out, raw, lambda) {
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const q0 = new THREE.Quaternion();
  const q1 = new THREE.Quaternion();
  const s0 = new THREE.Vector3();
  const s1 = new THREE.Vector3();
  raw.decompose(p1, q1, s1);
  out.decompose(p0, q0, s0);
  const t = THREE.MathUtils.clamp(lambda, 0, 1);
  p0.lerp(p1, t);
  q0.slerp(q1, t);
  s0.lerp(s1, t);
  out.compose(p0, q0, s0);
}

/**
 * Avança a malha de oclusão facial ao longo do **+Z local** da face (para a
 * câmara), para a ponte do GLB não parecer a flutuar à frente do nariz.
 * @param {any} THREE
 * @param {any} matrix `Matrix4` da face mesh (mutado in-place)
 * @param {number} occZ deslocamento em unidades métricas MindAR
 * @param {{ pos: any, quat: any, sca: any, nudge: any, mat: any }} scratch
 */
function omafitNudgeFaceOccluderAlongLocalZ(THREE, matrix, occZ, scratch) {
  if (!matrix || !(occZ > 0) || !scratch || !THREE) return;
  scratch.mat.copy(matrix);
  scratch.mat.decompose(scratch.pos, scratch.quat, scratch.sca);
  scratch.nudge.set(0, 0, occZ).applyQuaternion(scratch.quat);
  scratch.pos.add(scratch.nudge);
  scratch.mat.compose(scratch.pos, scratch.quat, scratch.sca);
  matrix.copy(scratch.mat);
}

/**
 * Converte um ponto de `metricLandmarks` para espaço mundo usando só rotação +
 * translação da malha facial (sem escala MindAR na âncora). Evita offsets
 * gigantes no `glassesTrackingWrap` quando `face.matrixWorld` inclui escala >> 1.
 */
function omafitMetricLmToFaceWorldPoint(metricVec, faceWorldMat, out) {
  const e = faceWorldMat.elements;
  const tx = e[12];
  const ty = e[13];
  const tz = e[14];
  const sx = Math.hypot(e[0], e[1], e[2]) || 1;
  const sy = Math.hypot(e[4], e[5], e[6]) || 1;
  const sz = Math.hypot(e[8], e[9], e[10]) || 1;
  const x = metricVec.x;
  const y = metricVec.y;
  const z = metricVec.z;
  out.set(
    (e[0] / sx) * x + (e[4] / sy) * y + (e[8] / sz) * z + tx,
    (e[1] / sx) * x + (e[5] / sy) * y + (e[9] / sz) * z + ty,
    (e[2] / sx) * x + (e[6] / sy) * y + (e[10] / sz) * z + tz,
  );
  return out;
}

/**
 * Constrói uma matriz 4×4 de base (rotação + translação) para óculos,
 * derivada **somente** de 5 marcos do MediaPipe/MindAR no espaço métrico
 * Three.js: 168 (ponte do nariz, origem), 33/263 (cantos externos dos
 * olhos, eixo X = largura), 10 (glabela/testa) e 152 (queixo, eixo Y
 * vertical). O eixo Z é derivado por produto vectorial (regra da mão
 * direita), e depois `Y` é reortogonalizado via `Z × X` para garantir
 * ortonormalidade (precisão numérica).
 *
 * Convenção do resultado (alinhada com o `anchor.group` do MindAR em
 * condições frontais: câmara identidade → `+X` direita do ecrã, `+Y`
 * cima, `+Z` fora do rosto):
 *   column0 = (lm[263] − lm[33]).normalize()        ← direita do ecrã
 *   column2 = cross(X, Y_raw).normalize()           ← fora do rosto
 *   column1 = cross(Z, X)                            ← cima ortogonal
 *   translation = lm[168]
 *
 * Falha (retorna `false`) se algum landmark estiver em falta, se
 * `|eL−eR|²<ε` (cabeça em yaw ≥90°, olhos colapsam), ou se o plano
 * X/Y for degenerado (raro; acontece quando a cara está virada para o
 * chão/tecto). O chamador deve manter a última rotação válida nesse
 * caso — evita popping quando o tracking oscila perto de bordos.
 *
 * **Performance**: aloca 0 objectos por frame quando `reuse` é fornecido;
 * caso contrário cria vectores temporários. Chama-se uma vez por frame.
 *
 * @param {any} THREE
 * @param {Array<[number,number,number]>} lm `payload.estimateResult.metricLandmarks` do MindAR
 * @param {{ get(i: number): any } | null} smoother One Euro smoother com 10/33/152/168/263 registados; fallback para `lm[i]` bruto
 * @param {any} outMat `THREE.Matrix4` destino (mutado in-place)
 * @param {{ x: any, yRaw: any, y: any, z: any, p: any, tmp: any, O: any, eR: any, eL: any, fh: any, ch: any } | null} [reuse]
 * @returns {boolean}
 */
function buildGlassesFaceBasisMatrix(THREE, lm, smoother, outMat, reuse) {
  const tmp = reuse?.tmp || new THREE.Vector3();
  const gp = (idx, out) => {
    const p = smoother ? smoother.get(idx) : null;
    if (p) {
      out.copy(p);
      return out;
    }
    const a = lm ? lm[idx] : null;
    if (!a) return null;
    out.set(a[0], a[1], a[2]);
    return out;
  };
  const O = gp(OMAFIT_FACE_LM_NOSE_BRIDGE, reuse?.O || new THREE.Vector3());
  const eR = gp(OMAFIT_FACE_LM_EYE_R_OUT, reuse?.eR || new THREE.Vector3());
  const eL = gp(OMAFIT_FACE_LM_EYE_L_OUT, reuse?.eL || new THREE.Vector3());
  const fh = gp(OMAFIT_FACE_LM_FOREHEAD_TOP, reuse?.fh || new THREE.Vector3());
  const ch = gp(OMAFIT_FACE_LM_CHIN, reuse?.ch || new THREE.Vector3());
  if (!O || !eR || !eL || !fh || !ch) return false;
  const xAxis = reuse?.x || new THREE.Vector3();
  xAxis.subVectors(eL, eR);
  if (xAxis.lengthSq() < 1e-10) return false;
  xAxis.normalize();
  const yRaw = reuse?.yRaw || new THREE.Vector3();
  yRaw.subVectors(fh, ch);
  if (yRaw.lengthSq() < 1e-10) return false;
  yRaw.normalize();
  const zAxis = reuse?.z || new THREE.Vector3();
  zAxis.crossVectors(xAxis, yRaw);
  if (zAxis.lengthSq() < 1e-10) return false;
  zAxis.normalize();
  const yAxis = reuse?.y || new THREE.Vector3();
  yAxis.crossVectors(zAxis, xAxis).normalize();
  outMat.makeBasis(xAxis, yAxis, zAxis);
  outMat.setPosition(O);
  return true;
}

/**
 * Vector `mid(cantos externos olhos) − ponte(168)` em `metricLandmarks` (MindAR),
 * mesmo referencial que `wearPosition` do colar (`throat.x − anchor.x`, …).
 * Índices: olho direito canto exterior **33**, olho esquerdo **263**, ponte **168**.
 *
 * @param {typeof import("three")} THREE
 * @param {any} lm `metricLandmarks`
 * @param {{ get(i: number): { x: number; y: number; z: number } | null } | null} smoother
 * @param {import("three").Vector3} out
 * @returns {boolean}
 */
function omafitGlassesEyeMidpointDeltaFrom168(THREE, lm, smoother, out) {
  if (!THREE || !lm || !out) return false;
  const pick = (idx) => {
    const p = smoother?.get?.(idx);
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) return p;
    const a = lm[idx];
    if (!a || a.length < 3) return null;
    return { x: a[0], y: a[1], z: a[2] };
  };
  const nb = pick(OMAFIT_FACE_LM_NOSE_BRIDGE);
  const eR = pick(OMAFIT_FACE_LM_EYE_R_OUT);
  const eL = pick(OMAFIT_FACE_LM_EYE_L_OUT);
  if (!nb || !eR || !eL) return false;
  out.set(
    (eR.x + eL.x) * 0.5 - nb.x,
    (eR.y + eL.y) * 0.5 - nb.y,
    (eR.z + eL.z) * 0.5 - nb.z,
  );
  return Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.z);
}

/**
 * Base ortonormal no **espaço mundo** (alinhada à malha facial MindAR):
 * - **X**: bochecha esquerda − direita (454 − 234), horizontal do rosto.
 * - **Y_raw**: testa − queixo (10 − 152), vertical.
 * - **Z**: X × Y_raw (frente); **Y** re-ortogonalizado com Z × X.
 *
 * Com `mirrorSelfieX` (vídeo frontal espelhado), nega-se a componente X dos
 * pontos métricos antes de formar os vectores, para alinhar ao Three.js.
 *
 * @param {any} THREE
 * @param {Array<[number,number,number]>} lm
 * @param {{ get(i: number): any } | null} smoother
 * @param {any} faceMatrixWorld `matrixWorld` da `faceMeshes[0]` (suavizada no widget)
 * @param {boolean} mirrorSelfieX
 * @param {any} outRotMat `Matrix4` só rotação (translation 0)
 * @param {{ p234:any,p454:any,p10:any,p152:any,vx:any,yRaw:any,vz:any,vy:any }} reuse
 * @returns {boolean}
 */
function buildGlassesCheekOrthogonalBasisWorld(
  THREE,
  lm,
  smoother,
  faceMatrixWorld,
  mirrorSelfieX,
  outRotMat,
  reuse,
) {
  const gp = (idx, out) => {
    const p = smoother ? smoother.get(idx) : null;
    if (p) {
      out.copy(p);
      return out;
    }
    const a = lm ? lm[idx] : null;
    if (!a) return null;
    out.set(a[0], a[1], a[2]);
    return out;
  };
  const p234 = gp(OMAFIT_FACE_LM_RIGHT_CHEEK, reuse.p234);
  const p454 = gp(OMAFIT_FACE_LM_LEFT_CHEEK, reuse.p454);
  const p10 = gp(OMAFIT_FACE_LM_FOREHEAD_TOP, reuse.p10);
  const p152 = gp(OMAFIT_FACE_LM_CHIN, reuse.p152);
  if (!p234 || !p454 || !p10 || !p152) return false;
  const mx = mirrorSelfieX ? -1 : 1;
  const p234x = p234.x * mx;
  const p454x = p454.x * mx;
  const p10x = p10.x * mx;
  const p152x = p152.x * mx;
  const vx = reuse.vx.set(p454x - p234x, p454.y - p234.y, p454.z - p234.z);
  if (vx.lengthSq() < 1e-12) return false;
  vx.normalize();
  const yRaw = reuse.yRaw.set(p10x - p152x, p10.y - p152.y, p10.z - p152.z);
  if (yRaw.lengthSq() < 1e-12) return false;
  yRaw.normalize();
  vx.transformDirection(faceMatrixWorld);
  yRaw.transformDirection(faceMatrixWorld);
  const vz = reuse.vz.copy(vx).cross(yRaw);
  if (vz.lengthSq() < 1e-12) return false;
  vz.normalize();
  const vy = reuse.vy.copy(vz).cross(vx).normalize();
  outRotMat.makeBasis(vx, vy, vz);
  outRotMat.setPosition(0, 0, 0);
  return true;
}

/**
 * Posiciona um mesh de oclusão (haste) no espaço local da malha facial
 * (mesmo referencial que `metricLandmarks`).
 */
function omafitPlaceTempleDepthOccluder(THREE, mesh, noseLm, earLm) {
  if (!mesh || !noseLm || !earLm) return;
  const nx = noseLm[0];
  const ny = noseLm[1];
  const nz = noseLm[2];
  const ex = earLm[0];
  const ey = earLm[1];
  const ez = earLm[2];
  let dx = ex - nx;
  let dy = ey - ny;
  let dz = ez - nz;
  const len = Math.hypot(dx, dy, dz) || 1;
  dx /= len;
  dy /= len;
  dz /= len;
  /** Mais próximo do contorno temporal → melhor oclusão depth com a pele. */
  const push = 0.48;
  mesh.position.set(ex + dx * push, ey + dy * 0.06, ez + dz * push);
  const dir = new THREE.Vector3(dx, dy, dz);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
}

/**
 * Material só depth (máscara facial invisível) — mesmo padrão que oclusor de pulso.
 */
function createOmafitFaceDepthOccluderMaterial(THREE) {
  const m = new THREE.MeshBasicMaterial({
    color: 0x000000,
  });
  m.colorWrite = false;
  m.depthWrite = true;
  m.depthTest = true;
  /** Reduz z-fighting com lentes/hastes quando o GLB encosta na malha 468. */
  m.polygonOffset = true;
  m.polygonOffsetFactor = 1;
  m.polygonOffsetUnits = 1;
  return m;
}

/**
 * Oclusão por profundidade: hastes laterais antes do resto; lentes por cima.
 * Complementa a máscara 468 (só depth) para geometria atrás do rosto (z-test).
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root
 */
function omafitApplyGlassesMeshDepthPriorities(THREE, root) {
  if (!THREE || !root?.traverse) return;
  const templeRe = /\b(temple|haste|shaft|stem|temporal|earpiece|hook|bra[cç]o)\b/i;
  const protectRe = /\b(lens|lentes|rim_front|frame_front|bridge|brow|topbar|shield|visor|nose)\b/i;
  root.traverse((child) => {
    if (!child.isMesh) return;
    const n = String(child.name || "").toLowerCase();
    const isTempleSide = templeRe.test(n) && !protectRe.test(n);
    const isLens = /\b(lens|lentes|mica|shield|visor)\b/i.test(n);
    child.renderOrder = isLens ? 4 : isTempleSide ? 1 : 2;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const mat of mats) {
      if (!mat || typeof mat !== "object") continue;
      mat.depthTest = true;
      if ("polygonOffset" in mat) {
        mat.polygonOffset = true;
        if (isLens) {
          mat.polygonOffsetFactor = -4;
          mat.polygonOffsetUnits = -2;
        } else if (isTempleSide) {
          mat.polygonOffsetFactor = -1;
          mat.polygonOffsetUnits = -1;
        } else {
          mat.polygonOffsetFactor = -2;
          mat.polygonOffsetUnits = -2;
        }
      }
    }
  });
}

/**
 * Suavização exponencial de marcos 3D (métrico MindAR) — reduz jitter em tilt/escala/hastes.
 * @param {number[]} indices
 * @param {number} tauMs
 */
function createFaceLandmarkEMASmoother(THREE, indices, tauMs) {
  const set = new Set(indices);
  /** @type {Record<number, THREE.Vector3>} */
  const vecs = {};
  /** @type {Record<number, boolean>} */
  const inited = {};
  let lastT = 0;
  return {
    reset() {
      for (const k of Object.keys(inited)) delete inited[k];
      lastT = 0;
    },
    /** @param {number[][]} lm */
    sample(lm, nowMs) {
      const dt = lastT > 0 ? Math.max(4, Math.min(80, nowMs - lastT)) : 16;
      lastT = nowMs;
      const a = 1 - Math.exp(-dt / tauMs);
      for (const i of set) {
        const raw = lm[i];
        if (!raw) continue;
        if (!vecs[i]) vecs[i] = new THREE.Vector3();
        const v = vecs[i];
        if (!inited[i]) {
          inited[i] = true;
          v.set(raw[0], raw[1], raw[2]);
          continue;
        }
        v.x += (raw[0] - v.x) * a;
        v.y += (raw[1] - v.y) * a;
        v.z += (raw[2] - v.z) * a;
      }
    },
    /** @param {number} i */
    get(i) {
      return vecs[i] || null;
    },
  };
}

/**
 * @param {number} te delta tempo (s)
 * @param {number} cutoff Hz
 */
function omafitOneEuroSmoothingFactor(te, cutoff) {
  const r = 2 * Math.PI * cutoff * te;
  return r / (r + 1);
}

/**
 * One Euro 3D (derivada partilhada por eixo; cutoff dinâmico pela magnitude da velocidade).
 * @param {number[]} x [x,y,z] bruto
 * @param {number} tSec timestamp em segundos (monotónico)
 * @param {{ xPrev: number[] | null, tPrev: number | null, dxPrev: number[] }} state
 */
function omafitOneEuroFilterVec3(x, tSec, state, minCutoff, beta, dCutoff) {
  if (!state.xPrev) {
    state.xPrev = [x[0], x[1], x[2]];
    state.tPrev = tSec;
    state.dxPrev = [0, 0, 0];
    return [x[0], x[1], x[2]];
  }
  const te = Math.max(1e-6, tSec - state.tPrev);
  state.tPrev = tSec;
  const ad = omafitOneEuroSmoothingFactor(te, dCutoff);
  const dx = [
    (x[0] - state.xPrev[0]) / te,
    (x[1] - state.xPrev[1]) / te,
    (x[2] - state.xPrev[2]) / te,
  ];
  const dxHat = [
    ad * dx[0] + (1 - ad) * state.dxPrev[0],
    ad * dx[1] + (1 - ad) * state.dxPrev[1],
    ad * dx[2] + (1 - ad) * state.dxPrev[2],
  ];
  state.dxPrev[0] = dxHat[0];
  state.dxPrev[1] = dxHat[1];
  state.dxPrev[2] = dxHat[2];
  const speed = Math.hypot(dxHat[0], dxHat[1], dxHat[2]);
  const cutoff = minCutoff + beta * speed;
  const a = omafitOneEuroSmoothingFactor(te, cutoff);
  const xHat = [
    a * x[0] + (1 - a) * state.xPrev[0],
    a * x[1] + (1 - a) * state.xPrev[1],
    a * x[2] + (1 - a) * state.xPrev[2],
  ];
  state.xPrev[0] = xHat[0];
  state.xPrev[1] = xHat[1];
  state.xPrev[2] = xHat[2];
  return xHat;
}

/**
 * Banco One Euro por índice de landmark (espaço métrico MindAR), API compatível com
 * `createFaceLandmarkEMASmoother` (sample / get / reset).
 * @param {number[]} indices
 */
function createFaceLandmarkOneEuroSmoother(THREE, indices, minCutoff, beta, dCutoff) {
  const set = new Set(indices);
  /** @type {Record<number, { xPrev: number[] | null, tPrev: number | null, dxPrev: number[] }>} */
  const states = {};
  /** @type {Record<number, THREE.Vector3>} */
  const vecs = {};
  for (const i of indices) {
    states[i] = { xPrev: null, tPrev: null, dxPrev: [0, 0, 0] };
    vecs[i] = new THREE.Vector3();
  }
  return {
    reset() {
      for (const i of indices) {
        states[i] = { xPrev: null, tPrev: null, dxPrev: [0, 0, 0] };
      }
    },
    /** @param {number[][]} lm */
    sample(lm, nowMs) {
      const tSec = nowMs * 0.001;
      for (const i of set) {
        const raw = lm[i];
        if (!raw) continue;
        const xh = omafitOneEuroFilterVec3(raw, tSec, states[i], minCutoff, beta, dCutoff);
        vecs[i].set(xh[0], xh[1], xh[2]);
      }
    },
    /** @param {number} i */
    get(i) {
      return states[i]?.xPrev ? vecs[i] : null;
    },
  };
}

/**
 * Tenta obter o landmark 168 em coordenadas **normalizadas** (x,y∈[0,1]) do
 * runtime MindAR, quando exposto no `estimateResult` (varia por versão).
 */
function omafitPickNormalizedLandmark168(estimateResult) {
  if (!estimateResult || typeof estimateResult !== "object") return null;
  const candidates = [
    estimateResult.faceLandmarks,
    estimateResult.landmarks,
    estimateResult.face?.landmarks,
    estimateResult.normalizedLandmarks,
    estimateResult.canonicalLandmarks,
  ];
  for (const arr of candidates) {
    if (!Array.isArray(arr)) continue;
    const p = arr[OMAFIT_FACE_LM_NOSE_BRIDGE];
    if (!p) continue;
    if (typeof p.x === "number" && typeof p.y === "number") return p;
    if (Array.isArray(p) && typeof p[0] === "number") {
      return { x: p[0], y: p[1], z: typeof p[2] === "number" ? p[2] : 0 };
    }
  }
  return null;
}

/**
 * Alinha o ponto principal da projeção ao 168: erro em NDC (baixa frequência)
 * para `makePerspective` assimétrico — “screen-to-world” via frustum offset.
 */
function omafitUpdatePrincipalShiftFromLm168(
  THREE,
  camera,
  anchorGroup,
  estimateResult,
  /** @type {{ x: number, y: number }} */ lp,
  mirrorVideoX,
  scratch,
) {
  if (!THREE || !camera || !anchorGroup || !lp || !scratch) return;
  const lm = omafitPickNormalizedLandmark168(estimateResult);
  if (!lm) return;
  anchorGroup.updateMatrixWorld(true);
  scratch.set(0, 0, 0).applyMatrix4(anchorGroup.matrixWorld);
  scratch.project(camera);
  const tgt = omafitMediaPipeNormalizedToNdcXY(lm);
  let ex = tgt.x - scratch.x;
  let ey = tgt.y - scratch.y;
  if (mirrorVideoX) ex = -ex;
  const a = 0.24;
  lp.x = lp.x * (1 - a) + ex * a;
  lp.y = lp.y * (1 - a) + ey * a;
  const lim = 0.07;
  lp.x = THREE.MathUtils.clamp(lp.x, -lim, lim);
  lp.y = THREE.MathUtils.clamp(lp.y, -lim, lim);
}

/**
 * Raio da câmara no espaço mundo a partir de NDC (x,y) — `unproject` near/far.
 */
function omafitRayFromNdc(THREE, camera, ndcX, ndcY, outOrigin, outDir) {
  camera.updateMatrixWorld(true);
  outOrigin.set(ndcX, ndcY, -1).unproject(camera);
  const farP = new THREE.Vector3(ndcX, ndcY, 1).unproject(camera);
  outDir.copy(farP).sub(outOrigin).normalize();
}

/**
 * Converte erro NDC (alvo − centro óculos) em transladação **mundo** no plano
 * da câmara à profundidade do centro do GLB; factor “lente” `pos.x *= (1+dist*k)`
 * em NDC horizontal; espelho selfie inverte X.
 */
function omafitWorldDeltaFromNdcScreenError(
  THREE,
  camera,
  errNdcX,
  errNdcY,
  depthDist,
  lensDistortK,
  mirrorSelfie,
  out,
  right,
  up,
) {
  const fovRad = (camera.fov * Math.PI) / 180;
  const halfH = depthDist * Math.tan(fovRad * 0.5);
  const halfW = halfH * Math.max(0.05, camera.aspect);
  let ex = errNdcX;
  const distNdc = Math.min(1.35, Math.hypot(errNdcX, errNdcY));
  ex *= 1 + distNdc * (Number(lensDistortK) || 0);
  if (mirrorSelfie) ex = -ex;
  right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  up.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  out.set(0, 0, 0).addScaledVector(right, ex * halfW).addScaledVector(up, errNdcY * halfH);
  return out;
}

/**
 * Bloqueio de pixel: centro do GLB ↔ landmark 168 em NDC (`project` / blend
 * com MediaPipe normalizado). Devolve delta **local da âncora** para somar a `wearPosition`.
 * Direcção mundo → local da âncora: `transformDirection(inverse(matrixWorld))` — **sem** `quaternion * offset`.
 */
function omafitComputeGlassesWearNdcLockLocalDelta(
  THREE,
  camera,
  anchorGroup,
  glasses,
  estimateResult,
  /** @type {{ w168: any, ndc168: any, ndcGl: any, worldD: any, localD: any, invAnchor: any, box: any, center: any, right: any, up: any, lensK: number, mirrorSelfie: boolean }} s */
  s,
  ndcBlendFromMp,
) {
  if (!THREE || !camera || !anchorGroup || !glasses || !s) return null;
  camera.updateMatrixWorld(true);
  anchorGroup.updateMatrixWorld(true);
  glasses.updateMatrixWorld(true);
  s.w168.set(0, 0, 0).applyMatrix4(anchorGroup.matrixWorld);
  s.box.setFromObject(glasses);
  s.box.getCenter(s.center);
  s.ndc168.copy(s.w168).project(camera);
  s.ndcGl.copy(s.center).project(camera);
  let errX = s.ndc168.x - s.ndcGl.x;
  let errY = s.ndc168.y - s.ndcGl.y;
  const mp = omafitPickNormalizedLandmark168(estimateResult);
  if (mp && ndcBlendFromMp > 1e-6) {
    const ndcMp = omafitMediaPipeNormalizedToNdcXY(mp);
    errX = (1 - ndcBlendFromMp) * errX + ndcBlendFromMp * (ndcMp.x - s.ndcGl.x);
    errY = (1 - ndcBlendFromMp) * errY + ndcBlendFromMp * (ndcMp.y - s.ndcGl.y);
  }
  const depthDist = camera.position.distanceTo(s.center);
  omafitWorldDeltaFromNdcScreenError(
    THREE,
    camera,
    errX,
    errY,
    depthDist,
    s.lensK,
    s.mirrorSelfie,
    s.worldD,
    s.right,
    s.up,
  );
  s.invAnchor.copy(anchorGroup.matrixWorld).invert();
  s.localD.copy(s.worldD).transformDirection(s.invAnchor);
  return s.localD;
}

/**
 * Modo debug: alinhar centro da bbox do GLB ao mundo do landmark 168 (esfera).
 */
function omafitForceGlassesBboxCenterToWorldPoint(
  THREE,
  glasses,
  worldTarget,
  scratch,
  /** @type {import("three").Object3D | undefined} */ nudgeHolder,
) {
  if (!THREE || !glasses || !worldTarget || !scratch) return;
  const holder = nudgeHolder || glasses;
  glasses.updateMatrixWorld(true);
  scratch.box.setFromObject(glasses);
  scratch.box.getCenter(scratch.center);
  scratch.worldD.subVectors(worldTarget, scratch.center);
  const par = holder.parent;
  if (!par) return;
  par.updateMatrixWorld(true);
  scratch.tmp.copy(scratch.worldD);
  par.worldToLocal(scratch.tmp);
  holder.position.addScaledVector(scratch.tmp, 0.62);
}

/**
 * Matriz de projeção OpenGL-style a partir de FOV vertical + aspect + offsets
 * NDC (ponto principal descentrado). Mantém `camera.near` / `camera.far`.
 */
function omafitApplyOpenGlPerspectiveFromVideoIntrinsics(THREE, camera, fovDeg, aspect, shiftXNdc, shiftYNdc) {
  if (!THREE || !camera) return;
  const near = Math.max(1e-4, Number(camera.near) || 0.01);
  const far = Math.max(near * 2, Number(camera.far) || 1000);
  const fovRad = (THREE.MathUtils.clamp(fovDeg, 35, 95) * Math.PI) / 180;
  const t = near * Math.tan(fovRad * 0.5);
  const b = -t;
  const r = t * Math.max(0.2, aspect);
  const l = -r;
  const w = r - l;
  const h = t - b;
  const sx = THREE.MathUtils.clamp(shiftXNdc || 0, -0.09, 0.09);
  const sy = THREE.MathUtils.clamp(shiftYNdc || 0, -0.09, 0.09);
  const dx = sx * 0.5 * w;
  const dy = sy * 0.5 * h;
  const mat = new THREE.Matrix4().makePerspective(l + dx, r + dx, t - dy, b - dy, near, far);
  camera.projectionMatrix.copy(mat);
  camera.projectionMatrixInverse.copy(mat).invert();
}

/**
 * Log SO(3): `qRel` unitário, caminho mais curto (w ≥ 0). Escreve `outV` (tangent).
 */
function omafitQuaternionRelativeLog(THREE, qFrom, qTo, outV, qScratch) {
  qScratch.copy(qFrom).invert().multiply(qTo);
  if (qScratch.w < 0) qScratch.set(-qScratch.x, -qScratch.y, -qScratch.z, -qScratch.w);
  const { x, y, z, w } = qScratch;
  const sinh = Math.hypot(x, y, z);
  const half = Math.atan2(sinh, w);
  const th = 2 * half;
  if (th < 1e-7) {
    outV.set(2 * x, 2 * y, 2 * z);
    return;
  }
  const k = th / Math.max(sinh, 1e-9);
  outV.set(x * k, y * k, z * k);
}

/** Exponencial em S³ a partir de vector tangent (axis * angle). */
function omafitExpVec3ToQuaternion(THREE, vx, vy, vz, outQ) {
  const th = Math.hypot(vx, vy, vz);
  if (th < 1e-8) {
    outQ.identity();
    return;
  }
  const h = th * 0.5;
  const s = Math.sin(h) / th;
  outQ.set(vx * s, vy * s, vz * s, Math.cos(h));
}

/**
 * One Euro no manifold de rotações: filtra o log de (qPrev⁻¹ × qRaw) e recompõe.
 * @param {{ qPrev: any | null, tPrev: number | null, logState: { xPrev: number[] | null, tPrev: number | null, dxPrev: number[] }, qScratch: any, qStep: any, vMeas: any }} state
 */
function omafitOneEuroFilterQuaternion(THREE, qRaw, tSec, state, minCutoff, beta, dCutoff) {
  if (!state.qPrev) {
    state.qPrev = qRaw.clone();
    state.tPrev = tSec;
    state.logState = { xPrev: null, tPrev: null, dxPrev: [0, 0, 0] };
    return state.qPrev;
  }
  const te = Math.max(1e-6, tSec - state.tPrev);
  state.tPrev = tSec;
  const v = state.vMeas || new THREE.Vector3();
  omafitQuaternionRelativeLog(THREE, state.qPrev, qRaw, v, state.qScratch);
  const vf = omafitOneEuroFilterVec3(
    [v.x, v.y, v.z],
    tSec,
    state.logState,
    minCutoff,
    beta,
    dCutoff,
  );
  omafitExpVec3ToQuaternion(THREE, vf[0], vf[1], vf[2], state.qStep);
  state.qPrev.multiply(state.qStep).normalize();
  return state.qPrev;
}

/** Decal radial + planos suaves sob ponte / têmporas (sem EffectComposer). */
function omafitCreateGlassesContactShadowRig(THREE, glassesAnatomy) {
  if (!THREE || !glassesAnatomy) return null;
  const g = new THREE.Group();
  g.name = "omafit-ar-glasses-contact-ao-rig";
  g.renderOrder = -2;
  const cvs =
    typeof document !== "undefined" ? document.createElement("canvas") : null;
  let tex = null;
  if (cvs) {
    cvs.width = 64;
    cvs.height = 64;
    const ctx = cvs.getContext("2d");
    if (ctx) {
      const grd = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
      grd.addColorStop(0, "rgba(18,14,22,0.38)");
      grd.addColorStop(0.45, "rgba(18,14,22,0.14)");
      grd.addColorStop(1, "rgba(18,14,22,0)");
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, 64, 64);
    }
    tex = new THREE.CanvasTexture(cvs);
    tex.needsUpdate = true;
  }
  const sharedMat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    depthTest: true,
    blending: THREE.MultiplyBlending,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  });
  /** Frente das lentes canonical Omafit ≈ −Z local; sombra assenta na face (+Z). */
  const bridge = new THREE.Mesh(new THREE.PlaneGeometry(0.072, 0.036), sharedMat);
  bridge.rotation.x = -Math.PI / 2;
  bridge.position.set(0, -0.012, 0.014);
  const tL = new THREE.Mesh(new THREE.PlaneGeometry(0.034, 0.092), sharedMat);
  tL.rotation.y = Math.PI * 0.22;
  tL.rotation.x = -Math.PI / 2;
  tL.position.set(-0.086, -0.006, 0.01);
  const tR = new THREE.Mesh(new THREE.PlaneGeometry(0.034, 0.092), sharedMat);
  tR.rotation.y = -Math.PI * 0.22;
  tR.rotation.x = -Math.PI / 2;
  tR.position.set(0.086, -0.006, 0.01);
  g.add(bridge, tL, tR);
  g.userData.omafitContactShadowMat = sharedMat;
  glassesAnatomy.add(g);
  return g;
}

function omafitDisposeGlassesContactRig(rig) {
  if (!rig) return;
  const seenMat = new Set();
  try {
    rig.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry?.dispose?.();
    });
    rig.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      if (!m || seenMat.has(m)) return;
      seenMat.add(m);
      if (m.map?.dispose) m.map.dispose();
      m.dispose?.();
    });
    rig.parent?.remove(rig);
  } catch {
    /* ignore */
  }
}

/**
 * Micro-UX: grava opacidade / transparent base por material (idempotente).
 * @param {import("three").Object3D} root
 */
function omafitStoreMaterialOpacityBaseline(root) {
  if (!root?.traverse) return;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (let mi = 0; mi < mats.length; mi++) {
      const m = mats[mi];
      if (!m || typeof m !== "object" || m.userData?.omafitOpacityBaseStored) continue;
      m.userData.omafitOpacityBaseStored = true;
      m.userData.omafitOpacityBase = typeof m.opacity === "number" ? m.opacity : 1;
      m.userData.omafitTransparentBase = m.transparent === true;
    }
  });
}

/**
 * @param {import("three").Object3D} root
 * @param {number} factor 0–1 multiplica a opacidade base
 */
function omafitApplyModelOpacityFactor(root, factor) {
  if (!root?.traverse) return;
  const f = Math.max(0, Math.min(1, Number(factor) || 0));
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (let mi = 0; mi < mats.length; mi++) {
      const m = mats[mi];
      if (!m || typeof m !== "object") continue;
      if (!m.userData) m.userData = {};
      if (!m.userData.omafitOpacityBaseStored) {
        m.userData.omafitOpacityBaseStored = true;
        m.userData.omafitOpacityBase = typeof m.opacity === "number" ? m.opacity : 1;
        m.userData.omafitTransparentBase = m.transparent === true;
      }
      const base = Number(m.userData.omafitOpacityBase);
      const b = Number.isFinite(base) ? base : 1;
      const op = b * f;
      if (op < 0.998) {
        m.transparent = true;
        m.opacity = op;
      } else {
        m.opacity = b;
        m.transparent = !!m.userData.omafitTransparentBase;
      }
    }
  });
}

/** Repõe materiais ao estado gravado em `omafitStoreMaterialOpacityBaseline`. */
function omafitRestoreModelOpacityBaseline(root) {
  if (!root?.traverse) return;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (let mi = 0; mi < mats.length; mi++) {
      const m = mats[mi];
      if (!m || !m.userData?.omafitOpacityBaseStored) continue;
      const base = Number(m.userData.omafitOpacityBase);
      m.opacity = Number.isFinite(base) ? base : 1;
      m.transparent = !!m.userData.omafitTransparentBase;
    }
  });
}

/**
 * Lista materiais únicos de um root para updates por frame.
 * @param {import("three").Object3D | null | undefined} root
 * @returns {any[]}
 */
function omafitCollectUniqueMaterials(root) {
  if (!root?.traverse) return [];
  const out = [];
  const seen = new Set();
  root.traverse((o) => {
    if (!o?.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (let i = 0; i < mats.length; i++) {
      const m = mats[i];
      if (!m || typeof m !== "object" || seen.has(m)) continue;
      seen.add(m);
      out.push(m);
    }
  });
  return out;
}

/**
 * Entrada suave (escala + opacidade) + decaimento de `snapBoost` no grupo wrap.
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D | null} wrap
 * @param {import("three").Object3D | null} opacityRoot
 * @param {{ introStartMs?: number, snapBoost?: number, introComplete?: boolean }} state
 * @param {number} nowMs
 * @param {{ introMs?: number, scaleFrom?: number }} [opts]
 */
function omafitStepMicroUxIntro(THREE, wrap, opacityRoot, state, nowMs, opts) {
  if (!THREE || !wrap || !state) return;
  const introMs = Math.max(120, Number(opts?.introMs) || 520);
  const scaleFrom = Number.isFinite(Number(opts?.scaleFrom)) ? Number(opts.scaleFrom) : 0.88;
  if (!(typeof state.introStartMs === "number") || !Number.isFinite(state.introStartMs)) {
    state.introStartMs = nowMs;
  }
  const u = THREE.MathUtils.clamp((nowMs - state.introStartMs) / introMs, 0, 1);
  const ease = 1 - (1 - u) ** 3;
  let snap = typeof state.snapBoost === "number" ? state.snapBoost : 1;
  if (snap > 1.0004) {
    snap = THREE.MathUtils.lerp(snap, 1, 0.17);
    state.snapBoost = snap;
  } else {
    state.snapBoost = 1;
  }
  const scaleCore = THREE.MathUtils.lerp(scaleFrom, 1, ease);
  wrap.scale.setScalar(scaleCore * snap);
  if (opacityRoot && state.preparedOpacity) {
    const op = THREE.MathUtils.clamp(u * 1.12, 0, 1);
    omafitApplyModelOpacityFactor(opacityRoot, op);
    if (u >= 1 && !state.introComplete) {
      state.introComplete = true;
      omafitRestoreModelOpacityBaseline(opacityRoot);
    }
  } else if (u >= 1 && !state.introComplete) {
    state.introComplete = true;
  }
}

/**
 * Escurecimento local tipo “cavity AO” em `MeshStandardMaterial` / físico
 * (sem RenderPass — Web mobile). Patch idempotente via `userData`.
 */
function omafitPatchGlassesMaterialsLocalCavityAo(THREE, root, intensity) {
  if (!THREE || !root || !(intensity > 0)) return;
  /** Só varyings do fragmento: `position` não existe aqui (só no vertex). Usamos `vViewPosition` (Three.js). */
  const inj = `float omafitNdV=abs(dot(normalize(normal),normalize(-vViewPosition)));
float omafitCav=smoothstep(0.22,0.94,1.0-omafitNdV);
float omafitTmp=(1.0-smoothstep(0.05,0.14,abs(vViewPosition.x)))*smoothstep(-0.02,0.06,vViewPosition.z);
diffuseColor.rgb*=mix(1.0,${1 - intensity},0.55*omafitCav+0.35*omafitTmp);`;
  root.traverse((ch) => {
    if (!ch.isMesh) return;
    const mats = Array.isArray(ch.material) ? ch.material : [ch.material];
    for (const mat of mats) {
      if (!mat || mat.userData?.omafitCavityPatched) continue;
      if (!("roughness" in mat) || typeof mat.onBeforeCompile !== "function") continue;
      mat.userData = mat.userData || {};
      mat.userData.omafitCavityPatched = true;
      const prevCav = mat.onBeforeCompile;
      mat.onBeforeCompile = function omafitCavityOnBeforeCompile(shader, renderer) {
        if (typeof prevCav === "function") prevCav.call(this, shader, renderer);
        if (shader.fragmentShader.includes("omafitNdV")) return;
        const needle = "#include <output_fragment>";
        if (shader.fragmentShader.includes(needle)) {
          shader.fragmentShader = shader.fragmentShader.replace(needle, `${inj}\n${needle}`);
        }
      };
      mat.needsUpdate = true;
    }
  });
}

/**
 * Canvas minúsculo para amostrar o feed de vídeo (luminância + cor) sem custo alto.
 * @param {number} w
 * @param {number} h
 */
function omafitCreateFaceAmbientProbe(w, h) {
  const canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
  if (!canvas) return { canvas: null, ctx: null, w: 0, h: 0 };
  const ww = Math.max(8, Math.min(96, Math.floor(w)));
  const hh = Math.max(8, Math.min(96, Math.floor(h)));
  canvas.width = ww;
  canvas.height = hh;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return { canvas, ctx, w: ww, h: hh };
}

/**
 * Ajusta luzes da cena face + exposição do renderer a partir do vídeo (AR “colado” ao mundo).
 * @param {typeof import("three")} THREE
 * @param {object} al estado `faceAdaptiveLight`
 * @param {HTMLElement | null} mindarHost
 * @param {import("three").WebGLRenderer | null} renderer
 */
function omafitStepFaceAdaptiveLighting(THREE, al, mindarHost, renderer) {
  if (!THREE || !al || !mindarHost) return;
  const nowMs = performance.now();
  if (al.lastMs > 0 && nowMs - al.lastMs < al.intervalMs) return;
  al.lastMs = nowMs;
  const vid = mindarHost.querySelector?.("video");
  if (!vid || vid.readyState < 2) return;
  const { ctx, w, h } = al.probe;
  if (!ctx || w < 4 || h < 4) return;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  try {
    ctx.drawImage(vid, 0, 0, w, h);
    const im = ctx.getImageData(0, 0, w, h);
    const d = im.data;
    for (let i = 0; i < d.length; i += 4) {
      sr += d[i];
      sg += d[i + 1];
      sb += d[i + 2];
    }
    const np = d.length / 4;
    sr /= np;
    sg /= np;
    sb /= np;
  } catch {
    return;
  }
  const y = THREE.MathUtils.clamp((0.299 * sr + 0.587 * sg + 0.114 * sb) / 255, 0, 1);
  const denom = Math.max(1e-3, sr + sg + sb);
  const warmth = THREE.MathUtils.clamp((sr - sb) / denom, -0.55, 0.55);
  const wb = al.warmBias;
  const k = 0.24;
  const ambTarget = THREE.MathUtils.lerp(0.24, 0.98, THREE.MathUtils.smoothstep(y, 0.07, 0.84));
  al.ambient.intensity += (ambTarget - al.ambient.intensity) * k;
  if (!al._skyA) al._skyA = new THREE.Color(0xb8daf8);
  if (!al._skyB) al._skyB = new THREE.Color(0xffead8);
  if (!al._gndA) al._gndA = new THREE.Color(0xa09078);
  if (!al._scratchSky) al._scratchSky = new THREE.Color();
  if (!al._scratchGnd) al._scratchGnd = new THREE.Color();
  const warmT = THREE.MathUtils.clamp(0.5 + warmth * wb, 0, 1);
  al._scratchSky.lerpColors(al._skyA, al._skyB, warmT);
  const dark = THREE.MathUtils.lerp(1, 0.52, THREE.MathUtils.smoothstep(y, 0.12, 0.92));
  al._scratchGnd.copy(al._skyB).lerp(al._gndA, 0.42).multiplyScalar(dark);
  al.hemi.color.lerp(al._scratchSky, k);
  al.hemi.groundColor.lerp(al._scratchGnd, k);
  const hemiI = al.accessoryNecklace
    ? THREE.MathUtils.lerp(0.34, 0.64, y)
    : THREE.MathUtils.lerp(0.3, 0.58, y);
  al.hemi.intensity += (hemiI - al.hemi.intensity) * k;
  if (al.key) {
    const keyI = THREE.MathUtils.lerp(0.1, 0.64, Math.pow(y, 0.84));
    al.key.intensity += (keyI - al.key.intensity) * k;
    if (!al._keyTint) al._keyTint = new THREE.Color();
    al._keyTint.setRGB(
      THREE.MathUtils.clamp(sr / 255, 0.75, 1),
      THREE.MathUtils.clamp(sg / 255, 0.78, 1),
      THREE.MathUtils.clamp(sb / 255, 0.72, 1),
    );
    al.key.color.lerp(al._keyTint, k * 0.55);
  }
  if (renderer && typeof renderer.toneMappingExposure === "number") {
    const expT = THREE.MathUtils.lerp(0.86, 1.24, y);
    renderer.toneMappingExposure += (expT - renderer.toneMappingExposure) * (k * 0.38);
  }
  const cm = al.contactRig?.userData?.omafitContactShadowMat;
  if (cm && typeof cm.opacity === "number") {
    const opT = THREE.MathUtils.lerp(0.3, 0.6, y);
    cm.opacity += (opT - cm.opacity) * k;
  }
}

/**
 * Garante resposta PBR coerente (tone map + materiais) após PMREM ou em cena só com luzes.
 * @param {typeof import("three")} THREE
 * @param {import("three").Object3D} root
 */
function omafitEnhanceFaceGlbPbrResponse(THREE, root) {
  if (!THREE || !root?.traverse) return;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m || m.userData?.omafitPbrRespTuned) continue;
      if (m.isMeshStandardMaterial !== true && m.isMeshPhysicalMaterial !== true) continue;
      m.userData = m.userData || {};
      m.userData.omafitPbrRespTuned = true;
      m.toneMapped = true;
      if ("envMapIntensity" in m && m.envMap && !(Number(m.envMapIntensity) > 0)) {
        m.envMapIntensity = 0.85;
      }
      if ("aoMapIntensity" in m && m.aoMap && Number(m.aoMapIntensity) === 0) {
        m.aoMapIntensity = 1;
      }
      m.needsUpdate = true;
    }
  });
}

/** Hastes / braços laterais do GLB (não lentes nem aro frontal). */
function omafitIsGlassesTempleHairMeshName(name) {
  const s = String(name || "").toLowerCase();
  if (!s) return false;
  if (/\b(lens|lentes|glass|vidro|cristal|crystal|shield|visor|rim_front|frame_front|lente)\b/i.test(s)) {
    return false;
  }
  return (
    /\b(temple|haste|shaft|stem|temporal|orelha|bra[cç]o|arm)\b/i.test(s) ||
    /temple|haste|shaft|stem|perna|side[_-]?arm/i.test(s)
  );
}

/**
 * Descarta fragmentos da haste onde a máscara de cabelo (multiclasse) é forte — alinha com Selfie Segmentation.
 * Uniforms partilhados: uOmafitHairMask, uOmafitHairMirror (flip UV vídeo↔NDC), uOmafitHairThreshold.
 */
function installGlassesTempleHairMaskOnMaterial(THREE, material, hairUniforms) {
  if (!material || !hairUniforms || material.userData?.omafitHairClipInstalled) return;
  material.userData = material.userData || {};
  material.userData.omafitHairClipInstalled = true;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = function onBeforeCompileHair(shader, renderer) {
    if (typeof prev === "function") prev.call(this, shader, renderer);
    shader.uniforms.uOmafitHairMask = hairUniforms.uOmafitHairMask;
    shader.uniforms.uOmafitHairMirror = hairUniforms.uOmafitHairMirror;
    shader.uniforms.uOmafitHairThreshold = hairUniforms.uOmafitHairThreshold;
    const isW2 = renderer?.capabilities?.isWebGL2 === true;
    /** WebGL2 / GLSL3: `texture()`; WebGL1: `texture2D()`. */
    const hairSample = isW2 ? "texture(uOmafitHairMask, uvh).r" : "texture2D(uOmafitHairMask, uvh).r";
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      [
        "varying vec2 vOmafitHairUv;",
        "#include <common>",
      ].join("\n"),
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <project_vertex>",
      [
        "#include <project_vertex>",
        "vec2 ndc = gl_Position.xy / max(abs(gl_Position.w), 1e-5);",
        "vOmafitHairUv = ndc * 0.5 + vec2(0.5);",
        "vOmafitHairUv.y = 1.0 - vOmafitHairUv.y;",
      ].join("\n"),
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <clipping_planes_fragment>",
      [
        "#include <clipping_planes_fragment>",
        "vec2 uvh = vOmafitHairUv;",
        "if (uOmafitHairMirror.x > 0.5) uvh.x = 1.0 - uvh.x;",
        "if (uOmafitHairMirror.y > 0.5) uvh.y = 1.0 - uvh.y;",
        `float __omafitHair = ${hairSample};`,
        "if (__omafitHair > uOmafitHairThreshold) discard;",
      ].join("\n"),
    );
  };
  material.needsUpdate = true;
}

/**
 * Percorre o GLB e instala o clip de cabelo só em meshes de haste (nome).
 */
function installGlassesTempleHairMaskOnGlb(THREE, root, hairUniforms) {
  if (!root || !hairUniforms) return 0;
  let n = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    if (!omafitIsGlassesTempleHairMeshName(o.name)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      installGlassesTempleHairMaskOnMaterial(THREE, m, hairUniforms);
      n += 1;
    }
  });
  return n;
}

/**
 * Metais (Tripo / PBR): reforça reflexos sob IBL — evita aspecto plástico cinza.
 */
function upgradeHandArMetalMaterials(THREE, root) {
  if (!root || typeof root.traverse !== "function") return;
  const metalName =
    /metal|steel|stainless|inox|gold|silver|chrome|titanium|aluminum|aluminium|brass|rose|pvd|mesh|case|lunette|bezel|coroa|crown|bracelet|strap|link/i;
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const next = mats.map((m) => {
      if (!m) return m;
      const name = String(m.name || "").toLowerCase();
      const glassy =
        /glass|vidro|lens|lente|cristal|crystal|sapphire|display|screen|dial_face/i.test(name) ||
        (m.transmission !== undefined && Number(m.transmission) > 0.05);
      if (glassy) return m;
      const isStd =
        m.isMeshStandardMaterial === true ||
        m.isMeshPhysicalMaterial === true;
      if (!isStd) return m;
      const isMetal =
        metalName.test(name) ||
        (Number(m.metalness) > 0.32 && Number(m.roughness) < 0.58) ||
        Number(m.metalness) > 0.52;
      if (!isMetal) return m;
      const out = m.clone();
      out.metalness = 1;
      out.roughness = Math.min(
        1,
        Math.max(0.08, OMAFIT_METAL_ROUGHNESS_DEFAULT),
      );
      out.envMapIntensity = OMAFIT_METAL_ENV_MAP_INTENSITY;
      out.needsUpdate = true;
      return out;
    });
    obj.material = Array.isArray(obj.material) ? next : next[0];
  });
}

function countHandArSolidMeshes(root) {
  let n = 0;
  if (!root || typeof root.traverse !== "function") return 0;
  root.traverse((o) => {
    if (o.isMesh && o.geometry && !o.isSkinnedMesh) n += 1;
  });
  return n;
}

/**
 * Malha única: pesos por vértice (mostrador rígido no núcleo, correia deformável nas extremidades).
 * Contração no plano ⊥ eixo longitudinal (maior dimensão do bbox).
 */
function initWatchSingleMeshStrapVertexDeformation(THREE, glbScene, fitSize) {
  if (!glbScene || !fitSize) return null;
  let solidCount = 0;
  /** @type {THREE.Mesh | null} */
  let mesh = null;
  glbScene.traverse((o) => {
    if (o.isMesh && o.geometry && !o.isSkinnedMesh) {
      solidCount += 1;
      mesh = o;
    }
  });
  if (solidCount !== 1 || !mesh) return null;
  const geom = mesh.geometry;
  const pos = geom.attributes.position;
  if (!pos) return null;
  geom.computeBoundingBox();
  const n = pos.count;
  const base = new Float32Array(pos.array.length);
  base.set(pos.array);
  const weights = new Float32Array(n);
  const sx = fitSize.x;
  const sy = fitSize.y;
  const sz = fitSize.z;
  const dims = [
    { i: 0, s: sx },
    { i: 1, s: sy },
    { i: 2, s: sz },
  ];
  dims.sort((a, b) => b.s - a.s);
  const iLong = dims[0].i;
  const iMid = dims[1].i;
  const iMin = dims[2].i;
  const halfLong = Math.max(dims[0].s * 0.5, 1e-9);
  const dialCore = Math.min(sx, sy, sz) * 0.32;
  const maxSz = Math.max(sx, sy, sz);
  for (let vi = 0; vi < n; vi++) {
    const j = vi * 3;
    const px = base[j];
    const py = base[j + 1];
    const pz = base[j + 2];
    const p = [px, py, pz];
    const along = Math.abs(p[iLong]);
    const rOther = Math.sqrt(p[iMid] * p[iMid] + p[iMin] * p[iMin]);
    const wAlong = THREE.MathUtils.smoothstep(0.18 * halfLong, 0.7 * halfLong, along);
    const wDial = 1 - THREE.MathUtils.smoothstep(0, dialCore, rOther);
    const wRadial = THREE.MathUtils.smoothstep(
      0.08 * Math.min(sx, sy, sz),
      0.48 * maxSz,
      rOther,
    );
    let w = wAlong * (0.32 + 0.68 * wRadial) * (1 - wDial * 0.9);
    w = THREE.MathUtils.clamp(w, 0, 1);
    weights[vi] = w;
  }
  return {
    mesh,
    basePos: base,
    weights,
    iLong,
    normFrame: 0,
  };
}

function applyWatchSingleMeshStrapVertexDeform(THREE, state, k) {
  if (!state || !state.mesh || !state.basePos || !state.weights) return;
  const pos = state.mesh.geometry.attributes.position;
  const arr = pos.array;
  const base = state.basePos;
  const weights = state.weights;
  const n = weights.length;
  const iLong = state.iLong;
  const kk = Number.isFinite(k) ? k : 1;
  for (let vi = 0; vi < n; vi++) {
    const j = vi * 3;
    const w = weights[vi];
    const f = THREE.MathUtils.lerp(1, kk, w);
    for (let c = 0; c < 3; c++) {
      if (c === iLong) arr[j + c] = base[j + c];
      else arr[j + c] = base[j + c] * f;
    }
  }
}

/**
 * Ouro / prata (Pulseira e-commerce): cores e roughness típicos de joalharia.
 */
function upgradeHandArLuxuryJewelryMaterials(THREE, root) {
  if (!root || typeof root.traverse !== "function") return;
  const goldRe =
    /gold|ouro|amarillo|amarilho|carat|ct\b|k18|18k|14k|yellow\s*gold/i;
  const silverRe =
    /silver|prata|plata|sterling|925|white\s*gold|platina|platinum/i;
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const next = mats.map((m) => {
      if (!m) return m;
      const isStd =
        m.isMeshStandardMaterial === true ||
        m.isMeshPhysicalMaterial === true;
      if (!isStd) return m;
      const name = String(m.name || "").toLowerCase();
      if (/glass|cristal|crystal|gem|pedra|diamond|pearl/i.test(name)) return m;
      let out = null;
      if (goldRe.test(name)) {
        out = m.clone();
        out.color.setHex(0xd4af37);
        out.metalness = 1;
        out.roughness = 0.15;
        out.envMapIntensity = Math.max(
          Number(out.envMapIntensity) || 1,
          OMAFIT_METAL_ENV_MAP_INTENSITY,
        );
      } else if (silverRe.test(name)) {
        out = m.clone();
        out.color.setHex(0xc0c0c0);
        out.metalness = 1;
        out.roughness = 0.1;
        out.envMapIntensity = Math.max(
          Number(out.envMapIntensity) || 1,
          OMAFIT_METAL_ENV_MAP_INTENSITY,
        );
      }
      if (!out) return m;
      out.needsUpdate = true;
      return out;
    });
    obj.material = Array.isArray(obj.material) ? next : next[0];
  });
}

/**
 * Heurística bangle (anel rígido): nome ou bbox quase isotrópico no plano do anel.
 */
function detectBraceletBangle(THREE, glbScene) {
  if (!glbScene || !THREE) return false;
  let named = false;
  glbScene.traverse((o) => {
    const n = String(o.name || "").toLowerCase();
    if (
      /bangle|r[ií]gid|rigid|cuff|sol[ií]d|torus|infinit|closed.?loop|anel\s*r[ií]gid/i.test(
        n,
      )
    ) {
      named = true;
    }
  });
  if (named) return true;
  glbScene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(glbScene);
  const s = new THREE.Vector3();
  box.getSize(s);
  const arr = [s.x, s.y, s.z].sort((a, b) => a - b);
  return arr[2] / Math.max(arr[0], 1e-9) < 1.16;
}

/**
 * Pulseira de elos: grupo radial com pivô; escala (k,1,k) em espaço local pós-fit.
 */
function setupBraceletLinkRadialGroup(THREE, glbScene, _localRingR, debug) {
  const meshes = [];
  glbScene.updateMatrixWorld(true);
  glbScene.traverse((o) => {
    if (o.isMesh && o.geometry && !o.isSkinnedMesh) meshes.push(o);
  });
  if (meshes.length === 0) return null;
  const group = new THREE.Group();
  group.name = "omafit_bracelet_link_radial";
  glbScene.add(group);
  const pivot = new THREE.Vector3();
  for (const m of meshes) {
    const box = new THREE.Box3().setFromObject(m);
    const c = new THREE.Vector3();
    box.getCenter(c);
    glbScene.worldToLocal(c);
    pivot.add(c);
  }
  pivot.multiplyScalar(1 / meshes.length);
  pivot.z = 0;
  group.position.copy(pivot);
  for (const m of meshes) {
    group.attach(m);
  }
  if (debug) {
    console.log("[omafit-ar] bracelet link radial group", { meshes: meshes.length });
  }
  return group;
}

/**
 * Malha única tipo elos: preserva o eixo mais fino (espessura); escala uniforme no anel.
 */
function initBraceletLinkVertexDeformation(THREE, glbScene, fitSize) {
  let solidCount = 0;
  /** @type {THREE.Mesh | null} */
  let mesh = null;
  glbScene.traverse((o) => {
    if (o.isMesh && o.geometry && !o.isSkinnedMesh) {
      solidCount += 1;
      mesh = o;
    }
  });
  if (solidCount !== 1 || !mesh) return null;
  const geom = mesh.geometry;
  const pos = geom.attributes.position;
  if (!pos) return null;
  const base = new Float32Array(pos.array.length);
  base.set(pos.array);
  const sx = fitSize.x;
  const sy = fitSize.y;
  const sz = fitSize.z;
  const dims = [
    { i: 0, s: sx },
    { i: 1, s: sy },
    { i: 2, s: sz },
  ];
  dims.sort((a, b) => a.s - b.s);
  const iThin = dims[0].i;
  const weights = new Float32Array(pos.count);
  weights.fill(1);
  return {
    mesh,
    basePos: base,
    weights,
    /** Eixo a preservar (espessura dos elos) — mesmo slot que iLong em apply. */
    iLong: iThin,
    normFrame: 0,
  };
}

/**
 * Textura radial para contact shadow (alpha 0 centro → 1 bordas).
 */
function createHandArRadialShadowTexture(THREE) {
  const c = typeof document !== "undefined" ? document.createElement("canvas") : null;
  const s = 128;
  if (!c) return null;
  c.width = s;
  c.height = s;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.08, s / 2, s / 2, s * 0.52);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(0.55, "rgba(0,0,0,0.12)");
  g.addColorStop(1, "rgba(0,0,0,0.38)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Cilindro oclusor: escreve depth com transição suave nas tampas (eixo local Y),
 * para não haver corte abrupto onde o braço real encontra a geometria.
 * Mantém colorWrite off; `uHalfLen` = metade do comprimento geométrico do CylinderGeometry.
 */
function createHandArArmOccluderDepthMaterial(THREE, halfLenM, softBandM) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uHalfLen: { value: halfLenM },
      uSoftBand: { value: softBandM },
    },
    vertexShader: `
      varying vec3 vLocalPos;
      void main() {
        vLocalPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vLocalPos;
      uniform float uHalfLen;
      uniform float uSoftBand;
      void main() {
        float wBottom = smoothstep(0.0, uSoftBand, vLocalPos.y + uHalfLen);
        float wTop = smoothstep(0.0, uSoftBand, uHalfLen - vLocalPos.y);
        float capW = min(wBottom, wTop);
        gl_FragColor = vec4(0.0);
        gl_FragDepth = mix(1.0, gl_FragCoord.z, capW);
      }
    `,
    colorWrite: false,
    depthWrite: true,
    depthTest: true,
    side: THREE.DoubleSide,
    transparent: false,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  });
}

function setHandArMeshRenderOrder(root, order) {
  if (!root || typeof root.traverse !== "function") return;
  root.traverse((o) => {
    if (o.isMesh) o.renderOrder = order;
  });
}

/**
 * === ISOLAMENTO BIOMÉTRICO RELÓGIO: PULSEIRA vs MOSTRADOR (v11.7) ===
 *
 * Relógio é composto por dois blocos distintos:
 *   1. Pulseira (strap/band/lug/buckle): contrai/expande em X e Z para
 *      abraçar o pulso real (espessura Y = 1.0 preservada).
 *   2. Mostrador / Case / Dial / Crystal / Crown: DEVE manter escala 1.0
 *      em XYZ em metros-mundo. O utilizador percebe o mostrador a encolher
 *      como "brinquedo" num pulso fino — corrigimos isolando-o num grupo
 *      com pivô no EIXO do braço (0,0,0 após fit centering) e aplicando
 *      `1/adaptMul` para cancelar a contração adaptativa global.
 *
 * Pivô do caseDial em (0,0,0):
 *   Com `caseDial.scale = 1/adaptMul` e `glbRoot.scale = su × adaptMul`,
 *   a multiplicação dá size_world = mesh_local × 1/adaptMul × adaptMul × su
 *                                 = mesh_local × su
 *   Para POSIÇÃO: mesh_pos_world = (mesh_local_pos × 1/adaptMul) × (su × adaptMul)
 *                                = mesh_local_pos × su
 *   → Mostrador em METROS-MUNDO é invariante a adaptMul (tamanho E posição
 *   ficam iguais ao design original). Aceita-se pequeno gap visual em pulsos
 *   finos em troca da preservação do mostrador — exactamente o spec.
 *
 * Pivô da pulseira em (centro da correia, z=0): contração radial uniforme
 * "de fora para dentro", preservando centro de massa visual.
 *
 * Devolve `{ strap, caseDial, strapCount, caseCount }`. Qualquer grupo pode
 * ser `null` (GLB sem meshes identificáveis por essa heurística).
 */
function setupWatchStrapBiometricGroup(THREE, glbScene, fitSize, localRingR, debug) {
  const caseRe =
    /case|dial|face|glass|bezel|body|crystal|screen|chassis|watch_face|lunette|crown|corona|button|pusher|sensor|digital|display|hands?|pointer/i;
  const strapRe =
    /strap|band|bracelet|correia|link|lug|fivela|buckle|mesh|steel|silicone|rubber|leather|loop|milanese|bracelete/i;
  const ringR = Math.max(Number(localRingR) || 0, 1e-6);
  const maxSz = Math.max(fitSize.x, fitSize.y, fitSize.z, 1e-9);
  const strapMeshes = [];
  const caseMeshes = [];
  glbScene.updateMatrixWorld(true);
  glbScene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const nm = String(o.name || "").toLowerCase();
    if (strapRe.test(nm) && !caseRe.test(nm)) {
      strapMeshes.push(o);
      return;
    }
    if (caseRe.test(nm) && !strapRe.test(nm)) {
      caseMeshes.push(o);
      return;
    }
    const box = new THREE.Box3().setFromObject(o);
    const c = new THREE.Vector3();
    box.getCenter(c);
    glbScene.worldToLocal(c);
    const radial = Math.hypot(c.x, c.y);
    const lateralX = Math.abs(c.x);
    /** Heurística geométrica para GLBs sem naming explícito.
     *  Regra conservadora (não quebrar comportamento anterior):
     *    • Mesh longe do eixo (≥ 66% ringR) OU muito lateral (> 11% bbox): PULSEIRA.
     *    • Demais meshes NÃO classificadas ficam sem grupo (atribuídas à cena
     *      geral, continuam a receber apenas `adaptMul` global). Só metemos
     *      um mesh no `caseGroup` quando o nome o identifica claramente —
     *      evitar falsos positivos (ex. uma "lug" sem nome a ser tratada
     *      como mostrador faria a lug crescer em pulsos finos). */
    if (radial >= ringR * 0.66 || lateralX > maxSz * 0.11) {
      strapMeshes.push(o);
    }
  });
  if (strapMeshes.length === 0 && caseMeshes.length === 0) {
    if (debug) {
      console.debug(
        "[omafit-ar] watch biometric: sem meshes (heurística+nomes).",
      );
    }
    return null;
  }
  let strapGroup = null;
  if (strapMeshes.length > 0) {
    const pivot = new THREE.Vector3();
    for (const m of strapMeshes) {
      const box = new THREE.Box3().setFromObject(m);
      const c = new THREE.Vector3();
      box.getCenter(c);
      glbScene.worldToLocal(c);
      pivot.add(c);
    }
    pivot.multiplyScalar(1 / strapMeshes.length);
    /** Pivô no plano perpendicular ao eixo do braço (+Z): centro médio da correia, z→0. */
    pivot.z = 0;
    strapGroup = new THREE.Group();
    strapGroup.name = "omafit_strap_biometric_radial";
    strapGroup.position.copy(pivot);
    glbScene.add(strapGroup);
    for (const m of strapMeshes) {
      strapGroup.attach(m);
    }
  }
  let caseGroup = null;
  if (caseMeshes.length > 0) {
    caseGroup = new THREE.Group();
    caseGroup.name = "omafit_case_dial_rigid";
    /** Pivô no eixo do braço (0,0,0 após fit centering). Mantém mostrador
     *  invariante a adaptMul: size E position em metros-mundo ficam iguais
     *  ao design original quando caseGroup.scale = 1/adaptMul. */
    caseGroup.position.set(0, 0, 0);
    glbScene.add(caseGroup);
    for (const m of caseMeshes) {
      caseGroup.attach(m);
    }
  }
  if (debug) {
    console.log("[omafit-ar] watch biometric groups", {
      strapMeshCount: strapMeshes.length,
      caseMeshCount: caseMeshes.length,
      ringR_mm: (ringR * 1000).toFixed(1),
    });
  }
  return {
    strap: strapGroup,
    caseDial: caseGroup,
    strapCount: strapMeshes.length,
    caseCount: caseMeshes.length,
  };
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
    title: "Olá, sou o assistente inteligente da {storeName}!",
    desc: "Veja como estes óculos ficam no seu rosto em tempo real, usando a câmera do seu dispositivo. Posicione o rosto de frente para a tela — o modelo 3D dos óculos acompanha o seu movimento. Os dados não são gravados nos nossos servidores.",
    howTitle: "Como funciona",
    howBody:
      "Na próxima etapa, toque em «Começar experiência» e autorize a câmera quando o navegador pedir.",
    cta: "Começar experiência",
    privacy: "Ao continuar, você concorda em usar a câmera apenas localmente no seu navegador para visualização.",
    close: "Fechar",
    linkTextFallback: "Experimentar óculos (AR)",
    arLoading: "A iniciar câmera e modelo 3D…",
    errCamera: "Permita o uso da câmera para o provador AR.",
    errCameraEmbed:
      "A câmara está bloqueada neste iframe (política do browser, preview do tema Shopify ou extensão). Teste na loja publicada (não no editor), actualize o tema Omafit ou use o telemóvel.",
    errFace: "Não foi possível carregar a detecção facial.",
    errGlb: "Não foi possível carregar o modelo 3D (GLB). Verifique se o ficheiro está público e acessível.",
    errGeneric: "AR indisponível neste dispositivo.",
    errHttps: "Abre a loja em HTTPS (ou localhost). Sem contexto seguro o browser não pede a câmera.",
    errMediaDevices: "Este browser não expõe a câmera aqui. Experimenta Chrome/Edge actualizado ou outro perfil.",
    arOpenNewWindowCta: "Abrir AR numa nova janela (recomendado no desktop)",
    arPopupBlocked:
      "O navegador bloqueou a janela nova. Permita pop-ups para o domínio do widget (ex.: omafit.netlify.app) e tente de novo.",
    arWindowModeBanner:
      "Janela dedicada ao AR: use «Começar experiência» e autorize a câmara quando o browser pedir.",
    addToCart: "Adicionar ao carrinho",
    addedToCart: "Adicionado!",
    addToCartError: "Erro ao adicionar",
    loadingModel: "Carregando modelo…",
    byType: {
      glasses: {},
      necklace: {
        desc: "Veja como este colar fica no seu pescoço em tempo real, usando a câmera do seu dispositivo. Deixe o rosto e a parte superior do peito visíveis na tela — o colar 3D acompanha o seu pescoço. Os dados não são gravados nos nossos servidores.",
        howBody:
          "Na próxima etapa, toque em «Começar experiência» e autorize a câmera quando o navegador pedir.",
        linkTextFallback: "Experimentar colar (AR)",
        arLoading: "A iniciar câmera e modelo 3D do colar…",
        errFace: "Não foi possível carregar a detecção do rosto/pescoço.",
      },
      watch: {
        desc: "Veja como este relógio fica no seu pulso em tempo real, usando a câmera traseira do seu celular. Mantenha a mão aberta ao centro da tela, com o pulso bem visível — o relógio 3D se encaixa no pulso. Os dados não são gravados nos nossos servidores.",
        howBody:
          "Na próxima etapa, toque em «Começar experiência» e autorize a câmera traseira quando o navegador pedir.",
        linkTextFallback: "Experimentar relógio (AR)",
        arLoading: "A iniciar câmera e modelo 3D do relógio…",
        errCamera: "Permita o uso da câmera traseira para experimentar o relógio.",
        errFace: "Não foi possível carregar a detecção da mão.",
      },
      bracelet: {
        desc: "Veja como esta pulseira fica no seu pulso em tempo real, usando a câmera traseira do seu celular. Mantenha a mão aberta ao centro da tela, com o pulso bem visível — a pulseira 3D se encaixa no pulso. Os dados não são gravados nos nossos servidores.",
        howBody:
          "Na próxima etapa, toque em «Começar experiência» e autorize a câmera traseira quando o navegador pedir.",
        linkTextFallback: "Experimentar pulseira (AR)",
        arLoading: "A iniciar câmera e modelo 3D da pulseira…",
        errCamera: "Permita o uso da câmera traseira para experimentar a pulseira.",
        errFace: "Não foi possível carregar a detecção da mão.",
      },
    },
  },
  en: {
    title: "Hello, I'm the intelligent assistant for {storeName}!",
    desc: "See how these glasses look on your face in real time using your device camera. Face the screen — the 3D glasses model tracks your movement. Your data is not stored on our servers.",
    howTitle: "How it works",
    howBody:
      'Next, tap “Start experience” and allow camera access when your browser asks.',
    cta: "Start experience",
    privacy: "By continuing, you agree to use the camera locally in your browser for preview only.",
    close: "Close",
    linkTextFallback: "Try glasses on (AR)",
    arLoading: "Starting camera and 3D model…",
    errCamera: "Allow camera access for AR try-on.",
    errCameraEmbed:
      "Camera is blocked in this iframe (browser policy, Shopify theme preview, or an extension). Try the live storefront (not the editor), update the Omafit theme, or use a phone.",
    errFace: "Could not load face detection.",
    errGlb: "Could not load the 3D model (GLB). Check that the file is public and reachable.",
    errGeneric: "AR unavailable on this device.",
    errHttps: "Open the store over HTTPS (or localhost). Without a secure context the browser won't prompt for the camera.",
    errMediaDevices: "This browser doesn't expose the camera here. Try an updated Chrome/Edge or another profile.",
    arOpenNewWindowCta: "Open AR in a new window (recommended on desktop)",
    arPopupBlocked:
      "The browser blocked the new window. Allow pop-ups for the widget domain (e.g. omafit.netlify.app) and try again.",
    arWindowModeBanner:
      "Dedicated AR window: tap “Start experience” and allow the camera when the browser asks.",
    addToCart: "Add to cart",
    addedToCart: "Added!",
    addToCartError: "Error adding",
    loadingModel: "Loading model…",
    byType: {
      glasses: {},
      necklace: {
        desc: "See how this necklace looks on your neck in real time using your device camera. Keep your face and upper chest visible on screen — the 3D necklace follows your neck. Your data is not stored on our servers.",
        howBody:
          'Next, tap “Start experience” and allow camera access when your browser asks.',
        linkTextFallback: "Try necklace on (AR)",
        arLoading: "Starting camera and 3D necklace…",
        errFace: "Could not load face/neck detection.",
      },
      watch: {
        desc: "See how this watch looks on your wrist in real time using your phone's rear camera. Keep your open hand centered on screen with your wrist clearly visible — the 3D watch fits on your wrist. Your data is not stored on our servers.",
        howBody:
          'Next, tap “Start experience” and allow rear-camera access when your browser asks.',
        linkTextFallback: "Try watch on (AR)",
        arLoading: "Starting rear camera and 3D watch…",
        errCamera: "Allow rear-camera access to try the watch on.",
        errFace: "Could not load hand detection.",
      },
      bracelet: {
        desc: "See how this bracelet looks on your wrist in real time using your phone's rear camera. Keep your open hand centered on screen with your wrist clearly visible — the 3D bracelet fits on your wrist. Your data is not stored on our servers.",
        howBody:
          'Next, tap “Start experience” and allow rear-camera access when your browser asks.',
        linkTextFallback: "Try bracelet on (AR)",
        arLoading: "Starting rear camera and 3D bracelet…",
        errCamera: "Allow rear-camera access to try the bracelet on.",
        errFace: "Could not load hand detection.",
      },
    },
  },
  es: {
    title: "¡Hola, soy el asistente inteligente de {storeName}!",
    desc: "Mira cómo quedan estas gafas en tu rostro en tiempo real con la cámara de tu dispositivo. Sitúa el rostro de frente a la pantalla: el modelo 3D de las gafas sigue tu movimiento. Los datos no se guardan en nuestros servidores.",
    howTitle: "Cómo funciona",
    howBody:
      "En el siguiente paso, pulsa «Empezar experiencia» y permite el acceso a la cámara cuando el navegador lo pida.",
    cta: "Empezar experiencia",
    privacy: "Al continuar, aceptas usar la cámara solo en tu navegador para la vista previa.",
    close: "Cerrar",
    linkTextFallback: "Probar gafas (AR)",
    arLoading: "Iniciando cámara y modelo 3D…",
    errCamera: "Permite el acceso a la cámara para el probador AR.",
    errCameraEmbed:
      "La cámara está bloqueada en este iframe (política del navegador, vista previa del tema Shopify o extensión). Prueba en la tienda publicada (no en el editor), actualiza el tema Omafit o usa el móvil.",
    errFace: "No se pudo cargar la detección facial.",
    errGlb: "No se pudo cargar el modelo 3D (GLB). Comprueba que el archivo sea público y accesible.",
    errGeneric: "AR no disponible en este dispositivo.",
    errHttps: "Abre la tienda en HTTPS (o localhost). Sin contexto seguro el navegador no pedirá la cámara.",
    errMediaDevices: "Este navegador no expone la cámara aquí. Prueba Chrome/Edge actualizado u otro perfil.",
    arOpenNewWindowCta: "Abrir AR en una ventana nueva (recomendado en escritorio)",
    arPopupBlocked:
      "El navegador bloqueó la ventana emergente. Permita ventanas emergentes para el dominio del widget (p. ej. omafit.netlify.app) e inténtelo de nuevo.",
    arWindowModeBanner:
      "Ventana dedicada al AR: pulse «Empezar experiencia» y permita la cámara cuando el navegador lo pida.",
    addToCart: "Añadir al carrito",
    addedToCart: "¡Añadido!",
    addToCartError: "Error al añadir",
    loadingModel: "Cargando modelo…",
    byType: {
      glasses: {},
      necklace: {
        desc: "Mira cómo queda este collar en tu cuello en tiempo real con la cámara de tu dispositivo. Mantén el rostro y la parte superior del pecho visibles en pantalla: el collar 3D sigue tu cuello. Los datos no se guardan en nuestros servidores.",
        howBody:
          "En el siguiente paso, pulsa «Empezar experiencia» y permite el acceso a la cámara cuando el navegador lo pida.",
        linkTextFallback: "Probar collar (AR)",
        arLoading: "Iniciando cámara y modelo 3D del collar…",
        errFace: "No se pudo cargar la detección del rostro/cuello.",
      },
      watch: {
        desc: "Mira cómo queda este reloj en tu muñeca en tiempo real con la cámara trasera del móvil. Mantén la mano abierta en el centro de la pantalla, con la muñeca bien visible: el reloj 3D encaja en la muñeca. Los datos no se guardan en nuestros servidores.",
        howBody:
          "En el siguiente paso, pulsa «Empezar experiencia» y permite el acceso a la cámara trasera cuando el navegador lo pida.",
        linkTextFallback: "Probar reloj (AR)",
        arLoading: "Iniciando cámara trasera y reloj 3D…",
        errCamera: "Permite el acceso a la cámara trasera para probar el reloj.",
        errFace: "No se pudo cargar la detección de la mano.",
      },
      bracelet: {
        desc: "Mira cómo queda esta pulsera en tu muñeca en tiempo real con la cámara trasera del móvil. Mantén la mano abierta en el centro de la pantalla, con la muñeca bien visible: la pulsera 3D encaja en la muñeca. Los datos no se guardan en nuestros servidores.",
        howBody:
          "En el siguiente paso, pulsa «Empezar experiencia» y permite el acceso a la cámara trasera cuando el navegador lo pida.",
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

function omafitResolveStoreNameForTitle(shopName, locale) {
  const n = String(shopName || "").trim();
  if (n) return n;
  const base = String(locale || "pt").toLowerCase().split("-")[0];
  if (base === "en") return "our store";
  if (base === "es") return "nuestra tienda";
  return "nossa loja";
}

function omafitFormatWelcomeTitle(template, shopName, locale) {
  return String(template || "").replace(
    /\{storeName\}/g,
    omafitResolveStoreNameForTitle(shopName, locale),
  );
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

/**
 * Iframe Netlify: branding já está em `#omafit-ar-root` (React) — usar antes dos
 * placeholders de `waitForOmafitWidgetAdminBranding`, alinhado ao fluxo do TryOnWidget.
 */
function readArRootBrandingSnapshot() {
  const r = typeof document !== "undefined" ? document.getElementById("omafit-ar-root") : null;
  if (!r) return null;
  const primary = String(r.dataset?.primaryColor || r.getAttribute("data-primary-color") || "").trim();
  const logo = String(r.dataset?.storeLogo || r.getAttribute("data-store-logo") || "").trim();
  const link = String(r.dataset?.linkText || r.getAttribute("data-link-text") || "").trim();
  if (!primary && !logo && !link) return null;
  return {
    primary: primary || "#810707",
    linkText: link || "Experimentar virtualmente",
    storeLogo: logo || "",
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
    /**
     * Iframe Netlify: a URL traz `arGlbUrl` mas pode existir `#omafit-widget-root`
     * vazio (outro script, extensão, ou versão antiga). Sem este atalho o RAF
     * espera `maxMs` e o ecrã fica em branco durante esse intervalo.
     * (Duplicado de `hasArGlbUrlQueryParam` — essa função está declarada mais abaixo no ficheiro.)
     */
    let arGlbFromQuery = false;
    try {
      const q = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
      const v = q.get("arGlbUrl") || q.get("ar_glb_url");
      arGlbFromQuery = Boolean(v && String(v).trim());
    } catch {
      arGlbFromQuery = false;
    }
    if (typeof window !== "undefined" && arGlbFromQuery) {
      const snap = readArRootBrandingSnapshot();
      settle(
        snap || {
          primary: "#810707",
          linkText: "Experimentar virtualmente",
          storeLogo: "",
        },
      );
      return;
    }
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
      const snap = readArRootBrandingSnapshot();
      settle(
        snap || {
          primary: "#810707",
          linkText: "Experimentar virtualmente",
          storeLogo: "",
        },
      );
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

function omafitResolveTryonLayout(root) {
  try {
    const ds = String(
      root?.dataset?.tryonLayout ?? root?.getAttribute?.("data-tryon-layout") ?? "",
    )
      .trim()
      .toLowerCase();
    if (ds === "hero") return "hero";
    if (ds === "sidebar") return "sidebar";
    if (ds === "default" || ds === "classic") return "default";
    const q = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
    const qv = (q.get("tryonLayout") || q.get("tryon_layout") || "").trim().toLowerCase();
    if (qv === "hero") return "hero";
    if (qv === "sidebar") return "sidebar";
  } catch {
    /* ignore */
  }
  return "default";
}

function omafitResolveTryonLayoutBackground(root, fallback) {
  try {
    const fromData = String(
      root?.dataset?.tryonLayoutBackgroundImage ??
        root?.getAttribute?.("data-tryon-layout-background-image") ??
        "",
    ).trim();
    if (fromData) return omafitUpgradeShopifyMediaToHttps(fromData);
    const q = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
    const fromQuery = String(q.get("tryonLayoutBackgroundImage") || q.get("tryon_layout_background_image") || "").trim();
    if (fromQuery) return omafitUpgradeShopifyMediaToHttps(fromQuery);
  } catch {
    /* ignore */
  }
  return omafitUpgradeShopifyMediaToHttps(fallback || "");
}

function omafitResolvePrimaryColor(root, preferred = "") {
  const fromPreferred = String(preferred || "").trim();
  const fromDataset = String(root?.dataset?.primaryColor || "").trim();
  const fromAdminAttr = String(root?.getAttribute?.("data-omafit-admin-primary") || "").trim();
  const fromStyleVar = String(root?.style?.getPropertyValue("--omafit-ar-primary") || "").trim();
  let fromQuery = "";
  try {
    const q = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
    fromQuery = String(
      q.get("primaryColor") ||
        q.get("primary_color") ||
        q.get("primary") ||
        q.get("brandColor") ||
        q.get("brand_color") ||
        "",
    ).trim();
  } catch {
    fromQuery = "";
  }
  /**
   * Prioridade alinhada ao TryOnWidget no iframe: dados explícitos no `#omafit-ar-root`
   * e na query vencem o placeholder `#810707` devolvido por `waitForOmafitWidgetAdminBranding`
   * quando não existe `#omafit-widget-root`.
   */
  const explicit =
    fromDataset || fromAdminAttr || fromStyleVar || fromQuery;
  const chosen = explicit || fromPreferred || "#810707";
  return chosen.replace(/[<>]/g, "").trim() || "#810707";
}

function omafitContrastOnPrimary(hex) {
  const h = String(hex || "").replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (full.length !== 6) return "#ffffff";
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? "#111827" : "#ffffff";
}

function omafitArSidebarStepLabels(lang) {
  const base = String(lang || "pt").toLowerCase().split("-")[0];
  if (base === "es") return { progress: "Progreso", step1: "Bienvenida", step2: "Probador AR" };
  if (base === "en") return { progress: "Progress", step1: "Welcome", step2: "AR try-on" };
  return { progress: "Progresso", step1: "Boas-vindas", step2: "Provador AR" };
}

function injectGlobalStyles(root, primaryOverride, tryonLayout = "default") {
  const old = document.getElementById("omafit-ar-styles");
  if (old) old.remove();

  const rawFont = resolveArFontFamilyStack(root);
  const stack = formatCssFontFamilyStack(rawFont);
  const appliedStack = stack || "'Outfit', system-ui, sans-serif";
  const primary = omafitResolvePrimaryColor(root, primaryOverride);

  const s = document.createElement("style");
  s.id = "omafit-ar-styles";
  s.textContent = `
    @keyframes omafit-ar-fade-in { from { opacity: 0; } to { opacity: 1; } }
    @keyframes omafit-ar-text-enter {
      0% { opacity: 0; transform: translateY(10px); }
      100% { opacity: 1; transform: translateY(0); }
    }
    /* Modal AR está em document.body (fora de #omafit-ar-root) — incluir .omafit-ar-shell como no TryOnWidget. */
    #omafit-ar-root, #omafit-ar-root *,
    .omafit-ar-shell, .omafit-ar-shell * {
      font-family: ${appliedStack} !important;
    }
    .omafit-ar-shell { animation: omafit-ar-fade-in 0.35s ease-out; }
    .omafit-ar-text-enter {
      opacity: 0;
      transform: translateY(10px);
      animation-name: omafit-ar-text-enter;
      animation-duration: 360ms;
      animation-fill-mode: forwards;
      animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
      will-change: opacity, transform;
    }
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
    @keyframes omafit-ar-ring-pulse {
      0% { box-shadow: inset 0 0 0 2px rgba(255,255,255,0.12), 0 0 0 0 rgba(120,220,160,0.35); }
      55% { box-shadow: inset 0 0 0 2px rgba(255,255,255,0.22), 0 0 22px 3px rgba(120,220,160,0.28); }
      100% { box-shadow: inset 0 0 0 2px rgba(255,255,255,0.14), 0 0 0 0 rgba(120,220,160,0); }
    }
    .omafit-ar-track-detect-ring {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 4;
      border-radius: 14px;
      opacity: 0;
      transition: opacity 0.45s ease, box-shadow 0.45s ease;
    }
    .omafit-ar-track-detect-ring--on {
      opacity: 1;
      animation: omafit-ar-ring-pulse 1.85s ease-in-out infinite;
    }
    /* Miniaturas + carrinho: filho de arWrap (fora do overflow do vídeo), acima do WebGL. */
    .omafit-ar-shell .omafit-ar-variant-cart-strip,
    .omafit-ar-variant-cart-strip {
      z-index: 999 !important;
      pointer-events: auto !important;
      background: transparent !important;
      background-image: none !important;
      box-shadow: none !important;
    }
    /* Botão carrinho mais alto e barra mais acima (evita barra gestual / canto inferior). */
    .omafit-ar-shell .omafit-ar-variant-cart-strip .omafit-ar-cart-btn {
      min-height: 52px;
      padding: 16px 20px !important;
      font-size: 1.05rem !important;
    }
    /* Controlo opcional de rotação GLB (só se data-ar-glasses-screen-rot=1). */
    .omafit-ar-shell .omafit-ar-glasses-screen-rot,
    [data-omafit="glasses-screen-rot"] {
      z-index: 50 !important;
      transform: translateZ(0);
      -webkit-transform: translateZ(0);
    }
    /* NAO sobrepor width/height/top/left do video ou canvas do MindAR.    */
    /* A biblioteca calcula em _resize() posicoes em pixels para fazer       */
    /* object-fit: cover manual (top/left negativos para centrar overflow).  */
    /* Se forcarmos width/height:100% no canvas por CSS, o canvas "estica"   */
    /* ao container mas as projecoes 3D continuam calculadas para o aspect   */
    /* do video -> oculos aparecem rodados/offset ("virado pro lado").       */
    ${
      tryonLayout === "sidebar"
        ? `
    .omafit-ar-shell-sidebar-layout { display: flex; flex-direction: row; min-height: 100dvh; }
    .omafit-ar-shell-sidebar-layout .omafit-ar-sbar-desktop-only {
      width: min(288px, 30vw);
      background: ${primary};
      color: ${omafitContrastOnPrimary(primary)};
      display: none;
      flex-direction: column;
      min-height: 0;
      padding: 24px 16px;
      border-right: 1px solid rgba(255,255,255,.14);
      box-sizing: border-box;
    }
    .omafit-ar-shell-sidebar-layout .omafit-ar-sbar-mobile-only {
      display: block;
      background: ${primary};
      color: ${omafitContrastOnPrimary(primary)};
      border-bottom: 1px solid rgba(255,255,255,.14);
    }
    .omafit-ar-shell-sidebar-layout .omafit-ar-sbar-progress-track {
      height: 8px; border-radius: 999px; background: rgba(255,255,255,.24); overflow: hidden;
    }
    .omafit-ar-shell-sidebar-layout .omafit-ar-sbar-progress-fill {
      height: 100%; border-radius: 999px; background: rgba(255,255,255,.88); transition: width .28s ease;
    }
    @media (min-width: 768px) {
      .omafit-ar-shell-sidebar-layout .omafit-ar-sbar-desktop-only { display: flex; }
      .omafit-ar-shell-sidebar-layout .omafit-ar-sbar-mobile-only { display: none; }
    }`
        : ""
    }
    .omafit-ar-shell-hero-layout { position: fixed; }
    .omafit-ar-shell-hero-layout .omafit-ar-hero-bg-root {
      position: absolute; inset: 0; z-index: 0; pointer-events: none; overflow: hidden;
    }
    .omafit-ar-shell-hero-layout .omafit-ar-hero-bg-mobile {
      position: absolute; inset: 0;
      transition: filter .24s ease, transform .24s ease;
    }
    .omafit-ar-shell-hero-layout .omafit-ar-hero-bg-desktop {
      display: none;
      position: absolute; inset: 0;
      transition: filter .24s ease, transform .24s ease;
    }
    .omafit-ar-shell-hero-layout.omafit-ar-hero-blur-on .omafit-ar-hero-bg-mobile,
    .omafit-ar-shell-hero-layout.omafit-ar-hero-blur-on .omafit-ar-hero-bg-desktop {
      filter: blur(4px);
      transform: scale(1.03);
    }
    @media (min-width: 768px) {
      .omafit-ar-shell-hero-layout .omafit-ar-hero-bg-mobile { display: none; }
      .omafit-ar-shell-hero-layout .omafit-ar-hero-bg-desktop { display: block; }
    }
    .omafit-ar-shell-hero-layout .omafit-ar-hero-top-brand {
      position: absolute;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 4;
      pointer-events: none;
      max-width: min(300px, 80vw);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    @media (min-width: 768px) {
      .omafit-ar-shell-hero-layout .omafit-ar-hero-top-brand {
        top: 12px;
        left: 16px;
        transform: none;
        max-width: min(280px, 40vw);
        justify-content: flex-start;
      }
      .omafit-ar-shell-hero-layout .omafit-ar-hero-top-brand img {
        max-height: 48px;
      }
    }
    /* Hero passo info: mobile texto centrado em baixo; desktop à esquerda (paridade TryOnWidget.tsx). */
    .omafit-ar-shell-hero-layout .omafit-ar-hero-info-col {
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      align-items: stretch;
      min-height: 0;
      flex: 1;
      overflow-y: auto;
      box-sizing: border-box;
      padding: 8px 14px max(18px, env(safe-area-inset-bottom, 0px));
    }
    .omafit-ar-shell-hero-layout .omafit-ar-hero-text-stack {
      display: flex;
      flex-direction: column;
      gap: 12px;
      width: 100%;
      max-width: 24rem;
      margin-left: auto;
      margin-right: auto;
      align-items: stretch;
      box-sizing: border-box;
    }
    .omafit-ar-shell-hero-layout .omafit-ar-hero-title-block,
    .omafit-ar-shell-hero-layout .omafit-ar-hero-blue-inner,
    .omafit-ar-shell-hero-layout .omafit-ar-hero-privacy {
      text-align: center;
    }
    @media (min-width: 768px) {
      .omafit-ar-shell-hero-layout .omafit-ar-hero-info-col {
        justify-content: center;
        align-items: flex-start;
        padding: 3.5rem 1rem 1.25rem 1.25rem;
      }
      .omafit-ar-shell-hero-layout .omafit-ar-hero-text-stack {
        max-width: 28rem;
        margin-left: 0;
        margin-right: 0;
        align-items: flex-start;
      }
      .omafit-ar-shell-hero-layout .omafit-ar-hero-title-block,
      .omafit-ar-shell-hero-layout .omafit-ar-hero-blue-inner,
      .omafit-ar-shell-hero-layout .omafit-ar-hero-privacy {
        text-align: left;
      }
    }
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
  } else if (
    rawFont &&
    !hasThemeFontFace &&
    !document.querySelector("link[data-omafit-ar-google-font='1']")
  ) {
    const firstFamily = String(rawFont.split(",")[0] || "")
      .trim()
      .replace(/^["']|["']$/g, "");
    if (
      firstFamily &&
      !/^(serif|sans-serif|cursive|fantasy|monospace|system-ui|inherit|initial|ui-sans-serif|ui-serif)$/i.test(
        firstFamily,
      )
    ) {
      const l = document.createElement("link");
      l.rel = "stylesheet";
      l.setAttribute("data-omafit-ar-google-font", "1");
      l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
        firstFamily.replace(/ /g, "+"),
      )}:wght@300;400;500;600;700&display=swap`;
      document.head.appendChild(l);
    }
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

function omafitAnimateTextEntrance(root) {
  if (!root?.querySelectorAll) return;
  const nodes = root.querySelectorAll("h1, h2, h3, h4, p, li, [data-omafit-text-anim='1']");
  let idx = 0;
  for (const node of nodes) {
    if (!node || node.dataset?.omafitTextAnimated === "1") continue;
    node.dataset.omafitTextAnimated = "1";
    node.classList.add("omafit-ar-text-enter");
    node.style.animationDelay = `${Math.min(idx, 10) * 48}ms`;
    idx += 1;
  }
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

function omafitHeroClampPct(n) {
  return Math.max(0, Math.min(100, n));
}

function omafitHeroContainImageLeftPercent(w, h, iw, ih) {
  if (w <= 0 || h <= 0 || iw <= 0 || ih <= 0) return 58;
  const scale = Math.min(w / iw, h / ih);
  const dispW = iw * scale;
  return omafitHeroClampPct(((w - dispW) / w) * 100);
}

/** Degradê overlay desktop: reforço forte em volta de seam (% da largura) = borda esquerda da imagem em contain + right. */
function omafitHeroDesktopShadeGradient(primaryColor, seam) {
  const p = primaryColor;
  if (seam == null || Number.isNaN(seam)) {
    return `linear-gradient(90deg, ${p} 0%, ${p}f2 42%, ${p}d9 58%, ${p}00 82%, ${p}00 100%)`;
  }
  const s = omafitHeroClampPct(seam);
  let t1 = omafitHeroClampPct(s - 26);
  let t2 = omafitHeroClampPct(s - 16);
  let t3 = omafitHeroClampPct(s - 8);
  let t4 = omafitHeroClampPct(s - 2);
  let t5 = s;
  let t6 = omafitHeroClampPct(s + 4);
  let t7 = omafitHeroClampPct(s + 10);
  let t8 = omafitHeroClampPct(s + 18);
  let t9 = Math.min(100, Math.max(t8 + 0.5, s + 30));
  if (t2 <= t1) t2 = Math.min(100, t1 + 0.35);
  if (t3 <= t2) t3 = Math.min(100, t2 + 0.35);
  if (t4 <= t3) t4 = Math.min(100, t3 + 0.35);
  if (t5 <= t4) t5 = Math.min(100, t4 + 0.35);
  if (t6 <= t5) t6 = Math.min(100, t5 + 0.35);
  if (t7 <= t6) t7 = Math.min(100, t6 + 0.35);
  if (t8 <= t7) t8 = Math.min(100, t7 + 0.35);
  if (t9 <= t8) t9 = Math.min(100, t8 + 0.35);
  return `linear-gradient(90deg, ${p} 0%, ${p} ${t1}%, ${p}fe ${t2}%, ${p}fc ${t3}%, ${p}fa ${t4}%, ${p}f5 ${t5}%, ${p}d5 ${t6}%, ${p}88 ${t7}%, ${p}38 ${t8}%, ${p}00 ${t9}%, ${p}00 100%)`;
}

function omafitHeroDesktopFeatherStyle(featherEl, seam, primaryColor) {
  if (!featherEl) return;
  const p = primaryColor;
  if (seam == null || Number.isNaN(seam)) {
    featherEl.style.display = "none";
    return;
  }
  const s = omafitHeroClampPct(seam);
  featherEl.style.display = "block";
  featherEl.style.position = "absolute";
  featherEl.style.left = `${s}%`;
  featherEl.style.top = "0";
  featherEl.style.bottom = "0";
  featherEl.style.width = "min(2.75rem, 7vw)";
  featherEl.style.transform = "translateX(-50%)";
  featherEl.style.zIndex = "2";
  featherEl.style.pointerEvents = "none";
  featherEl.style.backdropFilter = "blur(10px)";
  featherEl.style.webkitBackdropFilter = "blur(10px)";
  featherEl.style.background = `linear-gradient(90deg, ${p}aa 0%, ${p}55 35%, transparent 100%)`;
  featherEl.style.webkitMaskImage = "linear-gradient(90deg, transparent 0%, #000 16%, #000 84%, transparent 100%)";
  featherEl.style.maskImage = "linear-gradient(90deg, transparent 0%, #000 16%, #000 84%, transparent 100%)";
}

function omafitBindHeroDesktopShadeFromContain(shadeEl, featherEl, measureEl, primaryColor, heroBgSrc) {
  const img = new Image();
  function apply() {
    const w = measureEl.clientWidth;
    const h = measureEl.clientHeight;
    if (w <= 0 || h <= 0) return;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    if (iw <= 0 || ih <= 0) return;
    const seam = omafitHeroContainImageLeftPercent(w, h, iw, ih);
    shadeEl.style.backgroundImage = omafitHeroDesktopShadeGradient(primaryColor, seam);
    omafitHeroDesktopFeatherStyle(featherEl, seam, primaryColor);
  }
  function fallback() {
    shadeEl.style.backgroundImage = omafitHeroDesktopShadeGradient(primaryColor, null);
    omafitHeroDesktopFeatherStyle(featherEl, null, primaryColor);
  }
  img.onload = apply;
  img.onerror = fallback;
  img.src = heroBgSrc;
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => apply()) : null;
  if (measureEl && ro) ro.observe(measureEl);
  requestAnimationFrame(apply);
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
  layout = "default",
  layoutSidebar = false,
  layoutBackgroundImage = "",
  locale = "pt",
}) {
  const productImgHttps = omafitUpgradeShopifyMediaToHttps(productImage);
  const layoutMode = layout === "hero" ? "hero" : layoutSidebar ? "sidebar" : "default";
  const isSidebar = layoutMode === "sidebar";
  const isHero = layoutMode === "hero";
  const heroBg = omafitUpgradeShopifyMediaToHttps(layoutBackgroundImage || productImgHttps);
  const heroBgMobileCss = heroBg
    ? `linear-gradient(180deg, ${primaryColor}00 0%, ${primaryColor}00 18%, ${primaryColor}d9 42%, ${primaryColor}f2 58%, ${primaryColor} 100%), url("${heroBg.replace(/"/g, "%22")}")`
    : `linear-gradient(180deg, ${primaryColor}cc 0%, ${primaryColor} 100%)`;
  const heroBgDesktopSolidGradient = `linear-gradient(90deg, ${primaryColor}cc 0%, ${primaryColor} 100%)`;
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

  const shell = el("div", {
    className:
      layoutMode === "hero"
        ? "omafit-ar-shell omafit-ar-shell-hero-layout"
        : layoutMode === "sidebar"
          ? "omafit-ar-shell omafit-ar-shell-sidebar-layout"
          : "omafit-ar-shell",
  });
  shell.style.cssText = [
    "position: fixed",
    "inset: 0",
    `z-index: ${Z_SHELL}`,
    "background: #fff",
    "display: flex",
    isSidebar || isHero ? "flex-direction: row" : "flex-direction: column",
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
      style: {
        maxHeight: "48px",
        width: "auto",
        maxWidth: "min(200px, 70vw)",
        objectFit: "contain",
      },
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

  let sidebarDesktop = null;
  let sidebarMobile = null;
  if (isSidebar) {
    const L = omafitArSidebarStepLabels(locale);
    const mkCloseSidebarBtn = () => {
      const btn = el(
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
            color: "currentColor",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: "0",
            borderRadius: "8px",
            opacity: "0.92",
          },
        },
        [svgX()],
      );
      btn.setAttribute("data-omafit-ar-close-modal", "1");
      btn.addEventListener("click", onClose);
      btn.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          onClose();
        }
      });
      return btn;
    };
    const mobFill = el("div", { className: "omafit-ar-sbar-progress-fill" });
    mobFill.style.width = "50%";
    const deskFill = el("div", { className: "omafit-ar-sbar-progress-fill" });
    deskFill.style.width = "50%";
    const mobCounter = el("span", { textContent: "1/2", style: { fontSize: "10px", fontWeight: "600" } });
    const mobStep = el("p", {
      style: { margin: "8px 14px 12px", textAlign: "center", fontSize: "11px", fontWeight: "600" },
      textContent: `1. ${L.step1}`,
    });
    const deskCurrent = el("p", {
      style: { marginTop: "14px", fontSize: "12px", opacity: "0.8" },
      textContent: L.step1,
    });
    const mkNav = (n, label) => {
      const item = el("div", {
        style: {
          display: "flex",
          alignItems: "flex-start",
          gap: "8px",
          padding: "10px 12px",
          borderRadius: "10px",
          fontSize: "13px",
          marginBottom: "8px",
        },
      });
      item.appendChild(
        el("span", {
          textContent: String(n),
          style: {
            marginTop: "1px",
            display: "inline-flex",
            width: "20px",
            height: "20px",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "999px",
            border: "1px solid currentColor",
            fontSize: "10px",
            flexShrink: "0",
          },
        }),
      );
      item.appendChild(el("span", { textContent: label, style: { minWidth: "0", flex: "1" } }));
      return item;
    };
    const deskNav1 = mkNav(1, L.step1);
    const deskNav2 = mkNav(2, L.step2);
    const applySidebarStep = (key) => {
      const isAr = key === "ar";
      mobFill.style.width = isAr ? "100%" : "50%";
      deskFill.style.width = isAr ? "100%" : "50%";
      mobCounter.textContent = isAr ? "2/2" : "1/2";
      mobStep.textContent = `${isAr ? 2 : 1}. ${isAr ? L.step2 : L.step1}`;
      deskCurrent.textContent = isAr ? L.step2 : L.step1;
      deskNav1.style.opacity = isAr ? "0.55" : "1";
      deskNav1.style.fontWeight = isAr ? "400" : "600";
      deskNav2.style.opacity = isAr ? "1" : "0.55";
      deskNav2.style.fontWeight = isAr ? "600" : "400";
    };

    sidebarMobile = el("div", { className: "omafit-ar-sbar-mobile-only" });
    const mobTopBar = el("div", {
      style: { display: "flex", justifyContent: "flex-end", alignItems: "center", padding: "8px 10px 0" },
    });
    mobTopBar.appendChild(mkCloseSidebarBtn());
    const mobTop = el("div", { style: { display: "flex", justifyContent: "center", padding: "4px 12px 8px" } });
    if (logoUrl) mobTop.appendChild(el("img", { src: logoUrl, alt: shopName || "", style: { maxHeight: "40px", width: "auto", maxWidth: "70vw", objectFit: "contain" } }));
    else if (shopName) mobTop.appendChild(el("span", { textContent: shopName, style: { fontWeight: "600", fontSize: "14px" } }));
    const mobProg = el("div", { style: { padding: "8px 12px 4px", borderTop: "1px solid rgba(255,255,255,.14)" } });
    const mobProgTop = el("div", { style: { display: "flex", justifyContent: "space-between", marginBottom: "8px" } });
    mobProgTop.appendChild(el("span", { textContent: L.progress, style: { fontSize: "10px", fontWeight: "600", letterSpacing: ".14em", textTransform: "uppercase", opacity: ".86" } }));
    mobProgTop.appendChild(mobCounter);
    mobProg.appendChild(mobProgTop);
    mobProg.appendChild(el("div", { className: "omafit-ar-sbar-progress-track" }, [mobFill]));
    sidebarMobile.appendChild(mobTopBar);
    sidebarMobile.appendChild(mobTop);
    sidebarMobile.appendChild(mobProg);
    sidebarMobile.appendChild(mobStep);

    sidebarDesktop = el("aside", { className: "omafit-ar-sbar-desktop-only" });
    if (logoUrl) sidebarDesktop.appendChild(el("img", { src: logoUrl, alt: shopName || "", style: { maxHeight: "48px", width: "auto", maxWidth: "100%", objectFit: "contain", objectPosition: "left", marginBottom: "16px" } }));
    else if (shopName) sidebarDesktop.appendChild(el("div", { textContent: shopName, style: { fontWeight: "600", marginBottom: "14px", opacity: ".9" } }));
    sidebarDesktop.appendChild(el("p", { textContent: L.progress, style: { margin: "0 0 8px", fontSize: "10px", fontWeight: "600", letterSpacing: ".14em", textTransform: "uppercase", opacity: ".82" } }));
    sidebarDesktop.appendChild(el("div", { className: "omafit-ar-sbar-progress-track" }, [deskFill]));
    sidebarDesktop.appendChild(el("div", { style: { marginTop: "14px", flex: "1", minHeight: "0", overflowY: "auto" } }, [deskNav1, deskNav2]));
    sidebarDesktop.appendChild(deskCurrent);
    shell.__omafitArSidebarApi = { setStep: applySidebarStep };
    applySidebarStep("welcome");
    header.style.display = "none";
  }

  const mainRow = el("div", {
    style: {
      flex: "1",
      display: "flex",
      flexDirection: isSidebar || isHero ? "column" : "row",
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
      maxWidth: isSidebar ? "20rem" : "28rem",
      borderRadius: "16px",
      overflow: "hidden",
      background: "#f3f4f6",
    },
  });
  if (productImgHttps) {
    const pi = el("img", {
      src: productImgHttps,
      alt: productTitle,
      style: { width: "100%", height: "auto", display: "block", objectFit: "contain" },
    });
    imgBox.appendChild(pi);
  }
  colImg.appendChild(imgBox);

  const colContent = el("div", {
    className: isHero ? "omafit-ar-hero-info-col" : "",
    style: isHero
      ? {}
      : {
          flex: "1",
          overflowY: "auto",
          boxSizing: "border-box",
          padding: isSidebar ? "8px 14px 12px" : "12px 16px 24px",
        },
  });

  const mobileImgWrap = el("div", {
    style: {
      display: "block",
      background: "#f9fafb",
      borderRadius: "12px",
      padding: isSidebar || isHero ? "8px" : "12px",
      marginBottom: isSidebar || isHero ? "10px" : "16px",
    },
    className: "omafit-ar-mobile-img",
  });
  if (productImgHttps) {
    const mimg = el("div", {
      style: { borderRadius: "16px", overflow: "hidden", background: "#f3f4f6" },
    });
    mimg.appendChild(
      el("img", {
        src: productImgHttps,
        alt: productTitle,
        style: { width: "100%", height: "auto", display: "block" },
      }),
    );
    mobileImgWrap.appendChild(mimg);
  }

  /** Mesmo contraste que TryOnWidget hero step 1 (textos claros + CTA branco). */
  const heroInfoFg = "#ffffff";
  const heroInfoMuted = "rgba(255, 255, 255, 0.92)";
  const heroInfoAccent = "rgba(255, 255, 255, 0.95)";
  const heroInfoPanelBg = "rgba(255, 255, 255, 0.12)";
  const heroInfoPanelBorder = "rgba(255, 255, 255, 0.35)";

  const titleBlock = el("div", {
    className: isHero ? "omafit-ar-hero-title-block" : "",
    style: { marginBottom: "16px", ...(!isHero ? { textAlign: "center" } : {}) },
  });
  titleBlock.appendChild(
    el("h3", {
      textContent: omafitFormatWelcomeTitle(t.title, shopName, locale),
      style: {
        margin: "0 0 6px 0",
        fontSize: isSidebar || isHero ? "clamp(1.05rem, 2.2vw, 1.25rem)" : "clamp(1.35rem, 4vw, 1.85rem)",
        fontWeight: "600",
        color: isHero ? heroInfoFg : primaryColor,
      },
    }),
  );
  titleBlock.appendChild(
    el("p", {
      textContent: t.desc,
      style: {
        margin: 0,
        color: isHero ? heroInfoMuted : "#374151",
        fontSize: isSidebar || isHero ? "clamp(0.88rem, 1.8vw, 0.98rem)" : "clamp(1rem, 3vw, 1.2rem)",
        lineHeight: isSidebar || isHero ? "1.35" : "1.45",
      },
    }),
  );

  const cta = el(
    "button",
    {
      type: "button",
      style: {
        width: "100%",
        background: isHero ? "#ffffff" : primaryColor,
        color: isHero ? primaryColor : "#fff",
        border: isHero ? "2px solid rgba(255, 255, 255, 0.95)" : "none",
        padding: isSidebar || isHero ? "11px 14px" : "14px 20px",
        borderRadius: "8px",
        fontSize: isSidebar || isHero ? "clamp(0.9rem, 1.8vw, 1rem)" : "clamp(1rem, 3vw, 1.15rem)",
        fontWeight: "600",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
        fontFamily: "inherit",
        transition: "filter 0.2s ease, box-shadow 0.2s ease",
        marginBottom: isSidebar || isHero ? "8px" : "12px",
      },
    },
    [],
  );
  cta.appendChild(document.createTextNode(t.cta + " "));
  const arw = svgArrowRight();
  arw.style.color = isHero ? primaryColor : "#fff";
  cta.appendChild(arw);
  cta.addEventListener("mouseenter", () => {
    if (isHero) {
      cta.style.filter = "brightness(0.98)";
      cta.style.boxShadow = "0 4px 14px rgba(0,0,0,0.2)";
      cta.style.background = "rgba(255, 255, 255, 0.92)";
    } else {
      cta.style.filter = "brightness(0.92)";
      cta.style.boxShadow = `0 4px 14px ${primaryColor}44`;
    }
  });
  cta.addEventListener("mouseleave", () => {
    cta.style.filter = "none";
    cta.style.boxShadow = "none";
    if (isHero) {
      cta.style.background = "#ffffff";
    }
  });
  cta.addEventListener("click", () => {
    if (!omafitArDocumentAllowsCamera()) {
      omafitArOpenSessionInNewWindow(t, onClose);
      return;
    }
    onStartAr(shell, mainRow, colContent, header);
  });

  const privacy = el("p", {
    className: isHero ? "omafit-ar-hero-privacy" : "",
    textContent: t.privacy,
    style: {
      margin: 0,
      ...(!isHero ? { textAlign: "center" } : {}),
      color: isHero ? heroInfoMuted : "#6b7280",
      fontSize: isSidebar || isHero ? "0.78rem" : "0.875rem",
      lineHeight: isSidebar || isHero ? "1.3" : "1.4",
    },
  });

  try {
    const sp = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
    if (sp.get("omafit_ar_window") === "1") {
      colContent.appendChild(
        el("div", {
          role: "status",
          textContent: t.arWindowModeBanner || "",
          style: {
            background: "#dbeafe",
            color: "#1e3a8a",
            padding: "10px 12px",
            borderRadius: "8px",
            marginBottom: "12px",
            fontSize: "0.95rem",
            lineHeight: "1.45",
            textAlign: "center",
            border: "1px solid #93c5fd",
          },
        }),
      );
    }
  } catch {
    /* ignore */
  }

  if (!isHero) colContent.appendChild(mobileImgWrap);
  if (isHero) {
    const heroTextStack = el("div", { className: "omafit-ar-hero-text-stack" });
    heroTextStack.appendChild(titleBlock);
    heroTextStack.appendChild(cta);
    heroTextStack.appendChild(privacy);
    colContent.appendChild(heroTextStack);
  } else {
    colContent.appendChild(titleBlock);
    colContent.appendChild(cta);
    colContent.appendChild(privacy);
  }

  mainRow.appendChild(colImg);
  mainRow.appendChild(colContent);

  if (isSidebar) {
    const contentOuter = el("div", {
      style: { flex: "1", display: "flex", flexDirection: "column", minHeight: "0", overflow: "hidden" },
    });
    if (sidebarMobile) contentOuter.appendChild(sidebarMobile);
    contentOuter.appendChild(mainRow);
    if (sidebarDesktop) shell.appendChild(sidebarDesktop);
    shell.appendChild(contentOuter);
  } else if (isHero) {
    const contentOuter = el("div", {
      style: {
        flex: "1",
        display: "flex",
        flexDirection: "column",
        minHeight: "0",
        overflow: "hidden",
        position: "relative",
        zIndex: "1",
      },
    });
    const heroTopBrand = el("div", { className: "omafit-ar-hero-top-brand" });
    if (logoUrl) {
      heroTopBrand.appendChild(
        el("img", {
          src: logoUrl,
          alt: shopName || "",
          style: {
            maxHeight: "44px",
            width: "auto",
            maxWidth: "100%",
            objectFit: "contain",
            filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.35))",
          },
        }),
      );
    } else if (shopName) {
      heroTopBrand.appendChild(
        el("span", {
          textContent: shopName,
          style: {
            fontSize: "0.95rem",
            fontWeight: "600",
            color: "#ffffff",
            textShadow: "0 1px 3px rgba(0,0,0,0.55)",
          },
        }),
      );
    }
    const bgRoot = el("div", { className: "omafit-ar-hero-bg-root" });
    bgRoot.appendChild(
      el("div", {
        className: "omafit-ar-hero-bg-mobile",
        style: heroBg
          ? {
              backgroundImage: heroBgMobileCss,
              backgroundSize: "cover, cover",
              backgroundPosition: "center top, center top",
              backgroundRepeat: "no-repeat, no-repeat",
            }
          : { backgroundImage: heroBgMobileCss, backgroundSize: "cover" },
      }),
    );
    if (heroBg) {
      const heroBgUrl = `url("${heroBg.replace(/"/g, "%22")}")`;
      const desktopWrap = el("div", { className: "omafit-ar-hero-bg-desktop" });
      desktopWrap.appendChild(
        el("div", {
          className: "omafit-ar-hero-bg-desktop-base",
          style: {
            position: "absolute",
            inset: 0,
            backgroundColor: primaryColor,
            backgroundImage: heroBgUrl,
            backgroundSize: "contain",
            backgroundPosition: "right center",
            backgroundRepeat: "no-repeat",
          },
        }),
      );
      const shadeEl = el("div", {
        className: "omafit-ar-hero-bg-desktop-shade",
        style: {
          position: "absolute",
          inset: 0,
          backgroundImage: omafitHeroDesktopShadeGradient(primaryColor, null),
          backgroundSize: "100% 100%",
          backgroundRepeat: "no-repeat",
          pointerEvents: "none",
        },
      });
      desktopWrap.appendChild(shadeEl);
      const featherEl = el("div", { className: "omafit-ar-hero-bg-desktop-feather" });
      featherEl.style.display = "none";
      desktopWrap.appendChild(featherEl);
      bgRoot.appendChild(desktopWrap);
      omafitBindHeroDesktopShadeFromContain(shadeEl, featherEl, bgRoot, primaryColor, heroBg);
    } else {
      bgRoot.appendChild(
        el("div", {
          className: "omafit-ar-hero-bg-desktop",
          style: { backgroundImage: heroBgDesktopSolidGradient, backgroundSize: "cover" },
        }),
      );
    }
    shell.appendChild(bgRoot);
    if (heroTopBrand.childNodes.length > 0) contentOuter.appendChild(heroTopBrand);
    contentOuter.appendChild(mainRow);
    shell.appendChild(contentOuter);
    shell.__omafitArHeroApi = {
      setBlur(isOn) {
        shell.classList.toggle("omafit-ar-hero-blur-on", Boolean(isOn));
      },
    };
    shell.__omafitArHeroApi.setBlur(false);
  } else {
    shell.appendChild(header);
    shell.appendChild(mainRow);
    const closeBtns = header.querySelectorAll(".omafit-ar-close-btn");
    if (closeBtns.length > 1) {
      for (let i = 1; i < closeBtns.length; i += 1) closeBtns[i]?.remove?.();
    }
  }

  const mq = window.matchMedia("(min-width: 768px)");
  function applyMq() {
    if (isSidebar || isHero) {
      colImg.style.display = "none";
      mobileImgWrap.style.display = isHero ? "none" : "block";
      if (isSidebar && mq.matches) {
        mobileImgWrap.style.maxWidth = "240px";
        mobileImgWrap.style.width = "100%";
        mobileImgWrap.style.marginLeft = "auto";
        mobileImgWrap.style.marginRight = "auto";
      } else {
        mobileImgWrap.style.maxWidth = "";
        mobileImgWrap.style.width = "";
        mobileImgWrap.style.marginLeft = "";
        mobileImgWrap.style.marginRight = "";
      }
      return;
    }
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
  omafitAnimateTextEntrance(shell);

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
/**
 * Converte landmark MediaPipe **normalizado** (x,y ∈ [0,1], z relativo) para NDC
 * Three.js no plano near (−1…1). Útil para `Raycaster` / depuração; o path
 * MindAR deste widget usa `metricLandmarks` 3D + PnP — não substituir a
 * âncora por `unproject` sem calibrar distância à câmara.
 */
function omafitMediaPipeNormalizedToNdcXY(lm) {
  const x = (lm.x - 0.5) * 2;
  const y = -(lm.y - 0.5) * 2;
  return { x, y };
}

/**
 * Raio no espaço mundo a partir de um marco 2D normalizado (experimental).
 * `depthNdc` tipicamente em ]0,1[ (near→far em clip space antes do project).
 */
function omafitUnprojectMediaPipeNormalizedLandmark(THREE, camera, lm, depthNdc, target) {
  const { x: ndcX, y: ndcY } = omafitMediaPipeNormalizedToNdcXY(lm);
  target.set(ndcX, ndcY, depthNdc).unproject(camera);
  return target;
}

/**
 * Sincroniza projeção: canvas WebGL e `<video>` com as **mesmas** dimensões
 * intrínsecas (px), `camera.aspect` e FOV — corrige desvio lateral nas bordas
 * quando o frustum não coincide com a lente / frame do vídeo.
 *
 * @param {any} THREE
 * @param {any} mindarThree
 * @param {HTMLElement | null} mindarHost
 * @param {{ fovDeg?: number, strictVideoCanvasPixelMatch?: boolean }} [opts]
 */
/**
 * @returns {boolean} true se `camera` foi actualizada (sempre que existir câmara).
 */
function omafitSyncMindARFaceProjection(THREE, mindarThree, mindarHost, opts) {
  if (!THREE || !mindarThree) return false;
  const renderer = mindarThree.renderer;
  const camera = mindarThree.camera;
  const video = mindarHost?.querySelector?.("video");
  if (!renderer || !camera) return false;
  const vw = Math.max(0, Number(video?.videoWidth) || 0);
  const vh = Math.max(0, Number(video?.videoHeight) || 0);
  const strict = opts?.strictVideoCanvasPixelMatch !== false;
  const Lsync = omafitSyncMindARFaceProjection;
  /**
   * Modo não-estrito: o solvePnP / landmarks vêm do **mesmo** estimador que
   * define `getCameraParams()` no MindAR. Forçar FOV/aspect “à mão” (p.ex.
   * 63°) desalinha o frustum do GLB em relação à face → modelo fora de vista.
   * Usamos fov/aspect/near/far do controller e `updateProjectionMatrix`.
   */
  if (!strict && !opts?.useOpenGlStyleProjection) {
    const ctrl = mindarThree.controller;
    if (ctrl && typeof ctrl.getCameraParams === "function") {
      try {
        const p = ctrl.getCameraParams();
        if (
          p &&
          Number.isFinite(p.aspect) &&
          p.aspect > 0 &&
          Number.isFinite(p.fov) &&
          p.fov > 0 &&
          Number.isFinite(p.near) &&
          Number.isFinite(p.far) &&
          p.far > p.near
        ) {
          camera.aspect = p.aspect;
          camera.fov = THREE.MathUtils.clamp(p.fov, 20, 120);
          camera.near = p.near;
          camera.far = p.far;
          if (typeof camera.updateProjectionMatrix === "function") {
            camera.updateProjectionMatrix();
          }
          return true;
        }
      } catch {
        /* continuar para o sync legado */
      }
    }
  }
  /**
   * O MindAR repõe `camera` / `renderer` no loop interno — este sync tem de
   * correr **em cada frame** (`controller.onUpdate`), não só no `resize`.
   * Sem `videoWidth` ainda (antes de `loadedmetadata`), aplicamos só FOV/aspect
   * de recurso para o efeito ser visível logo.
   */
  if (vw >= 2 && vh >= 2 && strict && typeof renderer.setSize === "function") {
    /**
     * Só redimensionar o buffer quando a resolução do stream muda — chamar
     * `setSize` a 30–60 Hz recria estado WebGL e trava telemóveis fracos.
     * `updateStyle=false`: o MindAR `_resize()` mantém o CSS do canvas.
     */
    if (!Lsync._buf || Lsync._buf.w !== vw || Lsync._buf.h !== vh) {
      Lsync._buf = { w: vw, h: vh };
      renderer.setSize(vw, vh, false);
    }
  }
  /**
   * Com `strictVideoCanvasPixelMatch=false`, o MindAR faz `setSize(videoWidth,
   * videoHeight)` — o **framebuffer** segue o vídeo. O canvas pode estar
   * esticado no CSS (cover) com **aspecto de layout ≠ aspecto do buffer**;
   * usar `clientWidth/clientHeight` quebra o frustum e o GLB pode sair
   * inteiro do campo de visão. Prioridade: `canvas.width/height` (ou
   * `getDrawingBufferSize`) → intrínsecos do vídeo → layout CSS → câmara.
   */
  let aspect = 9 / 16;
  if (strict) {
    if (vw >= 2 && vh >= 2) aspect = vw / vh;
    else if (Number.isFinite(camera.aspect) && camera.aspect > 0) aspect = camera.aspect;
  } else {
    const dom = renderer.domElement;
    const bufW = dom ? Math.max(0, dom.width || 0) : 0;
    const bufH = dom ? Math.max(0, dom.height || 0) : 0;
    if (bufW >= 2 && bufH >= 2) {
      aspect = bufW / bufH;
    } else if (typeof renderer.getDrawingBufferSize === "function") {
      if (!Lsync._bufAspect) Lsync._bufAspect = new THREE.Vector2();
      renderer.getDrawingBufferSize(Lsync._bufAspect);
      if (Lsync._bufAspect.y >= 2) aspect = Lsync._bufAspect.x / Lsync._bufAspect.y;
      else if (vw >= 2 && vh >= 2) aspect = vw / vh;
      else if (Number.isFinite(camera.aspect) && camera.aspect > 0) aspect = camera.aspect;
    } else if (vw >= 2 && vh >= 2) {
      aspect = vw / vh;
    } else {
      const cssW = dom ? Math.max(0, dom.clientWidth || 0) : 0;
      const cssH = dom ? Math.max(0, dom.clientHeight || 0) : 0;
      if (cssW >= 2 && cssH >= 2) aspect = cssW / cssH;
      else if (Number.isFinite(camera.aspect) && camera.aspect > 0) aspect = camera.aspect;
    }
  }
  if (!Number.isFinite(aspect) || aspect <= 0) aspect = 9 / 16;
  camera.aspect = aspect;
  const fovLocked63 = opts?.lockWebcamFov63 === true;
  let fov = fovLocked63 ? 63 : Number(opts?.fovDeg);
  if (!Number.isFinite(fov)) fov = OMAFIT_FACE_CAMERA_FOV_DEFAULT;
  const fovAdj = Number(opts?.responsiveLayoutFovAdjustDeg);
  const adj = Number.isFinite(fovAdj) ? fovAdj : 0;
  fov += adj;
  if (fovLocked63) fov = THREE.MathUtils.clamp(fov, 56, 72);
  else fov = THREE.MathUtils.clamp(fov, 35, 95);
  camera.fov = fov;
  const useGl =
    opts?.useOpenGlStyleProjection !== false &&
    typeof THREE.Matrix4 === "function" &&
    camera.projectionMatrix &&
    typeof camera.projectionMatrix.copy === "function";
  if (useGl) {
    const sx = opts?.principalShiftNdcLp?.x ?? 0;
    const sy = opts?.principalShiftNdcLp?.y ?? 0;
    omafitApplyOpenGlPerspectiveFromVideoIntrinsics(THREE, camera, fov, aspect, sx, sy);
  } else if (typeof camera.updateProjectionMatrix === "function") {
    camera.updateProjectionMatrix();
  }
  return true;
}

/**
 * `document.permissionsPolicy.allowsFeature("camera")` reflecte o efeito
 * combinado de cabeçalhos + iframe `allow`. Se for `false`, `getUserMedia`
 * falha sem prompt útil — abrimos o mesmo URL numa janela de primeiro nível.
 */
function omafitArDocumentAllowsCamera() {
  try {
    const pp = document.permissionsPolicy;
    if (pp && typeof pp.allowsFeature === "function") {
      return pp.allowsFeature("camera") === true;
    }
  } catch {
    /* ignore */
  }
  try {
    const fp = document.featurePolicy;
    if (fp && typeof fp.allowsFeature === "function") {
      return fp.allowsFeature("camera") === true;
    }
  } catch {
    /* ignore */
  }
  return true;
}

function omafitArOpenSessionInNewWindow(t, onCloseModal) {
  try {
    const href = typeof location !== "undefined" ? location.href : "";
    const u = new URL(href || "https://omafit.netlify.app/", href || undefined);
    u.searchParams.set("omafit_ar_window", "1");
    const w = window.open(
      u.toString(),
      "_blank",
      "noopener,noreferrer,width=540,height=940",
    );
    if (w) {
      try {
        w.focus();
      } catch {
        /* ignore */
      }
      try {
        if (typeof onCloseModal === "function") onCloseModal();
      } catch {
        /* ignore */
      }
    } else if (typeof alert === "function") {
      alert(t?.arPopupBlocked || "Permita pop-ups para este site e tente de novo.");
    }
  } catch (e) {
    console.warn("[omafit-ar] omafitArOpenSessionInNewWindow", e);
  }
}

function omafitArAppendNewWindowFallbackButton(loadingEl, t, onCloseModal) {
  if (!loadingEl || !t) return;
  const btn = el("button", {
    type: "button",
    textContent: t.arOpenNewWindowCta || "Abrir AR numa nova janela",
    style: {
      marginTop: "4px",
      padding: "12px 18px",
      borderRadius: "8px",
      border: "none",
      cursor: "pointer",
      fontWeight: "600",
      fontSize: "1rem",
      background: "#2563eb",
      color: "#fff",
      maxWidth: "min(340px, 92vw)",
    },
  });
  btn.addEventListener("click", () => {
    omafitArOpenSessionInNewWindow(t, onCloseModal);
  });
  loadingEl.appendChild(btn);
}

async function startMindARFaceWithReliableCamera(mindarThree, videoIdealBlock) {
  const md = navigator.mediaDevices;
  if (!md || typeof md.getUserMedia !== "function") {
    try {
      await mindarThree.start();
    } catch (err) {
      const wrapped =
        err === undefined || err === null
          ? new DOMException(
              "MindAR: arranque falhou (sem detalhe). Câmara pode estar bloqueada por Permissions-Policy neste documento.",
              "NotAllowedError",
            )
          : err;
      throw wrapped;
    }
    return;
  }
  const orig = md.getUserMedia.bind(md);
  let patchActive = true;
  /**
   * Resolução / fps ideais — mais pixels = landmarks MediaPipe mais estáveis
   * (com fallback em cascata se o dispositivo não suportar).
   */
  /** Pedidos altos (1080p) saturam GPU + `setSize` — 720p chega para landmarks. */
  const faceVideoIdeal =
    videoIdealBlock && typeof videoIdealBlock === "object"
      ? videoIdealBlock
      : {
          width: { ideal: 1280, max: 1280, min: 480 },
          height: { ideal: 720, max: 720, min: 360 },
          frameRate: { ideal: 30, min: 12 },
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
    try {
      await mindarThree.start();
    } catch (err) {
      const wrapped =
        err === undefined || err === null
          ? new DOMException(
              "MindAR: arranque falhou (sem detalhe). Câmara pode estar bloqueada por Permissions-Policy neste documento.",
              "NotAllowedError",
            )
          : err;
      throw wrapped;
    }
  } finally {
    patchActive = false;
    md.getUserMedia = orig;
  }
}

/**
 * Depois do `_resize()` do MindAR, garante object-fit **cover** em pixels no
 * `<video>` e no canvas WebGL com o **mesmo** rect (paridade hand path).
 * Não usar `width/height:100%` no canvas — estica ao aspecto do contentor e
 * o GLB sai do frustum; aqui escala pelo aspecto do stream e centra com overflow
 * cortado pelo `overflow:hidden` do host.
 * @returns {boolean}
 */
function omafitMindARFaceCoverLayout(mindarHost, mindarThree) {
  if (!mindarHost) return false;
  const rect = mindarHost.getBoundingClientRect();
  const cw = Math.max(1, Math.round(rect.width));
  const ch = Math.max(1, Math.round(rect.height));
  const video = mindarHost.querySelector?.("video");
  if (!video) return false;
  const vw = Math.max(0, Number(video.videoWidth) || 0);
  const vh = Math.max(0, Number(video.videoHeight) || 0);
  if (vw < 2 || vh < 2) return false;
  const scale = Math.max(cw / vw, ch / vh);
  const dw = Math.ceil(vw * scale);
  const dh = Math.ceil(vh * scale);
  const left = Math.round((cw - dw) / 2);
  const top = Math.round((ch - dh) / 2);
  const patchEl = (el, zIndex) => {
    if (!el) return;
    Object.assign(el.style, {
      position: "absolute",
      width: `${dw}px`,
      height: `${dh}px`,
      left: `${left}px`,
      top: `${top}px`,
      right: "auto",
      bottom: "auto",
      margin: "0",
      maxWidth: "none",
      maxHeight: "none",
    });
    if (zIndex != null) el.style.zIndex = String(zIndex);
  };
  patchEl(video, 1);
  patchEl(mindarThree?.renderer?.domElement, 2);
  patchEl(mindarThree?.cssRenderer?.domElement, 3);
  return true;
}

/**
 * MindAR coloca o `<video>` da câmara atrás do canvas (z-index -2). O fundo só
 * se vê se o WebGL limpar com **alpha 0**; caso contrário o canvas tapa o vídeo
 * com preto opaco — o GLB continua visível, mas o feed da câmara desaparece.
 * Reforça também estilos do vídeo/canvas contra regras agressivas do tema.
 */
function fixMindARFaceVideoBehindCanvas(THREE, mindarThree, mindarHost, projectionOpts) {
  try {
    const { scene, renderer, cssRenderer } = mindarThree || {};
    if (scene && "background" in scene) scene.background = null;
    if (renderer && typeof renderer.setClearColor === "function") {
      renderer.setClearColor(0x000000, 0);
    }
    try {
      if (THREE?.SRGBColorSpace !== undefined && renderer && "outputColorSpace" in renderer) {
        renderer.outputColorSpace = THREE.SRGBColorSpace;
      }
    } catch {
      /* ignore */
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
    try {
      omafitMindARFaceCoverLayout(mindarHost, mindarThree);
    } catch {
      /* ignore */
    }
    /**
     * Projeção: buffer WebGL = stream; CSS cover em pixels (acima) — ver
     * `omafitSyncMindARFaceProjection` (não usar aspect do contentor no frustum).
     */
    try {
      if (THREE) {
        omafitSyncMindARFaceProjection(THREE, mindarThree, mindarHost, projectionOpts);
      }
      const cam2 = mindarThree?.camera;
      if (cam2 && Math.abs(cam2.scale?.x ?? 1) > 1e-6 && Math.abs((cam2.scale?.x ?? 1) + 1) < 1e-6) {
        console.warn(
          "[omafit-ar] camera.scale.x ≈ -1: o espelho no mundo 3D desalinha landmarks vs GLB. Preferir espelho no vídeo (MindAR/CSS), não na câmara.",
        );
      }
    } catch {
      /* ignore */
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

/** Normaliza URL de imagem Shopify (Ajax / Liquid). */
function omafitNormalizeShopifyProductImgUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (s.indexOf("//") === 0) return `https:${s}`;
  return s;
}

/**
 * Mapa variante → URL a partir de `product.images` no JSON Ajax (muitas lojas
 * não enviam `featured_image` por variante, só `variant_ids` nas imagens).
 */
function omafitVariantImageUrlMapFromProductJson(data) {
  /** @type {Map<string, string>} */
  const map = new Map();
  const images = data?.images;
  if (!Array.isArray(images)) return map;
  for (const im of images) {
    const src = omafitNormalizeShopifyProductImgUrl(
      typeof im === "string" ? im : im?.src || im?.url || im?.preview_image?.src || "",
    );
    if (!src) continue;
    const vids = im?.variant_ids || im?.variants;
    if (Array.isArray(vids)) {
      for (const vid of vids) {
        if (vid != null && String(vid).trim()) map.set(String(vid), src);
      }
    }
  }
  return map;
}

function omafitFeaturedImageUrlFromStorefrontVariant(sv) {
  const feat = sv?.featured_image ?? sv?.image;
  if (!feat) return "";
  if (typeof feat === "string") return omafitNormalizeShopifyProductImgUrl(feat);
  const raw = feat.src || feat.url || feat.preview_image?.src || "";
  return omafitNormalizeShopifyProductImgUrl(raw);
}

/** Handle do produto para `/products/{handle}.js` (data-attrs ou URL `/products/...`). */
function omafitResolveProductHandleForVariantFetch() {
  const fromDom =
    typeof document !== "undefined"
      ? String(
          document.getElementById("omafit-widget-root")?.getAttribute("data-product-handle") ||
            document.getElementById("omafit-ar-root")?.getAttribute("data-product-handle") ||
            "",
        ).trim()
      : "";
  if (fromDom) return fromDom;
  // Fallback: no Netlify iframe o `pathname` pode não ser `/products/...`.
  // Quando o `omafit-widget.js` do tema passa `productHandle` via query string,
  // precisamos aceitar isso para enriquecer variantes com `products/{handle}.js`.
  try {
    const qs =
      typeof window !== "undefined" && window.location?.search
        ? new URLSearchParams(window.location.search)
        : null;
    if (qs) {
      const fromQ = String(qs.get("productHandle") || qs.get("product_handle") || qs.get("handle") || "").trim();
      if (fromQ) return fromQ;
    }
  } catch {
    /* ignore */
  }
  try {
    const m = typeof location !== "undefined" ? location.pathname.match(/\/products\/([^/?#]+)/i) : null;
    return m && m[1] ? decodeURIComponent(m[1]) : "";
  } catch {
    return "";
  }
}

/**
 * Mescla dados do embed com `GET {locale}products/{handle}.js` (JSON Ajax Shopify):
 * lista completa de variantes + imagens (`featured_image` ou `images[].variant_ids`).
 */
async function omafitEnrichVariantsFromStorefrontJs(productHandle, existing) {
  const list = Array.isArray(existing) ? existing.slice() : [];
  if (!productHandle || typeof fetch !== "function") return list;
  const h = String(productHandle).trim();
  if (!h) return list;
  try {
    const rootRaw =
      typeof window !== "undefined" && window.Shopify?.routes?.root != null
        ? String(window.Shopify.routes.root).trim()
        : "";
    const root = rootRaw && rootRaw !== "undefined" ? rootRaw : "/";
    const prefix = root.endsWith("/") ? root : `${root}/`;
    const path = `${prefix}products/${encodeURIComponent(h)}.js`;
    const res = await fetch(path, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return list;
    const data = await res.json();
    const fromEmb = new Map(list.map((v) => [String(v.id), { ...v }]));
    const variantImgMap = omafitVariantImageUrlMapFromProductJson(data);
    /** Fallback quando não há imagem por variante: roda pelas URLs do produto. */
    const flatProductImgs = [];
    if (Array.isArray(data.images)) {
      for (const im of data.images) {
        const u = omafitNormalizeShopifyProductImgUrl(
          typeof im === "string" ? im : im?.src || im?.url || "",
        );
        if (u) flatProductImgs.push(u);
      }
    }
    const featGlobal = omafitNormalizeShopifyProductImgUrl(data?.featured_image || "");
    if (featGlobal && !flatProductImgs.includes(featGlobal)) flatProductImgs.unshift(featGlobal);

    const out = [];
    let rotImg = 0;
    for (const sv of data.variants || []) {
      const sid = String(sv.id);
      const base = fromEmb.get(sid) || {
        id: sv.id,
        title: sv.name || sv.title || "",
        price: sv.price,
        imageUrl: "",
        glbUrl: "",
        glb_url: "",
        calibration: null,
      };
      let img = String(base.imageUrl || base.image_url || "").trim();
      if (!img) img = omafitFeaturedImageUrlFromStorefrontVariant(sv);
      if (!img) img = variantImgMap.get(sid) || "";
      if (!img && flatProductImgs.length === 1) img = flatProductImgs[0];
      if (!img && flatProductImgs.length > 1) {
        img = flatProductImgs[rotImg % flatProductImgs.length] || "";
        rotImg += 1;
      }
      out.push({
        ...base,
        id: sv.id,
        title: String(base.title || sv.name || sv.title || "").trim() || String(sv.name || sv.title || ""),
        price: base.price ?? sv.price,
        imageUrl: omafitNormalizeShopifyProductImgUrl(img) || String(base.imageUrl || "").trim(),
      });
    }
    return out.length ? out : list;
  } catch {
    return list;
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
  const arSessionLayoutProfile = omafitResolveArDeviceRuntimeProfile({});
  const arSessionIsDesktop = arSessionLayoutProfile.formFactor === "desktop";
  let headerDisplayBeforeAr = "";
  if (arSessionIsDesktop && header) {
    headerDisplayBeforeAr = header.style.display || "";
    header.style.display = "none";
  }
  try {
    shell.__omafitArSidebarApi?.setStep?.("ar");
    shell.__omafitArHeroApi?.setBlur?.(true);
  } catch {
    /* ignore */
  }
  const desktopCol = shell.querySelector(".omafit-ar-col-desktop");
  if (desktopCol) desktopCol.style.display = "none";

  mainRow.style.flexDirection = "column";
  mainRow.style.padding = "0";
  /** Mesmo layout que pulseiras/relógios: área da câmara ocupa o popup acima da barra inferior. */
  try {
    shell.style.display = "flex";
    shell.style.flexDirection = "column";
    shell.style.minHeight = "0";
    shell.style.height = "100%";
  } catch {
    /* ignore */
  }
  mainRow.style.flex = "1 1 0";
  mainRow.style.minHeight = "0";
  try {
    const contentOuter = mainRow.parentElement;
    if (contentOuter && contentOuter !== shell) {
      contentOuter.style.flex = "1 1 0";
      contentOuter.style.minHeight = "0";
      contentOuter.style.display = "flex";
      contentOuter.style.flexDirection = "column";
    }
  } catch {
    /* ignore */
  }

  const arWrap = el("div", {
    style: {
      flex: "1 1 0",
      minHeight: "0",
      display: "flex",
      flexDirection: "column",
      alignItems: "stretch",
      justifyContent: "flex-start",
      width: "100%",
      boxSizing: "border-box",
      background: "#000",
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
    className: "omafit-ar-fit",
    style: {
      position: "relative",
      flex: "1 1 0",
      width: "100%",
      minHeight: "0",
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
  let variantSource = Array.isArray(variants) && variants.length ? variants : [];
  if (
    !variantSource.length &&
    typeof window !== "undefined" &&
    Array.isArray(window.__OMAFIT_AR_VARIANTS__)
  ) {
    variantSource = window.__OMAFIT_AR_VARIANTS__;
  }
  /**
   * Iframe Netlify: se não há variantes do Liquid (sem `__OMAFIT_AR_VARIANTS__`),
   * tenta ler `data-ar-variants-glb` do `#omafit-ar-root` — serializado pelo
   * `omafit-widget.js` do tema com id, glbUrl (`g`) e calibration (`c`).
   * Formato: JSON Array<{ id, g, c }> → mapeado para o schema interno.
   */
  if (!variantSource.length) {
    try {
      const arRoot = typeof document !== "undefined" ? document.getElementById("omafit-ar-root") : null;
      const rawGlbVars = arRoot ? (arRoot.getAttribute("data-ar-variants-glb") || "").trim() : "";
      if (rawGlbVars) {
        const parsed = JSON.parse(rawGlbVars);
        if (Array.isArray(parsed) && parsed.length > 0) {
          variantSource = parsed.map((v) => ({
            id: v.id,
            title: String(v.t || v.id || "").trim() || String(v.id),
            imageUrl: String(v.i || "").trim(),
            glbUrl: String(v.g || "").trim(),
            calibration: v.c || null,
          }));
          console.log("[omafit-ar] arVariantsGlb (iframe):", variantSource.length, "variantes com GLB");
        }
      }
    } catch {
      /* ignore */
    }
  }
  const productHandleForFetch = omafitResolveProductHandleForVariantFetch();
  if (productHandleForFetch) {
    variantSource = await omafitEnrichVariantsFromStorefrontJs(productHandleForFetch, variantSource);
  }

  const sessionGlb = String(glbUrl || "").trim();
  /**
   * `baseGlb`: GLB a nível de produto — calculado APÓS o enrich para que
   * variantes sem glbUrl próprio (e.g. partilham o GLB do produto) apareçam.
   * Ordem de prioridade: `data-glb-url` (sessão) > primeiro glbUrl nas variantes.
   */
  const resolveBaseGlb = (src) =>
    sessionGlb ||
    (Array.isArray(src)
      ? src.map((v) => String(v?.glbUrl ?? v?.glb_url ?? "").trim()).find(Boolean) || ""
      : "");
  const baseGlb = resolveBaseGlb(variantSource);

  const resolveVariantGlb = (v) =>
    String(v?.glbUrl ?? v?.glb_url ?? "").trim() || resolveBaseGlb(variantSource);
  /**
   * Filtro de variantes para a barra de miniaturas:
   * - Se alguma variante tem glbUrl próprio (fluxo Liquid ou arVariantsGlb do iframe),
   *   mostrar APENAS as variantes com glbUrl — evita exibir variantes sem AR.
   * - Se nenhuma variante tem glbUrl (todas partilham o baseGlb do produto),
   *   manter todas com id válido (comportamento legado: sem filtro).
   */
  const anyHasOwnGlb = variantSource.some((v) => v && String(v?.glbUrl ?? v?.glb_url ?? "").trim());
  let arVariants = variantSource.filter((v) => {
    if (!v) return false;
    const id = v.id != null ? String(v.id).trim() : "";
    if (!id) return false;
    if (anyHasOwnGlb) {
      return Boolean(String(v?.glbUrl ?? v?.glb_url ?? "").trim());
    }
    return true;
  });
  /**
   * Iframe Netlify: não há `window.__OMAFIT_AR_VARIANTS__` do Liquid. Com
   * `data-variant-id` + `data-glb-url` sintetizamos uma variante para miniaturas
   * (se `data-product-image`) e para o botão de carrinho.
   */
  try {
    const r = typeof document !== "undefined" ? document.getElementById("omafit-ar-root") : null;
    const vid = r ? String(r.dataset.variantId || r.getAttribute("data-variant-id") || "").trim() : "";
    const syntheticGlb = resolveBaseGlb(variantSource);
    if (arVariants.length === 0 && vid && syntheticGlb) {
      const pimg = r ? String(r.dataset.productImage || r.getAttribute("data-product-image") || "").trim() : "";
      const ptitle = r ? String(r.dataset.productTitle || r.getAttribute("data-product-title") || "").trim() : "";
      arVariants = [{ id: vid, title: ptitle || "Variant", imageUrl: pimg, glbUrl: syntheticGlb, calibration: null }];
      console.log("[omafit-ar] variante sintética (Netlify / sem __OMAFIT_AR_VARIANTS__)", {
        variantId: vid,
        hasImage: Boolean(pimg),
      });
    }
  } catch {
    /* ignore */
  }
  let currentVariantId = arVariants.length > 0 ? arVariants[0].id : null;
  let currentGlbUrl = arVariants.length > 0 ? resolveVariantGlb(arVariants[0]) : baseGlb;
  try {
    const pqv = new URLSearchParams(
      typeof window !== "undefined" ? window.location.search || "" : "",
    ).get("variant");
    if (pqv && String(pqv).trim() && arVariants.length) {
      const mv = arVariants.find((vv) => String(vv.id) === String(pqv).trim());
      if (mv) {
        currentVariantId = mv.id;
        currentGlbUrl = resolveVariantGlb(mv);
      }
    }
  } catch {
    /* noop */
  }
  let arBottomBar = null;
  const variantCalPayload = (v) =>
    v && typeof v.calibration === "object" && v.calibration !== null ? v.calibration : {};

  /** Miniaturas + carrinho: sempre que existir pelo menos uma variante com GLB (próprio ou do produto). */
  if (arVariants.length >= 1) {
    arBottomBar = el("div", {
      className: "omafit-ar-variant-cart-strip",
      style: {
        flexShrink: "0",
        width: "100%",
        boxSizing: "border-box",
        background: "#0d0d0d",
        padding: "10px 12px max(10px, env(safe-area-inset-bottom, 0px))",
        zIndex: "20",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        pointerEvents: "auto",
        borderTop: "1px solid rgba(255,255,255,0.12)",
      },
    });

    const thumbRow = el("div", {
      style: {
        display: "flex",
        gap: "8px",
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
        justifyContent: "flex-start",
        flexWrap: "nowrap",
        minHeight: "60px",
        padding: "0 4px 4px",
        touchAction: "pan-x",
        pointerEvents: "auto",
      },
    });

    const syncThumbBorders = () => {
      thumbRow.querySelectorAll("button").forEach((b) => {
        b.style.border =
          String(b.dataset.variantId) === String(currentVariantId)
            ? `3px solid ${primaryColor}`
            : "2px solid rgba(255,255,255,0.5)";
      });
    };

    /** `#omafit-ar-root` traz imagem principal do produto (900px); serve de fallback nas miniaturas. */
    let productThumbFallback = "";
    try {
      const rRoot =
        typeof document !== "undefined" ? document.getElementById("omafit-ar-root") : null;
      productThumbFallback = omafitUpgradeShopifyMediaToHttps(
        String(rRoot?.dataset?.productImage || rRoot?.getAttribute("data-product-image") || "").trim(),
      );
    } catch {
      productThumbFallback = "";
    }

    arVariants.forEach((v) => {
      const thumb = el("button", {
        type: "button",
        title: v.title || "",
        style: {
          width: "56px",
          height: "56px",
          borderRadius: "10px",
          border:
            String(v.id) === String(currentVariantId)
              ? `3px solid ${primaryColor}`
              : "2px solid rgba(255,255,255,0.5)",
          background: "#fff",
          cursor: "pointer",
          padding: "2px",
          overflow: "hidden",
          flexShrink: "0",
          transition: "border-color 0.2s",
        },
      });
      thumb.dataset.variantId = String(v.id);
      const rawVariantImg = String(v.imageUrl || v.image_url || "").trim();
      const fromVariant = omafitUpgradeShopifyMediaToHttps(rawVariantImg);
      const thumbImgSrc = fromVariant || productThumbFallback;
      if (thumbImgSrc) {
        const imgNode = el("img", {
          src: thumbImgSrc,
          alt: v.title || "",
          loading: "eager",
          decoding: "async",
          style: { width: "100%", height: "100%", objectFit: "cover", borderRadius: "7px", display: "block" },
        });
        if (productThumbFallback) {
          imgNode.addEventListener(
            "error",
            function omafitThumbErr() {
              imgNode.removeEventListener("error", omafitThumbErr);
              try {
                const cur = String(imgNode.currentSrc || imgNode.src || "");
                if (cur && cur !== String(productThumbFallback)) imgNode.src = productThumbFallback;
              } catch {
                /* ignore */
              }
            },
            false,
          );
        }
        thumb.appendChild(imgNode);
      } else {
        thumb.appendChild(el("span", {
          textContent: (v.title || "?").slice(0, 3),
          style: { fontSize: "11px", color: "#333", display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%" },
        }));
      }
      thumb.addEventListener("click", () => {
        if (String(v.id) === String(currentVariantId)) return;
        currentVariantId = v.id;
        currentGlbUrl = resolveVariantGlb(v);
        syncThumbBorders();
        if (typeof window.__omafitArSwitchGlb === "function") {
          window.__omafitArSwitchGlb(currentGlbUrl, variantCalPayload(v));
        }
      });
      thumbRow.appendChild(thumb);
    });

    arBottomBar.appendChild(thumbRow);

    const cartBtn = el("button", {
      type: "button",
      className: "omafit-ar-cart-btn",
      textContent: t.addToCart,
      style: {
        width: "100%",
        minHeight: "52px",
        padding: "16px 20px",
        borderRadius: "8px",
        border: "none",
        background: primaryColor,
        color: "#fff",
        fontWeight: "600",
        fontSize: "1.05rem",
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
        await omafitArPostCartAddVariant(Number(currentVariantId));
        cartBtn.textContent = t.addedToCart || "Added!";
        setTimeout(() => { cartBtn.textContent = t.addToCart; cartBtn.disabled = false; }, 2000);
      } catch {
        cartBtn.textContent = t.addToCartError || "Error";
        setTimeout(() => { cartBtn.textContent = t.addToCart; cartBtn.disabled = false; }, 2000);
      }
    });
    arBottomBar.appendChild(cartBtn);
  }

  colContent.style.padding = "0";
  /**
   * Contentor do modal: deixar `hidden` para que o conteúdo AR não transborde
   * a caixa. O "cortado do lado direito" era causado por medições em momento
   * errado no `_resize()` do MindAR — corrigido via `lateMindarResizeTimerIds`.
   */
  colContent.style.overflow = "hidden";
  colContent.style.overflowX = "hidden";
  colContent.style.flex = "1 1 0";
  colContent.style.display = "flex";
  colContent.style.flexDirection = "column";
  colContent.style.minHeight = "0";
  colContent.appendChild(arWrap);
  /**
   * Miniaturas + carrinho: irmãos de `arWrap` dentro de `colContent` (coluna
   * flex). `arWrap` com flex:1 e minHeight:0 liberta altura; antes a barra no
   * `shell` ou posição absoluta sumia em alguns layouts/telemóveis.
   */
  if (arBottomBar) colContent.appendChild(arBottomBar);
  omafitAnimateTextEntrance(colContent);

  let mindarThree = null;
  let arResizeObserver = null;
  /**
   * Handler opcional instalado por motores alternativos (p.ex. MediaPipe
   * Hand Landmarker) para libertar câmara, rAF loop, landmarker, etc.
   * É chamado em cada `cleanup()` para garantir paridade com o face path.
   */
  let arEngineCleanup = null;
  /** Libertação PMREM / chain MindAR / oclusor facial (path óculos). */
  let mindarFaceEnhancementsCleanup = null;
  /** Estado para `mindarFaceEnhancementsCleanup` (refs a libertar). */
  let faceArEnhancementState = null;
  /** Listeners de orientação/visibilidade adicionados dentro de `runArSession`. */
  let removeOrientationListeners = null;
  /** Timeouts de `_resize` tardio (layout do modal / safe-area) — limpar no cleanup. */
  let lateMindarResizeTimerIds = [];
  /** `loadedmetadata` no `<video>` — voltar a sincronizar canvas/câmara. */
  let faceProjectionVideoCleanup = null;
  /** Remover painel de debug Tripo (sliders) ao fechar o modal. */
  let removeTripoDebugPanel = null;
  /** Remover sliders de calibração manual (offset + escala). */
  let removeManualCalibPanel = null;
  /** Remover botões de rotação no ecrã (óculos). */
  let removeGlassesScreenRotPanel = null;

  const cleanup = () => {
    if (arSessionIsDesktop && header) {
      header.style.display = headerDisplayBeforeAr;
    }
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
    if (typeof faceProjectionVideoCleanup === "function") {
      try {
        faceProjectionVideoCleanup();
      } catch {
        /* ignore */
      }
      faceProjectionVideoCleanup = null;
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
    if (typeof mindarFaceEnhancementsCleanup === "function") {
      try {
        mindarFaceEnhancementsCleanup();
      } catch {
        /* ignore */
      }
      mindarFaceEnhancementsCleanup = null;
      faceArEnhancementState = null;
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
    if (typeof removeTripoDebugPanel === "function") {
      try {
        removeTripoDebugPanel();
      } catch {
        /* ignore */
      }
      removeTripoDebugPanel = null;
    }
    if (typeof removeGlassesScreenRotPanel === "function") {
      try {
        removeGlassesScreenRotPanel();
      } catch {
        /* ignore */
      }
      removeGlassesScreenRotPanel = null;
    }
    if (typeof removeManualCalibPanel === "function") {
      try {
        removeManualCalibPanel();
      } catch {
        /* ignore */
      }
      removeManualCalibPanel = null;
    }
    try {
      delete window.__omafitGlassesPivotConfig;
      delete window.__omafitGlassesManualCalib;
    } catch {
      /* ignore */
    }
    try {
      window.__omafitArSwitchGlb = null;
    } catch {
      /* ignore */
    }
  };

  const closeTargets = shell.querySelectorAll("[data-omafit-ar-close-modal]");
  for (const headerClose of closeTargets) {
    if (headerClose?.dataset?.omafitArSessionClose === "1") continue;
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
    if (arCfg) {
      omafitHydrateArTelemetryDatasetFromSearchParams(arCfg, embedCfg);
      omafitHydrateArRootManualRigFromUrl(arCfg);
      try {
        console.log("Manual rig attr:", arCfg.dataset.arGlassesManualMindarRig);
      } catch {
        /* ignore */
      }
    }
    function cfgAttrDispatch(camelKey, fallback = "") {
      const embedEl = typeof document !== "undefined" ? document.getElementById("omafit-widget-root") : null;
      const rootEl = typeof document !== "undefined" ? document.getElementById("omafit-ar-root") : null;
      /** Modo manual: o tema (`#omafit-ar-root`) ganha ao `#omafit-widget-root` (evita embed vazio a sombrear). */
      if (camelKey === "arGlassesManualMindarRig") {
        const rk = rootEl?.dataset?.[camelKey];
        if (rk !== undefined && String(rk).trim() !== "") return String(rk).trim();
        const ek = embedEl?.dataset?.[camelKey];
        if (ek !== undefined && String(ek).trim() !== "") return String(ek).trim();
        return String(fallback ?? "").trim();
      }
      const ek = embedEl?.dataset?.[camelKey];
      if (ek !== undefined && String(ek).trim() !== "") return String(ek).trim();
      const ak = rootEl?.dataset?.[camelKey];
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
    let trackingStack =
      liquidStackValid && accessoryTypeSource === "liquid-metafield"
        ? trackingStackRaw
        : inferredStack;

    /**
     * Metafields/tema antigos podem emitir `arTrackingStack=face` com `arAccessoryType=bracelet|watch`.
     * Nesse caso MindAR+cara corria em vez de `runHandArSession` — tracking “preso” e GLB incoerente.
     */
    if (accessoryType === "watch" || accessoryType === "bracelet") {
      trackingStack = "hand";
    }

    if (isOmafitEyewearArForcedFromQuery()) {
      accessoryType = "glasses";
      accessoryTypeSource = "query-eyewear_ar-forced";
      trackingStack = "face";
    }

    const arPerfModeEarly = String(cfgAttrDispatch("arPerformanceProfile", "auto")).trim().toLowerCase();
    const arDeviceProfileSnapshot = omafitResolveArDeviceRuntimeProfile({ perfMode: arPerfModeEarly });

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
      arDeviceProfile: arDeviceProfileSnapshot,
    });

    try {
      const qsDbg = typeof location !== "undefined" ? String(location.search || "") : "";
      if (
        accessoryType === "bracelet" &&
        (/[?&]omafit_ar_bracelet_log=1\b/.test(qsDbg) ||
          /[?&]omafit_ar_debug=1\b/.test(qsDbg))
      ) {
        let bundleImportMsLog = Number(cfgAttrDispatch("arHandBundleImportTimeoutMs", ""));
        if (!Number.isFinite(bundleImportMsLog) || bundleImportMsLog < 15000) bundleImportMsLog = 120000;
        bundleImportMsLog = Math.min(300000, bundleImportMsLog);
        console.info("[omafit-ar][bracelet]", "dispatcher:resolved", {
          trackingStack,
          source: accessoryTypeSource,
          liquidAccessoryType,
          clientDetected,
          glbUrlPreview: String(glbUrl || "").slice(0, 220),
          bundleImportMs: bundleImportMsLog,
        });
      }
    } catch {
      /* ignore */
    }

    if (trackingStack === "hand") {
      let bundleImportMs = Number(cfgAttrDispatch("arHandBundleImportTimeoutMs", ""));
      if (!Number.isFinite(bundleImportMs) || bundleImportMs < 15000) bundleImportMs = 120000;
      bundleImportMs = Math.min(300000, bundleImportMs);

      let threeModHand;
      let gltfModuleHand;
      let visionMod;
      try {
        [threeModHand, gltfModuleHand, visionMod] = await omafitPromiseTimeoutRace(
          getOmafitArHandModuleBundle(),
          bundleImportMs,
          "import hand AR (Three + GLTFLoader + @mediapipe/tasks-vision)",
        );
        try {
          const qsDbg = typeof location !== "undefined" ? String(location.search || "") : "";
          if (
            accessoryType === "bracelet" &&
            (/[?&]omafit_ar_bracelet_log=1\b/.test(qsDbg) ||
              /[?&]omafit_ar_debug=1\b/.test(qsDbg))
          ) {
            console.info("[omafit-ar][bracelet]", "dispatcher:hand_bundle_import_ok", {
              bundleImportMs,
            });
          }
        } catch {
          /* ignore */
        }
      } catch (eB) {
        try {
          const qsDbg = typeof location !== "undefined" ? String(location.search || "") : "";
          if (
            accessoryType === "bracelet" &&
            (/[?&]omafit_ar_bracelet_log=1\b/.test(qsDbg) ||
              /[?&]omafit_ar_debug=1\b/.test(qsDbg))
          ) {
            console.info("[omafit-ar][bracelet]", "dispatcher:hand_bundle_import_fail", {
              bundleImportMs,
              message: eB?.message || String(eB),
            });
          }
        } catch {
          /* ignore */
        }
        console.error("[omafit-ar] falha ao carregar bundle mão:", eB?.message || eB);
        loading.textContent = t.errGeneric || t.errFace || "";
        throw eB instanceof Error ? eB : new Error(String(eB));
      }
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
      /** Variante inicial (?variant=) ou não-default: recarregar GLB/calibração na sessão mão. */
      if (
        arVariants.length > 0 &&
        typeof window.__omafitArSwitchGlb === "function" &&
        String(currentVariantId) !== String(arVariants[0].id)
      ) {
        const ivSel = arVariants.find((vv) => String(vv.id) === String(currentVariantId));
        if (ivSel) {
          try {
            window.__omafitArSwitchGlb(resolveVariantGlb(ivSel), variantCalPayload(ivSel));
          } catch (e) {
            console.warn("[omafit-ar] switch variante inicial (mão):", e?.message || e);
          }
        }
      }
      return;
    }

    const [threeMod, gltfModule, mindFaceMod] = await getOmafitArModuleBundle();
    const THREE =
      threeMod.default && typeof threeMod.default.Group === "function" ? threeMod.default : threeMod;
    const { GLTFLoader } = gltfModule;
    const MindARThree = mindFaceMod.MindARThree || mindFaceMod.default;
    /** Lê sempre o DOM actual; mod rig manual: `#omafit-ar-root` primeiro (ver `cfgAttrDispatch`). */
    function cfgAttr(camelKey, fallback = "") {
      const embedEl = typeof document !== "undefined" ? document.getElementById("omafit-widget-root") : null;
      const rootEl = typeof document !== "undefined" ? document.getElementById("omafit-ar-root") : null;
      if (camelKey === "arGlassesManualMindarRig") {
        const rk = rootEl?.dataset?.[camelKey];
        if (rk !== undefined && String(rk).trim() !== "") return String(rk).trim();
        const ek = embedEl?.dataset?.[camelKey];
        if (ek !== undefined && String(ek).trim() !== "") return String(ek).trim();
        return String(fallback ?? "").trim();
      }
      const ek = embedEl?.dataset?.[camelKey];
      if (ek !== undefined && String(ek).trim() !== "") return String(ek).trim();
      const ak = rootEl?.dataset?.[camelKey];
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
      try {
        v = typeof raw === "string" ? JSON.parse(raw) : raw;
      } catch {
        return null;
      }
      if (v && typeof v === "object" && v.value !== undefined) {
        try {
          v = typeof v.value === "string" ? JSON.parse(v.value) : v.value;
        } catch {
          /* noop */
        }
      }
      if (!v || typeof v !== "object" || Array.isArray(v)) return null;
      /** Liquid `| json` sobre o drop do metafield (não o `.value`) → erro Shopify. */
      if (typeof v.error === "string" && Object.keys(v).length <= 2) return null;
      return v;
    }
    const _faceCalWorldAxes = {
      X: new THREE.Vector3(1, 0, 0),
      Y: new THREE.Vector3(0, 1, 0),
      Z: new THREE.Vector3(0, 0, 1),
    };
    /** Rotação de calibração loja (Y→X→Z) num grupo Three.js — face path (óculos). */
    function applyThreeGroupCalibRot(group, cal) {
      if (!group) return;
      group.quaternion.identity();
      const rxDeg = Number((cal && cal.rx) ?? 0) || 0;
      const ryDeg = Number((cal && cal.ry) ?? 0) || 0;
      const rzDeg = Number((cal && cal.rz) ?? 0) || 0;
      if (ryDeg) group.rotateOnWorldAxis(_faceCalWorldAxes.Y, (ryDeg * Math.PI) / 180);
      if (rxDeg) group.rotateOnWorldAxis(_faceCalWorldAxes.X, (rxDeg * Math.PI) / 180);
      if (rzDeg) group.rotateOnWorldAxis(_faceCalWorldAxes.Z, (rzDeg * Math.PI) / 180);
    }
    const initialFaceCal = parseOmafitCalibrationRaw(
      arCfg?.dataset?.arOmafitCalibration || "",
    );
    function applyOmafitCalibration(cal, el) {
      const target = el || arCfg;
      if (!target || !cal || typeof cal !== "object") return false;
      const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : null);
      const bridgeY = num(cal.bridgeY);
      const wearX = num(cal.wearX), wearY = num(cal.wearY), wearZ = num(cal.wearZ);
      const lfx = num(cal.localFineX);
      const lfy = num(cal.localFineY);
      const lfz = num(cal.localFineZ);
      const mox = num(cal.manualOffsetX);
      const moy = num(cal.manualOffsetY);
      const moz = num(cal.manualOffsetZ);
      const msm = num(cal.manualScaleMul);
      const scale = num(cal.scale);
      if (wearX !== null && wearY !== null && wearZ !== null) {
        target.dataset.arMindarWearPosition = `${wearX} ${wearY} ${wearZ}`;
      }
      if (lfx !== null && lfy !== null && lfz !== null) {
        target.dataset.arGlassesLocalFineXyz = `${lfx} ${lfy} ${lfz}`;
      }
      if (mox !== null && moy !== null && moz !== null) {
        target.dataset.arGlassesManualCalibOffset = `${mox} ${moy} ${moz}`;
      }
      if (msm !== null && msm > 0) {
        target.dataset.arGlassesManualCalibScale = String(
          Math.max(0.25, Math.min(4, msm)),
        );
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
    /** Offset final do pivot (m), eixos locais do pai — `data-ar-glasses-offset-final-m`. */
    function parseOffsetFinal(raw) {
      return parseXyzMeters(raw, 0, 0, 0);
    }

    /**
     * Rig MindAR manual (`mid(olhos)−168` + trim em landmarks): **desactivado**.
     * Posição/rotação vêm só da face mesh + `glassesTrackingWrap`.
     */
    const glassesManualMindarRig = false;
    /**
     * MindAR `addAnchor(i)`: i na malha facial 468. **Óculos** — sempre **168** (ponte nasal,
     * eixo médio estável). `data-ar-mindar-anchor` lateral (ex. 33, 263 olhos) é ignorado para
     * não deslocar estruturalmente o modelo. **Colar** — default **152** (zona mandíbula); aí
     * `arMindarAnchor` continua configurável dentro do clamp 0…477.
     */
    const defaultMindarAnchor = accessoryType === "necklace" ? "152" : "168";
    const anchorRaw = cfgAttr("arMindarAnchor", defaultMindarAnchor);
    let anchorIndex = Math.max(
      0,
      Math.min(477, Math.floor(Number(anchorRaw)) || (accessoryType === "necklace" ? 152 : 168)),
    );
    if (accessoryType === "glasses" && anchorIndex !== OMAFIT_FACE_LM_NOSE_BRIDGE) {
      console.warn(
        "[omafit-ar] óculos: âncora MindAR fixa no landmark 168 (ponte nasal / centro facial). arMindarAnchor=",
        anchorIndex,
        "→ a forçar 168 (evitar âncoras laterais dos olhos).",
      );
      anchorIndex = OMAFIT_FACE_LM_NOSE_BRIDGE;
    }
    /** Uma vez no load: `omafitAutoAlignGlassesModel` — `data-ar-glasses-auto-align-model="1"`. */
    const glassesAutoAlignModel =
      accessoryType === "glasses" &&
      /^(1|true|yes|on)$/.test(
        String(cfgAttr("arGlassesAutoAlignModel", "0")).trim().toLowerCase(),
      );
    /**
     * GLB preparado no Blender (ou DCC equivalente): **Object Origin** na ponte do nariz,
     * rotação aplicada no mesh (Apply Rotation), **frente das lentes = −Z** no espaço do root,
     * **+Y** para cima. Desliga heurísticas Tripo / bind base Ry / centro por bbox no root.
     * Attr: `data-ar-glasses-canonical-blender-export="1"`.
     */
    const glassesCanonicalBlenderExport =
      accessoryType === "glasses" &&
      /^(1|true|yes|on)$/.test(
        String(cfgAttr("arGlassesCanonicalBlenderExport", "0")).trim().toLowerCase(),
      );
    /**
     * Rig estrutural MindAR (`data-ar-glasses-structural-mindar-rig="1"`) — definido cedo
     * para o pipeline de standardização GLB e outros flags o poderem referenciar.
     */
    const glassesStructuralMindarRig =
      accessoryType === "glasses" &&
      !glassesManualMindarRig &&
      /^(1|true|yes|on|minimal)$/.test(
        String(cfgAttr("arGlassesStructuralMindarRig", "0")).trim().toLowerCase(),
      );
    /**
     * Normalização determinística pós-bake (Tripo / GLB arbitrário): centro + largura→1 + Ry + container.
     * Incompatível: manual MindAR, estrutural, export canónico Blender. Attr: `data-ar-glasses-glb-standardize="1"`.
     * Largura: `data-ar-glasses-glb-standardize-width` = `x` (só `size.x`) ou `maxXZ` (defeito).
     * Rotação base no contentor: **`Ry(π)` fixo** (sem attr). Avanço Z pós-normalização (m, **≥0**):
     * `data-ar-glasses-glb-standardize-forward-z-m` (defeito **0,05**).
     */
    const glassesGlbStandardize =
      accessoryType === "glasses" &&
      !glassesManualMindarRig &&
      !glassesStructuralMindarRig &&
      !glassesCanonicalBlenderExport &&
      /^(1|true|yes|on)$/.test(String(cfgAttr("arGlassesGlbStandardize", "0")).trim().toLowerCase());
    const glassesGlbStandardizeWidthMode = glassesGlbStandardize
      ? (() => {
          const w = String(cfgAttr("arGlassesGlbStandardizeWidth", "maxXZ")).trim().toLowerCase();
          return w === "x" || w === "sx" ? "x" : "maxXZ";
        })()
      : "maxXZ";
    const glassesGlbStandardizeForwardZM = glassesGlbStandardize
      ? (() => {
          const v = Number(
            String(cfgAttr("arGlassesGlbStandardizeForwardZM", "0.05")).trim().replace(",", "."),
          );
          if (!Number.isFinite(v)) return 0.05;
          return THREE.MathUtils.clamp(v, 0, 0.2);
        })()
      : 0;
    const glassesBboxRecenterPostBind =
      accessoryType === "glasses" &&
      !glassesManualMindarRig &&
      !glassesCanonicalBlenderExport &&
      !glassesGlbStandardize &&
      !/^(0|off|false|no)$/i.test(String(cfgAttr("arGlassesBboxRecenterPostBind", "1")).trim());
    /**
     * Avanço em **profundidade** (m) na frente do rosto, em série com o Z de `mid(33,263)−168`
     * em `metricLandmarks` no `wearPosition` (auto) ou somado ao mesh Z (manual). Sempre **≥0**;
     * clamp **[0, 0.04]**; default **0,008** m (antes 0,02 — demasiado longe do rosto).
     * Attr: `data-ar-glasses-depth-forward-m`.
     */
    const glassesDepthForwardM =
      accessoryType === "glasses"
        ? (() => {
            const v = Number(String(cfgAttr("arGlassesDepthForwardM", "0.008")).trim());
            if (!Number.isFinite(v)) return 0.008;
            return THREE.MathUtils.clamp(v, 0, 0.08);
          })()
        : 0;
    /**
     * Deslocamento lateral do **mesh** `glasses` no eixo **+X local** (metros), só translação
     * — centra visualmente a armação no nariz (âncora 168) quando o GLB vem ligeiramente
     * deslocado em X. Não usar rotação para corrigir lateral. Attr: `data-ar-glasses-nose-align-offset-x-m`.
     */
    const glassesNoseAlignOffsetXM =
      accessoryType === "glasses"
        ? (() => {
            const v = Number(String(cfgAttr("arGlassesNoseAlignOffsetXM", "0")).trim());
            if (!Number.isFinite(v)) return 0;
            return THREE.MathUtils.clamp(v, -0.08, 0.04);
          })()
        : 0;
    /** Offset manual do GLB no espaço local do `omafit-ar-glasses-model-wrap` (m); somado ao nariz em X. */
    const glassesModelCenterOffsetM =
      accessoryType === "glasses"
        ? parseXyzMeters(cfgAttr("arGlassesModelCenterOffsetM", "0 0 0"), 0, 0, 0)
        : { x: 0, y: 0, z: 0 };
    /**
     * v22: ZERO por default — alinhamento puro ao ponto médio dos olhos.
     * Override só quando o GLB tem centro deslocado conhecido.
     * Attr: `data-ar-glasses-empirical-align-m="x y z"` (metros).
     */
    const glassesEmpiricalAlignM =
      accessoryType === "glasses"
        ? parseXyzMeters(
            cfgAttr("arGlassesEmpiricalAlignM", "0 0 0"),
            0,
            0,
            0,
          )
        : { x: 0, y: 0, z: 0 };
    /** Multiplicador de estilo na largura anatómica (automático: IPD×equiv×factor/faceScale; antes era bochechas). */
    const glassesAnatomicWidthFactor = (() => {
      if (accessoryType !== "glasses") return 1;
      const v = Number(String(cfgAttr("arGlassesAnatomicWidthFactor", "1.05")).trim());
      return Number.isFinite(v) && v > 0.2 ? v : OMAFIT_GLASSES_ANATOMIC_WIDTH_FACTOR;
    })();
    /** IPD (landmarks) × equiv ≈ largura bochecha em mesma unidade. `data-ar-glasses-ipd-cheek-equiv`. */
    const glassesIpdCheekEquiv =
      accessoryType === "glasses"
        ? (() => {
            const raw = String(cfgAttr("arGlassesIpdCheekEquiv", "")).trim();
            if (!raw) return OMAFIT_GLASSES_IPD_CHEEK_EQUIV;
            const v = Number(raw);
            return Number.isFinite(v) && v > 0.4 && v < 6 ? v : OMAFIT_GLASSES_IPD_CHEEK_EQUIV;
          })()
        : OMAFIT_GLASSES_IPD_CHEEK_EQUIV;
    const glassesFaceDistanceScale =
      accessoryType === "glasses" &&
      !/^(0|false|off|no)$/i.test(String(cfgAttr("arGlassesFaceDistanceScale", "1")).trim());
    const glassesFaceDistanceRefM =
      accessoryType === "glasses" && glassesFaceDistanceScale
        ? (() => {
            const v = Number(String(cfgAttr("arGlassesFaceDistanceRefM", "0.45")).trim());
            return Number.isFinite(v) && v > 0.08 ? v : 0.45;
          })()
        : 0.45;
    const glassesFaceDistanceMulMin =
      accessoryType === "glasses" && glassesFaceDistanceScale
        ? (() => {
            const v = Number(String(cfgAttr("arGlassesFaceDistanceMulMin", "0.88")).trim());
            return Number.isFinite(v) && v > 0.45 ? v : 0.88;
          })()
        : 0.88;
    const glassesFaceDistanceMulMax =
      accessoryType === "glasses" && glassesFaceDistanceScale
        ? (() => {
            const v = Number(String(cfgAttr("arGlassesFaceDistanceMulMax", "1.14")).trim());
            return Number.isFinite(v) && v < 2.5 && v > glassesFaceDistanceMulMin ? v : 1.14;
          })()
        : 1.14;
    /** Malha 468 só-depth + extensões temporais (óculos); default `1` — `data-ar-glasses-face-depth-occluder="0"` desliga. Sobrescrito por `OMAFIT_GLASSES_FACE_OCCLUSION_DEBUG_OFF`. */
    const glassesFaceDepthOccluderEnabled =
      accessoryType === "glasses" &&
      !OMAFIT_GLASSES_FACE_OCCLUSION_DEBUG_OFF &&
      !/^(0|false|off|no)$/i.test(String(cfgAttr("arGlassesFaceDepthOccluder", "1")).trim());
    const faceOccAheadLocalZ =
      accessoryType === "glasses"
        ? (() => {
            const defAhead = glassesFaceDepthOccluderEnabled ? "0.0012" : "0";
            const v = Number(String(cfgAttr("arFaceOccluderNoseAhead", defAhead)).trim());
            return Number.isFinite(v) && v > 0 ? v : 0;
          })()
        : 0;
    /** Base ortogonal 234–454 / 10–152 em espaço mundo (via face mesh). */
    const glassesCheekOrthogonalBasis =
      accessoryType === "glasses" &&
      !/^(0|off|false|no)$/i.test(String(cfgAttr("arGlassesCheekOrthogonalBasis", "0")).trim());
    /** Offset Z extra (local do GLB) para “Z-fit” fino em relação ao nariz. */
    const glassesZFitExtra =
      accessoryType === "glasses"
        ? (() => {
            const v = Number(String(cfgAttr("arGlassesZFitExtra", "0")).trim());
            return Number.isFinite(v) ? v : 0;
          })()
        : 0;
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

    const perfModeResolved = String(cfgAttr("arPerformanceProfile", "auto")).trim().toLowerCase();
    const arDeviceProfile = omafitResolveArDeviceRuntimeProfile({ perfMode: perfModeResolved });
    /** Micro-interacções (entrada, anel de tracking, snap). `data-ar-micro-ux="0"` desliga. */
    const microUxDisabled = /^(0|false|off|no)$/i.test(String(cfgAttr("arMicroUx", "1")).trim());

    const faceCameraFovDeg = (() => {
      const v = Number(String(cfgAttr("arFaceCameraFovDeg", "63")).trim());
      return Number.isFinite(v) ? v : OMAFIT_FACE_CAMERA_FOV_DEFAULT;
    })();
    /** `1` = ajuste fino buffer↔stream (caro); por defeito o MindAR gere o renderer. */
    const faceProjectionStrict = !/^(0|false|off|no)$/i.test(
      String(cfgAttr("arFaceProjectionStrict", "0")).trim(),
    );
    const faceSceneMatrixWorldEveryFrame = !/^(0|false|off|no)$/i.test(
      String(cfgAttr("arFaceSceneMatrixWorldEveryFrame", "0")).trim(),
    );
    const faceProjectionMirrorNegateModelX = String(
      cfgAttr("arFaceProjectionMirrorNegateModelX", "auto"),
    )
      .trim()
      .toLowerCase();
    const faceProjectionOpts = {
      fovDeg: faceCameraFovDeg,
      mirrorSelfie: !disableFaceMirror,
      strictVideoCanvasPixelMatch: faceProjectionStrict,
      lockWebcamFov63:
        accessoryType === "glasses" &&
        !/^(0|false|off|no)$/i.test(String(cfgAttr("arFaceLockWebcamFov63", "0")).trim()),
      useOpenGlStyleProjection: !/^(0|false|off|no)$/i.test(
        String(cfgAttr("arFaceOpenGlProjectionMatrix", "0")).trim(),
      ),
      principalShiftNdcLp: { x: 0, y: 0 },
      principalAlign168:
        accessoryType === "glasses" &&
        !glassesManualMindarRig &&
        !/^(0|false|off|no)$/i.test(String(cfgAttr("arFacePrincipalAlign168", "0")).trim()),
    };
    try {
      omafitRefreshFaceProjectionLayoutFovNudge(faceProjectionOpts, mindarHost, arDeviceProfile);
    } catch {
      /* ignore */
    }
    const glassesAnchorSmoothMode = String(
      cfgAttr("arGlassesAnchorSmooth", accessoryType === "glasses" ? "one-euro" : "damp"),
    )
      .trim()
      .toLowerCase();
    const glassesAnchorOneEuro =
      accessoryType === "glasses" && glassesAnchorSmoothMode !== "damp";
    const glassesCavityAoIntensity = (() => {
      if (accessoryType !== "glasses") return 0;
      const v = Number(String(cfgAttr("arGlassesCavityAoIntensity", "0.22")).trim());
      return Number.isFinite(v) ? THREE.MathUtils.clamp(v, 0, 0.55) : 0.22;
    })();
    const glassesNdcScreenLock =
      accessoryType === "glasses" &&
      !/^(0|false|off|no)$/i.test(String(cfgAttr("arGlassesNdcScreenLock", "0")).trim());
    const glassesNdcBlendFromMp = (() => {
      const v = Number(String(cfgAttr("arGlassesNdcBlendFromMp", "0.5")).trim());
      return Number.isFinite(v) ? THREE.MathUtils.clamp(v, 0, 1) : 0.5;
    })();
    const glassesLensDistortK = (() => {
      const v = Number(String(cfgAttr("arGlassesLensDistortK", "0.072")).trim());
      return Number.isFinite(v) ? v : 0.072;
    })();
    const glassesNegateWearOffsetX =
      /^(1|true|on|yes)$/i.test(String(cfgAttr("arGlassesNegateWearOffsetX", "")).trim());

    let lm168DebugSphereQuery = false;
    try {
      lm168DebugSphereQuery =
        new URLSearchParams(window.location?.search || "").get("omafit_ar_lm168") === "1";
    } catch {
      lm168DebugSphereQuery = false;
    }
    /** Esfera vermelha na origem da âncora 168: diagnóstico GLB vs projeção. */
    const lm168DebugSphereEnabled =
      accessoryType === "glasses" &&
      anchorIndex === OMAFIT_FACE_LM_NOSE_BRIDGE &&
      (lm168DebugSphereQuery ||
        /^(1|true|on|yes)$/i.test(String(cfgAttr("arLandmark168DebugSphere", "")).trim()));
    let glassesEyeMidDebugQuery = false;
    try {
      glassesEyeMidDebugQuery =
        new URLSearchParams(window.location?.search || "").get("omafit_ar_eye_mid_debug") === "1";
    } catch {
      glassesEyeMidDebugQuery = false;
    }
    /** Esfera verde = mid(33,263); ciano = pivô óculos após centro lentes — espaço local da âncora 168. */
    const glassesEyeMidDebugVisualEnabled =
      accessoryType === "glasses" &&
      (glassesEyeMidDebugQuery ||
        /^(1|true|on|yes)$/i.test(String(cfgAttr("arGlassesEyeMidDebugVisual", "")).trim()));
    
    /** v22: Debug simples via query (?omafit_ar_glasses_eye_debug=1) para confirmar alinhamento. */
    let glassesEyeDebugSimple = false;
    try {
      glassesEyeDebugSimple =
        accessoryType === "glasses" &&
        typeof window !== "undefined" &&
        new URLSearchParams(window.location.search || "").get("omafit_ar_glasses_eye_debug") === "1";
    } catch {
      /* ignore */
    }
    const glassesForceBboxAlign168 =
      accessoryType === "glasses" &&
      (lm168DebugSphereEnabled ||
        /^(1|true|on|yes)$/i.test(String(cfgAttr("arGlassesDebugForceBboxAlign168", "")).trim()));
    const glassesNdcScratchNeeded = glassesNdcScreenLock || glassesForceBboxAlign168;

    const fMinStr = String(cfgAttr("arMindarFilterMinCf", "")).trim();
    const fBetaStr = String(cfgAttr("arMindarFilterBeta", "")).trim();
    const fMinParsed = fMinStr.length > 0 ? Number(fMinStr) : NaN;
    const fBetaParsed = fBetaStr.length > 0 ? Number(fBetaStr) : NaN;
    const mindarFilterMinDefault =
      accessoryType === "glasses" || accessoryType === "necklace"
        ? OMAFIT_MINDAR_GLASSES_FILTER_MIN_CF
        : OMAFIT_MINDAR_DEFAULT_FILTER_MIN_CF;
    const mindarFilterBetaDefault =
      accessoryType === "glasses" || accessoryType === "necklace"
        ? OMAFIT_MINDAR_GLASSES_FILTER_BETA
        : OMAFIT_MINDAR_DEFAULT_FILTER_BETA;
    const mindarOpts = {
      container: mindarHost,
      uiLoading: "no",
      uiScanning: "no",
      uiError: "no",
      disableFaceMirror,
      filterMinCF: Number.isFinite(fMinParsed)
        ? fMinParsed
        : mindarFilterMinDefault,
      filterBeta: Number.isFinite(fBetaParsed)
        ? fBetaParsed
        : mindarFilterBetaDefault,
    };

    mindarThree = new MindARThree(mindarOpts);
    /** Saída linear → sRGB + ACES por defeito (PBR / IBL coerente com o vídeo). */
    try {
      const r0 = mindarThree.renderer;
      if (r0 && THREE.SRGBColorSpace) r0.outputColorSpace = THREE.SRGBColorSpace;
      if (
        r0 &&
        THREE.ACESFilmicToneMapping !== undefined &&
        (!r0.toneMapping || r0.toneMapping === THREE.NoToneMapping)
      ) {
        r0.toneMapping = THREE.ACESFilmicToneMapping;
        r0.toneMappingExposure = 1.02;
      }
    } catch {
      /* ignore */
    }
    /** Óculos/colar: câmara frontal; só `environment` se o tema pedir explicitamente. */
    {
      const arPreferredCam = String(cfgAttr("arPreferredCamera", "user"))
        .trim()
        .toLowerCase();
      mindarThree.shouldFaceUser = arPreferredCam !== "environment";
    }
    /** Luz ambiente + hemisfério + chave suave; intensidades/cores base (refinadas por vídeo se `arFaceAmbientAdaptive`). */
    const faceAmbientLight = new THREE.AmbientLight(0xffffff, 0.62);
    const faceHemisphereLight = new THREE.HemisphereLight(0xb8daf8, 0xa09078, 0.46);
    if (accessoryType === "necklace") {
      faceHemisphereLight.intensity = 0.52;
    }
    mindarThree.scene.add(faceAmbientLight);
    mindarThree.scene.add(faceHemisphereLight);
    const faceKeyLight = new THREE.DirectionalLight(0xfff5ee, 0.36);
    faceKeyLight.name = "omafit-ar-face-key";
    faceKeyLight.position.set(0.32, 0.82, 0.38);
    mindarThree.scene.add(faceKeyLight);

    /** Óculos: `anchorIndex` já foi forçado a **168** (nariz / eixo médio); colar: 152 ou attr. */
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
        omafitRefreshFaceProjectionLayoutFovNudge(faceProjectionOpts, mindarHost, arDeviceProfile);
      } catch {
        /* ignore */
      }
      try {
        const r = mindarThree?.renderer;
        if (r?.setPixelRatio) {
          const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
          const maxDpr = omafitEffectiveArRendererMaxDpr(THREE, cfgAttr("arRendererMaxDpr", ""), arDeviceProfile);
          r.setPixelRatio(Math.min(dpr, maxDpr));
        }
      } catch {
        /* ignore */
      }
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
        if (mindarThree) {
          fixMindARFaceVideoBehindCanvas(THREE, mindarThree, mindarHost, faceProjectionOpts);
        }
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
    arResizeObserver.observe(arFit);
    arResizeObserver.observe(mindarHost);
    requestAnimationFrame(triggerMindarResize);
    requestAnimationFrame(() => requestAnimationFrame(triggerMindarResize));
    /** Timers espalhados até 2.5s (desktop até 4.5s) para cobrir:
     *  - fade-in do modal (~350ms);
     *  - idle do layout (flexbox grid estabiliza);
     *  - iOS Safari que pode reflowar após o `<video>` receber metadata.
     *  Sem isto, o MindAR mede o container no momento errado e o vídeo
     *  fica com `top/left` fora → aparece "cortado do lado direito". */
    const mindarResizeDelaysMs = arSessionIsDesktop
      ? [32, 96, 220, 500, 900, 1500, 2500, 3500, 4500]
      : [32, 96, 220, 500, 900, 1500, 2500];
    for (const ms of mindarResizeDelaysMs) {
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

    await startMindARFaceWithReliableCamera(
      mindarThree,
      omafitBuildFaceUserMediaVideoIdeal(arDeviceProfile),
    );
    {
      const vMeta = mindarHost?.querySelector?.("video");
      if (vMeta) {
        const onVideoProjectionDims = () => {
          triggerMindarResize();
        };
        vMeta.addEventListener("loadedmetadata", onVideoProjectionDims);
        vMeta.addEventListener("loadeddata", onVideoProjectionDims);
        faceProjectionVideoCleanup = () => {
          try {
            vMeta.removeEventListener("loadedmetadata", onVideoProjectionDims);
            vMeta.removeEventListener("loadeddata", onVideoProjectionDims);
          } catch {
            /* ignore */
          }
        };
      }
    }
    /**
     * Não usar `scene.background` + VideoTexture: isso altera o pipeline WebGL do
     * MindAR e opacity 0 no elemento video pode quebrar faceMesh/detect (drawImage).
     * Mantemos vídeo DOM atrás do canvas com limpeza transparente (ver loop).
     */
    fixMindARFaceVideoBehindCanvas(THREE, mindarThree, mindarHost, faceProjectionOpts);
    /** DPR do canvas WebGL: tecto por `data-ar-renderer-max-dpr` e/ou perfil de dispositivo. */
    try {
      const r = mindarThree.renderer;
      if (r?.setPixelRatio) {
        const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
        const maxDpr = omafitEffectiveArRendererMaxDpr(THREE, cfgAttr("arRendererMaxDpr", ""), arDeviceProfile);
        r.setPixelRatio(Math.min(dpr, maxDpr));
      }
    } catch {
      /* ignore */
    }

    if (OMAFIT_GLASSES_FACE_OCCLUSION_DEBUG_OFF && accessoryType === "glasses") {
      try {
        console.warn(
          "[omafit-ar] OMAFIT_GLASSES_FACE_OCCLUSION_DEBUG_OFF=true — oclusão facial (468 + hastes) desactivada para diagnóstico Z vs escala/rotação.",
        );
      } catch {
        /* ignore */
      }
    }
    /**
     * Malha facial 468 só depth + extensões temporais (óculos): oclusão de hastes / nuca.
     * No path mão não existe. Óculos: **default activo** (`data-ar-glasses-face-depth-occluder="1"`);
     * `data-ar-glasses-face-depth-occluder="0"` desliga se algum GPU clipar o GLB inteiro.
     */
    let faceOccluderMesh = null;
    let templeDepthGeom = null;
    let templeOccL = null;
    let templeOccR = null;
    /** Cilindro só depth: base ~ombros / topo ~mandíbula (métrico face). */
    let neckOccluderMesh = null;
    let neckOccGeomState = null;
    const useFace468DepthOccluder =
      accessoryType === "necklace" || glassesFaceDepthOccluderEnabled;
    if (useFace468DepthOccluder) {
      if (typeof mindarThree.addFaceMesh === "function") {
        try {
          faceOccluderMesh = mindarThree.addFaceMesh();
          if (faceOccluderMesh.material) faceOccluderMesh.material.dispose();
          faceOccluderMesh.material = createOmafitFaceDepthOccluderMaterial(THREE);
          faceOccluderMesh.visible = true;
          faceOccluderMesh.renderOrder = -80;
          // MindAR FaceGeometry atualiza vértices sem recalcular boundingSphere — com
          // frustumCulled=true a malha pode ser culled incorrectamente e falhar oclusão.
          faceOccluderMesh.frustumCulled = false;
          mindarThree.scene.add(faceOccluderMesh);
        } catch (e) {
          console.warn("[omafit-ar] face depth occluder:", e?.message || e);
        }
      }
      if (accessoryType === "glasses" && faceOccluderMesh) {
        try {
          /**
           * Pré-auricular alongado: cobre viragem lateral e deslocamento da haste virtual
           * ao longo do contorno (malha facial 468 + extensão “fantasma” só depth).
           */
          templeDepthGeom = new THREE.BoxGeometry(0.46, 0.72, 1.88);
          const tm = createOmafitFaceDepthOccluderMaterial(THREE);
          templeOccL = new THREE.Mesh(templeDepthGeom, tm);
          templeOccR = new THREE.Mesh(templeDepthGeom, tm);
          templeOccL.name = "omafit-ar-temple-depth-L";
          templeOccR.name = "omafit-ar-temple-depth-R";
          templeOccL.renderOrder = -79;
          templeOccR.renderOrder = -79;
          templeOccL.frustumCulled = false;
          templeOccR.frustumCulled = false;
          {
            const occTempleScaleRaw = Number(String(cfgAttr("arGlassesTempleOccluderScale", "1")).trim());
            const occTempleScale = Number.isFinite(occTempleScaleRaw)
              ? THREE.MathUtils.clamp(occTempleScaleRaw, 0.78, 1.45)
              : 1;
            templeOccL.scale.setScalar(occTempleScale);
            templeOccR.scale.setScalar(occTempleScale);
          }
          faceOccluderMesh.add(templeOccL);
          faceOccluderMesh.add(templeOccR);
        } catch (e) {
          console.warn("[omafit-ar] temple depth extenders:", e?.message || e);
        }
      }
      if (accessoryType === "necklace" && anchor.group) {
        try {
          neckOccGeomState = {};
          const ng = new THREE.CylinderGeometry(0.068, 0.084, 0.22, 22, 1, true);
          neckOccluderMesh = new THREE.Mesh(ng, createOmafitFaceDepthOccluderMaterial(THREE));
          neckOccluderMesh.name = "omafit-ar-neck-depth-occluder";
          neckOccluderMesh.renderOrder = -77;
          neckOccluderMesh.frustumCulled = false;
          anchor.group.add(neckOccluderMesh);
        } catch (e) {
          console.warn("[omafit-ar] neck depth occluder:", e?.message || e);
        }
      }
    }

    /**
     * Rotação por calibração loja (`data-ar-canonical-fix-yxz` / rx,ry,rz do metafield)
     * foi removida para evitar acumulação com pose MindAR / malha facial.
     */
    const fromDom = (() => {
      const r = typeof document !== "undefined" ? document.getElementById("omafit-ar-root") : null;
      const u = r ? (r.dataset.glbUrl || r.getAttribute("data-glb-url") || "").trim() : "";
      const v = r
        ? String(r.dataset.arGlbVersion || r.getAttribute("data-ar-glb-version") || "").trim()
        : "";
      return { u, v };
    })();
    const sessionGlbUrl =
      omafitReadGlbUrlFromRootOrQuery() || omafitAbsolutizeGlbUrlMaybe(String(glbUrl || "").trim());
    const glbVersion =
      fromDom.v ||
      String(arCfg?.dataset?.arGlbVersion || arCfg?.getAttribute?.("data-ar-glb-version") || "").trim();
    const glbLoadUrl = buildGlbLoaderUrl(sessionGlbUrl, glbVersion) || sessionGlbUrl;

    const arGlbDraco = !/^(0|false|off|no)$/i.test(String(cfgAttr("arGlbDraco", "1")).trim());
    let dracoLoaderFace = null;
    if (arGlbDraco) {
      try {
        dracoLoaderFace = await omafitGetSharedDracoLoader();
      } catch (e) {
        console.warn("[omafit-ar] Draco indisponível (GLB sem Draco continua OK):", e?.message || e);
      }
    }
    const loader = new GLTFLoader();
    loader.setCrossOrigin("anonymous");
    if (dracoLoaderFace) loader.setDRACOLoader(dracoLoaderFace);
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
      loader.load(
        glbLoadUrl,
        resolve,
        undefined,
        (err) => {
          console.error("[omafit-ar] GLTFLoader falhou", OMAFIT_AR_WIDGET_BUILD, {
            url: glbLoadUrl,
            message: err?.message || String(err),
          });
          reject(err);
        },
      );
    });
    let glasses = gltf.scene;
    /** Root GLB: estado conhecido antes de bake / bind (óculos). */
    if (accessoryType === "glasses") {
      glasses.position.set(0, 0, 0);
      glasses.rotation.set(0, 0, 0);
      glasses.scale.set(1, 1, 1);
      glasses.quaternion.identity();
    }
    try {
      let meshN = 0;
      glasses.traverse((o) => {
        if (o && o.isMesh) meshN += 1;
      });
      const triN = omafitCountGltfTriangles(glasses);
      omafitMaybeWarnGltfTriangleBudget(glbLoadUrl, triN);
      const texAniso = omafitEffectiveArTextureMaxAnisotropy(
        cfgAttr("arTextureMaxAnisotropy", "4"),
        arDeviceProfile,
        16,
      );
      if (mindarThree?.renderer) {
        omafitApplyGltfTextureAnisotropy(THREE, glasses, mindarThree.renderer, texAniso);
      }
      console.log("[omafit-ar] GLB carregado", OMAFIT_AR_WIDGET_BUILD, {
        url: glbLoadUrl,
        meshes: meshN,
        triangles: triN,
        draco: Boolean(dracoLoaderFace),
      });
    } catch {
      /* ignore */
    }
    if (!(glasses instanceof THREE.Object3D)) {
      console.warn(
        "[omafit-ar] gltf.scene não é instanceof THREE.Object3D deste bundle — verificar loader/CDN.",
      );
    }
    glasses.frustumCulled = false;
    glasses.traverse((child) => {
      if (!child.isMesh) return;
      child.frustumCulled = false;
      child.renderOrder = 2;
      const colorAttr =
        child.geometry && child.geometry.getAttribute ? child.geometry.getAttribute("color") : null;
      if (!child.material && colorAttr) {
        child.material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true });
      }
      if (!child.material) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of mats) {
        if (!mat) continue;
        if (mat.map) {
          if (THREE.SRGBColorSpace !== undefined && "colorSpace" in mat.map) {
            mat.map.colorSpace = THREE.SRGBColorSpace;
          } else if (THREE.sRGBEncoding !== undefined) mat.map.encoding = THREE.sRGBEncoding;
        }
        if (mat.emissiveMap) {
          if (THREE.SRGBColorSpace !== undefined && "colorSpace" in mat.emissiveMap) {
            mat.emissiveMap.colorSpace = THREE.SRGBColorSpace;
          } else if (THREE.sRGBEncoding !== undefined) mat.emissiveMap.encoding = THREE.sRGBEncoding;
        }
        if (colorAttr && "vertexColors" in mat) mat.vertexColors = true;
        if ("metalness" in mat) mat.metalness = 0;
        if ("roughness" in mat) mat.roughness = 1;
        if ("envMapIntensity" in mat) mat.envMapIntensity = 0;
        if ("emissiveIntensity" in mat) mat.emissiveIntensity = 1;
        /**
         * KHR_materials_transmission: sem PMREM / pipeline de transmissão do renderer,
         * o modelo pode renderizar como totalmente transparente no AR “lite”.
         */
        if ("transmission" in mat && Number(mat.transmission) > 0.02) {
          mat.transmission = 0;
          if ("thickness" in mat) mat.thickness = 0;
        }
        /**
         * A malha facial MindAR (só depth, renderOrder baixo) pode ganhar o z-test
         * sobre a ponte; polygonOffset negativo puxa o GLB ligeiramente para a câmara.
         */
        if ("polygonOffset" in mat) {
          mat.polygonOffset = true;
          mat.polygonOffsetFactor = -2;
          mat.polygonOffsetUnits = -2;
        }
        mat.toneMapped = false;
        mat.needsUpdate = true;
      }
    });
    if (accessoryType === "glasses") {
      try {
        omafitEnsureGlassesMeshesRenderable(THREE, glasses);
      } catch (e) {
        console.warn("[omafit-ar] ensure meshes renderable:", e?.message || e);
      }
      try {
        omafitApplyGlassesMeshDepthPriorities(THREE, glasses);
      } catch (e) {
        console.warn("[omafit-ar] mesh depth priorities:", e?.message || e);
      }
    }
    if (accessoryType === "glasses" && glassesCavityAoIntensity > 0) {
      try {
        omafitPatchGlassesMaterialsLocalCavityAo(THREE, glasses, glassesCavityAoIntensity);
      } catch (e) {
        console.warn("[omafit-ar] cavity AO patch:", e?.message || e);
      }
    }
    if (accessoryType === "glasses" || accessoryType === "necklace") {
      try {
        omafitEnhanceFaceGlbPbrResponse(THREE, glasses);
      } catch (e) {
        console.warn("[omafit-ar] PBR response tune:", e?.message || e);
      }
    }

    /**
     * Centralização absoluta do pivot **logo após o load** (antes de bake):
     * `position.sub(center)` — NÃO usar `pos += pos - center` (equivale a
     * `2*pos - center` e **não** zera o desvio).
     */
    if (
      accessoryType === "glasses" &&
      !glassesManualMindarRig &&
      !glassesCanonicalBlenderExport &&
      !glassesGlbStandardize
    ) {
      glasses.updateMatrixWorld(true);
      const fcLoad = omafitComputeGlassesLensAnchorPoint(THREE, glasses);
      if (fcLoad) glasses.position.sub(fcLoad);
      else {
        const boxLoad = new THREE.Box3().setFromObject(glasses);
        if (!(typeof boxLoad.isEmpty === "function" && boxLoad.isEmpty())) {
          glasses.position.sub(boxLoad.getCenter(new THREE.Vector3()));
        }
      }
    }

    /**
     * Pipeline simples ("filtro do Instagram"): idêntica ao preview do admin.
     * Hierarquia: anchor.group → wearPosition → calibRot → [trip] →
     *   `glassesPivot` → `glasses` (GLB congelado em T/R/S identity após load).
     *   - calibRot:     rotação mundo da calibração (defaults 0,0,0)
     *   - wearPosition: offset em unidades de âncora (≈14cm/unit) via wearX/Y/Z
     *   - escala runtime: só no `glassesPivot` (anatomia + loja)
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

    if (
      accessoryType === "glasses" &&
      glassesAutoAlignModel &&
      !glassesManualMindarRig &&
      !glassesCanonicalBlenderExport &&
      !glassesGlbStandardize
    ) {
      try {
        omafitAutoAlignGlassesModel(glasses, THREE);
      } catch (e) {
        console.warn("[omafit-ar] omafitAutoAlignGlassesModel:", e?.message || e);
      }
    }

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
     *    MUNDO. O eixo “frente das lentes” no ficheiro pode ser +Y (glTF
     *    típico); `omafitApplyGlassesMindarBindFix` alinha com a âncora MindAR
     *    (+Z para a câmara). A Euler do `calibRot` continua a ser pitch/yaw/roll
     *    em eixos mundo (ver preview admin).
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

    if (glassesGlbStandardize) {
      const { root: stdRoot } = omafitStandardizeGlassesGlbRootForAr(THREE, glasses, {
        widthMode: glassesGlbStandardizeWidthMode,
        forwardZM: glassesGlbStandardizeForwardZM,
      });
      glasses = stdRoot;
      glasses.updateMatrixWorld(true);
      try {
        console.log("[omafit-ar] glasses GLB standardize (pre-tracking)", {
          build: OMAFIT_AR_WIDGET_BUILD,
          widthMode: glassesGlbStandardizeWidthMode,
          baseRotationYRad: Math.PI,
          forwardZM: glassesGlbStandardizeForwardZM,
        });
      } catch {
        /* ignore */
      }
    }

    /** 2) Bbox (tamanho) + **âncora funcional** (midpoint entre lentes na fatia frontal, se
     *    detetado; senão centróide frontal com menor Z), não o centróide nu da AABB.
     *    `position.sub(frontCenter)` — **todos** os modos óculos (incl. manual MindAR). Modo manual:
     *    `omafitApplyGlassesManualMindarCenterMesh` só aplica identidade no mesh. */
    const box = new THREE.Box3().setFromObject(glasses);
    if (typeof box.isEmpty === "function" && box.isEmpty()) {
      throw new Error(
        "omafit-ar: GLB sem geometria visível (cena vazia ou só nós sem vértices).",
      );
    }
    const sz = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(sz.x, sz.y, sz.z, 1e-6);
    if (!Number.isFinite(maxDim) || maxDim < 1e-9) {
      throw new Error("omafit-ar: dimensões do GLB inválidas (NaN ou zero).");
    }
    /** Largura intrínseca do frame (eixo X) — normaliza escala IPD no loop. */
    let glassesFrameWidthLocal = 1;
    if (accessoryType === "glasses") {
      glassesFrameWidthLocal = Math.max(sz.x, 0.001);
    }
    if (!glassesCanonicalBlenderExport) {
      const frontCenter = omafitComputeGlassesLensAnchorPoint(THREE, glasses);
      if (frontCenter) glasses.position.sub(frontCenter);
      else glasses.position.sub(box.getCenter(new THREE.Vector3()));
    } else {
      try {
        console.log(
          "[omafit-ar] GLB canónico Blender: origem na ponte (sem `position.sub` do centróide da bbox).",
          OMAFIT_AR_WIDGET_BUILD,
        );
      } catch {
        /* ignore */
      }
    }

    /**
     * Wear em unidades de âncora. Profundidade: delta Z `mid(olhos)−168` (quando activo) +
     * `arGlassesDepthForwardM` (m, sempre positivo). Override base: `data-ar-mindar-wear-position`.
     */
    const wearPosMRaw = parseXyzMeters(
      cfgAttr("arMindarWearPosition", accessoryType === "glasses" ? "0 0 0" : ""),
      0,
      0,
      0,
    );
    /** Manual: sem offset lateral/vertical em `wearPosition` — mesh centrado + `arGlassesDepthForwardM` em Z local. */
    const wearPosM =
      accessoryType === "glasses" && glassesManualMindarRig
        ? { x: 0, y: 0, z: 0 }
        : wearPosMRaw;
    /**
     * Ajuste fino de centragem no espaço **local** do GLB (filho de
     * `glassesPivot`, antes do `scale` do mesh): move com a cabeça porque
     * toda a cadeia está sob `anchor.group`. Três números em
     * `data-ar-glasses-local-fine-xyz` (espaço ou vírgula), como `wear`.
     * Valores típicos para corrigir desvio lateral: ±0,002 … ±0,012.
     */
    const glassesLocalFineM = parseXyzMeters(
      cfgAttr("arGlassesLocalFineXyz", "0 0 0"),
      0,
      0,
      0,
    );
    const glassesManualCalibParsed = parseXyzMeters(
      cfgAttr("arGlassesManualCalibOffset", "0 0 0"),
      0,
      0,
      0,
    );
    const glassesManualScaleRaw = Number(String(cfgAttr("arGlassesManualCalibScale", "1")).trim());
    const glassesManualScaleMulInit =
      Number.isFinite(glassesManualScaleRaw) && glassesManualScaleRaw > 0
        ? THREE.MathUtils.clamp(glassesManualScaleRaw, 0.25, 4)
        : 1;
    /**
     * Transformações **locais** do `glassesPivot` (filho de `calibRot` ou de
     * `tripOffsetGroup` quando Tripo está activo). Rotação manual (attrs / metafield) **desactivada** —
     * orientação só via quaternion da malha facial no `glassesTrackingWrap`.
     */
    const glassesPivotConfig =
      accessoryType === "glasses"
        ? {
            offsetX: glassesLocalFineM.x + glassesManualCalibParsed.x,
            offsetY: glassesLocalFineM.y + glassesManualCalibParsed.y,
            offsetZ: glassesLocalFineM.z + glassesManualCalibParsed.z,
            rotX: 0,
            rotY: 0,
            rotZ: 0,
            scale: glassesManualScaleMulInit,
          }
        : null;
    if (glassesPivotConfig) {
      Object.defineProperty(glassesPivotConfig, "scaleMultiplier", {
        configurable: true,
        get() {
          return this.scale;
        },
        set(v) {
          const n = Number(v);
          this.scale = Number.isFinite(n) && n > 0 ? n : 1;
        },
      });
    }
    if (OMAFIT_GLASSES_PIVOT_DIRECT_TEST && glassesPivotConfig) {
      Object.assign(glassesPivotConfig, OMAFIT_GLASSES_PIVOT_TEST_OVERRIDES);
    }

    const glassesStructuralPivotPosVec = glassesStructuralMindarRig
      ? parseXyzMeters(
          cfgAttr("arGlassesStructuralPivotPos", "0 -0.04 -0.1"),
          0,
          -0.04,
          -0.1,
        )
      : null;
    const glassesStructuralPivotRotYDeg = glassesStructuralMindarRig
      ? Number(String(cfgAttr("arGlassesStructuralPivotRotYDeg", "0")).trim())
      : 0;
    const glassesStructuralPivotBoost = glassesStructuralMindarRig
      ? (() => {
          const b = Number(String(cfgAttr("arGlassesStructuralPivotBoost", "20")).trim());
          return Number.isFinite(b) && b > 0 ? b : 20;
        })()
      : 20;
    const glassesStructuralPivotClampMin = glassesStructuralMindarRig
      ? (() => {
          const m = Number(String(cfgAttr("arGlassesStructuralPivotScaleMin", "80")).trim());
          return Number.isFinite(m) && m > 0 ? m : 80;
        })()
      : 80;
    const glassesStructuralPivotClampMax = glassesStructuralMindarRig
      ? (() => {
          const m = Number(String(cfgAttr("arGlassesStructuralPivotScaleMax", "150")).trim());
          return Number.isFinite(m) && m > 0 ? m : 150;
        })()
      : 150;
    const glassesStructuralAxes =
      glassesStructuralMindarRig &&
      /^(1|true|yes|on)$/.test(String(cfgAttr("arGlassesStructuralAxes", "0")).trim().toLowerCase());

    /**
     * Ancoragem por geometria (opcional): `data-ar-glasses-geometry-anchor="1"`
     * — `glassesPivot` como filho **directo** de `anchor.group` (origem ≈ LM168),
     * offsets por defeito linha dos olhos / profundidade (Y≈−0.035, Z≈−0.08),
     * escala no pivot (base 120, clamp 80–150), **sem rotação Z** no pivot. Incompatível com rig estrutural.
     */
    let glassesGeometryAnchor =
      accessoryType === "glasses" &&
      !glassesManualMindarRig &&
      /^(1|true|yes|on)$/.test(
        String(cfgAttr("arGlassesGeometryAnchor", "0")).trim().toLowerCase(),
      );
    if (glassesStructuralMindarRig) glassesGeometryAnchor = false;
    const glassesGeometryOffsetDefaults = glassesGeometryAnchor
      ? parseXyzMeters(
          cfgAttr("arGlassesGeometryOffsetXyz", "0 -0.035 -0.08"),
          0,
          -0.035,
          -0.08,
        )
      : null;
    const glassesGeometryPivotScaleInit = glassesGeometryAnchor
      ? (() => {
          const s = Number(String(cfgAttr("arGlassesGeometryPivotScale", "120")).trim());
          return Number.isFinite(s) && s > 0
            ? THREE.MathUtils.clamp(s, OMAFIT_GLASSES_PIVOT_FACE_SCALE_MIN, OMAFIT_GLASSES_PIVOT_FACE_SCALE_MAX)
            : OMAFIT_GLASSES_PIVOT_FACE_SCALE_BASE;
        })()
      : 120;
    const glassesGeometryPivotPosTemplate =
      glassesGeometryAnchor && glassesGeometryOffsetDefaults
        ? new THREE.Vector3(
            glassesGeometryOffsetDefaults.x +
              wearPosM.x +
              glassesLocalFineM.x +
              glassesManualCalibParsed.x,
            glassesGeometryOffsetDefaults.y +
              wearPosM.y +
              glassesLocalFineM.y +
              glassesManualCalibParsed.y,
            glassesGeometryOffsetDefaults.z +
              wearPosM.z +
              glassesLocalFineM.z +
              glassesManualCalibParsed.z +
              glassesDepthForwardM +
              glassesZFitExtra,
          )
        : null;

    /**
     * Óculos automáticos **sem** Tripo/geometria/bochechas/standardize: `faceMatrix` →
     * `glassesTrackingWrap` (interpupilar + profundidade base), bind no `glassesStaticBindWrap`.
     * Calibração loja: `scale` no mesh (IPD×`omafit-glasses-calibration.js`); `wearX/Y/Z` em
     * metros no grupo `glassesMerchantWear` (paridade com o preview admin).
     */
    const glassesSimpleFaceOnly =
      accessoryType === "glasses" &&
      !glassesStructuralMindarRig &&
      !glassesGeometryAnchor &&
      !glassesCheekOrthogonalBasis &&
      !glassesGlbStandardize;

    /** Valores do metafield `omafit.ar_calibration` — mesma semântica que `applyCalibrationToState` no admin. */
    const glassesMerchantCal = (() => {
      const cal =
        initialFaceCal && typeof initialFaceCal === "object" ? initialFaceCal : {};
      const num = (k, def) => {
        const n = Number(cal[k]);
        return Number.isFinite(n) ? n : def;
      };
      const sc = num("scale", 1);
      return {
        scale: sc > 0 ? sc : 1,
        wearX: num("wearX", 0),
        wearY: num("wearY", 0),
        wearZ: num("wearZ", 0),
      };
    })();

    /**
     * Modo simples: offsets de calibração (m) vão em `glassesMerchantWear` (eixos da face),
     * não em `wearPosition` (unidades da âncora MindAR — distintas dos metros do admin).
     */
    const wearPosMEffective = glassesSimpleFaceOnly
      ? { x: 0, y: 0, z: 0 }
      : wearPosM;
    const glassesLocalFineMEffective = glassesSimpleFaceOnly
      ? { x: 0, y: 0, z: 0 }
      : glassesLocalFineM;
    /**
     * Modo simples: o deslocamento interpupilar e o “colar” ao rosto vêm do
     * `glassesMerchantWear` (metros, eixos locais do wrap = face). Sem offset em `wearPosition`.
     */
    const glassesDepthForwardMEffective = glassesSimpleFaceOnly
      ? OMAFIT_GLASSES_DEPTH_FORWARD_DEFAULT_M
      : glassesDepthForwardM;
    const glassesFaceForwardLocalM = glassesSimpleFaceOnly ? 0 : OMAFIT_GLASSES_FACE_LOCAL_FORWARD_M;

    const glassesPivotConfigEffective =
      accessoryType === "glasses" && glassesPivotConfig
        ? glassesSimpleFaceOnly
          ? {
              offsetX: 0,
              offsetY: 0,
              offsetZ: 0,
              rotX: 0,
              rotY: 0,
              rotZ: 0,
              scale: glassesPivotConfig.scale,
            }
          : glassesPivotConfig
        : glassesPivotConfig;

    /**
     * Translação do `glassesTrackingWrap` na **ponte nasal** (landmark 168), alinhada à
     * origem canónica do GLB (entre as lentes) e à âncora MindAR. IPD (33/263) só para escala.
     * Opt-out: `data-ar-glasses-eye-midpoint-align="0"`. Inactivo: manual MindAR, estrutural,
     * geometria, `data-ar-glasses-cheek-orthogonal-basis="1"`.
     */
    const glassesEyeMidpointAlign =
      accessoryType === "glasses" &&
      !glassesManualMindarRig &&
      !glassesStructuralMindarRig &&
      !glassesGeometryAnchor &&
      !glassesCheekOrthogonalBasis &&
      !/^(0|false|off|no)$/i.test(String(cfgAttr("arGlassesEyeMidpointAlign", "1")).trim());
    
    const glassesManualTargetWidthFactor = glassesManualMindarRig
      ? (() => {
          const v = Number(String(cfgAttr("arGlassesManualTargetWidthFactor", "1.1")).trim());
          return Number.isFinite(v) && v > 0 ? v : OMAFIT_GLASSES_MANUAL_FACE_WIDTH_TO_FRAME_FACTOR_DEFAULT;
        })()
      : OMAFIT_GLASSES_MANUAL_FACE_WIDTH_TO_FRAME_FACTOR_DEFAULT;
    /** Trim **X/Y/Z** em `metricLandmarks`, somado directamente a `mid(olhos)−168` (sem quaternion na posição). Attr: `data-ar-glasses-manual-face-basis-offset-m`. */
    const glassesManualFaceBasisOffsetM = glassesManualMindarRig
      ? parseXyzMeters(
          cfgAttr("arGlassesManualFaceBasisOffsetM", "0 -0.02 -0.05"),
          0,
          -0.02,
          -0.05,
        )
      : { x: 0, y: 0, z: 0 };
    /** Lerp posição / slerp quat do pivot manual por frame (`data-ar-glasses-manual-pivot-smooth`, clamp 0.6–0.85). */
    const glassesManualPivotSmoothAlpha = glassesManualMindarRig
      ? (() => {
          const v = Number(
            String(cfgAttr("arGlassesManualPivotSmooth", String(OMAFIT_GLASSES_MANUAL_PIVOT_LERP_DEFAULT))).trim(),
          );
          if (!Number.isFinite(v)) return OMAFIT_GLASSES_MANUAL_PIVOT_LERP_DEFAULT;
          return THREE.MathUtils.clamp(v, 0.6, 0.85);
        })()
      : 1;
    const glassesOffsetFinalM = parseOffsetFinal(cfgAttr("arGlassesOffsetFinalM", "0 0 0"));
    try {
      console.log("[omafit-ar] FINAL OFFSET (authoritative)", glassesOffsetFinalM);
    } catch {
      /* ignore */
    }

    /**
     * Contentor de orientação: quando activo (default para óculos), o GLB
     * entra num `offsetGroup` que aplica um **quaternion canônico**
     * determinístico (PCA + heurística rim) para mapear os eixos do
     * GLB → referencial da âncora MindAR (largura=X, topo=+Y, lentes=+Z).
     * O quaternion resultante fica no **mesh** `glasses`; opcionalmente
     * `tripOffsetGroup` (sliders ecrã) fica entre `calibRot` e `glassesPivot`.
     *
     * Override manual (em graus, eixos mundo Y→X→Z): `arGlassesTripoOffsetWorldDeg`
     * — ex.: `"-90,180,0"`. Quando presente e diferente do sentinel
     * `auto`, ignora o cálculo automático.
     *
     * Desligar o contentor por completo: `data-ar-glasses-tripto-offset-container="0"`.
     */
    const useTripoOffsetContainer =
      accessoryType === "glasses" &&
      !glassesSimpleFaceOnly &&
      !glassesManualMindarRig &&
      !glassesStructuralMindarRig &&
      !glassesGeometryAnchor &&
      !glassesCanonicalBlenderExport &&
      !glassesGlbStandardize &&
      !/^(0|off|false|no)$/.test(
        String(cfgAttr("arGlassesTripoOffsetContainer", "1")).trim().toLowerCase(),
      );
    if (accessoryType === "glasses") {
      console.log("[omafit-ar] pipeline óculos (verificar build + modo)", {
        build: OMAFIT_AR_WIDGET_BUILD,
        glassesSimpleFaceOnly,
        glassesManualMindarRig,
        glassesCanonicalBlenderExport,
        glassesGlbStandardize,
        useTripoOffsetContainer,
        hint: glassesSimpleFaceOnly
          ? "Pipeline simples: faceMesh → tracking wrap + mesh estático (sem wear/calib Tripo)."
          : null,
      });
    }
    const tripOffRaw = String(cfgAttr("arGlassesTripoOffsetWorldDeg", "auto")).trim().toLowerCase();
    const tripOffUseAuto = tripOffRaw === "" || tripOffRaw === "auto";
    const tripOffParts = tripOffRaw.split(",").map((s) => parseFloat(String(s).trim()));
    const tripDegY = tripOffUseAuto || !Number.isFinite(tripOffParts[0]) ? 0 : tripOffParts[0];
    const tripDegX = tripOffUseAuto || !Number.isFinite(tripOffParts[1]) ? 0 : tripOffParts[1];
    const tripDegZ = tripOffUseAuto || !Number.isFinite(tripOffParts[2]) ? 0 : tripOffParts[2];

    /**
     * Painel +/- de rotação no ecrã: **desligado por defeito** (`data-ar-glasses-screen-rot="1"` para ligar).
     * Query: `?omafit_ar_glasses_screen_rot=0|1`.
     */
    const screenRotAttr = String(cfgAttr("arGlassesScreenRot", "0")).trim().toLowerCase();
    let useGlassesScreenRot =
      accessoryType === "glasses" && /^(1|on|true|yes)$/.test(screenRotAttr);
    try {
      const q = new URLSearchParams(window.location?.search || "");
      const qv = (q.get("omafit_ar_glasses_screen_rot") || "").trim().toLowerCase();
      if (accessoryType === "glasses") {
        if (qv === "1" || qv === "true") useGlassesScreenRot = true;
        if (qv === "0" || qv === "false") useGlassesScreenRot = false;
      }
    } catch {
      /* ignore */
    }

    /**
     * Eixo da “largura” do óculos no plano transversal: MindAR aplica
     * escala bochecha→largura no maior de X local vs Z local. A heurística
     * de profundidade (`omafit-glasses-orient.js`) roda a seguir, logo
     * recalculamos a decisão pós-bind (não a bbox pré-rotatória).
     */
    let glassesFaceWideAxisX = sz.x >= sz.z;
    /**
     * Quaternion canônico calculado pelo `computeGlassesCanonicalOffsetQuat`
     * (mapeia eixos locais do GLB → eixos da âncora MindAR de forma
     * determinística). Aplicado mais abaixo ao `tripOffsetGroup` quando
     * `useTripoOffsetContainer` está activo e o utilizador não forçou
     * rotações manuais em graus.
     */
    let tripCanonicalQuat = null;
    let tripCanonicalDetected = null;
    /** Debug A/B: `?omafit_ar_skip_trip_canonical=1` não corre `computeGlassesCanonicalOffsetQuat`. */
    let omafitArSkipTripCanonicalQuatDebug = false;
    try {
      omafitArSkipTripCanonicalQuatDebug =
        new URLSearchParams(typeof window !== "undefined" ? window.location.search || "" : "").get(
          "omafit_ar_skip_trip_canonical",
        ) === "1";
    } catch {
      omafitArSkipTripCanonicalQuatDebug = false;
    }

    if (accessoryType === "glasses" && !glassesStructuralMindarRig && useTripoOffsetContainer) {
      glasses.rotation.set(0, 0, 0);
      glasses.quaternion.identity();
      glasses.updateMatrix();
      glasses.updateMatrixWorld(true);
      const szC = new THREE.Vector3();
      new THREE.Box3().setFromObject(glasses).getSize(szC);
      glassesFaceWideAxisX = szC.x >= szC.z;
      if (tripOffUseAuto && !omafitArSkipTripCanonicalQuatDebug) {
        try {
          const canon = computeGlassesCanonicalOffsetQuat(THREE, glasses);
          if (canon && canon.quat) {
            tripCanonicalQuat = canon.quat;
            tripCanonicalDetected = canon.detected;
            console.log("[omafit-ar] glasses canonical offset quat (auto, determinístico)", {
              widthAxis: canon.detected?.widthAxisIdx,
              heightAxis: canon.detected?.heightAxisIdx,
              depthAxis: canon.detected?.depthAxisIdx,
              depthFrontSign: canon.detected?.depthFrontSign,
              rimHeightSign: canon.rimHeightSign,
              widthSign: canon.signs?.widthSign,
              flippedWidthForRotation: canon.signs?.flippedWidthForRotation,
              confidence: canon.detected?.confidence,
              sizeBbox: { x: szC.x, y: szC.y, z: szC.z },
            });
          } else {
            console.warn("[omafit-ar] canonical quat: confiança baixa — fallback Y-90 X180");
          }
        } catch (e) {
          console.warn("[omafit-ar] canonical quat falhou:", e?.message || e);
        }
      } else if (tripOffUseAuto && omafitArSkipTripCanonicalQuatDebug) {
        try {
          console.warn(
            "[omafit-ar] DEBUG: canonicalQuat Tripo omitido (?omafit_ar_skip_trip_canonical=1). Se alinhar → problema era auto-canonical.",
          );
        } catch {
          /* noop */
        }
      } else {
        console.log("[omafit-ar] glasses Tripo offset container (manual em graus)", {
          arGlassesTripoOffsetWorldDeg: { y: tripDegY, x: tripDegX, z: tripDegZ },
        });
      }
    } else if (
      accessoryType === "glasses" &&
      !glassesStructuralMindarRig &&
      !glassesManualMindarRig &&
      !glassesGlbStandardize
    ) {
      if (glassesCanonicalBlenderExport) {
        glasses.updateMatrixWorld(true);
        const szCan = new THREE.Vector3();
        new THREE.Box3().setFromObject(glasses).getSize(szCan);
        glassesFaceWideAxisX = szCan.x >= szCan.z;
        try {
          console.log("[omafit-ar] glasses canonical Blender export — sem bind automático / Tripo.", {
            bbox: { x: szCan.x, y: szCan.y, z: szCan.z },
          });
        } catch {
          /* ignore */
        }
      } else {
        const rawBind = String(cfgAttr("arGlassesMindarBindFix", "") || "").trim();
        const rb = rawBind.toLowerCase();
        const autoAttr = String(
          cfgAttr("arGlassesAutoDepthAxis", "1"),
        ).trim().toLowerCase();
        const simpleFaceOnlyBindCandidate =
          !glassesManualMindarRig &&
          !glassesStructuralMindarRig &&
          !glassesGlbStandardize &&
          !glassesGeometryAnchor &&
          !glassesCheekOrthogonalBasis;
        const useAutoDepthAxis =
          !simpleFaceOnlyBindCandidate &&
          !/^(0|off|false|no|legacy|ry180|manual)$/.test(autoAttr);
        let bx = 0;
        let by = 0;
        let bz = 0;
        let applyBind = false;
        if (!rb || rb === "auto") {
            let auto = null;
            if (useAutoDepthAxis) {
              try {
                auto = applyGlassesAutoBind(THREE, glasses);
              } catch (e) {
                console.warn("[omafit-ar] glasses auto depth-axis falhou", e?.message || e);
              }
            }
            if (auto) {
              const { signs } = auto;
              const szPost = new THREE.Vector3();
              new THREE.Box3().setFromObject(glasses).getSize(szPost);
              glassesFaceWideAxisX = szPost.x >= szPost.z;
              console.log("[omafit-ar] glasses auto depth-axis bind", {
                widthAxis: auto.detected?.widthAxisIdx,
                heightAxis: auto.detected?.heightAxisIdx,
                depthAxis: auto.detected?.depthAxisIdx,
                depthFrontSign: auto.detected?.depthFrontSign,
                rimHeightSign: auto.rimHeightSign,
                widthSign: signs?.widthSign,
                flippedWidthForRotation: signs?.flippedWidthForRotation,
                confidence: auto.detected?.confidence,
                sizeBboxPre: { x: sz.x, y: sz.y, z: sz.z },
                sizeBboxPost: { x: szPost.x, y: szPost.y, z: szPost.z },
              });
              /**
               * Em alguns GLBs a auto-bind fica ambígua e o fix de handedness
               * (`flippedWidthForRotation`) vira a armação para o lado errado.
               * Neste caso aplicamos fallback determinístico `Ry(180)`.
               */
              if (signs?.flippedWidthForRotation) {
                bx = 0;
                by = 180;
                bz = 0;
                omafitApplyGlassesMindarBindFix(THREE, glasses, bx, by, bz);
                glasses.updateMatrixWorld(true);
                const szFix = new THREE.Vector3();
                new THREE.Box3().setFromObject(glasses).getSize(szFix);
                glassesFaceWideAxisX = szFix.x >= szFix.z;
                console.warn("[omafit-ar] auto-bind ambíguo (flippedWidthForRotation); fallback Ry(180)", {
                  widthSign: signs?.widthSign,
                  rimHeightSign: auto.rimHeightSign,
                  sizeBbox: { x: szFix.x, y: szFix.y, z: szFix.z },
                });
              }
            } else {
              /**
               * GLB Omafit canonical: frente lentes -Z, hastes +Z. Fallback
               * quando a auto heurística rejeita (malha demasiado simétrica) ou
               * está desligada: **Ry = 180°** (`π` rad) — alinhado à rotação base única.
               */
              applyBind = true;
              bx = 0;
              by = 180;
              bz = 0;
              omafitApplyGlassesMindarBindFix(THREE, glasses, bx, by, bz);
              const szPost = new THREE.Vector3();
              new THREE.Box3().setFromObject(glasses).getSize(szPost);
              glassesFaceWideAxisX = szPost.x >= szPost.z;
              console.log("[omafit-ar] glasses MindAR bind fix fallback Ry (°)", {
                rx: bx,
                ry: by,
                rz: bz,
                autoDepth: useAutoDepthAxis,
                sizeBbox: { x: szPost.x, y: szPost.y, z: szPost.z },
              });
            }
        } else if (!/^(0|none|off|false|identity)$/.test(rb)) {
          const p = parseEulerDegComponents(rawBind, 0, 0, 0);
          bx = p.x;
          by = p.y;
          bz = p.z;
          applyBind =
            Math.abs(bx) > 1e-6 ||
            Math.abs(by) > 1e-6 ||
            Math.abs(bz) > 1e-6;
          if (applyBind) {
            omafitApplyGlassesMindarBindFix(THREE, glasses, bx, by, bz);
            const szP = new THREE.Vector3();
            new THREE.Box3().setFromObject(glasses).getSize(szP);
            glassesFaceWideAxisX = szP.x >= szP.z;
            console.log("[omafit-ar] glasses MindAR bind fix (°)", {
              rx: bx,
              ry: by,
              rz: bz,
              mode: rawBind,
            });
          }
        }
      }
    } else if (accessoryType === "glasses" && glassesStructuralMindarRig) {
      /**
       * Pipeline estrutural: `normalizeGlassesModel` (sem bind/Tripo) — só **`Ry(π)`** fixo.
       */
      normalizeGlassesModel(THREE, glasses, {
        skipBboxCenter: glassesCanonicalBlenderExport,
        recenterAfterRotation: !glassesCanonicalBlenderExport,
      });
      glasses.updateMatrixWorld(true);
      const bStr = new THREE.Box3().setFromObject(glasses);
      const szStr = new THREE.Vector3();
      bStr.getSize(szStr);
      glassesFaceWideAxisX = szStr.x >= szStr.z;
      console.log("[omafit-ar] glasses structural MindAR rig (normalizeGlassesModel Ry=π)", {
        bbox: { x: szStr.x, y: szStr.y, z: szStr.z },
      });
    }
    let glassesManualModelWidth = 1;
    if (glassesManualMindarRig) {
      omafitApplyGlassesManualMindarCenterMesh(THREE, glasses);
      glasses.updateMatrixWorld(true);
      const boxMan = new THREE.Box3().setFromObject(glasses);
      const szMan = new THREE.Vector3();
      boxMan.getSize(szMan);
      /** Largura horizontal do GLB: max(X,Z) da bbox (metros, mesh centrado); Y = altura — evita GLB com largura no Z. */
      const modelHeight = szMan.y;
      glassesManualModelWidth = Math.max(szMan.x, szMan.z, 1e-6);
      glassesFaceWideAxisX = szMan.x >= szMan.z;
      console.log("MODEL WIDTH USED:", glassesManualModelWidth);
      console.log("BBOX:", { x: szMan.x, y: szMan.y, z: szMan.z });
      console.log("[omafit-ar] glasses manual MindAR (centro GLB; pivot estável + escala interpupilar)", {
        bboxSize: { x: szMan.x, y: szMan.y, z: szMan.z },
        modelHeight,
        modelWidth: glassesManualModelWidth,
      });
    }

    /**
     * Após `omafitApplyGlassesMindarBindFix` / `applyGlassesAutoBind`, a bbox
     * deixa de estar centrada na origem — o óculos roda em torno do nariz mas
     * o mesh fica deslocado lateralmente. Re-centrar antes da escala base.
     */
    if (accessoryType === "glasses" && glassesBboxRecenterPostBind && !glassesStructuralMindarRig) {
      omafitRecenterObject3OnGlassesLensFront(THREE, glasses);
      glasses.updateMatrixWorld(true);
      const szPivot = new THREE.Vector3();
      new THREE.Box3().setFromObject(glasses).getSize(szPivot);
      glassesFaceWideAxisX = szPivot.x >= szPivot.z;
    }

    /** Colar: separar corrente vs pingente para escala radial (k,1,k) sem esticar o pingente. */
    let necklacePartition = null;
    if (accessoryType === "necklace") {
      try {
        necklacePartition = omafitPartitionNecklaceChainPendant(THREE, glasses);
      } catch (e) {
        console.warn("[omafit-ar] necklace GLB partition:", e?.message || e);
      }
    }

    /**
     * Escala inicial no mesh: óculos **(1,1,1)** — em cada frame `onUpdate`, `glasses.scale` = IPD×1,5.
     * Joias (colar, …): normalizar pelo maior lado da bbox (`1/maxDim`).
     */
    const accessoryMeshNormalizeScale = accessoryType === "glasses" ? 1 : 1 / maxDim;
    if (accessoryType === "glasses") {
      if (!glassesManualMindarRig) {
        glasses.scale.set(1, 1, 1);
      }
    } else {
      glasses.scale.setScalar(accessoryMeshNormalizeScale);
    }
    console.log("[omafit-ar] face scale resolved", {
      glbMaxDim: maxDim,
      accessoryMeshNormalizeScale,
      glassesSimpleFaceOnly,
      wearPosM: wearPosMEffective,
      glassesLocalFineM: glassesLocalFineMEffective,
      anchorIndex,
      disableFaceMirror,
      sizeBbox: { x: sz.x, y: sz.y, z: sz.z },
      glassesAnatomicWidthFactor,
      glassesDepthForwardM: glassesDepthForwardMEffective,
    });

    const glassesStaticBindQuatPostBind =
      accessoryType === "glasses" ? glasses.quaternion.clone() : null;

    /** 4) Hierarquia (óculos):
     *   anchor.group → wearPosition → faceParent → calibRot → [tripOffsetGroup] →
     *   glassesPivot → glasses (GLB).
     *
     *     - Rastreio MindAR: `anchor.group.matrix` + descendentes.
     *     - `tripOffsetGroup`: só com contentor Tripo / sliders ecrã (opcional).
     *     - `glassesPivot`: offsets, rotação lojista + yaw anatómico (quaternion),
     *       escala **loja** (`cfg.scale`); escala anatómica no **mesh** (`glasses`).
     *     - Bind/Tripo no load; mesh nivelado em YXZ (só yaw) após montar no pivot.
     *     - `wearPosition` translada em unidades de âncora (≈ 14cm/unit em mundo).
     *
     *     SEM `centerOffset`/`bridgeY`: o comportamento anterior dependia da
     *     altura (sz.y) do GLB, e como estava por FORA de `calibRot` mas em
     *     unidades do GLB, o efeito variava conforme a geometria. Agora tudo
     *     se reduz a wearX/Y/Z em unidades de âncora (previsíveis).
     */
    /**
     * `calibRot`: rotação de calibração do lojista (rx/ry/rz via `applyThreeGroupCalibRot`).
     * Aplicada uma vez no load / troca de variante — não acumula com pose MindAR.
     *
     * `wearPosM`: `wearPosition.position.set`; óculos manual MindAR forçado a wear 0 nos attrs.
     * Óculos automáticos: escala interpupilar no mesh por frame.
     */
    const calibRot = new GroupCtor();
    calibRot.position.set(0, 0, 0);
    calibRot.scale.set(1, 1, 1);
    calibRot.rotation.order = "XYZ";
    calibRot.rotation.set(0, 0, 0);
    calibRot.quaternion.identity();
    if (accessoryType === "glasses" && initialFaceCal) {
      applyThreeGroupCalibRot(calibRot, initialFaceCal);
    }
    calibRot.updateMatrix();
    calibRot.updateMatrixWorld(true);
    const glassesAnatomy =
      accessoryType === "necklace" ? new GroupCtor() : null;
    if (glassesAnatomy) {
      glassesAnatomy.name = "omafit-ar-necklace-anatomy";
      glassesAnatomy.rotation.order = "YXZ";
    }
    /** Pai lógico sob `wearPosition` — a matriz de tracking continua em `anchor.group`. */
    const faceParentGroup = new GroupCtor();
    faceParentGroup.name = "omafit-ar-face-parent";
    /** Correcção opcional de espelho CSS no eixo X (sem tocar na `PerspectiveCamera`). */
    const projectionMirrorFix = new GroupCtor();
    projectionMirrorFix.name = "omafit-ar-projection-mirror-fix";
    /**
     * Só óculos com `useTripoOffsetContainer`: orientação canônica (auto
     * PCA) ou rotação fixa (override manual em graus).
     */
    /** @type {InstanceType<typeof GroupCtor> | null} */
    let tripOffsetGroup = null;
    /**
     * Estado mutável lido no loop de render; também exposto no painel de
     * sliders. Inicialmente converte o quat canônico (ou o fallback em
     * graus) para Euler **XYZ** — a mesma ordem que `rotation.set(x,y,z)`
     * usa por defeito. Assim os sliders abrem já na orientação correcta.
     * @type {{rotX:number, rotY:number, rotZ:number, posX:number, posY:number, posZ:number}|null}
     */
    let glassesOffset = null;
    if (useTripoOffsetContainer && accessoryType === "glasses") {
      tripOffsetGroup = new GroupCtor();
      tripOffsetGroup.name = "omafit-ar-tripto-offset";
      tripOffsetGroup.rotation.order = "XYZ";
      let initialQuat = null;
      if (tripCanonicalQuat) {
        initialQuat = tripCanonicalQuat.clone();
      } else {
        /** Fallback: utilizador forçou graus ou PCA com baixa confiança → Y=-90°, X=180°. */
        const fy = tripOffUseAuto ? -90 : tripDegY;
        const fx = tripOffUseAuto ? 180 : tripDegX;
        const fz = tripOffUseAuto ? 0 : tripDegZ;
        const tmp = new GroupCtor();
        omafitApplyGlassesTripoOffsetContainer(THREE, tmp, fy, fx, fz);
        initialQuat = tmp.quaternion.clone();
      }
      const eul = new THREE.Euler().setFromQuaternion(initialQuat, "XYZ");
      glassesOffset = {
        rotX: eul.x,
        rotY: eul.y,
        rotZ: eul.z,
        posX: 0,
        posY: 0,
        posZ: 0,
      };
      tripOffsetGroup.rotation.set(glassesOffset.rotX, glassesOffset.rotY, glassesOffset.rotZ);
      tripOffsetGroup.position.set(glassesOffset.posX, glassesOffset.posY, glassesOffset.posZ);
      tripOffsetGroup.updateMatrix();
    }
    /** @type {THREE.Group | null} */
    let necklaceSwingGroup = null;
    let necklaceShadowParts = null;
    /** Grupo intermédio: escala + fade de entrada sem afectar escalas anatómicas no mesh. */
    let microUxModelWrap = null;
    /** Grupo filho do pivot: origem = ponto lógico de try-on; o mesh `glasses` desloca-se dentro sem editar o GLB. */
    let glassesModelWrap = null;
    /** @type {THREE.Group | null} Pose facial (matrix da malha) — filho do model wrap; o GLB filho mantém só correcções estáticas. */
    let glassesTrackingWrap = null;
    /** Calibração wearX/Y/Z (m) — filho do tracking wrap; tem de existir no âmbito de `faceArEnhancementState`. */
    let glassesMerchantWear = null;
    let glassesPivot = null;
    /** Cópia da posição inicial do pivot (Z inclui `arGlassesZFitExtra` se aplicável) — repor antes do alinhamento debug 168. */
    let glassesPivotBaseLocalPos = null;
    if (accessoryType === "glasses") {
      glassesPivot = new GroupCtor();
      glassesPivot.name = "omafit-ar-glasses-pivot";
      glassesPivot.rotation.order = "XYZ";
      if (glassesStructuralMindarRig && glassesStructuralPivotPosVec) {
        glassesPivot.position.set(
          glassesStructuralPivotPosVec.x,
          glassesStructuralPivotPosVec.y,
          glassesStructuralPivotPosVec.z,
        );
        glassesPivot.rotation.set(
          0,
          rad(Number.isFinite(glassesStructuralPivotRotYDeg) ? glassesStructuralPivotRotYDeg : 0),
          0,
        );
        glassesPivot.scale.setScalar(1);
      } else if (glassesManualMindarRig) {
        /** Posição/escala no pivot; rotação da cabeça só no `anchor.group` (MindAR). */
        glassesPivot.matrixAutoUpdate = true;
        glassesPivot.position.set(0, 0, 0);
        glassesPivot.rotation.set(0, 0, 0);
        glassesPivot.scale.setScalar(1);
      } else if (glassesGeometryAnchor && glassesGeometryPivotPosTemplate) {
        glassesPivot.position.copy(glassesGeometryPivotPosTemplate);
        glassesPivot.rotation.order = "XYZ";
        glassesPivot.rotation.set(0, 0, 0);
        glassesPivot.scale.setScalar(glassesGeometryPivotScaleInit);
      } else if (glassesPivotConfigEffective) {
        const sc0 = Number(glassesPivotConfigEffective.scale);
        const scClamped = Number.isFinite(sc0) && sc0 > 0 ? THREE.MathUtils.clamp(sc0, 0.25, 4) : 1;
        glassesPivot.scale.setScalar(scClamped);
        glassesPivot.position.set(
          glassesPivotConfigEffective.offsetX,
          glassesPivotConfigEffective.offsetY,
          glassesPivotConfigEffective.offsetZ,
        );
        glassesPivot.rotation.set(
          rad(glassesPivotConfigEffective.rotX),
          rad(glassesPivotConfigEffective.rotY),
          rad(glassesPivotConfigEffective.rotZ),
        );
      } else {
        glassesPivot.scale.setScalar(1);
      }
      if (glassesGeometryAnchor) {
        anchor.group.add(glassesPivot);
      } else if (glassesManualMindarRig) {
        anchor.group.add(glassesPivot);
      } else if (tripOffsetGroup) {
        calibRot.add(tripOffsetGroup);
        tripOffsetGroup.add(glassesPivot);
      } else {
        calibRot.add(glassesPivot);
      }
      glassesModelWrap = new GroupCtor();
      glassesModelWrap.name = "omafit-ar-glasses-model-wrap";
      if (!microUxDisabled) {
        microUxModelWrap = new GroupCtor();
        microUxModelWrap.name = "omafit-ar-micro-ux-wrap";
        microUxModelWrap.add(glassesModelWrap);
        glassesPivot.add(microUxModelWrap);
      } else {
        glassesPivot.add(glassesModelWrap);
      }
      const useGlassesTrackingWrap =
        accessoryType === "glasses" && !glassesManualMindarRig && !glassesGlbStandardize;
      /** Pai do mesh: rotação de bind glTF→MindAR; o wrap de tracking aplica só a pose da face (não zera o bind a cada frame). */
      let glassesStaticBindWrap = null;
      if (useGlassesTrackingWrap) {
        glassesTrackingWrap = new GroupCtor();
        glassesTrackingWrap.name = "omafit-ar-glasses-tracking-wrap";
        glassesModelWrap.add(glassesTrackingWrap);
        glassesMerchantWear = new GroupCtor();
        glassesMerchantWear.name = "omafit-ar-glasses-merchant-wear";
        glassesTrackingWrap.add(glassesMerchantWear);
        glassesStaticBindWrap = new GroupCtor();
        glassesStaticBindWrap.name = "omafit-ar-glasses-static-bind";
        glassesMerchantWear.add(glassesStaticBindWrap);
        glassesStaticBindWrap.add(glasses);
      } else {
        glassesModelWrap.add(glasses);
      }
      glasses.name = "omafit-ar-glasses-model";
      if (glassesManualMindarRig) {
        glasses.matrixAutoUpdate = true;
        glasses.scale.set(1, 1, 1);
        glasses.rotation.order = "XYZ";
        glasses.rotation.set(0, Math.PI, 0);
        glasses.updateMatrix();
      } else if (glassesGlbStandardize) {
        glasses.scale.set(1, 1, 1);
        glasses.rotation.order = "XYZ";
        glasses.rotation.set(0, Math.PI, 0);
        glasses.updateMatrix();
      } else {
        glasses.scale.set(1, 1, 1);
        glasses.rotation.order = "XYZ";
        glasses.rotation.set(0, 0, 0);
      }
      if (
        !glassesStructuralMindarRig &&
        !glassesManualMindarRig &&
        !glassesCanonicalBlenderExport &&
        !glassesGlbStandardize
      ) {
        omafitStripGlassesMeshRollYxz(THREE, glasses);
      }
      if (glassesStaticBindWrap) {
        glasses.updateMatrix();
        glassesStaticBindWrap.position.set(0, 0, 0);
        glassesStaticBindWrap.scale.set(1, 1, 1);
        if (glassesStaticBindQuatPostBind) {
          glassesStaticBindWrap.quaternion.copy(glassesStaticBindQuatPostBind);
        } else {
          glassesStaticBindWrap.quaternion.copy(glasses.quaternion);
        }
        glasses.quaternion.identity();
        glasses.rotation.set(0, 0, 0);
      }
      /** Centro lógico no wrap: translação só no mesh `glasses` (GLB inalterado). Com **tracking wrap**, soma também offset empírico estático. */
      if (accessoryType === "glasses") {
        const nx = Number.isFinite(glassesNoseAlignOffsetXM) ? glassesNoseAlignOffsetXM : 0;
        const cx = glassesModelCenterOffsetM.x + nx;
        const cy = glassesModelCenterOffsetM.y;
        const cz = glassesModelCenterOffsetM.z;
        if (glassesManualMindarRig) {
          glasses.position.x += cx;
          glasses.position.y += cy;
          glasses.position.z += cz;
        } else if (glassesTrackingWrap) {
          glasses.position.set(
            cx + glassesEmpiricalAlignM.x,
            cy + glassesEmpiricalAlignM.y,
            cz + glassesEmpiricalAlignM.z,
          );
        } else {
          glasses.position.set(cx, cy, cz);
        }
      }
      if (!glassesGeometryAnchor && !glassesManualMindarRig) {
        glassesPivot.position.z += glassesZFitExtra;
      }
      glassesPivotBaseLocalPos = glassesPivot.position.clone();
      if (glassesGeometryAnchor) {
        console.log("[omafit-ar] glasses geometry anchor (pivot directo no anchor.group)", {
          pivotPos: glassesGeometryPivotPosTemplate
            ? {
                x: glassesGeometryPivotPosTemplate.x,
                y: glassesGeometryPivotPosTemplate.y,
                z: glassesGeometryPivotPosTemplate.z,
              }
            : null,
          pivotScale: glassesGeometryPivotScaleInit,
          rotDeg: { x: 0, y: 0, z: 0 },
        });
      }
      if (glassesStructuralAxes && THREE.AxesHelper) {
        const axesH = new THREE.AxesHelper(0.1);
        axesH.name = "omafit-ar-glasses-structural-axes";
        glassesPivot.add(axesH);
      }
      if (glassesManualMindarRig && glassesPivot) {
        console.log(
          "[omafit-ar] glasses manual MindAR — init (bbox-centro no root; mesh prep; pivot pos = mid(263,33)−168 + trim xyz + depthForward Z; rotação só quaternion makeBasis; escala IPD)",
          {
            build: OMAFIT_AR_WIDGET_BUILD,
            faceBasisOffsetM: {
              x: glassesManualFaceBasisOffsetM.x,
              y: glassesManualFaceBasisOffsetM.y,
              z: glassesManualFaceBasisOffsetM.z,
            },
          },
        );
      }
    } else if (accessoryType === "necklace") {
      necklaceSwingGroup = new GroupCtor();
      necklaceSwingGroup.name = "omafit-ar-necklace-swing";
      calibRot.add(necklaceSwingGroup);
      necklaceSwingGroup.add(glassesAnatomy);
      necklaceShadowParts = omafitCreateNecklaceChestDropShadow(THREE);
      necklaceSwingGroup.add(necklaceShadowParts.mesh);
      if (!microUxDisabled) {
        microUxModelWrap = new GroupCtor();
        microUxModelWrap.name = "omafit-ar-micro-ux-wrap";
        microUxModelWrap.add(glasses);
        glassesAnatomy.add(microUxModelWrap);
      } else {
        glassesAnatomy.add(glasses);
      }
    }

    /** Lerp/slerp leve no `glassesPivot` (opcional): `data-ar-glasses-pivot-smooth-ms="55"`. */
    let glassesPivotSmoother = null;
    let glassesPivotSmoothPrevMs = -1;
    const glassesPivotSmoothTauMs = Number(
      String(cfgAttr("arGlassesPivotSmoothMs", "0")).trim(),
    );
    if (
      accessoryType === "glasses" &&
      glassesPivot &&
      !glassesManualMindarRig &&
      !glassesStructuralMindarRig &&
      !glassesGeometryAnchor &&
      Number.isFinite(glassesPivotSmoothTauMs) &&
      glassesPivotSmoothTauMs > 0
    ) {
      glassesPivotSmoother = createMindarGlassesPivotSmoother(THREE, {
        positionTauMs: glassesPivotSmoothTauMs,
        rotationTauMs: glassesPivotSmoothTauMs * 1.08,
        scaleTauMs: glassesPivotSmoothTauMs * 0.95,
      });
    }

    /** Euler XYZ do pivot (graus→rad no `onUpdate`); sem composição Y extra por frame. */
    const glassesPivotPoseScratch =
      accessoryType === "glasses" &&
      glassesPivot &&
      !glassesManualMindarRig &&
      !glassesStructuralMindarRig &&
      !glassesGeometryAnchor
        ? {
            eMerc: new THREE.Euler(0, 0, 0, "XYZ"),
            tmpQuatSrt: new THREE.Quaternion(),
            tmpPosSrt: new THREE.Vector3(),
          }
        : null;

    const wearPosition = new GroupCtor();
    if (accessoryType === "glasses" && glassesManualMindarRig) {
      wearPosition.position.set(0, 0, 0);
    } else {
      wearPosition.position.set(wearPosMEffective.x, wearPosMEffective.y, wearPosMEffective.z);
    }
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
      const mnx = faceProjectionMirrorNegateModelX;
      let negModelX = false;
      if (mnx === "1" || mnx === "true" || mnx === "yes") negModelX = true;
      else if (mnx === "0" || mnx === "false" || mnx === "no") negModelX = false;
      else if (accessoryType === "glasses") {
        /**
         * Por defeito **não** espelhar o ramo 3D em X com o selfie: o MindAR
         * já alinha o frame; `scaleX=-1` no grupo do GLB + `faceMatrix` costuma
         * deslocar a armação (ex.: “virada à esquerda”) após o alinhamento
         * interpupilar. Opt-in: `data-ar-glasses-projection-mirror-model-x="1"`.
         * Outros acessórios: mantém o `auto` ≈ !disableFaceMirror.
         */
        const gmx = String(cfgAttr("arGlassesProjectionMirrorModelX", "0"))
          .trim()
          .toLowerCase();
        if (gmx === "1" || gmx === "true" || gmx === "on" || gmx === "yes") {
          negModelX = true;
        } else if (gmx === "0" || gmx === "false" || gmx === "off" || gmx === "no") {
          negModelX = false;
        } else {
          negModelX = !disableFaceMirror;
        }
      } else {
        negModelX = !disableFaceMirror;
      }
      if (negModelX && !flipSceneX) projectionMirrorFix.scale.set(-1, 1, 1);
      else projectionMirrorFix.scale.set(1, 1, 1);
    } catch {
      wearPosition.scale.set(1, 1, 1);
      projectionMirrorFix.scale.set(1, 1, 1);
    }
    wearPosition.add(projectionMirrorFix);
    projectionMirrorFix.add(faceParentGroup);
    faceParentGroup.add(calibRot);
    if (accessoryType === "glasses" && glassesCheekOrthogonalBasis) {
      faceParentGroup.matrixAutoUpdate = false;
    }

    anchor.group.add(wearPosition);

    if (glassesPivotConfigEffective && !(accessoryType === "glasses" && glassesManualMindarRig)) {
      try {
        window.__omafitGlassesPivotConfig = glassesPivotConfigEffective;
        window.__omafitGlassesManualCalib = glassesPivotConfigEffective;
      } catch {
        /* ignore */
      }
    }

    /** Sombras de contacto suaves (ponte / têmporas) — sem composer WebGL. */
    let glassesContactRig = null;
    if (
      accessoryType === "glasses" &&
      glassesPivot &&
      !/^(0|false|off|no)$/i.test(String(cfgAttr("arGlassesContactShadowRig", "1")).trim())
    ) {
      try {
        glassesContactRig = omafitCreateGlassesContactShadowRig(THREE, glassesPivot);
      } catch (e) {
        console.warn("[omafit-ar] contact shadow rig:", e?.message || e);
      }
    }

    /** Esfera no landmark 168 (origem local do `anchor.group`). Se coincidir com o nariz e o GLB não, o erro é do modelo. */
    let lm168DebugMesh = null;
    if (lm168DebugSphereEnabled) {
      const r = 0.011;
      const geo = new THREE.SphereGeometry(r, 10, 8);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xff0000,
        depthTest: true,
        depthWrite: true,
      });
      lm168DebugMesh = new THREE.Mesh(geo, mat);
      lm168DebugMesh.name = "omafit-ar-lm168-debug-sphere";
      lm168DebugMesh.frustumCulled = false;
      lm168DebugMesh.renderOrder = 999;
      lm168DebugMesh.position.set(0, 0, 0);
      anchor.group.add(lm168DebugMesh);
      console.log(
        "[omafit-ar] debug: esfera vermelha no landmark 168 (âncora). data-ar-landmark-168-debug-sphere=1 ou ?omafit_ar_lm168=1",
      );
    }

    let eyeMidDebugMesh = null;
    let glassesBboxCenterDebugMesh = null;
    /** v23: esferas debug olhos/centro (?omafit_ar_glasses_eye_debug=1). */
    let glassesEyeDebugSpheres = null;
    if (glassesEyeDebugSimple) {
      const geomEye = new THREE.SphereGeometry(0.006, 12, 12);
      const matEye = new THREE.MeshBasicMaterial({
        color: 0xff0000,
        transparent: true,
        opacity: 0.85,
        depthTest: false,
        depthWrite: false,
      });
      glassesEyeDebugSpheres = {
        right: new THREE.Mesh(geomEye, matEye),
        left: new THREE.Mesh(geomEye.clone(), matEye.clone()),
        center: new THREE.Mesh(
          new THREE.SphereGeometry(0.008, 16, 16),
          new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            transparent: true,
            opacity: 0.9,
            depthTest: false,
            depthWrite: false,
          }),
        ),
        scratchR: new THREE.Vector3(),
        scratchL: new THREE.Vector3(),
        scratchMid: new THREE.Vector3(),
      };
      for (const m of [
        glassesEyeDebugSpheres.right,
        glassesEyeDebugSpheres.left,
        glassesEyeDebugSpheres.center,
      ]) {
        m.frustumCulled = false;
        m.renderOrder = 1000;
      }
      glassesEyeDebugSpheres.right.name = "omafit-eye-debug-right";
      glassesEyeDebugSpheres.left.name = "omafit-eye-debug-left";
      glassesEyeDebugSpheres.center.name = "omafit-eye-debug-center";
      anchor.group.add(glassesEyeDebugSpheres.right);
      anchor.group.add(glassesEyeDebugSpheres.left);
      anchor.group.add(glassesEyeDebugSpheres.center);
      try {
        console.log(
          "[omafit-ar] glasses eye debug v23 — vermelho: olhos; verde: centro (?omafit_ar_glasses_eye_debug=1)",
        );
      } catch {
        /* ignore */
      }
    }
    if (glassesEyeMidDebugVisualEnabled) {
      const rDbg = 0.009;
      const mkSphere = (color) => {
        const g = new THREE.SphereGeometry(rDbg, 10, 8);
        const m = new THREE.MeshBasicMaterial({
          color,
          depthTest: true,
          depthWrite: true,
        });
        const mesh = new THREE.Mesh(g, m);
        mesh.frustumCulled = false;
        mesh.renderOrder = 998;
        return mesh;
      };
      eyeMidDebugMesh = mkSphere(0x22ff66);
      eyeMidDebugMesh.name = "omafit-ar-eye-mid-debug";
      glassesBboxCenterDebugMesh = mkSphere(0x33bbff);
      glassesBboxCenterDebugMesh.name = "omafit-ar-glasses-bbox-center-debug";
      anchor.group.add(eyeMidDebugMesh);
      anchor.group.add(glassesBboxCenterDebugMesh);
      try {
        console.log(
          "[omafit-ar] debug visual: verde = mid olhos (metric); ciano = pivô óculos após centro lentes (origem mesh, local âncora). data-ar-glasses-eye-mid-debug-visual=1 ou ?omafit_ar_eye_mid_debug=1",
        );
      } catch {
        /* ignore */
      }
    }

    /** Uniforms partilhados: máscara de cabelo (multiclasse) + espelho UV para alinhar ao vídeo selfie. */
    const hairUniformsFaceAr =
      accessoryType === "glasses" || accessoryType === "necklace"
        ? {
            uOmafitHairMask: { value: null },
            uOmafitHairMirror: { value: new THREE.Vector2(!disableFaceMirror ? 1 : 0, 0) },
            uOmafitHairThreshold: { value: accessoryType === "necklace" ? 0.38 : 0.45 },
          }
        : null;
    if (hairUniformsFaceAr) {
      const px = new Uint8Array(4);
      const ht = new THREE.DataTexture(px, 2, 2, THREE.RedFormat, THREE.UnsignedByteType);
      ht.needsUpdate = true;
      hairUniformsFaceAr.uOmafitHairMask.value = ht;
    }
    const faceLmSmoother =
      accessoryType === "glasses"
        ? createFaceLandmarkOneEuroSmoother(
            THREE,
            [
              OMAFIT_FACE_LM_NOSE_BRIDGE,
              OMAFIT_FACE_LM_EYE_R_OUT,
              OMAFIT_FACE_LM_EYE_L_OUT,
              OMAFIT_FACE_LM_RIGHT_CHEEK,
              OMAFIT_FACE_LM_LEFT_CHEEK,
              OMAFIT_FACE_LM_EAR_L,
              OMAFIT_FACE_LM_EAR_R,
              OMAFIT_FACE_LM_FOREHEAD_TOP,
              OMAFIT_FACE_LM_CHIN,
            ],
            OMAFIT_FACE_ONE_EURO_GLASSES_MIN_CUTOFF,
            OMAFIT_FACE_ONE_EURO_GLASSES_BETA,
            OMAFIT_FACE_ONE_EURO_GLASSES_D_CUTOFF,
          )
        : accessoryType === "necklace"
          ? createFaceLandmarkOneEuroSmoother(
              THREE,
              [
                OMAFIT_FACE_LM_CHIN,
                OMAFIT_FACE_LM_RIGHT_CHEEK,
                OMAFIT_FACE_LM_LEFT_CHEEK,
                OMAFIT_FACE_LM_NOSE_BRIDGE,
              ],
              OMAFIT_FACE_ONE_EURO_MIN_CUTOFF,
              OMAFIT_FACE_ONE_EURO_BETA,
              OMAFIT_FACE_ONE_EURO_D_CUTOFF,
            )
          : null;
    const faceMatrixExtraLambda =
      accessoryType === "glasses"
        ? OMAFIT_FACE_MATRIX_EXTRA_SMOOTH_GLASSES
        : accessoryType === "necklace"
          ? OMAFIT_FACE_MATRIX_EXTRA_SMOOTH_NECKLACE
          : OMAFIT_FACE_MATRIX_EXTRA_SMOOTH;

    /**
     * Buffers pré-alocados usados em cada frame para construir a matriz de
     * base dos óculos a partir dos 5 landmarks (168/33/263/10/152) sem
     * alocar `Vector3`/`Matrix4` temporários. `glassesBasisActive` controla
     * se a rotação da âncora MindAR é substituída pela derivada — desliga
     * via `data-ar-glasses-face-basis="0"` para voltar ao comportamento
     * antigo (só PnP do MindAR).
     */
    const glassesFaceBasisAttr = String(
      cfgAttr("arGlassesFaceBasis", "1"),
    ).trim().toLowerCase();
    const glassesBasisActive =
      accessoryType === "glasses" &&
      !(glassesFaceBasisAttr === "0" ||
        glassesFaceBasisAttr === "off" ||
        glassesFaceBasisAttr === "false" ||
        glassesFaceBasisAttr === "no");

    faceArEnhancementState = {
      microUxDisabled,
      microUxModelWrap,
      glassesModelWrap,
      glassesTrackingWrap,
      glassesMerchantWear,
      microUxGlassesRoot: glasses,
      microUxRingEl: null,
      microUx: {
        introStartMs: performance.now(),
        snapBoost: 1,
        hasFacePrev: false,
        preparedOpacity: false,
        introComplete: false,
      },
      faceProjectionOpts,
      projectionSyncLogged: false,
      positionLogged: false,
      glassesNdcScreenLock,
      glassesNdcBlendFromMp,
      glassesLensDistortK,
      glassesNegateWearOffsetX,
      glassesEyeMidpointAlign,
      glassesSimpleFaceOnly,
      anchorFaceLm: anchorIndex,
      glassesMerchantCal,
      glassesAutoFitScaleRef: computeGlassesPreviewBaseScale(
        glassesFrameWidthLocal,
        OMAFIT_GLASSES_SCALE_IPD_MUL_SIMPLE_FACE,
      ),
      glassesLastMeshScale: null,
      glassesFrameWidthLocal,
      eyeMidWearSmoothed: glassesEyeMidpointAlign ? new THREE.Vector3(0, 0, 0) : null,
      eyeMidWearTarget: glassesEyeMidpointAlign ? new THREE.Vector3() : null,
      eyeMidWearZero: glassesEyeMidpointAlign ? new THREE.Vector3(0, 0, 0) : null,
      glassesForceBboxAlign168,
      glassesManualMindarRig: !!glassesManualMindarRig,
      glassesManualMindarFinalLogged: false,
      glassesManualModelWidth: glassesManualMindarRig ? glassesManualModelWidth : 1,
      glassesManualTargetWidthFactor: glassesManualMindarRig
        ? glassesManualTargetWidthFactor
        : OMAFIT_GLASSES_MANUAL_FACE_WIDTH_TO_FRAME_FACTOR_DEFAULT,
      glassesManualFaceBasisOffsetM: {
        x: glassesManualFaceBasisOffsetM.x,
        y: glassesManualFaceBasisOffsetM.y,
        z: glassesManualFaceBasisOffsetM.z,
      },
      glassesManualPivotSmooth: glassesManualMindarRig
        ? { initialized: false, alpha: glassesManualPivotSmoothAlpha }
        : null,
      glassesOffsetFinalM: {
        x: glassesOffsetFinalM.x,
        y: glassesOffsetFinalM.y,
        z: glassesOffsetFinalM.z,
      },
      /** Reuso: `position.add` do offset final sem alocar por frame. */
      glassesOffsetFinalVec: new THREE.Vector3(),
      /** Joias: `1/maxDim` no load; óculos: 1 — a escala anatómica vem só do IPD×factor em `onUpdate`. */
      accessoryMeshNormalizeScale,
      glassesPivotBaseLocalPos: glassesPivotBaseLocalPos ? glassesPivotBaseLocalPos.clone() : null,
      glassesContactRig,
      ndcWearLock:
        glassesNdcScratchNeeded
          ? {
              sm: new THREE.Vector3(),
              w168: new THREE.Vector3(),
              ndc168: new THREE.Vector3(),
              ndcGl: new THREE.Vector3(),
              worldD: new THREE.Vector3(),
              localD: new THREE.Vector3(),
              invAnchor: new THREE.Matrix4(),
              box: new THREE.Box3(),
              center: new THREE.Vector3(),
              right: new THREE.Vector3(),
              up: new THREE.Vector3(),
              tmp: new THREE.Vector3(),
              lensK: glassesLensDistortK,
              mirrorSelfie: !disableFaceMirror,
            }
          : null,
      principalAlignScratch:
        accessoryType === "glasses" && faceProjectionOpts.principalAlign168
          ? new THREE.Vector3()
          : null,
      anchorSmoothOneEuro: glassesAnchorOneEuro,
      anchorEuroPosState: glassesAnchorOneEuro
        ? { xPrev: null, tPrev: null, dxPrev: [0, 0, 0] }
        : null,
      anchorEuroQuatState: glassesAnchorOneEuro
        ? {
            qPrev: null,
            tPrev: null,
            logState: { xPrev: null, tPrev: null, dxPrev: [0, 0, 0] },
            qScratch: new THREE.Quaternion(),
            qStep: new THREE.Quaternion(),
            vMeas: new THREE.Vector3(),
          }
        : null,
      anchorDec: glassesAnchorOneEuro
        ? { p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3() }
        : null,
      faceControllerPrev: null,
      smoothAnchorMat: new THREE.Matrix4(),
      smoothFaceMats: [],
      smoothInitialized: false,
      cheekRefWidth: null,
      smoothedCheekW: null,
      smoothedIpd: null,
      smoothedFaceScale: null,
      glassesIpdCheekEquiv,
      glassesFaceDistanceScale,
      glassesFaceDistanceRefM,
      glassesFaceDistanceMulMin,
      glassesFaceDistanceMulMax,
      faceCamDistScratch: glassesFaceDistanceScale ? new THREE.Vector3() : null,
      faceCamDistCamPos: glassesFaceDistanceScale ? new THREE.Vector3() : null,
      smoothedFaceCamDist: null,
      glassesPivotFaceScale: OMAFIT_GLASSES_PIVOT_FACE_SCALE_BASE,
      glassesStructuralMindarRig: !!glassesStructuralMindarRig,
      glassesGlbStandardize: !!glassesGlbStandardize,
      glassesStructuralPivotBoost,
      glassesStructuralPivotClampMin,
      glassesStructuralPivotClampMax,
      glassesStructuralPivotRotYDeg: Number.isFinite(glassesStructuralPivotRotYDeg)
        ? glassesStructuralPivotRotYDeg
        : 0,
      glassesStructuralPivotPos:
        glassesStructuralMindarRig && glassesStructuralPivotPosVec
          ? new THREE.Vector3(
              glassesStructuralPivotPosVec.x,
              glassesStructuralPivotPosVec.y,
              glassesStructuralPivotPosVec.z,
            )
          : null,
      glassesGeometryAnchor: !!glassesGeometryAnchor,
      glassesGeometryPivotPosTemplate: glassesGeometryPivotPosTemplate
        ? glassesGeometryPivotPosTemplate.clone()
        : null,
      glassesGeometryPivotScale: glassesGeometryPivotScaleInit,
      glassesGeometryRotXDeg: 0,
      glassesGeometryRotYDeg: 0,
      glassesAnatomicWidthFactor,
      glassesCheekOrthogonalBasis,
      glassesZFitExtra,
      glassesDepthForwardM,
      cheekBasisWorldRot: new THREE.Matrix4(),
      cheekBasisWearInv: new THREE.Matrix4(),
      cheekBasisReuse: glassesCheekOrthogonalBasis
        ? {
            p234: new THREE.Vector3(),
            p454: new THREE.Vector3(),
            p10: new THREE.Vector3(),
            p152: new THREE.Vector3(),
            vx: new THREE.Vector3(),
            yRaw: new THREE.Vector3(),
            vz: new THREE.Vector3(),
            vy: new THREE.Vector3(),
          }
        : null,
      cheekBasisValid: false,
      sceneMatrixWorldEveryFrame: faceSceneMatrixWorldEveryFrame,
      lm168DebugMesh,
      glassesEyeMidDebugVisualEnabled,
      eyeMidDebugMesh,
      glassesBboxCenterDebugMesh,
      glassesEyeDebugSpheres,
      eyeMidDebugScratch: glassesEyeMidDebugVisualEnabled
        ? {
            mid: new THREE.Vector3(),
            nb: new THREE.Vector3(),
            centerW: new THREE.Vector3(),
            centerLocal: new THREE.Vector3(),
          }
        : null,
      faceOccAheadLocalZ,
      faceOccComposeScratch:
        accessoryType === "glasses" && faceOccluderMesh
          ? {
              pos: new THREE.Vector3(),
              quat: new THREE.Quaternion(),
              sca: new THREE.Vector3(),
              nudge: new THREE.Vector3(),
              mat: new THREE.Matrix4(),
            }
          : null,
      facePmremRT: null,
      templeDepthGeom,
      faceOccluderMesh,
      templeOccL,
      templeOccR,
      lmSmoother: faceLmSmoother,
      glassesBasisActive,
      glassesBasisMat: glassesBasisActive ? new THREE.Matrix4() : null,
      glassesBasisReuse: glassesBasisActive
        ? {
            tmp: new THREE.Vector3(),
            O: new THREE.Vector3(),
            eR: new THREE.Vector3(),
            eL: new THREE.Vector3(),
            fh: new THREE.Vector3(),
            ch: new THREE.Vector3(),
            x: new THREE.Vector3(),
            yRaw: new THREE.Vector3(),
            y: new THREE.Vector3(),
            z: new THREE.Vector3(),
          }
        : null,
      glassesAnchorPos: glassesBasisActive ? new THREE.Vector3() : null,
      glassesAnchorScale: glassesBasisActive ? new THREE.Vector3() : null,
      glassesAnchorQuatRaw: glassesBasisActive ? new THREE.Quaternion() : null,
      glassesAnchorQuatTarget: glassesBasisActive ? new THREE.Quaternion() : null,
      glassesBasisLogged: false,
      hairUniforms: hairUniformsFaceAr,
      hairSegmenter: null,
      hairCategoryIndex: -1,
      hairMaskTexture: null,
      hairMaskUint8: null,
      hairSegFrameCounter: 0,
      arVideo: null,
      neckOccluderMesh,
      neckOccGeomState,
      poseLandmarker: null,
      lastPoseLandmarks: null,
      lastNecklaceFrameMs: 0,
      necklacePartition,
      necklaceSwing:
        accessoryType === "necklace" && necklaceSwingGroup
          ? {
              swingGroup: necklaceSwingGroup,
              pos: new THREE.Vector3(),
              vel: new THREE.Vector3(),
              euler: new THREE.Vector3(),
              eVel: new THREE.Vector3(),
              refNeckW: null,
              shoulderNeutralAtan: null,
              headPitchNeutral: null,
            }
          : null,
      necklaceShadowRes: accessoryType === "necklace" ? necklaceShadowParts : null,
      faceAdaptiveLight: (() => {
        if (
          /^(0|false|off|no)$/i.test(String(cfgAttr("arFaceAmbientAdaptive", "1")).trim())
        ) {
          return null;
        }
        const probe = omafitCreateFaceAmbientProbe(40, 40);
        if (!probe.ctx) return null;
        return {
          ambient: faceAmbientLight,
          hemi: faceHemisphereLight,
          key: faceKeyLight,
          probe,
          lastMs: 0,
          intervalMs: Math.max(
            48,
            Number(String(cfgAttr("arFaceAmbientProbeMs", "120")).trim()) || 120,
          ),
          warmBias: THREE.MathUtils.clamp(
            Number(String(cfgAttr("arFaceAmbientWarmBias", "0.35")).trim()) || 0.35,
            0,
            1,
          ),
          accessoryNecklace: accessoryType === "necklace",
          contactRig: glassesContactRig,
        };
      })(),
    };

    if (!microUxDisabled && microUxModelWrap && glasses) {
      try {
        omafitStoreMaterialOpacityBaseline(glasses);
        omafitApplyModelOpacityFactor(glasses, 0);
        faceArEnhancementState.microUx.introStartMs = performance.now();
        faceArEnhancementState.microUx.preparedOpacity = true;
        microUxModelWrap.scale.setScalar(0.88);
      } catch (e) {
        console.warn("[omafit-ar] micro-ux init:", e?.message || e);
      }
    }
    if (!microUxDisabled && mindarHost) {
      try {
        const ring = document.createElement("div");
        ring.className = "omafit-ar-track-detect-ring";
        ring.setAttribute("aria-hidden", "true");
        mindarHost.appendChild(ring);
        faceArEnhancementState.microUxRingEl = ring;
      } catch (e) {
        console.warn("[omafit-ar] micro-ux ring:", e?.message || e);
      }
    }

    if (mindarThree.controller && typeof mindarThree.controller.onUpdate === "function") {
      const st = faceArEnhancementState;
      st.faceControllerPrev = mindarThree.controller.onUpdate;
      mindarThree.controller.onUpdate = (payload) => {
        st.faceControllerPrev(payload);
        try {
          const mx = st.microUx;
          if (!st.microUxDisabled && mx && st.microUxRingEl) {
            if (payload.hasFace) st.microUxRingEl.classList.add("omafit-ar-track-detect-ring--on");
            else st.microUxRingEl.classList.remove("omafit-ar-track-detect-ring--on");
          }
        } catch {
          /* ignore */
        }
        const runProjectionSync = () => {
          if (!st.faceProjectionOpts) return;
          try {
            omafitSyncMindARFaceProjection(THREE, mindarThree, mindarHost, st.faceProjectionOpts);
            if (!st.projectionSyncLogged) {
              st.projectionSyncLogged = true;
              const cam = mindarThree.camera;
              const v = mindarHost?.querySelector?.("video");
              const dom = mindarThree.renderer?.domElement;
              console.log("[omafit-ar] projeção activa (cada frame)", OMAFIT_AR_WIDGET_BUILD, {
                fov: cam?.fov,
                aspect: cam?.aspect,
                principalNdc: st.faceProjectionOpts.principalShiftNdcLp,
                video: v ? { w: v.videoWidth, h: v.videoHeight } : null,
                canvas: dom ? { w: dom.width, h: dom.height } : null,
              });
            }
          } catch {
            /* ignore */
          }
        };
        if (!payload.hasFace) {
          try {
            if (st.microUx) st.microUx.hasFacePrev = false;
          } catch {
            /* ignore */
          }
          if (st.faceProjectionOpts?.principalShiftNdcLp) {
            st.faceProjectionOpts.principalShiftNdcLp.x *= 0.88;
            st.faceProjectionOpts.principalShiftNdcLp.y *= 0.88;
          }
          st.smoothInitialized = false;
          st.lmSmoother?.reset();
          st.smoothedCheekW = null;
          st.smoothedFaceScale = null;
          st.cheekBasisValid = false;
          if (st.glassesCheekOrthogonalBasis && faceParentGroup) {
            faceParentGroup.matrix.identity();
            faceParentGroup.matrixWorldNeedsUpdate = true;
          }
          st.glassesPivotFaceScale = OMAFIT_GLASSES_PIVOT_FACE_SCALE_BASE;
          if (st.eyeMidWearSmoothed) st.eyeMidWearSmoothed.set(0, 0, 0);
          if (st.necklaceSwing?.swingGroup) {
            st.necklaceSwing.vel.set(0, 0, 0);
            st.necklaceSwing.eVel.set(0, 0, 0);
            st.necklaceSwing.pos.set(0, 0, 0);
            st.necklaceSwing.euler.set(0, 0, 0);
            st.necklaceSwing.swingGroup.position.set(0, 0, 0);
            st.necklaceSwing.swingGroup.rotation.set(0, 0, 0);
          }
          if (st.anchorEuroPosState) {
            st.anchorEuroPosState.xPrev = null;
            st.anchorEuroPosState.tPrev = null;
            st.anchorEuroPosState.dxPrev = [0, 0, 0];
          }
          if (st.anchorEuroQuatState) {
            st.anchorEuroQuatState.qPrev = null;
            st.anchorEuroQuatState.tPrev = null;
            st.anchorEuroQuatState.logState = { xPrev: null, tPrev: null, dxPrev: [0, 0, 0] };
          }
          if (st.ndcWearLock?.sm) st.ndcWearLock.sm.set(0, 0, 0);
          if (glassesPivotSmoother) {
            resetMindarGlassesPivotSmoother(glassesPivotSmoother);
            glassesPivotSmoothPrevMs = -1;
          }
          runProjectionSync();
          return;
        }
        const est = payload.estimateResult;
        const lm = est?.metricLandmarks;
        if (!lm) {
          runProjectionSync();
          return;
        }
        const nowMs = performance.now();
        st.lmSmoother?.sample(lm, nowMs);
        try {
          const mx = st.microUx;
          if (!st.microUxDisabled && mx && !mx.hasFacePrev) {
            mx.snapBoost = Math.max(typeof mx.snapBoost === "number" ? mx.snapBoost : 1, 1.048);
          }
          if (st.microUx) st.microUx.hasFacePrev = true;
        } catch {
          /* ignore */
        }
        if (
          accessoryType === "glasses" &&
          st.faceProjectionOpts?.principalAlign168 &&
          st.principalAlignScratch
        ) {
          omafitUpdatePrincipalShiftFromLm168(
            THREE,
            mindarThree.camera,
            anchor.group,
            est,
            st.faceProjectionOpts.principalShiftNdcLp,
            !disableFaceMirror,
            st.principalAlignScratch,
          );
        }
        runProjectionSync();

        /**
         * Óculos: verificação de qualidade da **base canonical** derivada
         * de 5 landmarks (168/33/263/10/152) em `metricLandmarks`.
         *
         * Nota algébrica crítica (MindAR 1.2.5 `src/face-target/face-geometry/face-geometry.js`):
         *   `metricLandmarks` (`T`) = `inv(U) × N`, onde `U = solveWeightedOrthogonal(SI, N)`
         *   alinha canonical `SI` aos observados `N`. Logo `T ≈ SI` e NÃO
         *   muda com yaw/pitch/roll do rosto — a rotação do rosto está
         *   TODA encapsulada em `faceMatrix = vI` (que vem do `solvePnP`
         *   sobre `T` + landmarks 2D, com `diag(1,-1,-1)` aplicada).
         *
         * Consequência: construir uma matriz de base 3×3 a partir dos
         * eixos (eL-eR), (fh-ch), e cross destes, usando `metricLandmarks`,
         * dá uma rotação ≈ identity **independentemente da pose do rosto**.
         * Substituir o quaternion da `anchor.group.matrix` por essa base
         * destruiria a rotação do PnP (os óculos ficariam fixos olhando
         * para a câmara). Por isso **não substituímos** — a rotação do
         * rosto no espaço mundo é a que o MindAR já calcula via PnP, que
         * usa 468 landmarks ponderados por `cQ` (muito mais robusto que
         * 5 pontos).
         *
         * A função `buildGlassesFaceBasisMatrix` é útil como **sonda de
         * integridade**: se o desvio em relação a identity cresce muito
         * (p. ex. `|quat.angleTo(identity)| > 15°`), é indício de
         * landmarks mal detectados (expressão facial extrema, olho
         * parcialmente oculto) e o tracking está ruidoso. Logado 1× só
         * para telemetria, sem afectar o render.
         */
        if (st.glassesBasisActive && st.glassesBasisMat && !st.glassesBasisLogged) {
          const basisOk = buildGlassesFaceBasisMatrix(
            THREE,
            lm,
            st.lmSmoother,
            st.glassesBasisMat,
            st.glassesBasisReuse,
          );
          if (basisOk) {
            st.glassesAnchorQuatTarget.setFromRotationMatrix(st.glassesBasisMat);
            const angleFromIdentity = 2 * Math.acos(
              Math.min(1, Math.abs(st.glassesAnchorQuatTarget.w)),
            );
            st.glassesBasisLogged = true;
            console.log("[omafit-ar] glasses face-basis (canonical integrity sonda)", {
              landmarks: [
                OMAFIT_FACE_LM_NOSE_BRIDGE,
                OMAFIT_FACE_LM_EYE_R_OUT,
                OMAFIT_FACE_LM_EYE_L_OUT,
                OMAFIT_FACE_LM_FOREHEAD_TOP,
                OMAFIT_FACE_LM_CHIN,
              ],
              angleFromIdentityRad: angleFromIdentity.toFixed(4),
              angleFromIdentityDeg: ((angleFromIdentity * 180) / Math.PI).toFixed(2),
              note: "Esperado ~0° (metricLandmarks ≈ canonical SI). >15° indica tracking degradado.",
            });
          }
        }

        if (!st.smoothInitialized) {
          if (st.anchorEuroPosState) {
            st.anchorEuroPosState.xPrev = null;
            st.anchorEuroPosState.tPrev = null;
            st.anchorEuroPosState.dxPrev = [0, 0, 0];
          }
          if (st.anchorEuroQuatState) {
            st.anchorEuroQuatState.qPrev = null;
            st.anchorEuroQuatState.tPrev = null;
            st.anchorEuroQuatState.logState = { xPrev: null, tPrev: null, dxPrev: [0, 0, 0] };
          }
          st.smoothAnchorMat.copy(anchor.group.matrix);
          for (let fi = 0; fi < mindarThree.faceMeshes.length; fi++) {
            const fm = mindarThree.faceMeshes[fi];
            if (!st.smoothFaceMats[fi]) st.smoothFaceMats[fi] = new THREE.Matrix4();
            st.smoothFaceMats[fi].copy(fm.matrix);
            if (
              accessoryType === "glasses" &&
              st.faceOccAheadLocalZ > 0 &&
              st.faceOccComposeScratch &&
              faceOccluderMesh &&
              fm === faceOccluderMesh
            ) {
              omafitNudgeFaceOccluderAlongLocalZ(
                THREE,
                fm.matrix,
                st.faceOccAheadLocalZ,
                st.faceOccComposeScratch,
              );
            }
          }
          st.smoothInitialized = true;
        } else {
          if (
            st.anchorSmoothOneEuro &&
            st.anchorEuroPosState &&
            st.anchorEuroQuatState &&
            st.anchorDec
          ) {
            anchor.group.matrix.decompose(st.anchorDec.p, st.anchorDec.q, st.anchorDec.s);
            const tSec = nowMs * 0.001;
            const pF = omafitOneEuroFilterVec3(
              [st.anchorDec.p.x, st.anchorDec.p.y, st.anchorDec.p.z],
              tSec,
              st.anchorEuroPosState,
              OMAFIT_GLASSES_ANCHOR_ONE_EURO_MIN_CUTOFF,
              OMAFIT_GLASSES_ANCHOR_ONE_EURO_BETA,
              OMAFIT_GLASSES_ANCHOR_ONE_EURO_D_CUTOFF,
            );
            omafitOneEuroFilterQuaternion(
              THREE,
              st.anchorDec.q,
              tSec,
              st.anchorEuroQuatState,
              OMAFIT_GLASSES_ANCHOR_ONE_EURO_MIN_CUTOFF,
              OMAFIT_GLASSES_ANCHOR_ONE_EURO_BETA,
              OMAFIT_GLASSES_ANCHOR_ONE_EURO_D_CUTOFF,
            );
            st.smoothAnchorMat.compose(
              st.anchorDec.p.set(pF[0], pF[1], pF[2]),
              st.anchorEuroQuatState.qPrev,
              st.anchorDec.s,
            );
            anchor.group.matrix.copy(st.smoothAnchorMat);
          } else {
            omafitDampMatrix4(THREE, st.smoothAnchorMat, anchor.group.matrix, faceMatrixExtraLambda);
            anchor.group.matrix.copy(st.smoothAnchorMat);
          }
          for (let fi = 0; fi < mindarThree.faceMeshes.length; fi++) {
            const fm = mindarThree.faceMeshes[fi];
            if (!st.smoothFaceMats[fi]) st.smoothFaceMats[fi] = new THREE.Matrix4();
            omafitDampMatrix4(THREE, st.smoothFaceMats[fi], fm.matrix, faceMatrixExtraLambda);
            fm.matrix.copy(st.smoothFaceMats[fi]);
            if (
              accessoryType === "glasses" &&
              st.faceOccAheadLocalZ > 0 &&
              st.faceOccComposeScratch &&
              faceOccluderMesh &&
              fm === faceOccluderMesh
            ) {
              omafitNudgeFaceOccluderAlongLocalZ(
                THREE,
                fm.matrix,
                st.faceOccAheadLocalZ,
                st.faceOccComposeScratch,
              );
            }
          }
          if (accessoryType === "glasses") {
            if (
              !st.glassesManualMindarRig &&
              !st.glassesStructuralMindarRig &&
              !st.glassesGeometryAnchor &&
              !st.glassesCheekOrthogonalBasis &&
              glasses
            ) {
              const fms = mindarThree.faceMeshes;
              let faceSrc = null;
              if (fms && fms.length) {
                for (let fi0 = 0; fi0 < fms.length; fi0++) {
                  const fmm = fms[fi0];
                  if (fmm && fmm !== faceOccluderMesh) {
                    faceSrc = fmm;
                    break;
                  }
                }
                if (!faceSrc) faceSrc = fms[0];
              }
              /** Pai do alinhamento facial: sempre `glassesModelWrap` (tracking wrap é filho). */
              const faceAlignParent =
                st.glassesModelWrap || glassesModelWrap || glasses?.parent || null;
              if (faceSrc && faceAlignParent) {
                if (!_omafitSimpleGlassesFaceAlignScratch) {
                  _omafitSimpleGlassesFaceAlignScratch = {
                    faceWorld: new THREE.Matrix4(),
                    parentInv: new THREE.Matrix4(),
                    localMat: new THREE.Matrix4(),
                    basis: new THREE.Matrix4(),
                    q: new THREE.Quaternion(),
                    eyeR: new THREE.Vector3(),
                    eyeL: new THREE.Vector3(),
                    faceForwardOff: new THREE.Vector3(),
                    midMetric: new THREE.Vector3(),
                    midW: new THREE.Vector3(),
                    zFaceLocal: new THREE.Vector3(),
                    merchantWearScratch: new THREE.Vector3(),
                    wearAxisX: new THREE.Vector3(1, 0, 0),
                    wearAxisY: new THREE.Vector3(0, 1, 0),
                    wearAxisZ: new THREE.Vector3(0, 0, 1),
                  };
                }
                const fa = _omafitSimpleGlassesFaceAlignScratch;
                const lmLoc = lm;
                if (!fa.faceForwardOff) fa.faceForwardOff = new THREE.Vector3();
                faceSrc.updateMatrixWorld(true);
                faceAlignParent.updateMatrixWorld(true);
                /** `faceMatrix` MindAR: mesma matriz 4×4 suavizada que a malha (`m[12]..[14]` = translação). */
                fa.faceWorld.copy(faceSrc.matrixWorld);
                fa.parentInv.copy(faceAlignParent.matrixWorld).invert();
                fa.localMat.multiplyMatrices(fa.parentInv, fa.faceWorld);
                wearPosition.position.set(
                  wearPosMEffective.x,
                  wearPosMEffective.y,
                  wearPosMEffective.z,
                );
                if (st.glassesMerchantWear) {
                  st.glassesMerchantWear.position.set(0, 0, 0);
                  st.glassesMerchantWear.quaternion.identity();
                  st.glassesMerchantWear.scale.set(1, 1, 1);
                }
                if (faceParentGroup) {
                  faceParentGroup.matrixAutoUpdate = true;
                  faceParentGroup.position.set(0, 0, 0);
                  faceParentGroup.quaternion.identity();
                  faceParentGroup.scale.set(1, 1, 1);
                  faceParentGroup.rotation.set(0, 0, 0);
                }
                if (glassesPivot) {
                  glassesPivot.position.set(0, 0, 0);
                  glassesPivot.quaternion.identity();
                  glassesPivot.scale.set(1, 1, 1);
                }
                if (glassesTrackingWrap) {
                  glassesTrackingWrap.position.set(0, 0, 0);
                  glassesTrackingWrap.quaternion.identity();
                  glassesTrackingWrap.scale.set(1, 1, 1);
                }
                if (!fa.basis) fa.basis = new THREE.Matrix4();
                fa.basis.fromArray(fa.localMat.elements);

                if (glassesTrackingWrap && st.glassesSimpleFaceOnly) {
                  /**
                   * Rotação: 3×3 de `parentInv*faceWorld` (mesma pose que a malha 468 suavizada).
                   * (Evitar `faceWorld×lmBasis` no wrap: a composição alterava o eixo e a percepção
                   * de escala/virado.) Translação: ponte nasal (LM 168) em mundo → local do wrap;
                   * +Z de profundidade: coluna 2 de `fa.basis` no referencial do pai.
                   * O bind glTF→MindAR fica no `glassesStaticBindWrap`.
                   */
                  fa.q.setFromRotationMatrix(fa.basis);
                  glassesTrackingWrap.quaternion.copy(fa.q);
                  const okBridge = (() => {
                    if (!lmLoc) return false;
                    const pickLm = (idx, out) => {
                      const p = st.lmSmoother?.get(idx);
                      if (
                        p &&
                        Number.isFinite(p.x) &&
                        Number.isFinite(p.y) &&
                        Number.isFinite(p.z)
                      ) {
                        out.set(p.x, p.y, p.z);
                        return true;
                      }
                      const raw = lmLoc[idx];
                      if (!raw) return false;
                      if (typeof raw.length === "number" && raw.length >= 3) {
                        out.set(raw[0], raw[1], raw[2]);
                        return true;
                      }
                      if (typeof raw.x === "number") {
                        out.set(raw.x, raw.y, Number.isFinite(raw.z) ? raw.z : 0);
                        return true;
                      }
                      return false;
                    };
                    if (!pickLm(OMAFIT_FACE_LM_EYE_R_OUT, fa.eyeR)) return false;
                    if (!pickLm(OMAFIT_FACE_LM_EYE_L_OUT, fa.eyeL)) return false;
                    if (!pickLm(OMAFIT_FACE_LM_NOSE_BRIDGE, fa.midMetric)) return false;
                    omafitMetricLmToFaceWorldPoint(fa.midMetric, fa.faceWorld, fa.midW);
                    return true;
                  })();
                  const skipBridgeTranslate =
                    st.glassesSimpleFaceOnly &&
                    st.anchorFaceLm === OMAFIT_FACE_LM_NOSE_BRIDGE;
                  const applyGlassesMerchantWearOffset = () => {
                    const gw = st.glassesMerchantWear;
                    if (!gw || !st.glassesMerchantCal) return;
                    composeGlassesMerchantWearOffsetM(
                      fa.merchantWearScratch,
                      fa.wearAxisX,
                      fa.wearAxisY,
                      fa.wearAxisZ,
                      {
                        wearX: st.glassesMerchantCal.wearX,
                        wearY: st.glassesMerchantCal.wearY,
                        wearZ: st.glassesMerchantCal.wearZ,
                        depthForwardM: st.glassesDepthForwardM,
                      },
                    );
                    gw.position.copy(fa.merchantWearScratch);
                  };
                  const applyGlassesFrameDepthOffset = () => {
                    if (st.glassesSimpleFaceOnly) return;
                    const baseDepth = Number.isFinite(st.glassesDepthForwardM)
                      ? st.glassesDepthForwardM
                      : 0;
                    if (Math.abs(baseDepth) <= 1e-6) return;
                    const ce = fa.basis.elements;
                    fa.zFaceLocal.set(ce[8], ce[9], ce[10]);
                    if (fa.zFaceLocal.lengthSq() > 1e-12) fa.zFaceLocal.normalize();
                    fa.zFaceLocal.transformDirection(fa.parentInv);
                    glassesTrackingWrap.position.addScaledVector(fa.zFaceLocal, baseDepth);
                  };
                  const applyGlassesMerchantMeshScale = () => {
                    if (!glasses || !lmLoc) return;
                    const pickEye = (idx, out) => {
                      const p = st.lmSmoother?.get(idx);
                      if (
                        p &&
                        Number.isFinite(p.x) &&
                        Number.isFinite(p.y) &&
                        Number.isFinite(p.z)
                      ) {
                        out.set(p.x, p.y, p.z);
                        return true;
                      }
                      const raw = lmLoc[idx];
                      if (!raw) return false;
                      if (typeof raw.length === "number" && raw.length >= 3) {
                        out.set(raw[0], raw[1], raw[2]);
                        return true;
                      }
                      if (typeof raw.x === "number") {
                        out.set(raw.x, raw.y, Number.isFinite(raw.z) ? raw.z : 0);
                        return true;
                      }
                      return false;
                    };
                    if (!pickEye(OMAFIT_FACE_LM_EYE_R_OUT, fa.eyeR)) return;
                    if (!pickEye(OMAFIT_FACE_LM_EYE_L_OUT, fa.eyeL)) return;
                    const ipdLandmark = fa.eyeR.distanceTo(fa.eyeL);
                    const fe = fa.faceWorld.elements;
                    const sx = Math.hypot(fe[0], fe[1], fe[2]);
                    const sy = Math.hypot(fe[4], fe[5], fe[6]);
                    const szFace = Math.hypot(fe[8], fe[9], fe[10]);
                    const faceScale =
                      Number.isFinite(sx) && Number.isFinite(sy) && Number.isFinite(szFace)
                        ? Math.max(1e-6, (sx + sy + szFace) / 3)
                        : 1;
                    const ipdMetric = ipdLandmark / faceScale;
                    if (!(Number.isFinite(ipdMetric) && ipdMetric > 0)) return;
                    const ipdMul =
                      st.glassesSimpleFaceOnly && glassesTrackingWrap
                        ? OMAFIT_GLASSES_SCALE_IPD_MUL_SIMPLE_FACE
                        : OMAFIT_GLASSES_SCALE_IPD_MUL;
                    const calScale =
                      st.glassesMerchantCal && Number(st.glassesMerchantCal.scale) > 0
                        ? st.glassesMerchantCal.scale
                        : 1;
                    let scale = computeGlassesAutoFitMeshScale({
                      frameWidthLocal: st.glassesFrameWidthLocal,
                      ipdMetricM: ipdMetric,
                      merchantScaleMul: calScale,
                      ipdMul,
                    });
                    scale = THREE.MathUtils.clamp(
                      scale,
                      OMAFIT_GLASSES_MESH_SCALE_ABS_MIN,
                      OMAFIT_GLASSES_MESH_SCALE_ABS_MAX,
                    );
                    st.glassesLastMeshScale = scale;
                    glasses.scale.set(scale, scale, scale);
                  };
                  if (okBridge && st.glassesEyeMidpointAlign && faceAlignParent) {
                    if (skipBridgeTranslate) {
                      glassesTrackingWrap.position.set(0, 0, 0);
                    } else {
                      glassesTrackingWrap.position.copy(fa.midW);
                      faceAlignParent.worldToLocal(glassesTrackingWrap.position);
                    }
                    applyGlassesFrameDepthOffset();
                    applyGlassesMerchantWearOffset();

                    /** v23: Debug visual — esferas no espaço da âncora MindAR. */
                    if (st.glassesEyeDebugSpheres && anchor?.group) {
                      const d = st.glassesEyeDebugSpheres;
                      const ag = anchor.group;
                      d.scratchR.copy(fa.eyeR).applyMatrix4(fa.faceWorld);
                      d.scratchL.copy(fa.eyeL).applyMatrix4(fa.faceWorld);
                      d.scratchMid.copy(fa.midW);
                      ag.worldToLocal(d.scratchR);
                      ag.worldToLocal(d.scratchL);
                      ag.worldToLocal(d.scratchMid);
                      d.right.position.copy(d.scratchR);
                      d.left.position.copy(d.scratchL);
                      d.center.position.copy(d.scratchMid);
                    }
                  } else {
                    if (skipBridgeTranslate) {
                      glassesTrackingWrap.position.set(0, 0, 0);
                      applyGlassesFrameDepthOffset();
                      applyGlassesMerchantWearOffset();
                    } else {
                      glassesTrackingWrap.position.setFromMatrixPosition(fa.basis);
                      applyGlassesMerchantWearOffset();
                    }
                  }
                  applyGlassesMerchantMeshScale();
                  if (
                    glasses &&
                    st.glassesLastMeshScale == null &&
                    st.glassesMerchantCal &&
                    Number(st.glassesMerchantCal.scale) > 0
                  ) {
                    const fb = THREE.MathUtils.clamp(
                      st.glassesMerchantCal.scale,
                      OMAFIT_GLASSES_MESH_SCALE_ABS_MIN,
                      OMAFIT_GLASSES_MESH_SCALE_ABS_MAX,
                    );
                    st.glassesLastMeshScale = fb;
                    glasses.scale.set(fb, fb, fb);
                  }
                  glasses.rotation.order = "XYZ";
                  glasses.rotation.set(0, 0, 0);
                  try {
                    if (
                      typeof window !== "undefined" &&
                      new URLSearchParams(window.location.search || "").get(
                        "omafit_ar_final_quat_debug",
                      ) === "1"
                    ) {
                      console.log("FINAL QUAT", glasses.quaternion);
                      console.log("[omafit-ar debug] WRAP_QUAT (faceQuat no grupo)", glassesTrackingWrap.quaternion);
                    }
                  } catch {
                    /* noop */
                  }
                  {
                    glasses.position.set(0, 0, 0);
                    if (!st.positionLogged) {
                      st.positionLogged = true;
                      console.log("[omafit-ar] glasses calibration v38 (metros no merchantWear + IPD×scale)", {
                        build: OMAFIT_AR_WIDGET_BUILD,
                        merchantCal: st.glassesMerchantCal,
                        autoFitScaleRef: st.glassesAutoFitScaleRef,
                        merchantWearM: st.glassesMerchantWear
                          ? {
                              x: st.glassesMerchantWear.position.x.toFixed(4),
                              y: st.glassesMerchantWear.position.y.toFixed(4),
                              z: st.glassesMerchantWear.position.z.toFixed(4),
                            }
                          : null,
                        meshScale: st.glassesLastMeshScale,
                        skipBridgeTranslate,
                        glassesTrackingWrapPosition: {
                          x: glassesTrackingWrap.position.x.toFixed(4),
                          y: glassesTrackingWrap.position.y.toFixed(4),
                          z: glassesTrackingWrap.position.z.toFixed(4),
                        },
                        glassesDepthForwardM: st.glassesDepthForwardM,
                        glassesLocalPosition: {
                          x: glasses.position.x.toFixed(4),
                          y: glasses.position.y.toFixed(4),
                          z: glasses.position.z.toFixed(4),
                        },
                        positionLandmark: OMAFIT_FACE_LM_NOSE_BRIDGE,
                        scaleLandmarks: { right: OMAFIT_FACE_LM_EYE_R_OUT, left: OMAFIT_FACE_LM_EYE_L_OUT },
                        hint: "Origem do wrap = ponte 168; IPD 33/263 só para escala. Debug: ?omafit_ar_glasses_eye_debug=1",
                      });
                    }
                  }
                } else {
                  /** Ramo legado (ex.: sem tracking wrap — GLB standardize): pose composta no alvo único. */
                  const poseTarget = glassesTrackingWrap || glasses;
                  poseTarget.position.setFromMatrixPosition(fa.basis);
                  fa.q.setFromRotationMatrix(fa.basis);
                  poseTarget.quaternion.copy(fa.q);
                  fa.faceForwardOff.set(0, 0, glassesFaceForwardLocalM);
                  fa.faceForwardOff.applyQuaternion(poseTarget.quaternion);
                  poseTarget.position.add(fa.faceForwardOff);
                  if (!glassesTrackingWrap) {
                    glasses.position.x += glassesEmpiricalAlignM.x;
                    glasses.position.y += glassesEmpiricalAlignM.y;
                    glasses.position.z += glassesEmpiricalAlignM.z;
                  }
                }

                if (lmLoc) {
                  const okR = (() => {
                    const sm = st.lmSmoother?.get(OMAFIT_FACE_LM_EYE_R_OUT);
                    if (sm && Number.isFinite(sm.x) && Number.isFinite(sm.y) && Number.isFinite(sm.z)) {
                      fa.eyeR.set(sm.x, sm.y, sm.z);
                      return true;
                    }
                    const raw = lmLoc[OMAFIT_FACE_LM_EYE_R_OUT];
                    if (!raw) return false;
                    if (typeof raw.length === "number" && raw.length >= 3) {
                      fa.eyeR.set(raw[0], raw[1], raw[2]);
                      return true;
                    }
                    if (typeof raw.x === "number") {
                      fa.eyeR.set(raw.x, raw.y, Number.isFinite(raw.z) ? raw.z : 0);
                      return true;
                    }
                    return false;
                  })();
                  const okL = (() => {
                    const sm = st.lmSmoother?.get(OMAFIT_FACE_LM_EYE_L_OUT);
                    if (sm && Number.isFinite(sm.x) && Number.isFinite(sm.y) && Number.isFinite(sm.z)) {
                      fa.eyeL.set(sm.x, sm.y, sm.z);
                      return true;
                    }
                    const raw = lmLoc[OMAFIT_FACE_LM_EYE_L_OUT];
                    if (!raw) return false;
                    if (typeof raw.length === "number" && raw.length >= 3) {
                      fa.eyeL.set(raw[0], raw[1], raw[2]);
                      return true;
                    }
                    if (typeof raw.x === "number") {
                      fa.eyeL.set(raw.x, raw.y, Number.isFinite(raw.z) ? raw.z : 0);
                      return true;
                    }
                    return false;
                  })();
                  if (
                    okR &&
                    okL &&
                    !(glassesTrackingWrap && st.glassesSimpleFaceOnly)
                  ) {
                    /**
                     * IPD **só** no espaço `metricLandmarks` (antes de `faceWorld`). A
                     * `face.matrixWorld` inclui escala do modelo 468 / fitting — usar a
                     * distância após `applyMatrix4` infla o IPD e deixa a armação gigante.
                     */
                    const ipdLandmark = fa.eyeR.distanceTo(fa.eyeL);
                    const fe = fa.faceWorld.elements;
                    const sx = Math.hypot(fe[0], fe[1], fe[2]);
                    const sy = Math.hypot(fe[4], fe[5], fe[6]);
                    const szFace = Math.hypot(fe[8], fe[9], fe[10]);
                    const faceScale =
                      Number.isFinite(sx) && Number.isFinite(sy) && Number.isFinite(szFace)
                        ? Math.max(1e-6, (sx + sy + szFace) / 3)
                        : 1;
                    fa.eyeR.applyMatrix4(fa.faceWorld);
                    fa.eyeL.applyMatrix4(fa.faceWorld);
                    const ipdMetric =
                      st.glassesSimpleFaceOnly && glassesTrackingWrap
                        ? ipdLandmark / faceScale
                        : fa.eyeR.distanceTo(fa.eyeL);
                    if (Number.isFinite(ipdMetric) && ipdMetric > 0) {
                      const ipdMul =
                        glassesTrackingWrap && st.glassesSimpleFaceOnly
                          ? OMAFIT_GLASSES_SCALE_IPD_MUL
                          : OMAFIT_GLASSES_SCALE_IPD_METRIC_MUL;
                      const frameW =
                        Number(st.glassesFrameWidthLocal) > 0
                          ? st.glassesFrameWidthLocal
                          : 1;
                      let scale = (ipdMetric * ipdMul) / frameW;
                      const calScale =
                        initialFaceCal &&
                        Number.isFinite(initialFaceCal.scale) &&
                        initialFaceCal.scale > 0
                          ? initialFaceCal.scale
                          : 1;
                      scale = scale * calScale;
                      scale = THREE.MathUtils.clamp(
                        scale,
                        OMAFIT_GLASSES_MESH_SCALE_ABS_MIN,
                        OMAFIT_GLASSES_MESH_SCALE_ABS_MAX,
                      );
                      if (glassesTrackingWrap && st.glassesSimpleFaceOnly) {
                        glasses.scale.set(scale, scale, scale);
                      } else {
                        glasses.scale.setScalar(scale);
                      }
                    }
                  }
                }
                if (
                  glassesTrackingWrap &&
                  st.glassesSimpleFaceOnly &&
                  omafitArIsGlassesAbsurdTransformTest()
                ) {
                  glasses.position.set(0.5, 0.5, 0.5);
                  glasses.scale.set(5, 5, 5);
                }
              }
            }
            if (
              st.glassesEyeMidDebugVisualEnabled &&
              st.eyeMidDebugScratch &&
              st.eyeMidDebugMesh &&
              st.glassesBboxCenterDebugMesh &&
              anchor.group &&
              glasses
            ) {
            const sc = st.eyeMidDebugScratch;
            const eL = st.lmSmoother?.get(OMAFIT_FACE_LM_EYE_L_OUT);
            const eR = st.lmSmoother?.get(OMAFIT_FACE_LM_EYE_R_OUT);
            const nb = st.lmSmoother?.get(OMAFIT_FACE_LM_NOSE_BRIDGE);
            if (eL && eR && nb) {
              sc.mid.copy(eL).add(eR).multiplyScalar(0.5);
              sc.nb.copy(nb);
              st.eyeMidDebugMesh.position.set(
                sc.mid.x - sc.nb.x,
                sc.mid.y - sc.nb.y,
                sc.mid.z - sc.nb.z,
              );
              glasses.updateMatrixWorld(true);
              anchor.group.updateMatrixWorld(true);
              sc.centerW.set(0, 0, 0).applyMatrix4(glasses.matrixWorld);
              sc.centerLocal.copy(sc.centerW);
              anchor.group.worldToLocal(sc.centerLocal);
              st.glassesBboxCenterDebugMesh.position.copy(sc.centerLocal);
            }
          }
        }
        }
        if (accessoryType === "necklace" && st.necklaceSwing) {
          const a = lm[anchorIndex];
          const ch =
            st.lmSmoother?.get(OMAFIT_FACE_LM_CHIN) ||
            new THREE.Vector3(
              lm[OMAFIT_FACE_LM_CHIN][0],
              lm[OMAFIT_FACE_LM_CHIN][1],
              lm[OMAFIT_FACE_LM_CHIN][2],
            );
          const p234 = st.lmSmoother?.get(OMAFIT_FACE_LM_RIGHT_CHEEK);
          const p454 = st.lmSmoother?.get(OMAFIT_FACE_LM_LEFT_CHEEK);
          const R = p234 || new THREE.Vector3(lm[234][0], lm[234][1], lm[234][2]);
          const L = p454 || new THREE.Vector3(lm[454][0], lm[454][1], lm[454][2]);
          const midJ = new THREE.Vector3(
            (L.x + R.x) * 0.5,
            (L.y + R.y) * 0.5,
            (L.z + R.z) * 0.5,
          );
          const throat = {
            x: THREE.MathUtils.lerp(ch.x, midJ.x, OMAFIT_NECKLACE_CHIN_TO_THROAT),
            y: THREE.MathUtils.lerp(ch.y, midJ.y, OMAFIT_NECKLACE_CHIN_TO_THROAT),
            z: THREE.MathUtils.lerp(ch.z, midJ.z, OMAFIT_NECKLACE_CHIN_TO_THROAT),
          };
          wearPosition.position.set(
            wearPosM.x + (throat.x - a[0]),
            wearPosM.y + (throat.y - a[1]),
            wearPosM.z + (throat.z - a[2]),
          );
          const cw =
            p234 && p454
              ? p234.distanceTo(p454)
              : omafitFaceLandmarkDist3(lm, OMAFIT_FACE_LM_RIGHT_CHEEK, OMAFIT_FACE_LM_LEFT_CHEEK);
          if (Number.isFinite(cw) && cw > 1e-5) {
            if (st.necklaceSwing.refNeckW === null) st.necklaceSwing.refNeckW = cw;
            const k = THREE.MathUtils.clamp(cw / st.necklaceSwing.refNeckW, 0.86, 1.18);
            const part = st.necklacePartition;
            if (part?.chain) part.chain.scale.set(k, 1, k);
            else glasses.scale.set(
              k * st.accessoryMeshNormalizeScale,
              st.accessoryMeshNormalizeScale,
              k * st.accessoryMeshNormalizeScale,
            );
          }
          let shoulderYaw = 0;
          let shoulderRxBlend = 0;
          try {
            if (st.poseLandmarker) {
              const vid = mindarHost?.querySelector?.("video");
              if (vid && vid.readyState >= 2) {
                const pr = st.poseLandmarker.detectForVideo(vid, nowMs);
                const plm = pr?.landmarks?.[0];
                st.lastPoseLandmarks = plm;
                if (plm?.[OMAFIT_POSE_L_SHOULDER] && plm?.[OMAFIT_POSE_R_SHOULDER]) {
                  const pL = plm[OMAFIT_POSE_L_SHOULDER];
                  const pR = plm[OMAFIT_POSE_R_SHOULDER];
                  const atan = Math.atan2(pR.y - pL.y, pR.x - pL.x);
                  if (st.necklaceSwing.shoulderNeutralAtan === null) {
                    st.necklaceSwing.shoulderNeutralAtan = atan;
                  }
                  shoulderYaw = (atan - st.necklaceSwing.shoulderNeutralAtan) * 0.62;
                  shoulderRxBlend = THREE.MathUtils.clamp(
                    (pL.y + pR.y) * 0.5 - (lm[OMAFIT_FACE_LM_CHIN][1] + lm[OMAFIT_FACE_LM_NOSE_BRIDGE][1]) * 0.5,
                    -0.2,
                    0.2,
                  );
                }
              }
            }
          } catch {
            /* Pose opcional (ombros). */
          }
          const nb =
            st.lmSmoother?.get(OMAFIT_FACE_LM_NOSE_BRIDGE) ||
            new THREE.Vector3(
              lm[OMAFIT_FACE_LM_NOSE_BRIDGE][0],
              lm[OMAFIT_FACE_LM_NOSE_BRIDGE][1],
              lm[OMAFIT_FACE_LM_NOSE_BRIDGE][2],
            );
          const chLm =
            st.lmSmoother?.get(OMAFIT_FACE_LM_CHIN) ||
            new THREE.Vector3(
              lm[OMAFIT_FACE_LM_CHIN][0],
              lm[OMAFIT_FACE_LM_CHIN][1],
              lm[OMAFIT_FACE_LM_CHIN][2],
            );
          const chinY = chLm.y;
          const pitchMeas = nb.y - chinY;
          if (st.necklaceSwing.headPitchNeutral === null) st.necklaceSwing.headPitchNeutral = pitchMeas;
          const headPitchDelta = pitchMeas - st.necklaceSwing.headPitchNeutral;
          const targetRx =
            THREE.MathUtils.clamp(-headPitchDelta * 2.15, -0.52, 0.52) *
              (1 - OMAFIT_NECKLACE_SHOULDER_ROT_BLEND) +
            shoulderRxBlend * OMAFIT_NECKLACE_SHOULDER_ROT_BLEND;
          const targetRy = shoulderYaw * OMAFIT_NECKLACE_SHOULDER_ROT_BLEND * 0.82;
          glassesAnatomy.rotation.z =
            shoulderYaw * (1 - OMAFIT_NECKLACE_SHOULDER_ROT_BLEND) * 0.32;
          const dtSec =
            st.lastNecklaceFrameMs > 0
              ? Math.min(0.055, (nowMs - st.lastNecklaceFrameMs) * 0.001)
              : 1 / 60;
          st.lastNecklaceFrameMs = nowMs;
          const tgtPos = new THREE.Vector3(0, 0, 0);
          omafitNecklaceSpringStep(THREE, st, dtSec, tgtPos, targetRx, targetRy);
          if (neckOccluderMesh && neckOccGeomState && Number.isFinite(cw)) {
            const jawW = cw;
            const bot = new THREE.Vector3(
              throat.x,
              throat.y - jawW * 0.42,
              throat.z + jawW * 0.1,
            );
            const top = new THREE.Vector3(throat.x, throat.y + jawW * 0.06, throat.z);
            const va = new THREE.Vector3(top.x - a[0], top.y - a[1], top.z - a[2]);
            const vb = new THREE.Vector3(bot.x - a[0], bot.y - a[1], bot.z - a[2]);
            const rTop = Math.max(0.026, jawW * 0.36);
            const rBot = Math.max(0.032, jawW * 0.44);
            omafitUpdateNeckCylinderOccluder(THREE, neckOccluderMesh, neckOccGeomState, va, vb, rTop, rBot);
          }
        }
        if (st.templeOccL && st.templeOccR && accessoryType === "glasses") {
          const nb = st.lmSmoother?.get(OMAFIT_FACE_LM_NOSE_BRIDGE);
          const earL = st.lmSmoother?.get(OMAFIT_FACE_LM_EAR_L);
          const earR = st.lmSmoother?.get(OMAFIT_FACE_LM_EAR_R);
          const nose = nb ? [nb.x, nb.y, nb.z] : lm[OMAFIT_FACE_LM_NOSE_BRIDGE];
          const lmEarL = earL ? [earL.x, earL.y, earL.z] : lm[OMAFIT_FACE_LM_EAR_L];
          const lmEarR = earR ? [earR.x, earR.y, earR.z] : lm[OMAFIT_FACE_LM_EAR_R];
          omafitPlaceTempleDepthOccluder(THREE, st.templeOccL, nose, lmEarL);
          omafitPlaceTempleDepthOccluder(THREE, st.templeOccR, nose, lmEarR);
        }
        if (st.sceneMatrixWorldEveryFrame && mindarThree?.scene) {
          try {
            mindarThree.scene.updateMatrixWorld(true);
          } catch {
            /* ignore */
          }
        }
      };
    }

    mindarFaceEnhancementsCleanup = () => {
      const st = faceArEnhancementState;
      try {
        const el = st?.microUxRingEl;
        if (el?.parentNode) el.parentNode.removeChild(el);
      } catch {
        /* ignore */
      }
      try {
        if (mindarThree?.controller && st?.faceControllerPrev) {
          mindarThree.controller.onUpdate = st.faceControllerPrev;
        }
      } catch {
        /* ignore */
      }
      try {
        if (st?.facePmremRT?.dispose) st.facePmremRT.dispose();
      } catch {
        /* ignore */
      }
      try {
        if (st?.templeDepthGeom?.dispose) st.templeDepthGeom.dispose();
      } catch {
        /* ignore */
      }
      try {
        if (st?.templeOccL?.material) st.templeOccL.material.dispose();
      } catch {
        /* ignore */
      }
      try {
        const disposeDbgMesh = (dbg) => {
          if (!dbg) return;
          dbg.parent?.remove(dbg);
          dbg.geometry?.dispose?.();
          const mats = Array.isArray(dbg.material) ? dbg.material : [dbg.material];
          for (const mm of mats) {
            if (mm?.dispose) mm.dispose();
          }
        };
        disposeDbgMesh(st?.lm168DebugMesh);
        disposeDbgMesh(st?.eyeMidDebugMesh);
        disposeDbgMesh(st?.glassesBboxCenterDebugMesh);
      } catch {
        /* ignore */
      }
      try {
        st?.hairSegmenter?.close?.();
      } catch {
        /* ignore */
      }
      try {
        st?.poseLandmarker?.close?.();
      } catch {
        /* ignore */
      }
      try {
        const sh = st?.necklaceShadowRes;
        sh?.geo?.dispose?.();
        sh?.mat?.dispose?.();
        sh?.tex?.dispose?.();
      } catch {
        /* ignore */
      }
      try {
        st?.neckOccGeomState?.geom?.dispose?.();
      } catch {
        /* ignore */
      }
      try {
        if (st?.hairMaskTexture?.dispose) st.hairMaskTexture.dispose();
      } catch {
        /* ignore */
      }
      try {
        const ph = st?.hairUniforms?.uOmafitHairMask?.value;
        if (ph && ph !== st?.hairMaskTexture && ph.dispose) ph.dispose();
      } catch {
        /* ignore */
      }
      try {
        omafitDisposeGlassesContactRig(st?.glassesContactRig);
      } catch {
        /* ignore */
      }
      faceArEnhancementState = null;
    };

    (async () => {
      try {
        const pmremOn =
          accessoryType === "necklace" ||
          /^(1|on|true|yes)$/i.test(String(cfgAttr("arGlassesPmrem", "0")).trim());
        if (!pmremOn) {
          return;
        }
        const dep = `deps=three@${ESM_THREE_VER}`;
        const roomUrl = `${ESM_SH}/three@${ESM_THREE_VER}/examples/jsm/environments/RoomEnvironment.js?${dep}`;
        const rgbeUrl = `${ESM_SH}/three@${ESM_THREE_VER}/examples/jsm/loaders/RGBELoader.js?${dep}`;
        const hdrUrl = cfgAttr("arHandHdrEnvUrl", "").trim();
        const PMREMGenerator = THREE.PMREMGenerator;
        if (typeof PMREMGenerator !== "function") return;
        const renderer = mindarThree.renderer;
        const scene = mindarThree.scene;
        if (!renderer || !scene) return;
        const pmrem = new PMREMGenerator(renderer);
        let pmremRT = null;
        if (hdrUrl) {
          const { RGBELoader } = await import(rgbeUrl);
          const hdrtx = await new Promise((resolve, reject) => {
            const loader = new RGBELoader();
            loader.load(hdrUrl, resolve, undefined, reject);
          });
          hdrtx.mapping = THREE.EquirectangularReflectionMapping;
          if (THREE.LinearSRGBColorSpace) hdrtx.colorSpace = THREE.LinearSRGBColorSpace;
          pmremRT = pmrem.fromEquirectangular(hdrtx);
        } else {
          const { RoomEnvironment } = await import(roomUrl);
          const envScene = new RoomEnvironment();
          pmremRT = pmrem.fromScene(envScene, 0.04);
          envScene.dispose?.();
        }
        scene.environment = pmremRT.texture;
        if (faceArEnhancementState) faceArEnhancementState.facePmremRT = pmremRT;
        pmrem.dispose();
        try {
          renderer.toneMapping = THREE.ACESFilmicToneMapping;
          renderer.toneMappingExposure = 1.08;
        } catch {
          /* ignore */
        }
        upgradeFaceArEyewearRendering(THREE, glasses, pmremRT.texture);
        if (accessoryType === "necklace") {
          upgradeFaceArNecklaceJewelryMaterials(THREE, glasses, pmremRT.texture);
        }
        try {
          omafitEnhanceFaceGlbPbrResponse(THREE, glasses);
        } catch {
          /* ignore */
        }
        if (faceArEnhancementState?.hairUniforms && accessoryType === "glasses") {
          const n = installGlassesTempleHairMaskOnGlb(THREE, glasses, faceArEnhancementState.hairUniforms);
          if (n > 0) {
            console.log("[omafit-ar] segmentação cabelo: shaders em", n, "material(is) de haste");
          }
        }
        if (faceArEnhancementState?.hairUniforms && accessoryType === "necklace") {
          const nh = installNecklaceHairMaskOnGlb(THREE, glasses, faceArEnhancementState.hairUniforms);
          const nf = installNecklaceNapeFadeOnGlb(THREE, glasses);
          if (nh > 0) {
            console.log("[omafit-ar] colar: máscara cabelo em", nh, "material(is); fade nuca:", nf);
          }
        }
      } catch (e) {
        console.warn("[omafit-ar] PMREM facial (óculos):", e?.message || e);
      }
    })();

    void (async () => {
      if (accessoryType === "necklace") {
        try {
          const vision = await import(MEDIAPIPE_VISION_BUNDLE);
          const { FilesetResolver, PoseLandmarker } = vision;
          const filesetResolver = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_BASE);
          let poseLandmarker = null;
          try {
            poseLandmarker = await PoseLandmarker.createFromOptions(filesetResolver, {
              baseOptions: {
                modelAssetPath: MEDIAPIPE_POSE_LANDMARKER_URL,
                delegate: "GPU",
              },
              runningMode: "VIDEO",
              numPoses: 1,
            });
          } catch (e1) {
            console.warn("[omafit-ar] PoseLandmarker GPU:", e1?.message || e1);
            poseLandmarker = await PoseLandmarker.createFromOptions(filesetResolver, {
              baseOptions: {
                modelAssetPath: MEDIAPIPE_POSE_LANDMARKER_URL,
                delegate: "CPU",
              },
              runningMode: "VIDEO",
              numPoses: 1,
            });
          }
          if (faceArEnhancementState) faceArEnhancementState.poseLandmarker = poseLandmarker;
          console.log("[omafit-ar] PoseLandmarker (ombros) OK");
        } catch (e) {
          console.warn("[omafit-ar] PoseLandmarker indisponível:", e?.message || e);
        }
      }
    })();

    void (async () => {
      if (
        (accessoryType !== "glasses" && accessoryType !== "necklace") ||
        !faceArEnhancementState?.hairUniforms
      ) {
        return;
      }
      const hairAttr = String(cfgAttr("arFaceHairMask", "0")).trim().toLowerCase();
      if (/^(0|false|off|no)$/.test(hairAttr)) {
        faceArEnhancementState.hairUniforms.uOmafitHairThreshold.value = 2;
        return;
      }
      try {
        const vision = await import(MEDIAPIPE_VISION_BUNDLE);
        const { FilesetResolver, ImageSegmenter } = vision;
        const filesetResolver = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_BASE);
        let imageSegmenter = null;
        try {
          imageSegmenter = await ImageSegmenter.createFromOptions(filesetResolver, {
            baseOptions: {
              modelAssetPath: OMAFIT_IMAGE_SEG_SELFIE_MULTICLASS_URL,
              delegate: "GPU",
            },
            runningMode: "VIDEO",
            outputCategoryMask: true,
            outputConfidenceMasks: false,
          });
        } catch (e1) {
          console.warn("[omafit-ar] ImageSegmenter GPU:", e1?.message || e1);
          imageSegmenter = await ImageSegmenter.createFromOptions(filesetResolver, {
            baseOptions: {
              modelAssetPath: OMAFIT_IMAGE_SEG_SELFIE_MULTICLASS_URL,
              delegate: "CPU",
            },
            runningMode: "VIDEO",
            outputCategoryMask: true,
            outputConfidenceMasks: false,
          });
        }
        const labels = typeof imageSegmenter.getLabels === "function" ? imageSegmenter.getLabels() : [];
        let hairIdx = labels.findIndex((l) => /hair/i.test(String(l)));
        if (hairIdx < 0) hairIdx = 1;
        if (faceArEnhancementState) {
          faceArEnhancementState.hairSegmenter = imageSegmenter;
          faceArEnhancementState.hairCategoryIndex = hairIdx;
          faceArEnhancementState.arVideo = mindarHost.querySelector?.("video") || null;
        }
        console.log("[omafit-ar] ImageSegmenter multiclasse OK", { hairIdx, labels: labels.slice(0, 8) });
      } catch (e) {
        console.warn("[omafit-ar] ImageSegmenter (cabelo) indisponível:", e?.message || e);
      }
    })();

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
          dbgBbox.scale.setScalar(accessoryMeshNormalizeScale);
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

    /** 4.2) Diagnóstico: `calibRot` com calibração loja (rx/ry/rz) quando disponível. */
    try {
      const dbgAxX = new THREE.Vector3(1, 0, 0).applyQuaternion(calibRot.quaternion);
      const dbgAxY = new THREE.Vector3(0, 1, 0).applyQuaternion(calibRot.quaternion);
      const dbgAxZ = new THREE.Vector3(0, 0, 1).applyQuaternion(calibRot.quaternion);
      console.log("[omafit-ar] calibRot (óculos; calibração loja)", {
        glassesSimpleFaceOnly,
        glassesEyeMidpointAlign,
        wearPosM: wearPosMEffective,
        accessoryMeshNormalizeScale,
        glassesFrameWidthLocal,
        calibrationApplied: initialFaceCal
          ? { rx: initialFaceCal.rx, ry: initialFaceCal.ry, rz: initialFaceCal.rz }
          : "none",
        glassesScaleIpdMul: OMAFIT_GLASSES_SCALE_IPD_MUL,
        glassesScaleIpdMetricMul: OMAFIT_GLASSES_SCALE_IPD_METRIC_MUL,
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
    /** `setClearColor` só na 1.ª frame — evita trabalho WebGL redundante. */
    let mindarRendererClearPrimed = false;
    /** Últimos valores aplicados a `tripOffsetGroup` — evita `set` por frame quando estáveis. */
    const tripOffsetApplied = {
      rx: NaN,
      ry: NaN,
      rz: NaN,
      px: NaN,
      py: NaN,
      pz: NaN,
    };
    renderer.setAnimationLoop(() => {
      try {
        if (scene && scene.background != null) scene.background = null;
        if (!mindarRendererClearPrimed && renderer && typeof renderer.setClearColor === "function") {
          renderer.setClearColor(0x000000, 0);
          mindarRendererClearPrimed = true;
        }
      } catch {
        /* ignore */
      }
      /**
       * Aplicar `glassesOffset` ao `tripOffsetGroup` quando mudou — sliders / `__omafitGlassesOffset`.
       */
      if (tripOffsetGroup && glassesOffset) {
        const ox = glassesOffset.rotX;
        const oy = glassesOffset.rotY;
        const oz = glassesOffset.rotZ;
        const px = glassesOffset.posX;
        const py = glassesOffset.posY;
        const pz = glassesOffset.posZ;
        const ta = tripOffsetApplied;
        const eps = 1e-6;
        if (
          !Number.isFinite(ta.rx) ||
          Math.abs(ta.rx - ox) > eps ||
          Math.abs(ta.ry - oy) > eps ||
          Math.abs(ta.rz - oz) > eps ||
          Math.abs(ta.px - px) > eps ||
          Math.abs(ta.py - py) > eps ||
          Math.abs(ta.pz - pz) > eps
        ) {
          ta.rx = ox;
          ta.ry = oy;
          ta.rz = oz;
          ta.px = px;
          ta.py = py;
          ta.pz = pz;
          tripOffsetGroup.rotation.set(ox, oy, oz);
          tripOffsetGroup.position.set(px, py, pz);
        }
      }
      try {
        const stMu = faceArEnhancementState;
        const nowRaf = performance.now();
        if (stMu && !stMu.microUxDisabled && stMu.microUxModelWrap && stMu.microUx) {
          omafitStepMicroUxIntro(
            THREE,
            stMu.microUxModelWrap,
            stMu.microUxGlassesRoot,
            stMu.microUx,
            nowRaf,
            { introMs: 520, scaleFrom: 0.88 },
          );
        }
      } catch {
        /* ignore */
      }
      try {
        const vid = mindarHost?.querySelector?.("video");
        if (vid && faceArEnhancementState?.hairSegmenter) {
          omafitFaceArUpdateHairCategoryMask(THREE, faceArEnhancementState, vid, performance.now());
        }
      } catch {
        /* ignore */
      }
      try {
        if (faceProjectionOpts) {
          omafitSyncMindARFaceProjection(THREE, mindarThree, mindarHost, faceProjectionOpts);
        }
      } catch {
        /* ignore */
      }
      try {
        const fad = faceArEnhancementState?.faceAdaptiveLight;
        if (fad) {
          omafitStepFaceAdaptiveLighting(THREE, fad, mindarHost, renderer);
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
                "As colunas m[0..2], m[4..6], m[8..10] incluem a escala MindAR na âncora — ||basisX|| pode ser >>1; " +
                "não confundir com eyeDir/forward do rig manual (sempre normalizados). " +
                "Rosto frontal: direcção X/Y/Z ≈ eixos mundo, mas amplitudes ≠1 são normais.",
            });
          }
        } catch { /* no-op */ }
      }
      renderer.render(scene, camera);
    });
    fixMindARFaceVideoBehindCanvas(THREE, mindarThree, mindarHost, faceProjectionOpts);

    loading.style.display = "none";

    /**
     * Caminho face: aplica calibração da variante nos data-attrs; GLB diferente
     * do carregado ainda requer reabrir o modal (reload completo do MindAR).
     */
    window.__omafitArSwitchGlb = async (nextUrl, cal) => {
      try {
        if (cal && typeof cal === "object") {
          applyOmafitCalibration(cal, arCfg);
          if (accessoryType === "glasses") {
            applyThreeGroupCalibRot(calibRot, cal);
            calibRot.updateMatrix();
            calibRot.updateMatrixWorld(true);
          }
        }
        try {
          const stSw = faceArEnhancementState;
          if (stSw?.microUx && !stSw.microUxDisabled) {
            stSw.microUx.snapBoost = Math.max(typeof stSw.microUx.snapBoost === "number" ? stSw.microUx.snapBoost : 1, 1.032);
            stSw.microUx.introComplete = false;
            stSw.microUx.introStartMs = performance.now();
            if (stSw.microUxModelWrap) stSw.microUxModelWrap.scale.setScalar(0.985);
            if (stSw.microUxGlassesRoot && stSw.microUx.preparedOpacity) {
              omafitApplyModelOpacityFactor(stSw.microUxGlassesRoot, 0.88);
            }
          }
        } catch {
          /* ignore */
        }
        const gpc = glassesPivotConfigEffective;
        if (!glassesSimpleFaceOnly && gpc && arCfg?.dataset && !OMAFIT_GLASSES_PIVOT_DIRECT_TEST) {
          const fine = parseXyzMeters(arCfg.dataset.arGlassesLocalFineXyz || "0 0 0", 0, 0, 0);
          const po = parseXyzMeters(arCfg.dataset.arGlassesManualCalibOffset || "0 0 0", 0, 0, 0);
          const sr = Number(String(arCfg.dataset.arGlassesManualCalibScale ?? "1").trim());
          gpc.offsetX = fine.x + po.x;
          gpc.offsetY = fine.y + po.y;
          gpc.offsetZ = fine.z + po.z;
          gpc.rotX = 0;
          gpc.rotY = 0;
          gpc.rotZ = 0;
          gpc.scale =
            Number.isFinite(sr) && sr > 0 ? THREE.MathUtils.clamp(sr, 0.25, 4) : 1;
        }
        const nu = String(nextUrl || "").trim();
        if (nu && nu !== String(sessionGlbUrl || "").trim()) {
          console.warn(
            "[omafit-ar] Face AR: variante com outro GLB — reabra o experimento AR para carregar o novo ficheiro.",
          );
        }
      } catch (e) {
        console.warn("[omafit-ar] face __omafitArSwitchGlb:", e?.message || e);
      }
    };

    try {
      let showTripoDbg = false;
      try {
        if (
          new URLSearchParams(window.location?.search || "").get("omafit_ar_glasses_tripo_debug") ===
          "1"
        ) {
          showTripoDbg = true;
        }
      } catch {
        /* ignore */
      }
      if (
        /^(1|true|yes|on)$/.test(
          String(cfgAttr("arGlassesTripoDebug", "")).trim().toLowerCase(),
        )
      ) {
        showTripoDbg = true;
      }
      if (showTripoDbg && tripOffsetGroup) {
        removeTripoDebugPanel = installOmafitGlassesTripoDebugPanel(
          arWrap,
          THREE,
          tripOffsetGroup,
          tripDegY,
          tripDegX,
          tripDegZ,
        );
      }
    } catch (e) {
      console.warn("[omafit-ar] Tripo debug UI:", e?.message || e);
    }

    try {
      if (useGlassesScreenRot && glassesOffset) {
        removeGlassesScreenRotPanel = installOmafitGlassesOffsetPanel(
          arWrap,
          THREE,
          glassesOffset,
        );
      }
    } catch (e) {
      console.warn("[omafit-ar] screen rot UI:", e?.message || e);
    }

    try {
      let showManualCalibUi = false;
      try {
        if (
          new URLSearchParams(window.location?.search || "").get("omafit_ar_glasses_manual_calib") ===
          "1"
        ) {
          showManualCalibUi = true;
        }
      } catch {
        /* ignore */
      }
      if (
        /^(1|true|yes|on)$/.test(
          String(cfgAttr("arGlassesManualCalibUi", "")).trim().toLowerCase(),
        )
      ) {
        showManualCalibUi = true;
      }
      if (showManualCalibUi && glassesPivotConfigEffective && !glassesSimpleFaceOnly) {
        removeManualCalibPanel = installOmafitGlassesManualCalibPanel(arWrap, glassesPivotConfigEffective);
      }
    } catch (e) {
      console.warn("[omafit-ar] manual calib UI:", e?.message || e);
    }

    __omafitArDbgLog({
      location: "omafit-ar-widget.js:runArSession",
      message: "mindar face started (simple pipeline)",
      hypothesisId: "H6-simple-pipeline",
      data: {
        pipeline: "simple-instagram-filter",
        glassesSimpleFaceOnly,
        anchorIndex,
        disableFaceMirror,
        mirrorSelfieLegacy: legacyMsRaw || null,
        mindarDisableMirrorExplicit: mindarDmExplicit,
        wearPositionM: wearPosMEffective,
        debugEnabled,
        accessoryMeshNormalizeScale,
        glassesScaleIpdMul: OMAFIT_GLASSES_SCALE_IPD_MUL,
        glassesScaleIpdMetricMul: OMAFIT_GLASSES_SCALE_IPD_METRIC_MUL,
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
  } catch (rawErr) {
    const e =
      rawErr === undefined || rawErr === null
        ? new Error("omafit-ar: falha sem valor (rejeição vazia)")
        : rawErr instanceof Error
          ? rawErr
          : typeof rawErr === "object" && "message" in rawErr
            ? new Error(String(rawErr.message))
            : new Error(String(rawErr));
    console.error("[omafit-ar]", e);
    const errName = e && typeof e === "object" && "name" in e ? String(e.name || "") : "";
    const isCam =
      errName === "NotAllowedError" ||
      errName === "PermissionDeniedError" ||
      errName === "OverconstrainedError" ||
      errName === "NotFoundError" ||
      errName === "AbortError";
    const msg = String((e && e.message) || e || "");
    const isPolicyViolation =
      /permissions policy violation|camera is not allowed|not allowed in this document|feature policy/i.test(
        msg,
      );
    const isMindarCameraPolicy =
      /MindAR: arranque falhou|rejeição vazia|Permissions-Policy neste documento/i.test(msg);
    const isGlb =
      /glb|gltf|fetch|load|404|403|network|failed to fetch|http/i.test(msg) &&
      !/face|landmarker|wasm|vision|tensorflow|mind|tfjs|facemesh/i.test(msg);
    if (/omafit-ar: contexto não seguro|insecure context/i.test(msg)) {
      loading.textContent = t.errHttps || t.errGeneric;
    } else if (/mediaDevices|getUserMedia/i.test(msg)) {
      loading.textContent = t.errMediaDevices || t.errGeneric;
    } else if (isPolicyViolation || isMindarCameraPolicy) {
      loading.textContent = t.errCameraEmbed || t.errCamera || t.errGeneric;
      omafitArAppendNewWindowFallbackButton(loading, t, onClose);
    } else if (isCam) {
      loading.textContent = t.errCamera || t.errGeneric;
      omafitArAppendNewWindowFallbackButton(loading, t, onClose);
    } else {
      loading.textContent = isGlb ? t.errGlb : t.errFace;
    }
    cleanup();
  }
}

/**
 * `import()` remoto (tasks-vision), WASM MediaPipe ou GPU que nunca faz resolve —
 * sem timeout o utilizador fica eternamente em «A carregar tracking».
 *
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} label
 * @returns {Promise<T>}
 */
function omafitPromiseTimeoutRace(promise, ms, label) {
  const n = Math.max(1, Math.min(600000, Number(ms) || 90000));
  return Promise.race([
    promise,
    new Promise((_, rej) => {
      setTimeout(() => {
        rej(new Error(`omafit-ar: ${label} (${n}ms)`));
      }, n);
    }),
  ]);
}

/**
 * Sessão AR para acessórios de pulso (relógios, pulseiras) usando
 * MediaPipe Hand Landmarker + Three.js directamente (sem MindAR).
 *
 * Hierarquia Three.js igual à do face path (pulseira: grupo extra de alinhamento):
 *   anchorGroup → wearPosition → calibRot → [braceletWristAlign] → glbRoot
 *
 * `anchorGroup` é re-orientado a cada frame a partir dos landmarks 0, 1, 5, 9
 * e 17 (punho, CMC polegar, MCP índice/mindinho, MCP médio): eixo do antebraço
 * (com blend estável), normal palmar/dorsal e produtos vectoriais no plano
 * 0–5–17. Para **pulseira**, largura MCP5–MCP17, segmento punho→MCP9 (elipse
 * não circular: X/Z ~ largura, Y ~ espessura), offset −Y suavizado e rotação
 * extra alinhada ao braço. Estes pontos definem uma base
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

  // #region agent log
  function dbgBraceletAr(hypothesisId, location, message, data) {
    if (accessoryType !== "bracelet") return;
    const payload = {
      sessionId: "49efff",
      hypothesisId,
      location,
      message,
      data: data && typeof data === "object" ? data : {},
      timestamp: Date.now(),
    };
    try {
      console.info("[omafitDbgBracelet]", payload.hypothesisId, payload.message, payload.data);
    } catch {
      /* ignore */
    }
    fetch("http://127.0.0.1:7744/ingest/736271b4-0216-42af-91db-7273b476c84e", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "49efff" },
      body: JSON.stringify(payload),
    }).catch(() => {});
  }
  // #endregion

  const qsHand =
    typeof location !== "undefined" ? String(location.search || "") : "";
  const braceletHandDiag =
    accessoryType === "bracelet" &&
    (/[?&]omafit_ar_bracelet_log=1\b/.test(qsHand) ||
      /[?&]omafit_ar_debug=1\b/.test(qsHand));
  function braceletHandLog(stage, payload) {
    if (!braceletHandDiag) return;
    try {
      const lt =
        loading && loading.textContent != null
          ? String(loading.textContent).slice(0, 140)
          : "";
      console.info("[omafit-ar][bracelet]", stage, {
        tMs: typeof performance !== "undefined" ? Math.round(performance.now()) : 0,
        loadingText: lt,
        ...(payload && typeof payload === "object" ? payload : {}),
      });
    } catch {
      /* ignore */
    }
  }

  const perfModeHand = String(cfgAttr("arPerformanceProfile", "auto")).trim().toLowerCase();
  const handArProfile = omafitResolveArDeviceRuntimeProfile({ perfMode: perfModeHand });
  const handMicroUxDisabled = /^(0|false|off|no)$/i.test(String(cfgAttr("arMicroUx", "1")).trim());

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

  braceletHandLog("handSession:start", {
    build: typeof OMAFIT_AR_WIDGET_BUILD !== "undefined" ? OMAFIT_AR_WIDGET_BUILD : "?",
    glbUrlPreview: String(glbUrl || "").slice(0, 200),
    microUxDisabled: handMicroUxDisabled,
    perfMode: perfModeHand,
    preferredCamera: String(cfgAttr("arPreferredCamera", "") || "").trim(),
  });
  dbgBraceletAr("H5", "runHandArSession:entry", "hand_session_start", {
    build: typeof OMAFIT_AR_WIDGET_BUILD !== "undefined" ? OMAFIT_AR_WIDGET_BUILD : "?",
    microUxDisabled: handMicroUxDisabled,
    glbUrlPreview: String(glbUrl || "").slice(0, 160),
  });

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

  const handVidIdeal = omafitBuildFaceUserMediaVideoIdeal(handArProfile);
  const baseVideoConstraint = {
    width: { ideal: handVidIdeal.width.ideal, max: handVidIdeal.width.max },
    height: { ideal: handVidIdeal.height.ideal, max: handVidIdeal.height.max },
    frameRate: handVidIdeal.frameRate,
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
    braceletHandLog("getUserMedia:failed", { message: e?.message || String(e) });
    throw e;
  }

  try {
    const track = stream.getVideoTracks?.()?.[0];
    const fm = track?.getSettings?.()?.facingMode;
    if (fm === "environment") mirrorVideoX = false;
    if (fm === "user") mirrorVideoX = true;
    braceletHandLog("camera:track", {
      facingMode: fm || "(unknown)",
      mirrorVideoX,
      wantRearCamera,
    });
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
    arDeviceProfile: handArProfile,
  });

  loading.textContent =
    accessoryType === "bracelet"
      ? "A preparar tracking da pulseira…"
      : "A preparar tracking do pulso…";

  braceletHandLog("mediapipe:before_vision_exports", {
    visionKeys:
      vision && typeof vision === "object"
        ? Object.keys(vision).slice(0, 24)
        : typeof vision,
    hasDefault: Boolean(vision?.default),
  });

  const visionExports = (() => {
    const v = vision;
    if (!v || typeof v !== "object") return null;
    if (typeof v.FilesetResolver === "function" && typeof v.HandLandmarker === "function") {
      return v;
    }
    const d = v.default;
    if (
      d &&
      typeof d === "object" &&
      typeof d.FilesetResolver === "function" &&
      typeof d.HandLandmarker === "function"
    ) {
      return d;
    }
    return null;
  })();
  if (!visionExports) {
    console.error("[omafit-ar] vision module inválido (tasks-vision):", vision);
    braceletHandLog("mediapipe:vision_exports_invalid", {
      visionType: typeof vision,
    });
    loading.textContent = t.errGeneric || t.errFace || "AR indisponível.";
    throw new Error(
      "omafit-ar: MediaPipe tasks-vision sem FilesetResolver/HandLandmarker — verifique import/CDN.",
    );
  }
  const { FilesetResolver, HandLandmarker } = visionExports;

  /** WASM/jsDelivr/CSP: `forVisionTasks` pode pendurar indefinidamente sem isto. */
  function omaMpRace(promise, ms, label) {
    const n = Math.max(1, Number(ms) || 1);
    return Promise.race([
      promise,
      new Promise((_, rej) => {
        setTimeout(() => {
          rej(new Error(`omafit-ar: ${label} (${n}ms)`));
        }, n);
      }),
    ]);
  }

  let fsTimeoutMs = Number(cfgAttr("arHandFilesetTimeoutMs", ""));
  if (!Number.isFinite(fsTimeoutMs) || fsTimeoutMs <= 0) fsTimeoutMs = 45000;
  fsTimeoutMs = Math.min(120000, Math.max(8000, fsTimeoutMs));

  braceletHandLog("mediapipe:fileset_resolver_start", {
    wasmBase: MEDIAPIPE_WASM_BASE,
    fsTimeoutMs,
  });

  let filesetResolver;
  try {
    filesetResolver = await omaMpRace(
      FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_BASE),
      fsTimeoutMs,
      "MediaPipe WASM (FilesetResolver)",
    );
    console.log("[omafit-ar] FilesetResolver OK");
    braceletHandLog("mediapipe:fileset_resolver_ok", {});
  } catch (eFs) {
    console.error("[omafit-ar] FilesetResolver falhou:", eFs?.message || eFs);
    braceletHandLog("mediapipe:fileset_resolver_fail", {
      message: eFs?.message || String(eFs),
    });
    loading.textContent = t.errGeneric || t.errFace || "AR indisponível.";
    throw eFs instanceof Error ? eFs : new Error(String(eFs));
  }

  const handModelAssetUrl =
    String(cfgAttr("arHandModelUrl", "") || "").trim() || MEDIAPIPE_HAND_MODEL_URL;
  try {
    void fetch(handModelAssetUrl, { mode: "cors", cache: "force-cache" }).catch(() => {});
  } catch {
    /* ignore */
  }

  function parseHandMpConf(key, fallback) {
    const raw = String(cfgAttr(key, "") || "").trim();
    if (raw === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0.05 && n <= 1 ? n : fallback;
  }
  /**
   * Pulseira: limiares por defeito ligeiramente mais baixos que o relógio
   * (0,35/0,4) para reduzir frames sem mão detetada — o âncora só mostra o GLB
   * com landmarks estáveis. Override: `data-ar-hand-min-detection-confidence`, etc.
   */
  const mpConfFallbackDet = accessoryType === "bracelet" ? 0.35 : 0.5;
  const mpConfFallbackPres = accessoryType === "bracelet" ? 0.35 : 0.5;
  const mpConfFallbackTrack = accessoryType === "bracelet" ? 0.4 : 0.5;
  const mpMinDet = parseHandMpConf("arHandMinDetectionConfidence", mpConfFallbackDet);
  const mpMinPres = parseHandMpConf("arHandMinPresenceConfidence", mpConfFallbackPres);
  const mpMinTrack = parseHandMpConf("arHandMinTrackingConfidence", mpConfFallbackTrack);
  dbgBraceletAr("H4", "mediapipe:mp_conf", "HandLandmarker_thresholds", {
    mpMinDet,
    mpMinPres,
    mpMinTrack,
  });

  async function createHandLandmarker(delegate) {
    return HandLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: handModelAssetUrl,
        delegate,
      },
      runningMode: "VIDEO",
      numHands: 1,
      minHandDetectionConfidence: mpMinDet,
      minHandPresenceConfidence: mpMinPres,
      minTrackingConfidence: mpMinTrack,
    });
  }

  /**
   * Igual ao relógio por defeito: **CPU primeiro** (`data-ar-hand-mp-delegate` vazio).
   * Opt-in pulseira só se precisares do arranque GPU rápido em redes lentas:
   * `data-ar-hand-bracelet-gpu-first="1"` em `#omafit-widget-root` ou `#omafit-ar-root`.
   * Modelo espelhado (rede/CSP): `data-ar-hand-model-url="https://…/hand_landmarker.task"`.
   */
  let handLandmarker = null;
  const delegatePrefRaw = String(cfgAttr("arHandMpDelegate", "") || "").trim().toLowerCase();
  const delegatePref =
    accessoryType === "bracelet" && delegatePrefRaw === "gpu"
      ? "cpu"
      : delegatePrefRaw;
  const timeoutRaw = cfgAttr("arHandLandmarkerTimeoutMs", "");
  let mpTimeoutMs = Number(timeoutRaw);
  if (!Number.isFinite(mpTimeoutMs) || mpTimeoutMs <= 0) mpTimeoutMs = 24000;
  mpTimeoutMs = Math.min(60000, Math.max(5000, mpTimeoutMs));

  const cpuFirst = delegatePref !== "gpu";

  const bfGpuFirstRaw = String(cfgAttr("arHandBraceletGpuFirst", "0")).trim().toLowerCase();
  const braceletGpuFirstEnabled =
    accessoryType === "bracelet" &&
    delegatePref === "" &&
    (bfGpuFirstRaw === "1" ||
      bfGpuFirstRaw === "true" ||
      bfGpuFirstRaw === "yes" ||
      bfGpuFirstRaw === "on");

  braceletHandLog("mediapipe:hand_landmarker_plan", {
    delegatePrefRaw,
    delegatePrefEffective: delegatePref,
    mpTimeoutMs,
    cpuFirst,
    modelUrl: handModelAssetUrl.slice(0, 220),
    braceletGpuFirstEnabled,
  });

  async function createHandLandmarkerWithTimeout(delegate, label) {
    let lmTo = Math.min(90000, Math.max(mpTimeoutMs, 15000));
    if (!Number.isFinite(lmTo) || lmTo <= 0) lmTo = 24000;
    lmTo = Math.min(45000, Math.max(8000, lmTo));
    return omaMpRace(createHandLandmarker(delegate), lmTo, label);
  }

  if (braceletGpuFirstEnabled) {
    loading.textContent = "A carregar tracking da pulseira (GPU)…";
    await new Promise((res) =>
      requestAnimationFrame(() => requestAnimationFrame(res)),
    );
    try {
      const gpuBraceletMs = Math.min(
        14000,
        Math.max(7000, Math.floor(mpTimeoutMs * 0.55)),
      );
      handLandmarker = await omaMpRace(
        createHandLandmarker("GPU"),
        gpuBraceletMs,
        "HandLandmarker GPU (pulseira primeiro)",
      );
      console.log("[omafit-ar] HandLandmarker OK (GPU, pulseira primeiro)");
      braceletHandLog("mediapipe:hand_landmarker_ok", {
        delegate: "GPU_bracelet_first",
      });
    } catch (eBf) {
      console.warn(
        "[omafit-ar] Pulseira: tentativa GPU inicial falhou, a usar CPU.",
        eBf?.message || eBf,
      );
      braceletHandLog("mediapipe:bracelet_gpu_first_fail", {
        message: eBf?.message || String(eBf),
      });
      handLandmarker = null;
    }
  }

  if (!handLandmarker) {
    if (cpuFirst) {
      loading.textContent =
        accessoryType === "bracelet"
          ? "A carregar tracking da pulseira (CPU)…"
          : "A carregar tracking do pulso (CPU)…";
      await new Promise((res) =>
        requestAnimationFrame(() => requestAnimationFrame(res)),
      );
      console.log(
        "[omafit-ar] HandLandmarker CPU (default; relógio ou fallback pulseira)",
      );
      handLandmarker = await createHandLandmarkerWithTimeout(
        "CPU",
        "HandLandmarker CPU",
      );
      console.log("[omafit-ar] HandLandmarker OK (CPU)");
      braceletHandLog("mediapipe:hand_landmarker_ok", { delegate: "CPU" });
    } else {
      try {
        loading.textContent =
          accessoryType === "bracelet"
            ? "A carregar tracking da pulseira (GPU)…"
            : "A carregar tracking do pulso (GPU)…";
        handLandmarker = await Promise.race([
          createHandLandmarker("GPU"),
          new Promise((_, rej) => {
            setTimeout(() => {
              rej(new Error("omafit-ar: HandLandmarker GPU timeout"));
            }, mpTimeoutMs);
          }),
        ]);
        console.log("[omafit-ar] HandLandmarker OK (GPU)");
        braceletHandLog("mediapipe:hand_landmarker_ok", { delegate: "GPU" });
      } catch (eGpu) {
        console.warn("[omafit-ar] HandLandmarker GPU falhou ou expirou:", eGpu?.message || eGpu);
        braceletHandLog("mediapipe:hand_landmarker_gpu_fail", {
          message: eGpu?.message || String(eGpu),
        });
        loading.textContent =
          accessoryType === "bracelet"
            ? "A trocar para tracking da pulseira (CPU)…"
            : "A trocar para tracking do pulso (CPU)…";
        handLandmarker = await createHandLandmarkerWithTimeout(
          "CPU",
          "HandLandmarker CPU fallback",
        );
        console.log("[omafit-ar] HandLandmarker OK (CPU fallback)");
        braceletHandLog("mediapipe:hand_landmarker_ok", { delegate: "CPU_fallback" });
      }
    }
  }

  braceletHandLog("handSession:after_landmarker", {
    nextUi: "arLoading / modelo 3D",
  });
  dbgBraceletAr("H4", "runHandArSession:after_landmarker", "landmarker_ready", {
    hasLandmarker: Boolean(handLandmarker),
  });

  loading.textContent = t.arLoading || t.loading || "A carregar modelo 3D…";

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

  const proximityHint = document.createElement("div");
  proximityHint.setAttribute("aria-live", "polite");
  proximityHint.setAttribute("data-omafit-ar-hand-proximity", "1");
  Object.assign(proximityHint.style, {
    position: "absolute",
    left: "50%",
    bottom: "14px",
    transform: "translateX(-50%)",
    zIndex: "6",
    maxWidth: "min(340px, 92vw)",
    padding: "9px 16px",
    borderRadius: "12px",
    fontSize: "13px",
    lineHeight: "1.4",
    textAlign: "center",
    fontFamily:
      'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    color: "rgba(255,255,255,0.96)",
    background: "rgba(16,16,24,0.78)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    pointerEvents: "none",
    opacity: "0",
    transition: "opacity 0.4s ease",
    boxShadow: "0 2px 14px rgba(0,0,0,0.28)",
  });
  const handWristInstruction =
    accessoryType === "bracelet"
      ? "Coloque seu pulso esquerdo em frente a camera"
      : "Coloque seu pulso direito em frente a camera";
  proximityHint.textContent = handWristInstruction;
  mindarHost.appendChild(proximityHint);

  let handDetectRingEl = null;
  if (!handMicroUxDisabled) {
    try {
      handDetectRingEl = document.createElement("div");
      handDetectRingEl.className = "omafit-ar-track-detect-ring";
      handDetectRingEl.setAttribute("aria-hidden", "true");
      mindarHost.appendChild(handDetectRingEl);
    } catch {
      /* ignore */
    }
  }

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: handArProfile.webglAntialias !== false,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  });
  {
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const maxDpr = omafitEffectiveArRendererMaxDpr(THREE, cfgAttr("arRendererMaxDpr", ""), handArProfile);
    renderer.setPixelRatio(Math.min(dpr, maxDpr));
  }
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
    try {
      const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const maxDpr = omafitEffectiveArRendererMaxDpr(THREE, cfgAttr("arRendererMaxDpr", ""), handArProfile);
      renderer.setPixelRatio(Math.min(dpr, maxDpr));
    } catch {
      /* ignore */
    }
    if (camera) {
      const asp = vW / Math.max(1, vH);
      camera.aspect = asp;
      camera.fov = omafitHandPathCameraFovDeg(THREE, asp, handArProfile);
      camera.updateProjectionMatrix();
    }
    void cssW;
    void cssH;
  };

  const scene = new THREE.Scene();
  const handAmbientLight = new THREE.AmbientLight(0xffffff, 0.72);
  const handHemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.38);
  if (accessoryType === "bracelet") {
    /** Céu azul-claro + chão quente — reflexos exteriores em metais preciosos. */
    handHemiLight.color.set(0xb8daf8);
    handHemiLight.groundColor.set(0xa08068);
    handHemiLight.intensity = 0.42;
  }
  scene.add(handAmbientLight);
  scene.add(handHemiLight);

  const handInitAsp =
    video.videoWidth > 2 && video.videoHeight > 2 ? video.videoWidth / video.videoHeight : 1;
  const camera = new THREE.PerspectiveCamera(
    omafitHandPathCameraFovDeg(THREE, handInitAsp, handArProfile),
    handInitAsp,
    0.02,
    100,
  );
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);

  /** PMREM environment (IBL); libertado em `cleanupHand`. */
  let handEnvPmremRT = null;
  /** Textura equirectangular HDR opcional (se `data-ar-hand-hdr-env-url`). */
  let handHdrEquirectTexture = null;
  try {
    const dep = `deps=three@${ESM_THREE_VER}`;
    const roomUrl = `${ESM_SH}/three@${ESM_THREE_VER}/examples/jsm/environments/RoomEnvironment.js?${dep}`;
    const rgbeUrl = `${ESM_SH}/three@${ESM_THREE_VER}/examples/jsm/loaders/RGBELoader.js?${dep}`;
    const hdrUrl = cfgAttr("arHandHdrEnvUrl", "").trim();
    let pmremImpMs = Number(cfgAttr("arHandPmremImportTimeoutMs", ""));
    if (!Number.isFinite(pmremImpMs) || pmremImpMs <= 0) pmremImpMs = 20000;
    pmremImpMs = Math.min(45000, Math.max(6000, pmremImpMs));

    braceletHandLog("pmrem:start", {
      pmremImpMs,
      hdrCustom: Boolean(hdrUrl),
      esmThree: ESM_THREE_VER,
    });

    const PMREMGenerator = THREE.PMREMGenerator;
    if (typeof PMREMGenerator !== "function") {
      throw new Error("THREE.PMREMGenerator indisponível (build Three antigo?)");
    }
    const pmrem = new PMREMGenerator(renderer);
    if (hdrUrl) {
      const { RGBELoader } = await omaMpRace(
        import(rgbeUrl),
        pmremImpMs,
        "RGBELoader import (esm)",
      );
      const hdrtx = await new Promise((resolve, reject) => {
        const loader = new RGBELoader();
        loader.load(hdrUrl, resolve, undefined, reject);
      });
      hdrtx.mapping = THREE.EquirectangularReflectionMapping;
      if (THREE.LinearSRGBColorSpace) hdrtx.colorSpace = THREE.LinearSRGBColorSpace;
      handHdrEquirectTexture = hdrtx;
      handEnvPmremRT = pmrem.fromEquirectangular(hdrtx);
      scene.environment = handEnvPmremRT.texture;
    } else {
      const { RoomEnvironment } = await omaMpRace(
        import(roomUrl),
        pmremImpMs,
        "RoomEnvironment import (esm)",
      );
      const envScene = new RoomEnvironment();
      handEnvPmremRT = pmrem.fromScene(envScene, 0.04);
      scene.environment = handEnvPmremRT.texture;
      envScene.dispose?.();
    }
    pmrem.dispose();
    handAmbientLight.intensity = 0.38;
    handHemiLight.intensity = 0.2;
    braceletHandLog("pmrem:ok", { hasSceneEnv: Boolean(scene.environment) });
  } catch (e) {
    console.warn("[omafit-ar] PMREM / IBL indisponível — reflexos reduzidos.", e?.message || e);
    braceletHandLog("pmrem:fail", { message: e?.message || String(e) });
  }
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  /** Exposure > 1: metais com contraste de luxo sem “estourar” reflexos (com ACES). */
  renderer.toneMappingExposure = 1.2;
  if (THREE.SRGBColorSpace) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  /** Luz chave + vídeo: intensidade segue luminância média do feed. */
  const handKeyLight = new THREE.DirectionalLight(0xfff5ee, 0.52);
  handKeyLight.position.set(0.38, 0.94, 0.36);
  scene.add(handKeyLight);
  const lumaCanvas =
    typeof document !== "undefined" ? document.createElement("canvas") : null;
  let lumaCtx = null;
  let lastLumaMs = 0;
  /** Reuso cor média do vídeo → hemisfério (iluminação adaptativa mão). */
  let handLumaTintCol = null;
  if (lumaCanvas) {
    lumaCanvas.width = 48;
    lumaCanvas.height = 32;
    lumaCtx = lumaCanvas.getContext("2d", { willReadFrequently: true });
  }

  /**
   * Hierarquia espelha a face path para paridade com o preview do admin:
   *   anchor → wearPosition → calibRot → [pulseira: wristAlign] → glbRoot
   */
  const anchor = new THREE.Group();
  /** Matriz escrita em `updateAnchorFromHand` — não deixar o Three interpolar. */
  anchor.matrixAutoUpdate = false;
  scene.add(anchor);

  const wearPosition = new THREE.Group();
  anchor.add(wearPosition);

  const calibRot = new THREE.Group();
  wearPosition.add(calibRot);

  /** Só pulseira: rotação suave punho→MCP9 em espaço de `calibRot`. */
  let braceletWristAlignGroup = null;
  let braceletAxisDebugLine = null;
  let braceletOccNormalDebugLine = null;
  const glbRoot = new THREE.Group();
  glbRoot.visible = false;
  const handMicroUxWrap = new THREE.Group();
  handMicroUxWrap.name = "omafit-ar-hand-micro-ux-wrap";
  const handMicroUx = {
    introStartMs: 0,
    introComplete: false,
    preparedOpacity: false,
    snapBoost: 1,
    hadLandmarks: false,
  };
  let handMicroOpacityRoot = null;
  if (accessoryType === "bracelet") {
    braceletWristAlignGroup = new THREE.Group();
    braceletWristAlignGroup.name = "omafit-ar-bracelet-wrist-align";
    calibRot.add(braceletWristAlignGroup);
    braceletWristAlignGroup.add(handMicroUxWrap);
    handMicroUxWrap.add(glbRoot);
    if (OMAFIT_BRACELET_AXIS_DEBUG_ENABLED || omafitBraceletBAxisDebugFromQuery()) {
      const dbgGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0.08, 0),
      ]);
      const dbgMat = new THREE.LineBasicMaterial({
        color: 0x00ff00,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      braceletAxisDebugLine = new THREE.Line(dbgGeom, dbgMat);
      braceletAxisDebugLine.frustumCulled = false;
      braceletAxisDebugLine.renderOrder = 999;
      scene.add(braceletAxisDebugLine);
    }
    if (OMAFIT_BRACELET_OCC_NORMAL_DEBUG_ENABLED) {
      const occDbgGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0.05, 0),
      ]);
      const occDbgMat = new THREE.LineBasicMaterial({
        color: 0xff0000,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      braceletOccNormalDebugLine = new THREE.Line(occDbgGeom, occDbgMat);
      braceletOccNormalDebugLine.frustumCulled = false;
      braceletOccNormalDebugLine.renderOrder = 999;
      scene.add(braceletOccNormalDebugLine);
    }
  } else {
    calibRot.add(handMicroUxWrap);
    handMicroUxWrap.add(glbRoot);
  }

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
   *  • `renderOrder` 0 (oclusor) vs 1 (meshes GLB) → oclusor primeiro.
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
  const occluderGeomHalfLen = OMAFIT_ARM_OCCLUDER_LENGTH_M / 2;
  const armOccluderMat = createHandArArmOccluderDepthMaterial(
    THREE,
    occluderGeomHalfLen,
    accessoryType === "bracelet" ? 0.048 : 0.028,
  );
  if (accessoryType === "bracelet") armOccluderMat.side = THREE.BackSide;
  const armOccluder = new THREE.Mesh(armOccluderGeom, armOccluderMat);
  /** Oclusor antes do GLB; meshes do relógio usam renderOrder 1. */
  armOccluder.renderOrder = 0;
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

  /**
   * Plano de oclusão (depth-only), criado uma única vez.
   * Escreve no depth buffer sem pintar cor para ajudar a esconder
   * geometrias da pulseira que deveriam ficar atrás do punho.
   */
  const occPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.2, 0.2),
    new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: true,
      depthTest: true,
      depthFunc: THREE.LessEqualDepth,
      side: THREE.DoubleSide,
      /**
       * O antigo overlay vermelho (`opacity` 0.2 + `transparent`) punha o plano na
       * fila transparente e o depth combinava com o GLB curvo; só `colorWrite:false`
       * opaco mudava o comportamento e a pulseira parecia “plana” no pulso.
       * Mantemos fila transparente com opacidade 0 — invisível, mesmo efeito 3D.
       */
      transparent: true,
      opacity: 0,
    }),
  );
  occPlane.visible = false;
  occPlane.frustumCulled = false;
  occPlane.renderOrder = 1;
  occPlane.scale.set(0.12, 0.08, 1);
  scene.add(occPlane);

  /** Sombra de contacto (multiply) ligeira sob o mostrador — pele escurecida ao centro. */
  const contactRadialTex = createHandArRadialShadowTexture(THREE);
  const contactShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.085, 0.085),
    new THREE.MeshBasicMaterial({
      map: contactRadialTex,
      transparent: true,
      opacity: 0.36,
      depthWrite: false,
      depthTest: true,
      blending: THREE.MultiplyBlending,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.position.set(0, -0.0065, 0);
  contactShadow.renderOrder = 2;
  contactShadow.visible = false;
  contactShadow.frustumCulled = false;
  anchor.add(contactShadow);

  const wearXYZ = parseXyzMeters(cfgAttr("arMindarWearPosition", "0 0 0"), 0, 0, 0);
  const userScale = Number(cfgAttr("arMindarModelScale", "1")) || 1;

  /**
   * Aplica apenas a rotação de calibração do lojista ao `calibRot` (rx/ry/rz
   * em graus, eixos **mundo**, composição Y→X→Z — mesma ordem que o preview do
   * admin em `applyCalibrationToState`). Posição e escala ficam intactos.
   * Sem cal (ou todos zero) repõe identidade.
   */
  const _calWorldAxes = {
    X: new THREE.Vector3(1, 0, 0),
    Y: new THREE.Vector3(0, 1, 0),
    Z: new THREE.Vector3(0, 0, 1),
  };
  const applyCalibRot = (cal) => {
    calibRot.quaternion.identity();
    const rxDeg = Number((cal && cal.rx) ?? 0) || 0;
    const ryDeg = Number((cal && cal.ry) ?? 0) || 0;
    const rzDeg = Number((cal && cal.rz) ?? 0) || 0;
    if (ryDeg) calibRot.rotateOnWorldAxis(_calWorldAxes.Y, ryDeg * Math.PI / 180);
    if (rxDeg) calibRot.rotateOnWorldAxis(_calWorldAxes.X, rxDeg * Math.PI / 180);
    if (rzDeg) calibRot.rotateOnWorldAxis(_calWorldAxes.Z, rzDeg * Math.PI / 180);
  };

  /** Lê calibração inicial do produto a partir de `data-ar-omafit-calibration`. */
  const _initialHandCal = (() => {
    try {
      const raw = arCfg?.dataset?.arOmafitCalibration || embedCfg?.dataset?.arOmafitCalibration || "";
      if (!raw) return null;
      let v = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (v && typeof v === "object" && v.value !== undefined) {
        try { v = typeof v.value === "string" ? JSON.parse(v.value) : v.value; } catch { /* noop */ }
      }
      if (!v || typeof v !== "object" || Array.isArray(v)) return null;
      if (typeof v.error === "string" && Object.keys(v).length <= 2) return null;
      return v;
    } catch { return null; }
  })();
  applyCalibRot(_initialHandCal);

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
   * Pulseira plana → wrap cilíndrico real em torno do eixo local Y:
   * - normaliza X pelo bbox global da `glbScene` (evita distorção entre meshes),
   * - converte para ângulo [-π, π],
   * - projecta para círculo (X,Z) com raio fixo.
   */
  function wrapBraceletCylinderNormalized(glbScene, radius) {
    glbScene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(glbScene);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const width = Math.max(1e-6, size.x);
    const halfW = width * 0.5;

    const worldP = new THREE.Vector3();
    const sceneP = new THREE.Vector3();
    const localP = new THREE.Vector3();
    const invWorld = new THREE.Matrix4();
    glbScene.traverse((obj) => {
      if (!obj?.isMesh || !obj.geometry?.attributes?.position) return;
      const pos = obj.geometry.attributes.position;
      obj.updateMatrixWorld(true);
      invWorld.copy(obj.matrixWorld).invert();
      for (let i = 0; i < pos.count; i++) {
        localP.set(pos.getX(i), pos.getY(i), pos.getZ(i));
        worldP.copy(localP).applyMatrix4(obj.matrixWorld);
        sceneP.copy(worldP);
        glbScene.worldToLocal(sceneP);

        const nx = THREE.MathUtils.clamp((sceneP.x - center.x) / halfW, -1, 1);
        const angle = nx * Math.PI;
        sceneP.x = center.x + Math.cos(angle) * radius;
        sceneP.z = center.z + Math.sin(angle) * radius;

        worldP.copy(sceneP);
        glbScene.localToWorld(worldP);
        localP.copy(worldP).applyMatrix4(invWorld);
        pos.setXYZ(i, localP.x, localP.y, localP.z);
      }
      pos.needsUpdate = true;
      obj.geometry.computeBoundingBox();
      obj.geometry.computeBoundingSphere();
      obj.geometry.computeVertexNormals();
    });
  }

  /**
   * Diâmetro-alvo (~65 mm) para encolher GLBs Tripo com escala nativa gigante
   * antes do radial procedural e antes de `fitWristGlb` (âncora / posição).
   */
  const OMAFIT_BRACELET_TRIPO_TARGET_DIAMETER_M = 0.065;

  /**
   * Threshold de elongação (maxDim / medianDim) para o modo `auto` do radial
   * procedural. Abaixo deste valor a malha é sólida/redonda (bangle) e o
   * radial fica desligado; acima é corrente/chain e o radial ativa.
   * Valor 3.0: bangle típico tem elong ~1.0–1.8; corrente simples tem elong > 4.
   */
  const OMAFIT_BRACELET_RADIAL_AUTO_ELONG_THRESHOLD = 3.0;

  /**
   * Normaliza escala da cena da pulseira quando o bbox é desproporcional.
   * Não altera landmarks nem tracking — só `glbScene.scale`.
   */
  function omafitNormalizeBraceletTripoGlbScale(THREE, glbScene, glbRoot) {
    if (!glbScene || !THREE) return;
    /**
     * Sempre resetar a escala antes de medir — ignora escala baked no ficheiro
     * e escala residual de uma variante anterior. Depois normalizar SEMPRE para
     * OMAFIT_BRACELET_TRIPO_TARGET_DIAMETER_M (~65 mm), seja o GLB grande ou
     * pequeno. Garante que todas as variantes partem da mesma base de referência
     * antes do fitWristGlb, tornando o comportamento idêntico à primeira carga.
     */
    glbScene.scale.set(1, 1, 1);
    glbScene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(glbScene);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z, 1e-9);
    const estimatedRadius = maxDim * 0.5;
    const normalizationScale = THREE.MathUtils.clamp(
      OMAFIT_BRACELET_TRIPO_TARGET_DIAMETER_M / maxDim,
      0.01,
      10,
    );
    glbScene.scale.setScalar(normalizationScale);
    glbScene.updateMatrixWorld(true);
    try {
      const gr = glbRoot && glbRoot.scale ? glbRoot.scale.x : 1;
      console.log("[bracelet-normalization]", {
        maxDim,
        normalizationScale,
        finalScale: glbScene.scale.x,
        glbRootScale: gr,
        estimatedRadius,
      });
    } catch {
      /* ignore */
    }
  }

  /**
   * Pulseira tipo Tripo (malha alongada): substitui por `InstancedMesh` radial —
   * distribui N cópias do mesmo visual ao redor do eixo no plano do pulso.
   * O raio da curva é **sempre procedural** (landmarks), nunca derivado do GLB.
   */
  function omafitBraceletRadialShouldRebuild(THREE, glbScene, modeRaw) {
    const mode = String(modeRaw ?? "auto").trim().toLowerCase();
    if (/^(0|off|false|no)$/.test(mode)) return false;
    if (/^(1|on|true|yes)$/.test(mode)) return true;
    const solidCount = countHandArSolidMeshes(glbScene);
    if (solidCount < 1) return false;
    glbScene.updateMatrixWorld(true);
    const tb = new THREE.Box3().setFromObject(glbScene);
    const sz = new THREE.Vector3();
    tb.getSize(sz);
    const d = [sz.x, sz.y, sz.z].sort((a, b) => a - b);
    const elong = d[2] / Math.max(1e-6, d[1]);
    /**
     * Radial só para malhas alongadas (corrente/chain).
     * Bangles e pulseiras sólidas têm elong ~1–1.8 → should=false.
     */
    const should = solidCount >= 1 && elong > OMAFIT_BRACELET_RADIAL_AUTO_ELONG_THRESHOLD;
    console.log("[omafit-ar] bracelet radial gate(auto)", {
      mode,
      solidCount,
      size: { x: sz.x, y: sz.y, z: sz.z },
      elong,
      should,
    });
    return should;
  }

  function omafitDisposeMeshGeometriesOnly(obj) {
    obj.traverse((o) => {
      if (!o.geometry) return;
      try {
        o.geometry.dispose();
      } catch {
        /* ignore */
      }
    });
  }

  function omafitBraceletRadialDebugEnabled(cfgAttrFn) {
    try {
      if (
        /^(1|true|on|yes)$/i.test(
          String(cfgAttrFn("arBraceletRadialDebug", "0")).trim(),
        )
      ) {
        return true;
      }
      if (typeof window !== "undefined") {
        const q = new URLSearchParams(window.location?.search || "").get(
          "omafit_ar_bracelet_radial_debug",
        );
        if (q === "1") return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  }

  /**
   * Remove tudo em `rootScene` excepto o grupo radial — evita GLB plano original visível.
   */
  function omafitBraceletRadialStripNonRadialChildren(rootScene, radialGroup) {
    const ch = [...rootScene.children];
    for (let i = 0; i < ch.length; i++) {
      const c = ch[i];
      if (c === radialGroup) continue;
      rootScene.remove(c);
      omafitDisposeMeshGeometriesOnly(c);
    }
  }

  /**
   * Incorpora a escala mundial do `mesh` (incl. pais, ex. `glbScene.scale` pós-Tripo)
   * nos vértices da `geometry` em espaço local — `InstancedMesh` ignora escala do pai
   * nos buffers clonados; sem isto, beads ficam no tamanho bruto do GLB.
   */
  function omafitBakeMeshWorldScaleIntoGeometry(mesh, geometry) {
    if (!mesh || !geometry?.attributes?.position) return;
    mesh.updateMatrixWorld(true);
    const tmpP = new THREE.Vector3();
    const tmpQ = new THREE.Quaternion();
    const tmpS = new THREE.Vector3();
    mesh.matrixWorld.decompose(tmpP, tmpQ, tmpS);
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(
        i,
        pos.getX(i) * tmpS.x,
        pos.getY(i) * tmpS.y,
        pos.getZ(i) * tmpS.z,
      );
    }
    pos.needsUpdate = true;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }

  /**
   * @returns {boolean}
   */
  function omafitRebuildBraceletRadialInstanced(THREE, rootScene, segments) {
    braceletRadialInstMesh = null;
    braceletRadialSegCount = 0;
    let srcMesh = null;
    rootScene.updateMatrixWorld(true);
    rootScene.traverse((o) => {
      if (!srcMesh && o?.isMesh && o.geometry && !o.isSkinnedMesh) srcMesh = o;
    });
    if (!srcMesh) return false;

    const matSrc = srcMesh.material;
    const matPick =
      Array.isArray(matSrc) && matSrc.length ? matSrc[0] : matSrc;
    if (!matPick || typeof matPick.clone !== "function") return false;
    const mat = matPick.clone();

    const geoCentered = srcMesh.geometry.clone();
    geoCentered.computeBoundingBox();
    const ctr = new THREE.Vector3();
    geoCentered.boundingBox.getCenter(ctr);
    geoCentered.translate(-ctr.x, -ctr.y, -ctr.z);
    omafitBakeMeshWorldScaleIntoGeometry(srcMesh, geoCentered);
    /** Escalas já nos vértices da instância — evitar dupla aplicação no grafo. */
    rootScene.scale.set(1, 1, 1);
    rootScene.updateMatrixWorld(true);

    const trash = [];
    rootScene.traverse((o) => {
      if (
        o !== rootScene &&
        o?.geometry &&
        (o.isMesh || o.isSkinnedMesh)
      ) {
        trash.push(o);
      }
    });
    for (let ti = 0; ti < trash.length; ti++) {
      const m = trash[ti];
      if (m.parent) m.parent.remove(m);
      omafitDisposeMeshGeometriesOnly(m);
    }

    const group = new THREE.Group();
    group.name = "omafit-ar-bracelet-radial";

    const seg = THREE.MathUtils.clamp(Math.round(segments), 8, 64);
    const inst = new THREE.InstancedMesh(geoCentered, mat, seg);
    inst.name = "omafit-ar-bracelet-radial-inst";
    inst.frustumCulled = false;

    const id = new THREE.Object3D();
    id.position.set(0, 0, 0);
    id.quaternion.identity();
    id.scale.set(1, 1, 1);
    id.updateMatrix();
    for (let i = 0; i < seg; i++) {
      inst.setMatrixAt(i, id.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
    rootScene.add(group);
    omafitBraceletRadialStripNonRadialChildren(rootScene, group);
    rootScene.updateMatrixWorld(true);

    const radialDbg = omafitBraceletRadialDebugEnabled(cfgAttr);
    if (radialDbg && mat) {
      mat.wireframe = true;
    }

    console.log("[omafit-ar] bracelet radial children:", group.children.length, {
      segments: seg,
      wireframe: radialDbg,
    });

    braceletRadialInstMesh = inst;
    braceletRadialSegCount = seg;
    return true;
  }

  /**
   * Anel da pulseira procedural em **mundo**: base ortonormal a partir de
   * landmarks (wrist=w0, index=w5, pinky=w17), círculo no plano tangente,
   * orientação fixa via `makeBasis` + quaternion (sem `lookAt`).
   * Raio **só** a partir da largura do pulso (corda 5–17): `clamp(span*0.42, 26..34) mm`.
   * Matrizes em espaço do pai do `instMesh`.
   */
  function omafitUpdateBraceletRadialWristOriented(
    THREE,
    instMesh,
    segCount,
    wrist,
    indexLm,
    pinkyLm,
  ) {
    if (
      !instMesh?.isInstancedMesh ||
      !instMesh.instanceMatrix ||
      segCount < 2
    ) {
      return;
    }
    const parent = instMesh.parent;
    if (!parent) return;

    braceletRadVx.subVectors(indexLm, wrist);
    if (braceletRadVx.lengthSq() < 1e-12) return;
    braceletRadVx.normalize();

    braceletRadHandDir.subVectors(pinkyLm, wrist);
    if (braceletRadHandDir.lengthSq() < 1e-12) return;
    braceletRadHandDir.normalize();

    braceletRadNormal.crossVectors(braceletRadVx, braceletRadHandDir);
    if (braceletRadNormal.lengthSq() < 1e-12) return;
    braceletRadNormal.normalize();

    braceletRadTangent.crossVectors(braceletRadNormal, braceletRadVx);
    if (braceletRadTangent.lengthSq() < 1e-12) return;
    braceletRadTangent.normalize();

    const wristWidth = indexLm.distanceTo(pinkyLm);
    const wristRadius = wristWidth * 0.42;
    const safeRadius = THREE.MathUtils.clamp(wristRadius, 0.026, 0.034);
    try {
      console.log("[bracelet-procedural-radius]", {
        wristWidth,
        wristRadius,
        safeRadius,
      });
    } catch {
      /* ignore */
    }
    if (safeRadius < 1e-8) return;

    braceletRadRingCenter
      .copy(wrist)
      .addScaledVector(braceletRadNormal, -safeRadius * 0.25);

    braceletRadBasisMat.makeBasis(
      braceletRadVx,
      braceletRadTangent,
      braceletRadNormal,
    );
    braceletRadQuat.setFromRotationMatrix(braceletRadBasisMat);

    parent.updateMatrixWorld(true);
    braceletRadInvParent.copy(parent.matrixWorld).invert();

    for (let i = 0; i < segCount; i++) {
      const angle = (i / segCount) * Math.PI * 2;
      const rc = Math.cos(angle) * safeRadius;
      const rs = Math.sin(angle) * safeRadius;
      braceletRadPos
        .copy(braceletRadRingCenter)
        .addScaledVector(braceletRadVx, rc)
        .addScaledVector(braceletRadTangent, rs);

      braceletRadWorldMat.compose(
        braceletRadPos,
        braceletRadQuat,
        braceletRadScaleOne,
      );
      braceletRadTmpM.multiplyMatrices(
        braceletRadInvParent,
        braceletRadWorldMat,
      );
      instMesh.setMatrixAt(i, braceletRadTmpM);
    }
    instMesh.instanceMatrix.needsUpdate = true;
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
   * Largura “segura” punho: distância MCP5–MCP17 × padding antes do ratio
   * antropométrico (folga 25–30 % pedida por produto).
   */
  const OMAFIT_BRACELET_WRIST_WIDTH_PADDING = 1.08;
  /**
   * Ocupação vertical da mão em coord. normalizadas [0,1]: ≥ 0,4 → perto
   * (mais precisão); abaixo disso → suavização extra + possível aviso de proximidade.
   */
  const OMAFIT_HAND_SCREEN_CLOSE_FRAC = 0.4;
  /**
   * Expansão biométrica vs distância normalizada MCP5–MCP17.
   * Valores anteriores (1,25–1,45) inflavam também relógios; mantemos só uma
   * folga leve para não ultrapassar visualmente o pulso.
   */
  const OMAFIT_BRACELET_EXPAND_THIN = 1.02;
  const OMAFIT_BRACELET_EXPAND_WIDE = 1.16;
  const OMAFIT_BRACELET_SPAN_NORM_LO = 0.056;
  const OMAFIT_BRACELET_SPAN_NORM_HI = 0.108;
  /** Pulso “largo”: +10 % só no eixo X (largura) vs profundidade. */
  const OMAFIT_BRACELET_WIDE_SCREEN_N = 0.095;
  const OMAFIT_BRACELET_WIDE_M = 0.086;
  const OMAFIT_BRACELET_WIDE_LAT_BOOST = 1.04;
  /**
   * Elipse no plano do anel (XY local; eixo Z = braço após `fitWristGlb`):
   * X = largura ulnar–radial; Y = “profundidade” palmar–dorsal (pedido XZ no
   * texto do produto → aqui X e Y); Z = espessura ao longo do braço — só
   * `suBase` (sem W) para não deformar o perfil da peça no eixo do braço.
   */
  const OMAFIT_BRACELET_ELLIPSE_X = 1.02;
  /** Quase neutro: evita “apertar” a abertura no eixo palmar–dorsal. */
  const OMAFIT_BRACELET_ELLIPSE_DEPTH = 0.99;
  /** Slerp do alinhamento punho→MCP9 em espaço de `calibRot` (ms). */
  const OMAFIT_BRACELET_ALIGN_TAU_MS = 190;
  /** Lerp da posição de wear (offset âncora) para a pulseira (ms). */
  const OMAFIT_BRACELET_WEAR_LERP_MS = 240;
  /** Limite de correção angular extra (rad) — evita saltos quando MCP9 oscila. */
  const OMAFIT_BRACELET_ALIGN_MAX_RAD = 0.11;
  /**
   * Raio do cilindro oclusor (mundo) = factor × raio interno estimado da
   * pulseira em mundo — ligeiramente menor que a cavidade interna para o
   * depth cortar antes do inner mesh (menos Z-fighting / atravessar).
   */
  const OMAFIT_BRACELET_OCCLUDER_VS_INNER = 0.74;
  /**
   * Ratio knuckle-span → raio do pulso (landmarks 5–17). Pulseira usa valor
   * mais alto que relógio: feedback persistente de pulseira sub-dimensionada
   * mesmo com 0.34 único em v11.3.
   */
  /**
   * Raio estimado do punso a partir do segmento 5–17 (corda MCP): subir
   * alinha melhor as pontas do anel às extremidades laterais do punso.
   */
  const OMAFIT_BRACELET_KNUCKLE_TO_WRIST_R = 0.335;
  const OMAFIT_WATCH_KNUCKLE_TO_WRIST_R = 0.325;

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
      if (!braceletProceduralRadial) {
        /**
         * Rotação pelo menor eixo: alinha o anel ao braço (hole axis → Z).
         * Necessária para TODOS os modos — o wrap e outros offsets dependem
         * de Z = direção do braço. O rigid slot mantém esta etapa e apenas
         * pula o wrap cilíndrico destrutivo.
         */
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
        /**
         * Wrap cilíndrico: só para correntes/chains não-radial (modo legado).
         * Rigid slot: malha preservada como veio do ingest — sem deformação.
         */
        if (!braceletIsRigidSlot) {
          const braceletDims = [size.x, size.y, size.z].sort((a, b) => a - b);
          const braceletFlatRatio =
            braceletDims[2] / Math.max(1e-6, braceletDims[1]);
          if (braceletFlatRatio > 1.85) {
            const wrapRadius = Math.max(1e-6, size.x * 0.5 * 1.1);
            wrapBraceletCylinderNormalized(glbScene, wrapRadius);
            glbScene.updateMatrixWorld(true);
            bbox = new THREE.Box3().setFromObject(glbScene);
            bbox.getSize(size);
          }
        }
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
     *
     * Pulseira **procedural radial** (Tripo / malha alongada): NÃO usar
     * bbox nem `computeLocalInnerRadius` — GLB sem unidade física confiável.
     * `localInnerR` neutro = alvo anatómico default ⇒ `baseScale ≈ 1` (só mesh visual).
     */
    let medianDim;
    let maxDim;
    let localRingR;
    let localInnerR;
    if (accessoryType === "bracelet" && braceletProceduralRadial) {
      const gapNeutral = OMAFIT_BRACELET_WRIST_GAP_M;
      const tgtInnerNeutral = OMAFIT_DEFAULT_WRIST_R_M + gapNeutral;
      localInnerR = tgtInnerNeutral;
      localRingR = tgtInnerNeutral * 1.02;
      const sortedP = [size.x, size.y, size.z].sort((a, b) => a - b);
      medianDim = sortedP[1] || 1;
      maxDim = sortedP[2] || 1;
    } else {
      const sorted = [size.x, size.y, size.z].sort((a, b) => a - b);
      medianDim = sorted[1] || 1;
      maxDim = sorted[2] || 1;
      localRingR = didBend
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
      localInnerR =
        computedInner && computedInner > localRingR * 0.5 && computedInner < localRingR * 0.99
          ? computedInner
          : Math.max(localRingR * 0.9, 1e-6);
    }

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
    /**
     * Pulseira: segunda passagem `setFromObject` + recentrar — pivots GLB
     * assimétricos (fecho, charms) deixam o anel deslocado do centro do bbox
     * na primeira iteração; o landmark 0 da âncora deve coincidir com o eixo
     * médio do anel no plano XY (eixo Z = braço após `fit`).
     */
    if (accessoryType === "bracelet") {
      /**
       * Rigid slot: preservar a rotação aplicada pelo menor-eixo bbox
       * (alinha o furo ao Z do espaço local → `wristAlignStep` alinha Z ao braço).
       * Resetar quaternion aqui (comportamento legado) apagava esse alinhamento.
       *
       * Modo legado (chains sem rigid slot): mantém reset para compatibilidade.
       */
      if (!braceletIsRigidSlot) {
        glbScene.rotation.set(0, 0, 0);
        glbScene.quaternion.identity();
      }
      glbScene.updateMatrixWorld(true);
      bbox.setFromObject(glbScene);
      bbox.getCenter(center);
      if (center.lengthSq() > 1e-14) {
        glbScene.position.sub(center);
      }
      glbScene.updateMatrixWorld(true);
      bbox.setFromObject(glbScene);
      bbox.getSize(size);
    }
    /**
     * Ajuste fino de encaixe no espaço local do GLB:
     * - recentrado pelo interior já feito via `position.sub(center)`
     * - Y proporcional à altura (encaixe no punho) — apenas modo legado
     * - Z proporcional à profundidade — apenas modo legado
     *
     * Rigid slot: offsets Y/Z foram calibrados para o fluxo com
     * `quaternion.identity()` (eixos canónicos fixos). Com rotação preservada
     * (menor-eixo bbox), os mesmos offsets vão para uma direcção arbitrária
     * no plano do anel → um arco "sai" do pulso com diâmetro e orientação
     * correctos. Solução: usar só `position.sub(center)` (duplo recentro).
     */
    if (accessoryType === "bracelet") {
      if (!braceletIsRigidSlot) {
        glbScene.position.y -= size.y * OMAFIT_BRACELET_GLB_LOCAL_Y_SIZE_MUL;
        glbScene.position.z -= size.z * OMAFIT_BRACELET_GLB_LOCAL_Z_SIZE_MUL;
        glbScene.position.y += OMAFIT_BRACELET_GLB_MICRO_POS_Y_M;
        glbScene.position.z += OMAFIT_BRACELET_GLB_MICRO_POS_Z_M;
      }
    } else {
      glbScene.position.y += OMAFIT_HAND_GLB_LOCAL_Y_BIND_M;
    }
    glbScene.updateMatrixWorld(true);
    const sortedOut = [size.x, size.y, size.z].sort((a, b) => a - b);
    const medianDimOut = sortedOut[1] || medianDim;
    const maxDimOut = sortedOut[2] || maxDim;

    return {
      baseScale: calcBaseScale,
      size,
      bbox,
      maxDim: maxDimOut,
      medianDim: medianDimOut,
      localRingR,
      localInnerR,
      didBend,
    };
  }

  /** @typedef {{ xx: number, xy: number, xz: number, yy: number, yz: number, zz: number }} OmafitCov3 */

  function omafitMulCov3(C, v, out) {
    out.x = C.xx * v.x + C.xy * v.y + C.xz * v.z;
    out.y = C.xy * v.x + C.yy * v.y + C.yz * v.z;
    out.z = C.xz * v.x + C.yz * v.y + C.zz * v.z;
    return out;
  }

  /**
   * Determina se o GLB da pulseira deve usar o modo "rigid slot" (objeto rígido).
   * Calcula elong = maxDim / medianDim do bbox normalizado. Se ≤ threshold, é
   * bangle/sólido → rigid slot. Se > threshold, é corrente/chain (mas nesse
   * caso o radial procedural já estaria ativo, então esta função raramente
   * retorna false em prática).
   *
   * Precisa ser chamada APÓS omafitNormalizeBraceletTripoGlbScale (escala ~65mm).
   */
  function computeBraceletRigidSlotFromScene(scene) {
    if (braceletProceduralRadial) return false;
    scene.updateMatrixWorld(true);
    const _rsBox = new THREE.Box3().setFromObject(scene);
    const _rsSize = new THREE.Vector3();
    _rsBox.getSize(_rsSize);
    const _rsDims = [_rsSize.x, _rsSize.y, _rsSize.z].sort((a, b) => a - b);
    const _rsElong = _rsDims[2] / Math.max(1e-6, _rsDims[1]);
    const _rsResult = _rsElong <= OMAFIT_BRACELET_RADIAL_AUTO_ELONG_THRESHOLD;
    console.log("[omafit-ar] bracelet rigid-slot", { rigidSlot: _rsResult, elong: Number(_rsElong.toFixed(3)) });
    return _rsResult;
  }

  function omafitPowerMaxUnitEigen3(C, vOut, tmp) {
    vOut.set(1, 0.17, 0.03);
    vOut.normalize();
    for (let it = 0; it < 48; it++) {
      omafitMulCov3(C, vOut, tmp);
      const ls = tmp.lengthSq();
      if (ls < 1e-28) {
        vOut.set(1, 0, 0);
        return;
      }
      tmp.multiplyScalar(1 / Math.sqrt(ls));
      if (tmp.dot(vOut) < 0) tmp.negate();
      vOut.copy(tmp);
    }
  }

  function omafitPowerSecondUnitEigen3(C, e2, vOut, tmp) {
    vOut.set(0.31, 1, 0.27);
    vOut.addScaledVector(e2, -e2.dot(vOut)).normalize();
    for (let it = 0; it < 48; it++) {
      omafitMulCov3(C, vOut, tmp);
      tmp.addScaledVector(e2, -e2.dot(tmp));
      const ls = tmp.lengthSq();
      if (ls < 1e-28) break;
      tmp.multiplyScalar(1 / Math.sqrt(ls));
      if (tmp.dot(vOut) < 0) tmp.negate();
      vOut.copy(tmp);
    }
  }

  /**
   * Eixo do “furo” no espaço local do `glbScene`: PCA sobre vértices (amostrados),
   * espessura ≈ autovetor da menor variância; eixo do anel ⟂ espessura.
   */
  function omafitDetectBraceletRingHoleAxisUnitInGlb(THREE, glbScene) {
    glbScene.updateMatrixWorld(true);
    const tmp = new THREE.Vector3();
    const tmp2 = new THREE.Vector3();
    const tmp3 = new THREE.Vector3();
    const ringOut = new THREE.Vector3(0, 0, 1);

    let vertTotal = 0;
    glbScene.traverse((obj) => {
      if (!obj?.isMesh || !obj.geometry?.attributes?.position) return;
      vertTotal += obj.geometry.attributes.position.count;
    });
    if (vertTotal < 1) {
      const box = new THREE.Box3().setFromObject(glbScene);
      const sz = new THREE.Vector3();
      box.getSize(sz);
      const ax = sz.x;
      const ay = sz.y;
      const az = sz.z;
      if (!Number.isFinite(ax + ay + az) || (ax < 1e-10 && ay < 1e-10 && az < 1e-10)) {
        return ringOut.set(0, 0, 1);
      }
      const d = [ax, ay, az];
      let iMax = 0;
      for (let i = 1; i < 3; i++) if (d[i] > d[iMax]) iMax = i;
      return ringOut.set(iMax === 0 ? 1 : 0, iMax === 1 ? 1 : 0, iMax === 2 ? 1 : 0).normalize();
    }

    const MAX_SAMPLES = 10000;
    const stride = Math.max(1, Math.ceil(vertTotal / MAX_SAMPLES));
    const coords = [];
    let capDone = false;
    glbScene.traverse((obj) => {
      if (capDone) return;
      if (!obj?.isMesh || !obj.geometry?.attributes?.position) return;
      const pos = obj.geometry.attributes.position;
      obj.updateMatrixWorld(true);
      for (let i = 0; i < pos.count; i += stride) {
        if (coords.length >= MAX_SAMPLES * 3) {
          capDone = true;
          return;
        }
        tmp.set(pos.getX(i), pos.getY(i), pos.getZ(i));
        obj.localToWorld(tmp);
        glbScene.worldToLocal(tmp);
        coords.push(tmp.x, tmp.y, tmp.z);
      }
    });

    const n = (coords.length / 3) | 0;
    if (n < 4) {
      const box = new THREE.Box3().setFromObject(glbScene);
      const sz = new THREE.Vector3();
      box.getSize(sz);
      const ax = sz.x;
      const ay = sz.y;
      const az = sz.z;
      if (!Number.isFinite(ax + ay + az) || (ax < 1e-10 && ay < 1e-10 && az < 1e-10)) {
        return ringOut.set(0, 0, 1);
      }
      const d = [ax, ay, az];
      let iMax = 0;
      for (let i = 1; i < 3; i++) if (d[i] > d[iMax]) iMax = i;
      return ringOut.set(iMax === 0 ? 1 : 0, iMax === 1 ? 1 : 0, iMax === 2 ? 1 : 0).normalize();
    }

    let mx = 0;
    let my = 0;
    let mz = 0;
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      mx += coords[j];
      my += coords[j + 1];
      mz += coords[j + 2];
    }
    const invN = 1 / n;
    mx *= invN;
    my *= invN;
    mz *= invN;

    let xx = 0;
    let xy = 0;
    let xz = 0;
    let yy = 0;
    let yz = 0;
    let zz = 0;
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      const x = coords[j] - mx;
      const y = coords[j + 1] - my;
      const z = coords[j + 2] - mz;
      xx += x * x;
      xy += x * y;
      xz += x * z;
      yy += y * y;
      yz += y * z;
      zz += z * z;
    }
    const invNm1 = n > 1 ? 1 / (n - 1) : 1;
    xx *= invNm1;
    xy *= invNm1;
    xz *= invNm1;
    yy *= invNm1;
    yz *= invNm1;
    zz *= invNm1;

    /** @type {OmafitCov3} */
    const C = { xx, xy, xz, yy, yz, zz };
    const e2 = tmp;
    const e1 = tmp2;
    const thick = tmp3;
    omafitPowerMaxUnitEigen3(C, e2, ringOut);
    omafitPowerSecondUnitEigen3(C, e2, e1, ringOut);
    /**
     * `thick` = autovetor de MENOR variância = direção de menor extensão
     * geométrica = eixo **normal ao plano do anel** = eixo do FURO.
     *
     * Anteriormente calculávamos `ringOut = cross(thick, X/Y)`, que devolvia
     * um vetor tangente ao plano — ao tentar alinhar essa tangente com a
     * direção do braço, o plano do anel ficava perpendicular ao pulso.
     *
     * Correção: retornar `thick` diretamente como eixo do furo.
     * `wristAlignStep` vai alinhar thick com wristDir → anel envolve o pulso.
     */
    thick.crossVectors(e2, e1);
    if (thick.lengthSq() < 1e-16) thick.set(0, 0, 1);
    else thick.normalize();

    ringOut.copy(thick);

    return ringOut;
  }

  /** Eixo do “furo” em espaço local de `calibRot` (pai de `braceletWristAlignGroup`). */
  function omafitRefreshBraceletRingHoleAxisInCalibLocal(
    THREE,
    glbScene,
    calibRot,
    outAxisUnit,
    tmpMat,
    forceHoleAxisSceneUnit,
  ) {
    glbScene.matrixAutoUpdate = true;
    /**
     * NÃO resetar glbScene.scale — a escala de normalização (~0.065) deve ser
     * mantida. `transformDirection` ignora a escala da matriz (apenas aplica
     * rotação), portanto o resultado da detecção do eixo é idêntico com ou
     * sem escala. Resetar para (1,1,1) e não restaurar destruía a normalização
     * no modo rigid-slot (o GLB aparecia à escala nativa ~1 m).
     */
    glbScene.updateMatrixWorld(true);
    calibRot.updateMatrixWorld(true);
    if (
      forceHoleAxisSceneUnit &&
      forceHoleAxisSceneUnit.lengthSq() > 1e-12
    ) {
      outAxisUnit.copy(forceHoleAxisSceneUnit).normalize();
    } else {
      const h = omafitDetectBraceletRingHoleAxisUnitInGlb(THREE, glbScene);
      outAxisUnit.copy(h);
    }
    outAxisUnit.transformDirection(glbScene.matrixWorld);
    tmpMat.copy(calibRot.matrixWorld).invert();
    outAxisUnit.transformDirection(tmpMat);
    if (outAxisUnit.lengthSq() < 1e-12) outAxisUnit.set(0, 0, 1);
    else outAxisUnit.normalize();
  }

  // Load the GLB (Draco lazy: partilha WASM com o caminho face).
  const arGlbDracoHand = !/^(0|false|off|no)$/i.test(String(cfgAttr("arGlbDraco", "1")).trim());
  let dracoLoaderHand = null;
  if (arGlbDracoHand) {
    try {
      dracoLoaderHand = await omafitGetSharedDracoLoader();
    } catch (e) {
      console.warn("[omafit-ar] hand GLB Draco:", e?.message || e);
    }
  }
  const glbLoader = new GLTFLoader();
  glbLoader.setCrossOrigin("anonymous");
  if (dracoLoaderHand) glbLoader.setDRACOLoader(dracoLoaderHand);
  const versionHint =
    arCfg?.dataset?.arGlbVersion || arCfg?.getAttribute?.("data-ar-glb-version") || "";
  const finalGlbUrl = buildGlbLoaderUrl(omafitAbsolutizeGlbUrlMaybe(glbUrl), versionHint);
  braceletHandLog("glb:load_start", {
    finalGlbUrl: String(finalGlbUrl || "").slice(0, 260),
    glbVersionHint: String(versionHint || "").slice(0, 32),
    dracoLoader: Boolean(dracoLoaderHand),
  });
  let baseScale = 0.1;
  /** Raio local do anel/cilindro wrap (EIXO), em unidades GLB (pré-scale). */
  let localRingR = 0.025;
  /** Raio local INTERNO real (superfície que toca a pele), unidades GLB.
   *  Usado no ajuste adaptativo por frame: targetInnerR_mundo / localInnerR
   *  dá o scale exacto para a face interna encostar à pele. */
  let localInnerR = 0.022;
  /**
   * Referência do localInnerR da PRIMEIRA variante carregada (pulseira).
   * Usada nas trocas: se o GLB seguinte tiver localInnerR muito diferente
   * (export com unidades distintas ou geometria de anel com outra espessura
   * medida pelo computeLocalInnerRadius), normalizar para este valor de âncora
   * garante que o baseScale — e portanto a escala final no pulso — fique igual.
   * Null = ainda não inicializado (primeira carga vai setar).
   */
  let anchorLocalInnerR = null;
  /**
   * Snapshot da 1ª variante em modo rigid-slot: posição, rotação, escala local
   * do `glbScene` + escala do `glbRoot` + baseScale/localInnerR/localRingR.
   * Nas trocas de variante com GLB também rigid-slot, reaplica-se este pacote
   * em vez de `fitWristGlb` — todas as variantes ficam iguais à primeira no
   * slot (velocidade + consistência). Null se 1ª carga não for rigid ou for radial.
   */
  let braceletRigidTemplate = null;
  /** Sinaliza se o relógio foi geometricamente dobrado à volta dum cilindro
   *  (GLB plano detectado). Usado só para logging. */
  let didBendWatch = false;
  /**
   * Grupos biométricos do relógio (v11.7):
   *   `.strap`    — correia/lugs/buckle: escala (k, 1, k) que contrai XZ.
   *   `.caseDial` — mostrador/case/crystal: escala (1/adaptMul)³ que cancela
   *                 o encolhimento global do `adaptMul` → mostrador fica
   *                 RÍGIDO em metros-mundo (tamanho E posição do design).
   * `null` se `setupWatchStrapBiometricGroup` não conseguir isolar nenhuma
   * mesh por nomes/heurística (fallback: comportamento antigo via vertex deform).
   */
  let watchStrapRadial = null;
  /** Malha única: deformação por vértice (alternativa ao grupo correia). */
  let watchVertexDeform = null;
  /** Pulseira rígida (bangle): só escala global; elos: grupo ou vértices. */
  let braceletProceduralRadial = false;
  /** `InstancedMesh` da pulseira radial (actualização por frame com base no pulso). */
  let braceletRadialInstMesh = null;
  let braceletRadialSegCount = 0;
  const braceletRadTmpM = new THREE.Matrix4();
  const braceletRadInvParent = new THREE.Matrix4();
  const braceletRadWorldMat = new THREE.Matrix4();
  const braceletRadBasisMat = new THREE.Matrix4();
  const braceletRadPos = new THREE.Vector3();
  const braceletRadRingCenter = new THREE.Vector3();
  const braceletRadVx = new THREE.Vector3();
  const braceletRadHandDir = new THREE.Vector3();
  const braceletRadNormal = new THREE.Vector3();
  const braceletRadTangent = new THREE.Vector3();
  const braceletRadQuat = new THREE.Quaternion();
  const braceletRadScaleOne = new THREE.Vector3(1, 1, 1);
  let braceletIsBangle = false;
  /**
   * Modo "rigid slot": quando verdadeiro, o GLB é tratado como objeto rígido
   * num slot fixo no pulso — sem rotação pelo menor eixo bbox, sem wrap
   * cilíndrico, sem escala elíptica por frame. Ativo para bangles e pulseiras
   * sólidas (elong ≤ OMAFIT_BRACELET_RADIAL_AUTO_ELONG_THRESHOLD).
   */
  let braceletIsRigidSlot = false;
  let braceletLinkRadial = null;
  let braceletVertexDeform = null;
  let braceletOcclusionMaterials = [];
  let braceletOcclusionSmooth = 0;
  const braceletCameraDir = new THREE.Vector3();
  const braceletOccWidth = new THREE.Vector3();
  const braceletOccForward = new THREE.Vector3();
  const braceletOccNormal = new THREE.Vector3();
  /** Deslize ao longo do antebraço (inércia dupla). */
  let braceletWristPrev = null;
  let braceletSlideFast = 0;
  let braceletSlideLag = 0;
  const braceletDv = new THREE.Vector3();
  const braceletPlaceState =
    accessoryType === "bracelet"
      ? createOmafitBraceletWristPlacementState(THREE)
      : null;
  const braceletRingHoleAxisAlignLocal = new THREE.Vector3(0, 0, 1);
  const braceletRingHoleTmpMat = new THREE.Matrix4();
  /** Eixo do “furo” em espaço do GLB para pulseira procedural (anel em XZ). */
  const braceletRadialHoleAxisScene = new THREE.Vector3(0, 1, 0);
  /** Escala radial suavizada [kFloor, 1] — mostrador permanece fora deste grupo. */
  let smoothedStrapK = 1;
  dbgBraceletAr("H1", "glb:before_await_load", "await_glb_promise", {
    url: String(finalGlbUrl || "").slice(0, 200),
    draco: Boolean(dracoLoaderHand),
  });
  await new Promise((resolve, reject) => {
    glbLoader.load(
      finalGlbUrl,
      (gltf) => {
        const glbScene = gltf.scene || gltf.scenes?.[0];
        if (!glbScene) {
          dbgBraceletAr("H1", "glb:onLoad", "gltf_no_scene", {});
          reject(new Error("GLB sem cena"));
          return;
        }
        dbgBraceletAr("H1", "glb:onLoad", "gltf_scene_ok", {
          childCount: glbScene.children?.length ?? -1,
        });
        bakeGLBTransforms(THREE, glbScene, ({ baked, skipped }) => {
          console.log(
            `[omafit-ar] hand GLB baked meshes=${baked} skipped=${skipped}`,
          );
        });
        braceletProceduralRadial = false;
        braceletRadialInstMesh = null;
        braceletRadialSegCount = 0;
        if (accessoryType === "bracelet") {
          omafitNormalizeBraceletTripoGlbScale(THREE, glbScene, glbRoot);
          const radialMode = cfgAttr("arBraceletRadial", "auto");
          const radialShould = omafitBraceletRadialShouldRebuild(
            THREE,
            glbScene,
            radialMode,
          );
          if (radialShould) {
            const segRaw = Number(
              String(cfgAttr("arBraceletRadialSegments", "24")).trim(),
            );
            const seg = Number.isFinite(segRaw) ? segRaw : 24;
            braceletProceduralRadial = omafitRebuildBraceletRadialInstanced(
              THREE,
              glbScene,
              seg,
            );
          }
          console.log("[omafit-ar] bracelet radial init", {
            radialMode,
            radialShould,
            activated: braceletProceduralRadial,
            segments: braceletRadialSegCount,
            sizing: braceletProceduralRadial ? "procedural-wrist-only" : "glb-derived",
          });
          braceletIsRigidSlot = computeBraceletRigidSlotFromScene(glbScene);
        }
        try {
          const triH = omafitCountGltfTriangles(glbScene);
          omafitMaybeWarnGltfTriangleBudget(finalGlbUrl, triH);
          const texAnisoH = omafitEffectiveArTextureMaxAnisotropy(
            cfgAttr("arTextureMaxAnisotropy", "4"),
            handArProfile,
            16,
          );
          omafitApplyGltfTextureAnisotropy(THREE, glbScene, renderer, texAnisoH);
        } catch {
          /* ignore */
        }
        glbRoot.add(glbScene);
        upgradeHandArGlassMaterials(THREE, glbScene);

        const fitRes = fitWristGlb(glbScene, glbRoot, accessoryType, userScale);
        baseScale = fitRes.baseScale;
        localRingR = fitRes.localRingR;
        localInnerR = fitRes.localInnerR || fitRes.localRingR * 0.9;
        didBendWatch = Boolean(fitRes.didBend);
        /**
         * Guardar raio interno da PRIMEIRA carga como âncora para trocas futuras.
         * Só para pulseira: relógio/óculos não têm o problema de divergência
         * de localInnerR entre variantes (geometrias mais padronizadas).
         */
        if (accessoryType === "bracelet" && anchorLocalInnerR === null && localInnerR > 1e-6) {
          anchorLocalInnerR = localInnerR;
        }

        watchVertexDeform = null;
        watchStrapRadial = null;
        braceletIsBangle = false;
        braceletLinkRadial = null;
        braceletVertexDeform = null;
        if (accessoryType === "bracelet") {
          upgradeHandArLuxuryJewelryMaterials(THREE, glbScene);
          braceletIsBangle = detectBraceletBangle(THREE, glbScene);
          /**
           * Rigid slot: sem deformações de elo — a malha é usada como objeto
           * rígido, sem reparent de meshes nem vertex deform que alteram a
           * geometria e quebram a orientação no slot do pulso.
           */
          if (!braceletIsRigidSlot && !braceletIsBangle && !braceletProceduralRadial) {
            if (countHandArSolidMeshes(glbScene) === 1) {
              braceletVertexDeform = initBraceletLinkVertexDeformation(
                THREE,
                glbScene,
                fitRes.size,
              );
            }
            if (!braceletVertexDeform) {
              braceletLinkRadial = setupBraceletLinkRadialGroup(
                THREE,
                glbScene,
                fitRes.localRingR,
                debug,
              );
            }
          }
          if (debug) {
            console.log("[omafit-ar] bracelet", {
              bangle: braceletIsBangle,
              rigidSlot: braceletIsRigidSlot,
              linkVertex: Boolean(braceletVertexDeform),
              linkGroup: Boolean(braceletLinkRadial),
            });
          }
          braceletOcclusionMaterials = omafitCollectUniqueMaterials(glbScene);
          for (let mi = 0; mi < braceletOcclusionMaterials.length; mi++) {
            const bm = braceletOcclusionMaterials[mi];
            if (!bm || typeof bm !== "object") continue;
            bm.depthWrite = true;
            bm.depthTest = true;
            bm.side = THREE.DoubleSide;
          }
          glbScene.traverse((obj) => {
            if (!obj?.isMesh) return;
            if (obj.renderOrder < 2) obj.renderOrder = 2;
          });
          scene.traverse((obj) => {
            if (!obj?.isMesh) return;
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            let writesDepth = false;
            for (let i = 0; i < mats.length; i++) {
              const mat = mats[i];
              if (!mat) continue;
              if (mat.depthWrite) {
                writesDepth = true;
                if (obj !== occPlane) mat.depthWrite = false;
              }
            }
            if (writesDepth && debug) {
              console.log(
                obj === occPlane ? "DEPTH WRITER: occPlane" : "DEPTH WRITER: disabled",
                obj.name || obj.type || "mesh",
              );
            }
          });
          braceletOcclusionSmooth = 0;
          omafitRefreshBraceletRingHoleAxisInCalibLocal(
            THREE,
            glbScene,
            calibRot,
            braceletRingHoleAxisAlignLocal,
            braceletRingHoleTmpMat,
            braceletProceduralRadial ? braceletRadialHoleAxisScene : null,
          );
          if (!braceletProceduralRadial && braceletIsRigidSlot) {
            braceletRigidTemplate = {
              quat: glbScene.quaternion.clone(),
              pos: glbScene.position.clone(),
              scl: glbScene.scale.clone(),
              glbRootScale: glbRoot.scale.clone(),
              baseScale,
              localInnerR,
              localRingR,
            };
            try {
              console.log("[omafit-ar] bracelet rigid template captured (1st variant)", {
                baseScale,
                localInnerR_mm: (localInnerR * 1000).toFixed(1),
                localRingR_mm: (localRingR * 1000).toFixed(1),
              });
            } catch {
              /* ignore */
            }
          }
        } else if (accessoryType === "watch") {
          if (countHandArSolidMeshes(glbScene) === 1) {
            watchVertexDeform = initWatchSingleMeshStrapVertexDeformation(
              THREE,
              glbScene,
              fitRes.size,
            );
          }
          if (watchVertexDeform) {
            if (debug) {
              console.log("[omafit-ar] single-mesh strap vertex radial deformation");
            }
          } else {
            watchStrapRadial = setupWatchStrapBiometricGroup(
              THREE,
              glbScene,
              fitRes.size,
              fitRes.localRingR,
              debug,
            );
          }
        }
        smoothedStrapK = 1;
        upgradeHandArMetalMaterials(THREE, glbScene);
        omafitEnsureGlassesMeshesRenderable(THREE, glbScene);
        setHandArMeshRenderOrder(glbRoot, 1);
        handMicroOpacityRoot = glbScene;
        if (!handMicroUxDisabled) {
          try {
            omafitStoreMaterialOpacityBaseline(glbScene);
            omafitApplyModelOpacityFactor(glbScene, 0);
            handMicroUx.introStartMs = performance.now();
            handMicroUx.introComplete = false;
            handMicroUx.preparedOpacity = true;
            handMicroUxWrap.scale.setScalar(0.9);
          } catch {
            /* ignore */
          }
        }

        console.log(
          "[omafit-ar] hand GLB fit",
          braceletProceduralRadial && accessoryType === "bracelet"
            ? {
                accessoryType,
                strategy: "bracelet procedural radial → GLB scale neutral (wrist-only ring)",
                baseScale: fitRes.baseScale,
                didBend: fitRes.didBend,
                bbox: { x: fitRes.size.x, y: fitRes.size.y, z: fitRes.size.z },
              }
            : {
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
              },
        );
        braceletHandLog("glb:load_ok", {
          baseScale: fitRes.baseScale,
          bangle: accessoryType === "bracelet" ? braceletIsBangle : null,
          braceletLinkVertex: accessoryType === "bracelet" ? Boolean(braceletVertexDeform) : null,
          braceletLinkRadial: accessoryType === "bracelet" ? Boolean(braceletLinkRadial) : null,
        });

        glbRoot.visible = true;
        /**
         * Pré-carga em background dos GLBs das outras variantes.
         * Dispara `fetch()` com `cache: "force-cache"` imediatamente após o
         * primeiro GLB estar pronto — quando o utilizador clicar na miniatura,
         * o browser já terá o ficheiro em disco/memória (sem bloquear o render).
         * Apenas GLBs com URL diferente do actual são pré-carregados.
         * Erros de rede são silenciosos (non-blocking).
         */
        try {
          const rootArEl = typeof document !== "undefined" ? document.getElementById("omafit-ar-root") : null;
          const rawVarsPreload = rootArEl ? (rootArEl.getAttribute("data-ar-variants-glb") || "").trim() : "";
          if (rawVarsPreload) {
            const parsedPreload = JSON.parse(rawVarsPreload);
            if (Array.isArray(parsedPreload)) {
              const currentUrl = String(finalGlbUrl || "");
              parsedPreload.forEach((vp) => {
                const vpUrl = buildGlbLoaderUrl(String(vp?.g || "").trim(), versionHint);
                if (!vpUrl || vpUrl === currentUrl) return;
                fetch(vpUrl, { cache: "force-cache", mode: "cors" }).catch(() => {});
              });
            }
          }
        } catch {
          /* pré-carga não-bloqueante: ignora qualquer erro */
        }
        dbgBraceletAr("H3", "glb:before_resolve", "fit_complete", {
          baseScale: fitRes.baseScale,
          glbRootVisible: glbRoot.visible,
          braceletIsBangle,
          microUxPrepared: Boolean(handMicroUx?.preparedOpacity),
          glbWorldScale: glbRoot.scale
            ? { x: glbRoot.scale.x, y: glbRoot.scale.y, z: glbRoot.scale.z }
            : null,
        });
        resolve();
      },
      undefined,
      (err) => {
        dbgBraceletAr("H1", "glb:onError", "load_failed", {
          message: String(err?.message || err).slice(0, 200),
        });
        braceletHandLog("glb:load_error", {
          message: err?.message || String(err),
          url: String(finalGlbUrl || "").slice(0, 260),
        });
        reject(err);
      },
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
  const tmpCamToWrist = new THREE.Vector3();
  /** Triângulo punho→MCP índice / mindinho: normal ≈ palma vs dorso (só relógio). */
  const wristTriA = new THREE.Vector3();
  const wristTriB = new THREE.Vector3();
  const palmTriN = new THREE.Vector3();
  /** Eixo punho → média(1,17) e scratch para evitar `new Vector3` no hot path. */
  const handMidThumbPinky = new THREE.Vector3();
  const handZForearm = new THREE.Vector3();
  const handToMcpScratch = new THREE.Vector3();
  const handToMcpRawScratch = new THREE.Vector3();
  const handW0to1Scratch = new THREE.Vector3();
  const handNAltScratch = new THREE.Vector3();
  const handRollQuat = new THREE.Quaternion();

  /** Estado suavizado (EMA) dos eixos/posição — aproxima o filtro OneEuro do MindAR. */
  const smX = new THREE.Vector3();
  const smY = new THREE.Vector3();
  const smZ = new THREE.Vector3();
  const smPos = new THREE.Vector3();
  /** Pré-EMA rápida da posição (landmarks) antes do tau principal. */
  const prePos = new THREE.Vector3();
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
  /**
   * Referência lenta do span 5–17 (m): sobe rápido quando a mão aproxima,
   * desce devagar quando afasta — `handKnuckleSpan / ref` encolhe o GLB em
   * perspectiva sem “pulsar” frame a frame.
   */
  let handKnuckleSpanRef = 0;
  let smoothKnuckleSpan = OMAFIT_BASE_KNUCKLE_SPAN_M;
  let smoothKnuckleSpanInit = false;
  /** Jitter span 5–17 (m) + histerese para aviso “aproxime o pulso”. */
  let prevKnuckleSpan3d = 0;
  let knuckleJitterEma = 0;
  let proximityHintStable = 0;

  let running = true;
  let lastVideoFrameTime = -1;
  let rafId = 0;
  let missedFrames = 0;
  const MISSED_HIDE_THRESHOLD = 6;
  let braceletFirstLandmarkLogged = false;
  /** Log debug H2 (sessão agent) uma vez quando há landmarks. */
  let braceletH2DebugLogged = false;

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
    const lm5n = lms[5];
    const lm17n = lms[17];
    const dBaseNx = (lm17n.x - lm5n.x) * videoAspect();
    const dBaseNy = lm17n.y - lm5n.y;
    const distanciaBaseNorm = Math.hypot(dBaseNx, dBaseNy);
    let mnHy = 1;
    let mxHy = 0;
    for (let hi = 0; hi < lms.length; hi++) {
      const yy = lms[hi].y;
      if (yy < mnHy) mnHy = yy;
      if (yy > mxHy) mxHy = yy;
    }
    const proporcaTela = Math.max(0, mxHy - mnHy);
    const closeEnoughHand = proporcaTela >= OMAFIT_HAND_SCREEN_CLOSE_FRAC;
    const tWristExpand = THREE.MathUtils.clamp(
      (distanciaBaseNorm - OMAFIT_BRACELET_SPAN_NORM_LO) /
        Math.max(1e-5, OMAFIT_BRACELET_SPAN_NORM_HI - OMAFIT_BRACELET_SPAN_NORM_LO),
      0,
      1,
    );
    const wristExpandMul = THREE.MathUtils.lerp(
      OMAFIT_BRACELET_EXPAND_THIN,
      OMAFIT_BRACELET_EXPAND_WIDE,
      tWristExpand,
    );
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
    const w1 = unprojectLandmark(lms[1] || wristN, zDist);
    const w5 = unprojectLandmark(lms[5], zDist);
    const w9 = unprojectLandmark(lms[9], zDist);
    const w17 = unprojectLandmark(lms[17], zDist);
    const clampDt = Math.max(8, Math.min(80, Number.isFinite(dtMs) ? dtMs : 16));

    if (accessoryType === "bracelet" && braceletPlaceState) {
      omafitBraceletWristMetricsStep(THREE, braceletPlaceState, {
        w0,
        w5,
        w9,
        w17,
        clampDt,
        closeEnoughHand,
        metricsTauMs: OMAFIT_BRACELET_METRICS_EMA_MS,
        sinkTauMs: OMAFIT_BRACELET_SINK_EMA_MS,
        sinkTargetM: OMAFIT_BRACELET_SKIN_SINK_TARGET_M,
        refThick09M: OMAFIT_BRACELET_REF_FOREARM_REACH_M,
        widthClamp: [0.042, 0.118],
        thickClamp: [0.055, 0.142],
      });
    }

    /**
     * === BASE ORTONORMAL — eixo "antebraço" + plano de largura (índice–mínimo) ===
     *
     * Padrão sugerido (Y World ~ antebraço, roll com vector indicador–mínimo):
     *   `forearmDir = normalize(elbow - wrist)`,
     *   `quat0 = setFromUnitVectors((0,1,0), forearmDir)`,
     *   `rollQuat = setFromUnitVectors((1,0,0), normalize(indexMCP - pinkyMCP))`, …
     * O *Hand Landmarker* não tem cotovelo: `landmarks[1]` é a base do polegar, não
     * o cotovelo. Proxy anatomicamente alinhado com "do pulso em direcção ao
     * antebraço": `wrist - middleMcp` = (0) − (9) em mundo após unproject
     * (o segmento 9→0 acompanha a linha mão/punho, invertido fica fora da mão).
     *
     * Aqui a convenção do GLB mantém a coluna **Z** = eixo longitudinal do braço
     * (não Y), e **X** = projectação de 5→17 (MCP índice → MCP mínimo) no plano
     * ⟂ Z — equivalente ao teu *handDir* com um grau de liberdade removido (twist).
     * Em seguida `makeBasis` + *wrist roll* (palma) em torno de Z, como antes.
     */
    handZForearm.subVectors(w0, w9);
    if (handZForearm.lengthSq() < 1e-8) {
      handMidThumbPinky.addVectors(w1, w17).multiplyScalar(0.5);
      handZForearm.subVectors(handMidThumbPinky, w0);
    }
    if (handZForearm.lengthSq() < 1e-10) {
      handToMcpScratch.subVectors(w9, w0);
      handW0to1Scratch.subVectors(w1, w0);
      handZForearm.copy(handToMcpScratch).lerp(handW0to1Scratch, 0.2);
    }
    if (handZForearm.lengthSq() < 1e-10) {
      handZForearm.set(0, 0.71, -0.71);
    } else {
      handZForearm.normalize();
    }

    wristTriA.subVectors(w5, w0);
    wristTriB.subVectors(w17, w0);
    palmTriN.copy(wristTriA).cross(wristTriB);
    const triLenPalm = palmTriN.length();
    if (triLenPalm > 1e-7) {
      palmTriN.multiplyScalar(1 / triLenPalm);
    } else {
      palmTriN.set(0, 1, 0);
    }

    tmpX.subVectors(w5, w17);
    tmpX.addScaledVector(handZForearm, -tmpX.dot(handZForearm));
    if (tmpX.lengthSq() < 1e-10) {
      tmpX.crossVectors(wristTriA, handZForearm);
    }
    if (tmpX.lengthSq() < 1e-10) {
      tmpX.set(1, 0, 0);
    }
    tmpX.normalize();
    if (handLabel === "Left" && (accessoryType !== "watch" || OMAFIT_WATCH_USE_HANDEDNESS_LABEL)) {
      tmpX.negate();
    }
    tmpY.crossVectors(handZForearm, tmpX).normalize();

    if (accessoryType === "watch" && triLenPalm > 1e-7) {
      handNAltScratch.subVectors(w1, w0).cross(wristTriA);
      if (handNAltScratch.lengthSq() > 1e-12) {
        handNAltScratch.normalize();
        if (handNAltScratch.dot(palmTriN) < 0) handNAltScratch.negate();
        palmTriN.lerp(handNAltScratch, 0.22).normalize();
      }
      if (palmTriN.dot(tmpY) < 0) palmTriN.negate();
      tmpY.lerp(palmTriN, 0.52).normalize();
      tmpY.addScaledVector(handZForearm, -tmpY.dot(handZForearm));
      const yLenBlend = tmpY.length();
      if (yLenBlend > 1e-7) tmpY.multiplyScalar(1 / yLenBlend);
    }

    tmpZ.copy(handZForearm);
    tmpX.crossVectors(tmpY, tmpZ).normalize();
    tmpY.crossVectors(tmpZ, tmpX).normalize();
    if (accessoryType === "bracelet") {
      handMidThumbPinky.addVectors(w5, w17).multiplyScalar(0.5);
      handToMcpScratch.subVectors(handMidThumbPinky, w0);
      if (handToMcpScratch.lengthSq() < 1e-12) {
        handToMcpScratch.subVectors(w9, w0);
      }
      if (handToMcpScratch.lengthSq() < 1e-12) {
        handToMcpScratch.copy(tmpY);
      } else {
        handToMcpScratch.normalize();
      }
      tmpX.subVectors(w5, w17);
      if (tmpX.lengthSq() < 1e-12) tmpX.set(1, 0, 0);
      else tmpX.normalize();
      tmpY.copy(handToMcpScratch);
      tmpZ.crossVectors(tmpX, tmpY);
      if (tmpZ.lengthSq() < 1e-12) {
        tmpZ.copy(palmTriN);
      } else {
        tmpZ.normalize();
      }
      handNAltScratch.set(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
      if (tmpZ.dot(handNAltScratch) < 0) tmpZ.negate();
      tmpX.crossVectors(tmpY, tmpZ).normalize();
      tmpY.crossVectors(tmpZ, tmpX).normalize();
    }

    const w0to1 = handW0to1Scratch.subVectors(w1, w0);

    /**
     * Posição: directamente no landmark do pulso (w0). Antes usava-se 30 %
     * do vector punho→MCP, mas isso colocava o relógio na base dos nós dos
     * dedos (na mão, não no pulso). MediaPipe `landmark[0]` está na prega
     * do pulso, onde anatomicamente se usa o relógio. Elevar ~6 mm na
     * normal dorsal para o mostrador assentar POR CIMA da pele, não dentro.
     * Calibrações `wearZ` do lojista continuam a permitir ajuste fino.
     *
     * Pulseira: deslocamento ao longo de punho→MCP ligeiramente *negativo* para
     * não puxar a anel em direcção aos nós (ficava "alta" na mão); ajuste fino
     * em tmpY (normal) para aproximar o antebraço.
     */
    tmpPos.copy(w0);
    if (accessoryType === "watch") {
      tmpPos.addScaledVector(tmpY, 0.0025);
    } else {
      /**
       * Pulseira: inset pela normal do pulso (análogo a
       * `model.position.addScaledVector(wristNormal, -0.015)`).
       */
      tmpPos.addScaledVector(
        tmpY,
        accessoryType === "bracelet"
          ? -OMAFIT_BRACELET_WRIST_NORMAL_INSET_M
          : 0.0025,
      );
    }
    if (accessoryType === "bracelet") {
      /**
       * Mantém o centro no punho e aplica apenas um inset pequeno/estável na
       * normal local já calibrada (tmpY). O bloco anterior recalculava uma
       * normal alternativa (palmNormal) por frame e sobrescrevia `tmpPos`,
       * causando desencaixe lateral no pulso.
       */
      const wristWidth = w5.distanceTo(w17);
      const dynamicInset = THREE.MathUtils.clamp(wristWidth * 0.065, 0.003, 0.007);
      const forearmRetreat = THREE.MathUtils.clamp(
        OMAFIT_BRACELET_WRIST_OFFSET_BASE_M + wristWidth * OMAFIT_BRACELET_WRIST_OFFSET_WIDTH_MUL,
        OMAFIT_BRACELET_WRIST_OFFSET_MIN_M,
        OMAFIT_BRACELET_WRIST_OFFSET_MAX_M,
      );
      tmpPos
        .copy(w0)
        .addScaledVector(tmpY, -dynamicInset)
        // Empurra levemente para o antebraço para evitar ficar "alto" na mão.
        .addScaledVector(handToMcpScratch, -forearmRetreat);
    }

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
     * Posição: EMA fixa α=0.15 (v12.0). Rotação: SLERP t=0.10.
     */
    basisMat.makeBasis(tmpX, tmpY, tmpZ);
    tmpQuat.setFromRotationMatrix(basisMat);
    const palmNx = palmTriN.dot(tmpX);
    const palmNy = palmTriN.dot(tmpY);
    const wristRoll = Math.atan2(palmNx, palmNy);
    handRollQuat.setFromAxisAngle(
      handZForearm,
      wristRoll * OMAFIT_HAND_WRIST_ROLL_GAIN,
    );
    if (accessoryType !== "bracelet") {
      tmpQuat.premultiply(handRollQuat);
    }
    if (!smoothInitialized) {
      smoothedQuat.copy(tmpQuat);
      prePos.copy(tmpPos);
      smPos.copy(tmpPos);
      smoothInitialized = true;
    } else {
      const dtSec = Math.max(1e-3, clampDt / 1000);
      const posSpeed = tmpPos.distanceTo(smPos) / dtSec;
      let posAlpha = OMAFIT_HAND_POS_ALPHA_MIN + OMAFIT_HAND_POS_ALPHA_SPEED_GAIN * posSpeed;
      posAlpha = THREE.MathUtils.clamp(posAlpha, OMAFIT_HAND_POS_ALPHA_MIN, OMAFIT_HAND_POS_ALPHA_MAX);
      if (!closeEnoughHand) posAlpha *= 0.62;
      posAlpha = THREE.MathUtils.clamp(posAlpha, 0.035, OMAFIT_HAND_POS_ALPHA_MAX);
      posAlpha = THREE.MathUtils.lerp(posAlpha, OMAFIT_HAND_EMA_POS_ALPHA, 0.18);
      if (accessoryType === "bracelet") posAlpha = 0.2;
      smPos.lerp(tmpPos, posAlpha);
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
        const dtSec = Math.max(1e-3, clampDt / 1000);
        const rotSpeed = angleBetween / dtSec;
        let rotAlpha = OMAFIT_HAND_ROT_ALPHA_MIN + OMAFIT_HAND_ROT_ALPHA_SPEED_GAIN * rotSpeed;
        rotAlpha = THREE.MathUtils.clamp(rotAlpha, OMAFIT_HAND_ROT_ALPHA_MIN, OMAFIT_HAND_ROT_ALPHA_MAX);
        if (!closeEnoughHand) rotAlpha *= 0.7;
        rotAlpha = THREE.MathUtils.clamp(rotAlpha, 0.03, OMAFIT_HAND_ROT_ALPHA_MAX);
        rotAlpha = THREE.MathUtils.lerp(rotAlpha, OMAFIT_HAND_EMA_ROT_ALPHA, 0.2);
        if (accessoryType === "bracelet") rotAlpha = 0.2;
        smoothedQuat.slerp(tmpQuat, rotAlpha);
      }
    }

    /** Extrai eixos da quaternion suavizada (para debug e para
     *  componentes que dependam de smX/smY/smZ, como o fallback de escala). */
    basisMat.makeRotationFromQuaternion(smoothedQuat);
    smX.set(basisMat.elements[0], basisMat.elements[1], basisMat.elements[2]);
    smY.set(basisMat.elements[4], basisMat.elements[5], basisMat.elements[6]);
    smZ.set(basisMat.elements[8], basisMat.elements[9], basisMat.elements[10]);

    /**
     * Pulseira: deslize com inércia dupla ao longo do eixo do antebraço (smZ).
     * Vector instantâneo punho→punho frame-a-frame × eixo ≈ velocidade de deslize.
     */
    if (accessoryType === "bracelet") {
      if (braceletWristPrev) {
        braceletDv.subVectors(w0, braceletWristPrev);
        const slideImpulse = braceletDv.dot(smZ);
        const slideFastT = THREE.MathUtils.clamp(slideImpulse * 46, -0.026, 0.026);
        const aFast =
          1 - Math.exp(-clampDt / OMAFIT_BRACELET_SLIDE_TAU_FAST_MS);
        const aLag =
          1 - Math.exp(-clampDt / OMAFIT_BRACELET_SLIDE_TAU_LAG_MS);
        braceletSlideFast = THREE.MathUtils.lerp(
          braceletSlideFast,
          slideFastT,
          aFast,
        );
        braceletSlideLag = THREE.MathUtils.lerp(
          braceletSlideLag,
          braceletSlideFast,
          aLag,
        );
      }
      braceletWristPrev = w0.clone();
    }

    tmpMat.copy(basisMat);
    tmpMat.setPosition(smPos);
    anchor.matrix.copy(tmpMat);
    anchor.matrixWorldNeedsUpdate = true;
    anchor.updateMatrixWorld(true);

    if (accessoryType !== "bracelet") {
      wearPosition.position.set(wearXYZ.x, wearXYZ.y, wearXYZ.z);
    }
    wearPosition.updateMatrixWorld(true);

    /** Near/far dinâmicos: evita clipping do GLB quando o pulso está muito perto da lente. */
    const eyeDist = Math.max(0.12, Math.min(2.8, -smPos.z));
    camera.near = Math.max(0.004, Math.min(0.12, eyeDist * 0.072));
    camera.far = Math.max(6.5, Math.min(140, eyeDist * 15.0));
    camera.updateProjectionMatrix();

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
    const aKn =
      (1 - Math.exp(-clampDt / 220)) *
      (closeEnoughHand ? 1 : 0.42);
    if (!smoothKnuckleSpanInit) {
      smoothKnuckleSpan = handKnuckleSpan;
      smoothKnuckleSpanInit = true;
    } else {
      smoothKnuckleSpan += (handKnuckleSpan - smoothKnuckleSpan) * aKn;
    }
    const handKnuckleSpanStable = smoothKnuckleSpan;
    const isWideWrist =
      distanciaBaseNorm >= OMAFIT_BRACELET_WIDE_SCREEN_N ||
      handKnuckleSpanStable >= OMAFIT_BRACELET_WIDE_M;
    const wideLatBoost = isWideWrist ? OMAFIT_BRACELET_WIDE_LAT_BOOST : 1;
    const braceletRingGeomMean = Math.sqrt(
      Math.max(1e-6, wristExpandMul * OMAFIT_BRACELET_ELLIPSE_X * wideLatBoost) *
        Math.max(1e-6, wristExpandMul * OMAFIT_BRACELET_ELLIPSE_DEPTH),
    );
    const aSpanRef =
      1 - Math.exp(-clampDt / OMAFIT_HAND_KNUCKLE_SPAN_REF_TAU_MS);
    if (handKnuckleSpanRef <= 1e-8) {
      handKnuckleSpanRef = handKnuckleSpanStable;
    } else if (handKnuckleSpanStable > handKnuckleSpanRef) {
      handKnuckleSpanRef = handKnuckleSpanStable;
    } else {
      handKnuckleSpanRef += (handKnuckleSpanStable - handKnuckleSpanRef) * aSpanRef;
    }
    const perspMul = THREE.MathUtils.clamp(
      handKnuckleSpanStable / Math.max(0.034, handKnuckleSpanRef),
      accessoryType === "bracelet" ? 0.86 : 0.76,
      1.03,
    );
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
    const effectiveKnuckleSpan =
      accessoryType === "bracelet"
        ? handKnuckleSpanStable * OMAFIT_BRACELET_WRIST_WIDTH_PADDING
        : handKnuckleSpanStable;
    /**
     * Pulseira: garantir raio mínimo a partir da corda 5–17 (≈ largura do
     * punso na câmara) para as extremidades do anel não ficarem “dentro”
     * das pontas laterais percebidas.
     */
    const wristRadiusFromSpanChord =
      accessoryType === "bracelet" ? handKnuckleSpanStable * 0.34 : 0;
    const wristRadiusRaw = Math.max(
      0.018,
      Math.min(
        0.047,
        Math.max(
          effectiveKnuckleSpan * knuckleToWristRatio,
          wristRadiusFromSpanChord,
        ),
      ),
    );
    /**
     * Comprimento do antebraço (para occluder): ratio ≈ 3.2 × knuckleSpan
     * (comprimento médio de antebraço adulto 25-30 cm vs knuckleSpan 78-92 mm).
     * Mantemos clamp [0.3, 0.6] m para robustez contra outliers — o occluder
     * pode ser um pouco mais comprido que o antebraço real sem problema
     * (depth-write extra para trás não afecta render da cena).
     */
    const forearmLengthRaw =
      accessoryType === "bracelet"
        ? Math.max(0.46, Math.min(0.78, handKnuckleSpanStable * 5.05))
        : Math.max(0.3, Math.min(0.6, handKnuckleSpanStable * 4.0));
    if (!smoothOccluderInitialized) {
      smoothWristRadius = wristRadiusRaw;
      smoothForearmLength = forearmLengthRaw;
      smoothOccluderInitialized = true;
    } else {
      const clampDtOcc = Math.max(8, Math.min(80, Number.isFinite(dtMs) ? dtMs : 16));
      const aOcc = 1 - Math.exp(-clampDtOcc / 800);
      const aOccHand = closeEnoughHand ? aOcc : aOcc * 0.42;
      smoothWristRadius += (wristRadiusRaw - smoothWristRadius) * aOccHand;
      smoothForearmLength += (forearmLengthRaw - smoothForearmLength) * aOccHand;
    }
    /**
     * Scale do cilindro + elipse na secção do pulso.
     *
     * Pulseira: raio base = 0,95 × raio interno da joia em mundo (alinhado a
     * `localInnerR` × escala activa, com média geométrica da elipse X/Y).
     * Relógio: mantém `smoothWristR × OMAFIT_HAND_OCCLUDER_RADIUS_SCALE`.
     *
     * Elipse do cilindro: após `armOccluder.quaternion`, eixo local X ≈ anchor X
     * (ulnar–radial) e Z local ≈ anchor Y (palmar–dorsal).
     */
    /** Ligeiramente maior ao longo da largura do punho (knuckle span). */
    const OMAFIT_OCCLUDER_ELLIPSE_ULNAR_RADIAL = 1.1;
    /** Ligeiramente maior na espessura palmar–dorsal (vista de perfil). */
    const OMAFIT_OCCLUDER_ELLIPSE_PALMAR_DORSAL = 1.12;
    const gapOc =
      accessoryType === "bracelet"
        ? OMAFIT_BRACELET_WRIST_GAP_M
        : OMAFIT_WATCH_WRIST_GAP_M;
    const targetInnerROc = smoothWristRadius + gapOc;
    const defaultTargetROc = OMAFIT_DEFAULT_WRIST_R_M + gapOc;
    const adaptMulOc = targetInnerROc / defaultTargetROc;
    const userMulOc =
      Number.isFinite(Number(userScale)) && Number(userScale) > 0
        ? Number(userScale)
        : 1;
    let occluderR;
    if (accessoryType === "bracelet" && localInnerR > 1e-6) {
      const innerWorldR =
        localInnerR *
        baseScale *
        userMulOc *
        adaptMulOc *
        perspMul *
        braceletRingGeomMean;
      occluderR = Math.max(
        0.0105,
        innerWorldR * OMAFIT_BRACELET_OCCLUDER_VS_INNER,
      );
    } else {
      occluderR = Math.max(
        0.011,
        smoothWristRadius * OMAFIT_HAND_OCCLUDER_RADIUS_SCALE,
      );
    }
    const braceletOccShrink = accessoryType === "bracelet" ? 0.92 : 1;
    const radiusScale = (occluderR / OMAFIT_ARM_OCCLUDER_RADIUS_M) * braceletOccShrink;
    const lengthScale = smoothForearmLength / OMAFIT_ARM_OCCLUDER_LENGTH_M;
    armOccluder.scale.set(
      radiusScale * OMAFIT_OCCLUDER_ELLIPSE_ULNAR_RADIAL,
      lengthScale,
      radiusScale * OMAFIT_OCCLUDER_ELLIPSE_PALMAR_DORSAL,
    );
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
    /**
     * Oclusão dinâmica por lado visível:
     * - Se `smY` aponta para a câmara, esse lado está visível.
     * - O cilindro é deslocado para o lado oposto (sempre oclui o “lado de trás”).
     */
    tmpCamToWrist.subVectors(camera.position, smPos);
    if (tmpCamToWrist.lengthSq() > 1e-10) {
      tmpCamToWrist.normalize();
    } else {
      tmpCamToWrist.set(0, 0, 1);
    }
    const yFacingCamera = smY.dot(tmpCamToWrist) >= 0;
    const braceletDorsumFacingCamera =
      accessoryType === "bracelet" && yFacingCamera;
    const occluderYOffsetMag =
      accessoryType === "bracelet"
        ? Math.max(0.002, smoothWristRadius - 0.0055)
        : smoothWristRadius + 0.006;
    if (accessoryType === "watch" && OMAFIT_WATCH_OCCLUDER_INVERT_SIDE) {
      armOccluder.position.y = yFacingCamera ? occluderYOffsetMag : -occluderYOffsetMag;
    } else {
      armOccluder.position.y = yFacingCamera ? -occluderYOffsetMag : occluderYOffsetMag;
    }
    armOccluder.visible =
      accessoryType === "bracelet"
        /**
         * Rigid slot: occluder sempre ativo — o cilindro está centrado no braço
         * e usa BackSide, portanto oclui o lado posterior do anel em qualquer
         * orientação da mão. O guarda `!braceletDorsumFacingCamera` era para
         * o modo legado (corrente) onde o occluder causava artefactos ao virar.
         */
        ? OMAFIT_BRACELET_DEPTH_OCCLUDER_ENABLED && (braceletIsRigidSlot || !braceletDorsumFacingCamera)
        : true;
    /** Z offset: centrar o cilindro atrás do pulso (−L/2). */
    armOccluder.position.z = -smoothForearmLength / 2;
    armOccluder.updateMatrix();
    armOccluder.updateMatrixWorld(true);
    /**
     * occPlane: reativado para rigid slot após orientação estabilizada (v6).
     * O plano depth-only entre pele e parte posterior do anel faz a pulseira
     * parecer envolver o punho — sem ele a metade traseira aparece à frente da pele.
     */
    occPlane.visible = accessoryType === "bracelet";
    if (occPlane.visible) {
      // T/B/N: normal do plano deve apontar para DENTRO do braço.
      braceletOccWidth.copy(smX).normalize();   // T
      braceletOccForward.copy(smY).normalize(); // B
      braceletOccNormal.crossVectors(braceletOccWidth, braceletOccForward).normalize(); // N
      braceletCameraDir.set(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
      if (braceletOccNormal.dot(braceletCameraDir) > 0) {
        braceletOccNormal.negate();
      }
      const dotOcc = THREE.MathUtils.clamp(
        braceletOccNormal.dot(braceletCameraDir),
        -1,
        1,
      );
      tmpCamToWrist.subVectors(camera.position, smPos);
      if (tmpCamToWrist.lengthSq() > 1e-12) tmpCamToWrist.normalize();
      else tmpCamToWrist.set(0, 0, 1);
      const isInFront = braceletOccNormal.dot(tmpCamToWrist) < 0;
      occPlane.visible = isInFront && dotOcc < -0.2;
      basisMat.makeBasis(braceletOccWidth, braceletOccForward, braceletOccNormal);
      occPlane.quaternion.setFromRotationMatrix(basisMat);
      const wristWidthOcc = w5.distanceTo(w17);
      const dynamicOffset = THREE.MathUtils.clamp(
        wristWidthOcc * 0.015,
        0.0008,
        0.0015,
      );
      occPlane.position.copy(smPos).addScaledVector(braceletOccNormal, dynamicOffset);
      if (occPlane.visible) {
        occPlane.updateMatrix();
        occPlane.updateMatrixWorld(true);
      }
      if (braceletOccNormalDebugLine?.geometry?.attributes?.position) {
        const occPos = braceletOccNormalDebugLine.geometry.attributes.position;
        occPos.setXYZ(0, smPos.x, smPos.y, smPos.z);
        occPos.setXYZ(
          1,
          smPos.x + braceletOccNormal.x * 0.05,
          smPos.y + braceletOccNormal.y * 0.05,
          smPos.z + braceletOccNormal.z * 0.05,
        );
        occPos.needsUpdate = true;
      }
    }

    /**
     * Oclusão adaptativa visual (material) para pulseira:
     * - factor por angulação normal-do-pulso vs direcção da câmara
     * - suavização temporal para evitar flicker
     * - força adaptativa por largura do punho
     * - lado traseiro mais ocluído
     */
    if (
      OMAFIT_BRACELET_MATERIAL_OCCLUSION_ENABLED &&
      accessoryType === "bracelet" &&
      braceletOcclusionMaterials.length > 0
    ) {
      braceletCameraDir.set(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
      braceletOccWidth.subVectors(w5, w17).normalize();
      braceletOccForward.subVectors(w5, w0).normalize();
      braceletOccNormal.crossVectors(braceletOccWidth, braceletOccForward);
      if (braceletOccNormal.lengthSq() < 1e-10) {
        braceletOccNormal.copy(smY);
      } else {
        braceletOccNormal.normalize();
      }
      const dot = THREE.MathUtils.clamp(
        braceletOccNormal.dot(braceletCameraDir),
        -1,
        1,
      );
      const facing = THREE.MathUtils.clamp((dot + 1) / 2, 0, 1);
      braceletOcclusionSmooth = THREE.MathUtils.lerp(
        braceletOcclusionSmooth,
        facing,
        0.15,
      );
      const wristWidth = w5.distanceTo(w17);
      /**
       * Rigid slot: fade de material mais suave (máx 0.3) — o depth occluder
       * cilíndrico já esconde o arco traseiro; a oclusão de material serve só
       * para suavizar a transição lateral. Modo legado (chains): máx 0.7
       * como antes, para compensar ausência do occluder cilíndrico.
       */
      const occStrMax = braceletIsRigidSlot ? 0.3 : 0.7;
      const occlusionStrength = THREE.MathUtils.clamp(
        wristWidth * 2.0,
        0.15,
        occStrMax,
      );
      const targetOpacity = 1.0 - braceletOcclusionSmooth * occlusionStrength;
      const fade = THREE.MathUtils.clamp(facing, 0.3, 1.0);
      const allowAdaptiveOpacity = handMicroUxDisabled || handMicroUx.introComplete;
      for (let mi = 0; mi < braceletOcclusionMaterials.length; mi++) {
        const m = braceletOcclusionMaterials[mi];
        if (!m || typeof m !== "object") continue;
        if (!m.userData) m.userData = {};
        if (!m.userData.omafitOccBaseStored) {
          m.userData.omafitOccBaseStored = true;
          m.userData.omafitOccOpacityBase =
            typeof m.opacity === "number" ? m.opacity : 1;
          m.userData.omafitOccTransparentBase = m.transparent === true;
          m.userData.omafitOccDepthWriteBase =
            typeof m.depthWrite === "boolean" ? m.depthWrite : true;
        }
        const baseOpacity = Number(m.userData.omafitOccOpacityBase);
        const opBase = Number.isFinite(baseOpacity) ? baseOpacity : 1;
        m.depthTest = true;
        m.depthWrite = true;
        m.side = THREE.DoubleSide;
        if (allowAdaptiveOpacity) {
          m.transparent = true;
          const currentOpacity =
            typeof m.opacity === "number" ? m.opacity : opBase;
          const antiVanishOpacity = Math.max(targetOpacity, fade);
          const opacityFloor = braceletIsRigidSlot ? 0.55 : 0.12;
          m.opacity = THREE.MathUtils.lerp(
            currentOpacity,
            THREE.MathUtils.clamp(opBase * antiVanishOpacity, opacityFloor, opBase),
            0.15,
          );
        }
      }
    }

    const wristSpanScaleMul = THREE.MathUtils.clamp(
      (handKnuckleSpanStable * OMAFIT_HAND_KNUCKLE_SPAN_SCALE_K) /
        OMAFIT_BASE_KNUCKLE_SPAN_M,
      OMAFIT_HAND_KNUCKLE_SPAN_SCALE_MIN,
      OMAFIT_HAND_KNUCKLE_SPAN_SCALE_MAX,
    );

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
     *
     * `wristSpanScaleMul`: largura punho `distance(5,17)` em mundo × k (1,2) /
     * referência NHANES — reduz pulseira/relógio “gigante ou minúsculo” vs span.
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
      let suBase =
        baseScale *
        userMul *
        adaptMul *
        perspMul *
        wristSpanScaleMul *
        (accessoryType === "bracelet" ? OMAFIT_BRACELET_SCALE_BOOST : 1);
      if (accessoryType === "bracelet") {
        /**
         * Proteção hard para pulseira: limita escala base a um intervalo
         * anatómico plausível. O cálculo antigo por circunferência podia
         * inflar muito quando `localInnerR` vinha subestimado no GLB.
         */
        suBase = THREE.MathUtils.clamp(suBase, baseScale * 0.68, baseScale * 1.24);
      }
      const Wb = wristExpandMul;
      if (accessoryType === "bracelet" && braceletPlaceState) {
        /**
         * Rigid slot: chamar o step para suavizar a posição de wear (lerp),
         * mas sobrescrever a escala com setScalar uniforme — sem deformação
         * elíptica. O GLB é tratado como objeto rígido no slot do pulso.
         */
        const sw = omafitBraceletWristScaleWearStep(THREE, braceletPlaceState, {
          clampDt,
          closeEnoughHand,
          suBase,
          Wb,
          wideLatBoost,
          ellipseX: OMAFIT_BRACELET_ELLIPSE_X,
          ellipseDepth: OMAFIT_BRACELET_ELLIPSE_DEPTH,
          refWidthM: OMAFIT_BASE_KNUCKLE_SPAN_M,
          refThick09M: OMAFIT_BRACELET_REF_FOREARM_REACH_M,
          refReachM: OMAFIT_BRACELET_REF_FOREARM_REACH_M,
          mulXClamp: [0.9, 1.14],
          mulYClamp: [0.91, 1.24],
          mulZClamp: [0.965, 1.065],
          zScaleExp: OMAFIT_BRACELET_Z_SCALE_EXP,
          posLerpTauMs: OMAFIT_BRACELET_WEAR_LERP_MS,
          wearBase: wearXYZ,
          slideZ: braceletSlideLag,
        });
        if (braceletIsRigidSlot) {
          glbRoot.scale.setScalar(suBase * Wb);
        } else {
          glbRoot.scale.set(sw.sx, sw.sy, sw.sz);
        }
        wearPosition.position.set(sw.wearX, sw.wearY, sw.wearZ);
        wearPosition.updateMatrixWorld(true);
        if (braceletWristAlignGroup) {
          if (!braceletProceduralRadial) {
            omafitBraceletWristAlignStep(THREE, braceletPlaceState, {
              calibRot,
              alignGroup: braceletWristAlignGroup,
              w0,
              w5,
              w9,
              w17,
              camera,
              clampDt,
              closeEnoughHand,
              alignTauMs: OMAFIT_BRACELET_ALIGN_TAU_MS,
              ringHoleAxisLocal: braceletRingHoleAxisAlignLocal,
              debugAxisLine: braceletAxisDebugLine,
            });
          } else {
            braceletWristAlignGroup.position.set(0, 0, 0);
            braceletWristAlignGroup.quaternion.identity();
            braceletWristAlignGroup.scale.set(1, 1, 1);
          }
        }
        if (braceletProceduralRadial && braceletRadialInstMesh) {
          calibRot.updateMatrixWorld(true);
          handMicroUxWrap.updateMatrixWorld(true);
          glbRoot.updateMatrixWorld(true);
          if (handMicroOpacityRoot) handMicroOpacityRoot.updateMatrixWorld(true);
          omafitUpdateBraceletRadialWristOriented(
            THREE,
            braceletRadialInstMesh,
            braceletRadialSegCount,
            w0,
            w5,
            w17,
          );
        }
      } else {
        glbRoot.scale.setScalar(suBase * Wb);
      }

      /**
       * === MOSTRADOR / CASE RÍGIDO EM PULSOS FINOS (v11.7) ===
       *
       * Em pulsos finos (18–22 mm vs 26 mm default), `adaptMul` ≈ 0.70–0.85
       * encolhe TODO o GLB. Isto é desejável para a correia (abraça o pulso)
       * mas DESASTROSO para o mostrador — um dial de 40 mm passa a parecer
       * um relógio de criança (28 mm). Solução: grupo `caseDial` com pivô
       * no eixo do braço (0,0,0) e escala `1/adaptMul` — `glbRoot.scale ×
       * caseDial.scale = su × adaptMul × (1/adaptMul) = su`. Mostrador fica
       * RÍGIDO em metros-mundo, posição e dimensão idênticas ao design
       * original, independentemente do pulso. A correia continua a contrair.
       *
       * Nota: em GLB single-mesh (sem grupos), o `watchVertexDeform` já
       * preserva o núcleo do mostrador via peso `wDial` na deformação
       * vertex-based, portanto não precisa de correcção separada.
       */
      if (accessoryType === "watch" && watchStrapRadial?.caseDial) {
        const worldScale =
          adaptMul * perspMul * wristExpandMul * wristSpanScaleMul;
        const invAdapt =
          Number.isFinite(worldScale) && worldScale > 1e-4 ? 1 / worldScale : 1;
        watchStrapRadial.caseDial.scale.setScalar(invAdapt);
      }

      /**
       * === Correia relógio / pulseira elos: escala biométrica radial (k em sx,sz) ===
       * Bangle: só adaptMul global acima; elos: grupo ou vértices com espessura preservada.
       *
       * v11.7: targetK deriva AMBOS de (a) ratio anatómico knuckle-span e
       * (b) alvo em espaço-mundo `(wristR + gap) / (innerR_default_world)`.
       * Usamos o MÍNIMO dos dois — quem pede mais contração vence. Isto
       * resolve o caso "flutuando" onde o ratio knuckle-span era suave (~0.88)
       * mas o pulso real era tão fino que só a fórmula espaço-mundo conseguia
       * produzir contração suficiente (~0.70).
       */
      if (
        localInnerR > 1e-6 &&
        ((accessoryType === "watch" &&
          (watchStrapRadial?.strap || watchVertexDeform)) ||
          (accessoryType === "bracelet" &&
            !braceletIsBangle &&
            (braceletLinkRadial || braceletVertexDeform)))
      ) {
        const su =
          baseScale *
          userMul *
          adaptMul *
          perspMul *
          wristSpanScaleMul *
          (accessoryType === "bracelet" ? braceletRingGeomMean : wristExpandMul);
        const spanRatio =
          handKnuckleSpan / Math.max(1e-6, OMAFIT_BASE_KNUCKLE_SPAN_M);
        /**
         * Pulseira (elos): k mais alto e mínimo elevado — `k` < 1 encolhe o
         * anel e afasta as pontas do span real 5–17; priorizamos abertura
         * alinhada às extremidades laterais do punso.
         */
        const kFromSpan =
          accessoryType === "bracelet"
            ? THREE.MathUtils.clamp(spanRatio * 0.96 + 0.06, 0.84, 1.02)
            : THREE.MathUtils.clamp(spanRatio * 0.88 + 0.12, 0.55, 1.02);
        /**
         * Alvo em espaço-mundo: a superfície INTERNA da correia (após `su` +
         * `k`) deve ficar a `smoothWristRadius + 0.25 × gap` do eixo do braço.
         * Com `adaptMul` já aplicado, este ratio é ~1 em pulsos médios e
         * cai < 1 só se `smoothWristR` for ainda menor que o default −
         * nesse caso forçamos mais contração (pulso muito fino onde o
         * próprio `adaptMul` já atingiu o limite inferior do tracker).
         */
        const gapM =
          accessoryType === "bracelet"
            ? OMAFIT_BRACELET_WRIST_GAP_M
            : OMAFIT_WATCH_WRIST_GAP_M;
        const rTarget = smoothWristRadius + gapM * 0.25;
        const kWorldTight =
          accessoryType === "bracelet" ? 0.993 : 0.985;
        const kFromWorld =
          rTarget / Math.max(1e-6, localInnerR * su * kWorldTight);
        /** kFloor protege contra clipping (correia NÃO pode entrar dentro do occluder). */
        const kFloor = kFromWorld;
        let targetK = Math.min(kFromSpan, 1);
        targetK = THREE.MathUtils.clamp(targetK, kFloor, 1);
        const aStr =
          1 - Math.exp(-clampDt / OMAFIT_WATCH_STRAP_BIOMETRIC_TAU_MS);
        smoothedStrapK = THREE.MathUtils.lerp(smoothedStrapK, targetK, aStr);
        if (watchStrapRadial?.strap) {
          watchStrapRadial.strap.scale.set(smoothedStrapK, 1, smoothedStrapK);
        }
        if (watchVertexDeform) {
          applyWatchSingleMeshStrapVertexDeform(
            THREE,
            watchVertexDeform,
            smoothedStrapK,
          );
          watchVertexDeform.mesh.geometry.attributes.position.needsUpdate = true;
          watchVertexDeform.normFrame += 1;
          if (watchVertexDeform.normFrame % 2 === 0) {
            watchVertexDeform.mesh.geometry.computeVertexNormals();
          }
        }
        if (braceletLinkRadial) {
          braceletLinkRadial.scale.set(smoothedStrapK, 1, smoothedStrapK);
        }
        if (braceletVertexDeform) {
          applyWatchSingleMeshStrapVertexDeform(
            THREE,
            braceletVertexDeform,
            smoothedStrapK,
          );
          braceletVertexDeform.mesh.geometry.attributes.position.needsUpdate = true;
          braceletVertexDeform.normFrame += 1;
          if (braceletVertexDeform.normFrame % 2 === 0) {
            braceletVertexDeform.mesh.geometry.computeVertexNormals();
          }
        }
      }
    }

    try {
      const jitterInst =
        prevKnuckleSpan3d > 1e-8
          ? Math.abs(handKnuckleSpan - prevKnuckleSpan3d)
          : 0;
      prevKnuckleSpan3d = handKnuckleSpan;
      knuckleJitterEma = knuckleJitterEma * 0.88 + jitterInst * 0.12;
      const trembling = knuckleJitterEma > 0.0035;
      const farHand = proporcaTela < OMAFIT_HAND_SCREEN_CLOSE_FRAC;
      if (farHand && trembling) {
        proximityHintStable = Math.min(36, proximityHintStable + 1);
      } else {
        proximityHintStable = Math.max(0, proximityHintStable - 2);
      }
      proximityHint.style.opacity = proximityHintStable >= 8 ? "1" : "0";
    } catch {
      /* ignore */
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
      const caseRigidK =
        accessoryType === "watch" && watchStrapRadial?.caseDial
          ? 1 /
            Math.max(
              1e-4,
              adaptMul * perspMul * wristExpandMul * wristSpanScaleMul,
            )
          : null;
      console.debug("[omafit-ar] hand anchor v12.1", {
        hand: handLabel || "?",
        handScore: (lastHandScore || 0).toFixed(2),
        anchor: "eixo 0→média(1,17) + roll 0–5–17",
        /** Raw knuckle span (medida bruta MediaPipe landmarks 5-17). */
        knuckleSpan_mm: (handKnuckleSpan * 1000).toFixed(1),
        knuckleSpanRef_mm: (handKnuckleSpanRef * 1000).toFixed(1),
        perspMul: perspMul.toFixed(3),
        /** wristR DEPOIS de aplicar ratio 0.34 + clamp [18, 42] mm. */
        wristR_mm: (smoothWristRadius * 1000).toFixed(1),
        /** Raio efectivo do cilindro oclusor (escala × raio biométrico). */
        occluderR_mm: (occluderR * 1000).toFixed(1),
        forearmL_cm: (smoothForearmLength * 100).toFixed(1),
        bent: didBendWatch,
        ...(accessoryType === "bracelet" && braceletProceduralRadial
          ? {
              braceletRadialSizing: "procedural-wrist-only (ver [bracelet-procedural-radius])",
            }
          : {
              /** Raio INTERNO do GLB (superfície que toca a pele em unidades GLB). */
              localInnerR_mm: (localInnerR * 1000).toFixed(1),
              /** Raio do EIXO do GLB (metade da mediana do bbox). */
              localRingR_mm: (localRingR * 1000).toFixed(1),
              /** Raio INTERNO final do GLB no mundo (deve ≈ wristR + gap).
               *  Se este valor for MENOR que smoothWristR, o GLB clipa no braço!
               *  Se for MAIOR que smoothWristR + 5mm, o GLB fica flutuando. */
              finalInnerR_mm: (localInnerR * baseScale * userMul * adaptMul * 1000).toFixed(1),
            }),
        adaptScale: adaptMul.toFixed(3),
        glbScale: (baseScale * userMul * adaptMul * wristSpanScaleMul).toFixed(
          4,
        ),
        wristSpanScaleMul: wristSpanScaleMul.toFixed(3),
        zDist: zDist.toFixed(3),
        Yz: tmpY.z.toFixed(3),
        strapBiometricK:
          watchStrapRadial?.strap ||
          watchVertexDeform ||
          braceletLinkRadial ||
          braceletVertexDeform
            ? smoothedStrapK.toFixed(4)
            : null,
        /** Escala inversa aplicada ao mostrador (deve ficar ≈ 1/adaptScale).
         *  Null significa: GLB não tem grupo `caseDial` identificável — o
         *  mostrador encolhe com adaptMul (fallback v11.6 para GLBs sem
         *  naming convention ou para single-mesh com vertex deform). */
        caseRigidK: caseRigidK != null ? caseRigidK.toFixed(3) : null,
        strapVertexDeform: Boolean(watchVertexDeform),
        braceletBangle: accessoryType === "bracelet" ? braceletIsBangle : null,
        braceletSlide_mm:
          accessoryType === "bracelet"
            ? (braceletSlideLag * 1000).toFixed(1)
            : null,
        knuckleSpanRatio: (handKnuckleSpan / OMAFIT_BASE_KNUCKLE_SPAN_M).toFixed(3),
        distanciaBaseNorm: distanciaBaseNorm.toFixed(4),
        proporcaTela: proporcaTela.toFixed(3),
        closeEnoughHand,
        wristExpandMul: wristExpandMul.toFixed(3),
        wideWrist: isWideWrist,
      });
    }

    /**
     * Sombra de contacto pulseira: elipse proporcional à largura do punho.
     * Aqui temos w5/w17/w0/w9 em escopo (landmarks em mundo desprojectado).
     * X ≈ largura MCP5–MCP17 × 1.15; Z ≈ espessura punho–MCP9 × 0.85.
     * Relógio usa escala fixa definida no init — não sobrescrever.
     */
    if (accessoryType === "bracelet") {
      const csWristW = w5.distanceTo(w17);
      const csThick = w0.distanceTo(w9);
      contactShadow.scale.set(
        THREE.MathUtils.clamp(csWristW * 1.15, 0.05, 0.16),
        1,
        THREE.MathUtils.clamp(csThick * 0.85, 0.035, 0.1),
      );
    }
  }

  function tick() {
    if (!running) return;
    try {
    if (video.readyState < 2) {
      renderer.render(scene, camera);
      return;
    }
    const videoFrameTime = Number(video.currentTime) || 0;
    if (videoFrameTime === lastVideoFrameTime) {
      renderer.render(scene, camera);
      return;
    }
    lastVideoFrameTime = videoFrameTime;
    const nowTs = performance.now();
    const dtMs = lastFrameTs < 0 ? 16 : nowTs - lastFrameTs;
    lastFrameTs = nowTs;

    let res = null;
    try {
      const mediaTs = videoFrameTime > 0 ? videoFrameTime * 1000 : nowTs;
      res = handLandmarker.detectForVideo(video, mediaTs);
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
      if (braceletHandDiag && !braceletFirstLandmarkLogged) {
        braceletFirstLandmarkLogged = true;
        braceletHandLog("tick:first_hand_landmarks", {
          n: landmarks.length,
          handLabel,
          handScore: Number(lastHandScore || 0).toFixed(3),
        });
      }
      missedFrames = 0;
      updateAnchorFromHand(landmarks, dtMs, handLabel);
      anchor.visible = true;
      if (accessoryType === "bracelet" && !braceletH2DebugLogged) {
        braceletH2DebugLogged = true;
        dbgBraceletAr("H2", "tick:first_landmarks", "anchor_on", {
          n: landmarks.length,
          glbRootVisible: glbRoot.visible,
        });
      }
      if (!handMicroUxDisabled) {
        try {
          if (handDetectRingEl) handDetectRingEl.classList.add("omafit-ar-track-detect-ring--on");
          if (!handMicroUx.hadLandmarks) {
            handMicroUx.snapBoost = Math.max(
              typeof handMicroUx.snapBoost === "number" ? handMicroUx.snapBoost : 1,
              1.042,
            );
          }
          handMicroUx.hadLandmarks = true;
        } catch {
          /* ignore */
        }
      }
      /** Occluder só é útil quando há mão detectada. Evita deixar cilindro
       *  invisível a escrever depth no meio do ecrã quando a mão desaparece. */
      armOccluder.visible =
        accessoryType === "bracelet"
          ? OMAFIT_BRACELET_DEPTH_OCCLUDER_ENABLED && armOccluder.visible
          : true;
      occPlane.visible = accessoryType === "bracelet" && occPlane.visible;
      if (braceletAxisDebugLine) braceletAxisDebugLine.visible = accessoryType === "bracelet";
      if (braceletOccNormalDebugLine) braceletOccNormalDebugLine.visible = accessoryType === "bracelet";
      contactShadow.visible = true;
    } else {
      missedFrames += 1;
      if (missedFrames > MISSED_HIDE_THRESHOLD) {
        anchor.visible = false;
        if (!handMicroUxDisabled) {
          try {
            handMicroUx.hadLandmarks = false;
            if (handDetectRingEl) handDetectRingEl.classList.remove("omafit-ar-track-detect-ring--on");
          } catch {
            /* ignore */
          }
        }
        armOccluder.visible = false;
        occPlane.visible = false;
        if (braceletAxisDebugLine) braceletAxisDebugLine.visible = false;
        if (braceletOccNormalDebugLine) braceletOccNormalDebugLine.visible = false;
        contactShadow.visible = false;
        smoothInitialized = false;
        smoothOccluderInitialized = false;
        handKnuckleSpanRef = 0;
        prevKnuckleSpan3d = 0;
        knuckleJitterEma = 0;
        proximityHintStable = 18;
        try {
          proximityHint.textContent = handWristInstruction;
          proximityHint.style.opacity = "1";
        } catch {
          /* ignore */
        }
        smoothedStrapK = 1;
        if (watchStrapRadial?.strap) {
          watchStrapRadial.strap.scale.set(1, 1, 1);
        }
        if (watchStrapRadial?.caseDial) {
          watchStrapRadial.caseDial.scale.setScalar(1);
        }
        if (watchVertexDeform) {
          applyWatchSingleMeshStrapVertexDeform(THREE, watchVertexDeform, 1);
          watchVertexDeform.mesh.geometry.attributes.position.needsUpdate = true;
          watchVertexDeform.mesh.geometry.computeVertexNormals();
        }
        braceletSlideFast = 0;
        braceletSlideLag = 0;
        braceletWristPrev = null;
        if (braceletPlaceState) {
          resetOmafitBraceletWristPlacementState(braceletPlaceState);
        }
        if (braceletWristAlignGroup) {
          braceletWristAlignGroup.quaternion.identity();
          braceletWristAlignGroup.position.set(0, 0, 0);
        }
        if (braceletLinkRadial) {
          braceletLinkRadial.scale.set(1, 1, 1);
        }
        if (braceletVertexDeform) {
          applyWatchSingleMeshStrapVertexDeform(THREE, braceletVertexDeform, 1);
          braceletVertexDeform.mesh.geometry.attributes.position.needsUpdate = true;
          braceletVertexDeform.mesh.geometry.computeVertexNormals();
        }
        wearPosition.position.set(wearXYZ.x, wearXYZ.y, wearXYZ.z);
      }
    }

    /** Luminância média do vídeo → intensidade da DirectionalLight. */
    if (lumaCtx && video.readyState >= 2) {
      const tNow = performance.now();
      if (tNow - lastLumaMs > 110) {
        lastLumaMs = tNow;
        try {
          lumaCtx.drawImage(video, 0, 0, lumaCanvas.width, lumaCanvas.height);
          const im = lumaCtx.getImageData(
            0,
            0,
            lumaCanvas.width,
            lumaCanvas.height,
          );
          const d = im.data;
          const n = d.length;
          let sum = 0;
          let sR = 0;
          let sG = 0;
          let sB = 0;
          for (let i = 0; i < n; i += 4) {
            const r = d[i];
            const g = d[i + 1];
            const b = d[i + 2];
            sR += r;
            sG += g;
            sB += b;
            sum += 0.299 * r + 0.587 * g + 0.114 * b;
          }
          const np = n / 4;
          const avg = sum / np / 255;
          const tgt = THREE.MathUtils.lerp(
            0.2,
            1.82,
            Math.pow(THREE.MathUtils.clamp(avg, 0, 1), 0.88),
          );
          handKeyLight.intensity = THREE.MathUtils.lerp(
            handKeyLight.intensity,
            tgt,
            0.24,
          );
          handAmbientLight.intensity = THREE.MathUtils.lerp(
            handAmbientLight.intensity,
            THREE.MathUtils.lerp(0.18, 0.58, avg),
            0.12,
          );
          if (!handLumaTintCol) handLumaTintCol = new THREE.Color();
          handLumaTintCol.setRGB(sR / np / 255, sG / np / 255, sB / np / 255);
          handHemiLight.color.lerp(handLumaTintCol, 0.09);
          handHemiLight.groundColor.lerp(handLumaTintCol, 0.05);
        } catch {
          /* vídeo pode estar tainted em contextos raros */
        }
      }
    }

    if (!handMicroUxDisabled && handMicroUxWrap) {
      try {
        omafitStepMicroUxIntro(THREE, handMicroUxWrap, handMicroOpacityRoot, handMicroUx, nowTs, {
          introMs: 480,
          scaleFrom: 0.9,
        });
      } catch {
        /* ignore */
      }
    }

    renderer.render(scene, camera);
    } finally {
      if (running) rafId = requestAnimationFrame(tick);
    }
  }

  loading.style.display = "none";
  dbgBraceletAr("H5", "runHandArSession:loading_hidden", "overlay_hidden_starting_raf", {
    glbRootVisible: glbRoot.visible,
    anchorVisible: anchor.visible,
  });
  rafId = requestAnimationFrame(tick);

  // Live variant override hook: compatível com o face path.
  const prevSwitch = window.__omafitArSwitchGlb || null;
  window.__omafitArSwitchGlb = async (nextUrl, cal) => {
    try {
      /**
       * Repor sempre a posição base antes de aplicar cal — evita herdar
       * wearPosition da variante anterior quando a nova não tem calibração.
       * O bloco cal.scale × baseScale_antigo foi removido: a escala correcta
       * é calculada pelo fitWristGlb depois de carregar o novo GLB (idêntico
       * à primeira carga).
       */
      applyCalibRot(cal && typeof cal === "object" ? cal : null);
      wearPosition.position.set(wearXYZ.x, wearXYZ.y, wearXYZ.z);
      if (cal && typeof cal === "object") {
        if (Number.isFinite(Number(cal.wearX))) wearPosition.position.x = Number(cal.wearX);
        if (Number.isFinite(Number(cal.wearY))) wearPosition.position.y = Number(cal.wearY);
        if (Number.isFinite(Number(cal.wearZ))) wearPosition.position.z = Number(cal.wearZ);
      }
      /**
       * Reset do estado de suavização: evita que a nova variante comece com
       * deslocamento de slide/wear acumulado da variante anterior.
       */
      if (accessoryType === "bracelet" && braceletPlaceState) {
        resetOmafitBraceletWristPlacementState(braceletPlaceState);
        /**
         * Após reset, `smoothPosLerp` fica em (0,0,0). Isso faz a pulseira
         * animar de (0,0,0) até o alvo real (wearXYZ) — visualmente "desce"
         * ou "sobe" durante o lerp. Prime diretamente para wearXYZ para que a
         * troca seja instantânea na posição correcta.
         */
        braceletPlaceState.smoothPosLerp.set(wearXYZ.x, wearXYZ.y, wearXYZ.z);
        braceletPlaceState.wearLerpPrimed = true;
      }
      braceletSlideFast = 0;
      braceletSlideLag = 0;
      if (nextUrl && typeof nextUrl === "string") {
        await new Promise((resolve) => {
          glbLoader.load(
            buildGlbLoaderUrl(nextUrl, versionHint),
            (gltf) => {
              const next = gltf.scene || gltf.scenes?.[0];
              if (!next) return resolve();
              if (!handMicroUxDisabled) {
                try {
                  handMicroUxWrap.scale.setScalar(0.94);
                  handMicroUx.introComplete = false;
                  handMicroUx.introStartMs = performance.now();
                  if (handMicroOpacityRoot) omafitApplyModelOpacityFactor(handMicroOpacityRoot, 0.2);
                } catch {
                  /* ignore */
                }
              }
              bakeGLBTransforms(THREE, next, () => {});
              braceletProceduralRadial = false;
              braceletRadialInstMesh = null;
              braceletRadialSegCount = 0;
              if (accessoryType === "bracelet") {
                omafitNormalizeBraceletTripoGlbScale(THREE, next, glbRoot);
                const radialMode = cfgAttr("arBraceletRadial", "auto");
                const radialShould = omafitBraceletRadialShouldRebuild(
                  THREE,
                  next,
                  radialMode,
                );
                if (radialShould) {
                  const segRaw = Number(
                    String(cfgAttr("arBraceletRadialSegments", "24")).trim(),
                  );
                  const seg = Number.isFinite(segRaw) ? segRaw : 24;
                  braceletProceduralRadial = omafitRebuildBraceletRadialInstanced(
                    THREE,
                    next,
                    seg,
                  );
                }
                console.log("[omafit-ar] bracelet radial switch", {
                  radialMode,
                  radialShould,
                  activated: braceletProceduralRadial,
                  segments: braceletRadialSegCount,
                  sizing: braceletProceduralRadial ? "procedural-wrist-only" : "glb-derived",
                });
                braceletIsRigidSlot = computeBraceletRigidSlotFromScene(next);
              }
              while (glbRoot.children.length) glbRoot.remove(glbRoot.children[0]);
              glbRoot.add(next);
              /**
               * Resetar escala do glbRoot antes do fit — evita herdar escala
               * de variante anterior caso fitWristGlb tenha algum path que não
               * sobreponha a escala (salvaguarda explícita).
               */
              glbRoot.scale.set(1, 1, 1);
              upgradeHandArGlassMaterials(THREE, next);
              const useRigidTemplate =
                accessoryType === "bracelet" &&
                !braceletProceduralRadial &&
                braceletIsRigidSlot &&
                braceletRigidTemplate !== null;
              let fitRes;
              if (useRigidTemplate) {
                next.quaternion.copy(braceletRigidTemplate.quat);
                next.position.copy(braceletRigidTemplate.pos);
                next.scale.copy(braceletRigidTemplate.scl);
                glbRoot.scale.copy(braceletRigidTemplate.glbRootScale);
                baseScale = braceletRigidTemplate.baseScale;
                localRingR = braceletRigidTemplate.localRingR;
                localInnerR = braceletRigidTemplate.localInnerR;
                didBendWatch = false;
                next.updateMatrixWorld(true);
                const bboxT = new THREE.Box3().setFromObject(next);
                const sizeT = new THREE.Vector3();
                bboxT.getSize(sizeT);
                const sortedT = [sizeT.x, sizeT.y, sizeT.z].sort((a, b) => a - b);
                fitRes = {
                  baseScale: braceletRigidTemplate.baseScale,
                  localRingR: braceletRigidTemplate.localRingR,
                  localInnerR: braceletRigidTemplate.localInnerR,
                  didBend: false,
                  size: sizeT,
                  maxDim: sortedT[2] || sizeT.x,
                  medianDim: sortedT[1] || sizeT.x,
                };
                try {
                  console.log("[omafit-ar] bracelet switch: rigid template applied (matches 1st variant)", {
                    baseScale,
                    localInnerR_mm: (localInnerR * 1000).toFixed(1),
                  });
                } catch {
                  /* ignore */
                }
              } else {
                fitRes = fitWristGlb(next, glbRoot, accessoryType, userScale);
                baseScale = fitRes.baseScale;
                localRingR = fitRes.localRingR;
                const rawInnerR = fitRes.localInnerR || fitRes.localRingR * 0.9;
                /**
                 * Normalização de escala por âncora (pulseira):
                 * Se o localInnerR da nova variante divergir mais de ±25% da 1ª
                 * carga, ajusta baseScale para que o tamanho no pulso seja igual.
                 * Fórmula: baseScale_corrigido = fitRes.baseScale × (rawInnerR / anchorLocalInnerR)
                 * → resulta em targetInnerR / anchorLocalInnerR (raio âncora, não o bruto).
                 * O runtime usa baseScale × adaptMul para escalar por frame;
                 * anchorLocalInnerR é usado como localInnerR para que o adaptMul
                 * frame-a-frame também fique consistente entre variantes.
                 */
                if (
                  accessoryType === "bracelet" &&
                  anchorLocalInnerR !== null &&
                  anchorLocalInnerR > 1e-6 &&
                  rawInnerR > 1e-6
                ) {
                  const drift = rawInnerR / anchorLocalInnerR;
                  if (drift < 0.75 || drift > 1.33) {
                    baseScale = fitRes.baseScale * drift;
                    console.log("[omafit-ar] bracelet innerR drift corrected", {
                      rawInnerR_mm: (rawInnerR * 1000).toFixed(1),
                      anchorLocalInnerR_mm: (anchorLocalInnerR * 1000).toFixed(1),
                      drift: drift.toFixed(3),
                      baseScaleOrig: fitRes.baseScale.toFixed(4),
                      baseScaleCorrected: baseScale.toFixed(4),
                    });
                  }
                  localInnerR = anchorLocalInnerR;
                } else {
                  localInnerR = rawInnerR;
                }
                didBendWatch = Boolean(fitRes.didBend);
              }
              watchVertexDeform = null;
              watchStrapRadial = null;
              braceletIsBangle = false;
              braceletLinkRadial = null;
              braceletVertexDeform = null;
              if (accessoryType === "bracelet") {
                upgradeHandArLuxuryJewelryMaterials(THREE, next);
                braceletIsBangle = detectBraceletBangle(THREE, next);
                if (!braceletIsRigidSlot && !braceletIsBangle && !braceletProceduralRadial) {
                  if (countHandArSolidMeshes(next) === 1) {
                    braceletVertexDeform = initBraceletLinkVertexDeformation(
                      THREE,
                      next,
                      fitRes.size,
                    );
                  }
                  if (!braceletVertexDeform) {
                    braceletLinkRadial = setupBraceletLinkRadialGroup(
                      THREE,
                      next,
                      fitRes.localRingR,
                      false,
                    );
                  }
                }
                omafitRefreshBraceletRingHoleAxisInCalibLocal(
                  THREE,
                  next,
                  calibRot,
                  braceletRingHoleAxisAlignLocal,
                  braceletRingHoleTmpMat,
                  braceletProceduralRadial ? braceletRadialHoleAxisScene : null,
                );
                braceletOcclusionMaterials = omafitCollectUniqueMaterials(next);
                for (let mi = 0; mi < braceletOcclusionMaterials.length; mi++) {
                  const bm = braceletOcclusionMaterials[mi];
                  if (!bm || typeof bm !== "object") continue;
                  bm.depthWrite = true;
                  bm.depthTest = true;
                  bm.side = THREE.DoubleSide;
                }
              } else if (accessoryType === "watch") {
                if (countHandArSolidMeshes(next) === 1) {
                  watchVertexDeform = initWatchSingleMeshStrapVertexDeformation(
                    THREE,
                    next,
                    fitRes.size,
                  );
                }
                if (!watchVertexDeform) {
                  watchStrapRadial = setupWatchStrapBiometricGroup(
                    THREE,
                    next,
                    fitRes.size,
                    fitRes.localRingR,
                    false,
                  );
                }
              }
              smoothedStrapK = 1;
              upgradeHandArMetalMaterials(THREE, next);
              omafitEnsureGlassesMeshesRenderable(THREE, next);
              setHandArMeshRenderOrder(glbRoot, 1);
              handMicroOpacityRoot = next;
              if (!handMicroUxDisabled) {
                try {
                  omafitStoreMaterialOpacityBaseline(next);
                  /**
                   * Troca de variante: NÃO aplicar opacidade 0.
                   * Na 1ª carga a opacidade 0 faz sentido (modelo ainda não
                   * trackava). Na troca o modelo anterior já estava visível —
                   * começar em 0 torna o novo invisível por ~480 ms.
                   * Usa apenas a animação de escala (0.9→1.0) como indicador
                   * visual da troca. `preparedOpacity = false` desativa o
                   * interpolador de opacidade em `omafitStepMicroUxIntro`.
                   */
                  handMicroUx.introStartMs = performance.now();
                  handMicroUx.introComplete = false;
                  handMicroUx.preparedOpacity = false;
                  handMicroUxWrap.scale.setScalar(0.9);
                } catch {
                  /* ignore */
                }
              }
              console.log("[omafit-ar] hand GLB fit (switch)", {
                accessoryType,
                baseScale,
                rigidTemplate: Boolean(useRigidTemplate),
                localInnerR_mm: ((localInnerR || 0) * 1000).toFixed(1),
                localRingR_mm: ((localRingR || 0) * 1000).toFixed(1),
                bbox: {
                  x: fitRes.size.x.toFixed(4),
                  y: fitRes.size.y.toFixed(4),
                  z: fitRes.size.z.toFixed(4),
                },
                braceletIsRigidSlot,
                userScale,
              });
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
      if (handHdrEquirectTexture) {
        handHdrEquirectTexture.dispose();
        handHdrEquirectTexture = null;
      }
    } catch {
      /* ignore */
    }
    try {
      if (handEnvPmremRT) {
        handEnvPmremRT.dispose();
        handEnvPmremRT = null;
        scene.environment = null;
      }
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
      if (proximityHint?.parentNode) proximityHint.parentNode.removeChild(proximityHint);
    } catch {
      /* ignore */
    }
    try {
      if (handDetectRingEl?.parentNode) handDetectRingEl.parentNode.removeChild(handDetectRingEl);
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

  let glbUrl = omafitReadGlbUrlFromRootOrQuery();
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

  omafitHydrateArTelemetryDatasetFromSearchParams(
    root,
    typeof document !== "undefined" ? document.getElementById("omafit-widget-root") : null,
  );

  const adminBrand = await waitForOmafitWidgetAdminBranding();
  /** `#omafit-ar-root` (Liquid / iframe) e `#omafit-widget-root` (`data-omafit-admin-primary`) antes do fallback. */
  const widgetRootEl =
    typeof document !== "undefined" ? document.getElementById("omafit-widget-root") : null;
  const embedPrimary = String(
    widgetRootEl?.getAttribute("data-omafit-admin-primary") || "",
  ).trim();
  const primaryColor = omafitResolvePrimaryColor(
    root,
    (embedPrimary || adminBrand?.primary || "").trim(),
  );
  const productTitle = root.dataset.productTitle || "Produto";
  const productImage = omafitUpgradeShopifyMediaToHttps(root.dataset.productImage || "");
  const rootLogo = (root.dataset.storeLogo || root.getAttribute("data-store-logo") || "").trim();
  let logoUrl = (rootLogo || adminBrand?.storeLogo || "").trim();
  logoUrl = omafitUpgradeShopifyMediaToHttps(logoUrl);
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

  if (isOmafitEyewearArForcedFromQuery()) {
    accessoryType = "glasses";
    accessoryTypeSource = "query-eyewear_ar-forced";
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

  try {
  const tryonLayoutMode = omafitResolveTryonLayout(root);
  const tryonLayoutBackground = omafitResolveTryonLayoutBackground(root, productImage);
  injectGlobalStyles(root, primaryColor, tryonLayoutMode);
  {
    const deferPreload =
      String(root?.dataset?.arDeferModulePreload ?? root?.getAttribute?.("data-ar-defer-module-preload") ?? "")
        .trim()
        .toLowerCase() === "1";
    if (!deferPreload) {
      getOmafitArModuleBundle().catch(() => {});
    }
  }

  let modal = null;

  function closeModal() {
    if (modal?.parentNode) modal.parentNode.removeChild(modal);
    modal = null;
    document.body.style.overflow = "";
  }

  function openModal() {
    if (modal) return;
    document.body.style.overflow = "hidden";
    const arProductId = root.dataset.productId || root.getAttribute("data-product-id") || "";
    modal = buildInfoModal({
      primaryColor,
      logoUrl,
      shopName,
      productTitle,
      productImage,
      t,
      layout: tryonLayoutMode,
      layoutSidebar: tryonLayoutMode === "sidebar",
      layoutBackgroundImage: tryonLayoutBackground,
      locale: lang,
      onClose: closeModal,
      onStartAr: (shell, mainRow, colContent, header) => {
        const freshVariants = Array.isArray(window.__OMAFIT_AR_VARIANTS__)
          ? window.__OMAFIT_AR_VARIANTS__
          : [];
        runArSession({
          shell,
          mainRow,
          colContent,
          header,
          glbUrl,
          primaryColor,
          t,
          onClose: closeModal,
          variants: freshVariants,
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
  } catch (e) {
    __omafitArMainStarted = false;
    __omafitArLastRootSig = "";
    console.error("[omafit-ar] main(): falha ao montar UI (modal ou estilos).", e);
  }
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
      if (r) {
        omafitHydrateArRootManualRigFromUrl(r);
        try {
          console.log("Manual rig attr:", r.dataset.arGlassesManualMindarRig);
        } catch {
          /* ignore */
        }
      }
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
    const glb = omafitReadGlbUrlFromRootOrQuery();
    if (root && glb) {
      omafitHydrateArTelemetryDatasetFromSearchParams(
        root,
        document.getElementById("omafit-widget-root"),
      );
      omafitHydrateArRootManualRigFromUrl(root);
      try {
        console.log("Manual rig attr:", root.dataset.arGlassesManualMindarRig);
      } catch {
        /* ignore */
      }
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
