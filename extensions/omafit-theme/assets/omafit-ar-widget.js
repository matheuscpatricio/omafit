/**
 * Omafit AR óculos — mesma hierarquia visual da etapa "info" do TryOnWidget + link como omafit-widget.js.
 * Fluxo: (1) modal info → (2) AR com câmera (Three.js + MediaPipe Face Landmarker).
 */
const ESM_THREE = "https://esm.sh/three@0.160.0";
const ESM_GLTF = "https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";
const ESM_VISION = "https://esm.sh/@mediapipe/tasks-vision@0.10.17";
const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const Z_SHELL = 2147483640;

// #region agent log
/** Debug ingest (sessão 8c9070) — não remover até verificação pós-correção. */
function __omafitArDbgLog(payload) {
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

let __omafitArDbgPoseOkOnce = false;
let __omafitArDbgPoseFailOnce = false;

/**
 * Desktop costuma falhar com facingMode + resolução (OverconstrainedError).
 * Tenta várias constraints e cai em { video: true }.
 */
function omafitArGetUserMediaStream() {
  const md = typeof navigator !== "undefined" ? navigator.mediaDevices : null;
  if (md && typeof md.getUserMedia === "function") {
    const attempts = [
      {
        video: {
          facingMode: { ideal: "user" },
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      },
      { video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
      { video: true, audio: false },
    ];
    return attempts.reduce(
      (p, c) => p.catch(() => md.getUserMedia(c)),
      Promise.reject(new Error("omafit-ar: try next constraint")),
    );
  }
  const legacy =
    navigator.getUserMedia ||
    navigator.webkitGetUserMedia ||
    navigator.mozGetUserMedia ||
    navigator.msGetUserMedia;
  if (!legacy) {
    return Promise.reject(new Error("getUserMedia não disponível neste navegador"));
  }
  return new Promise((resolve, reject) => {
    legacy.call(navigator, { video: true, audio: false }, resolve, reject);
  });
}

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
    arLoading: "A iniciar câmera e modelo 3D…",
    errCamera: "Permita o uso da câmera para o provador AR.",
    errFace: "Não foi possível carregar a detecção facial.",
    errGlb: "Não foi possível carregar o modelo 3D (GLB). Verifique se o ficheiro está público e acessível.",
    errGeneric: "AR indisponível neste dispositivo.",
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
    arLoading: "Starting camera and 3D model…",
    errCamera: "Allow camera access for AR try-on.",
    errFace: "Could not load face detection.",
    errGlb: "Could not load the 3D model (GLB). Check that the file is public and reachable.",
    errGeneric: "AR unavailable on this device.",
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
    arLoading: "Iniciando cámara y modelo 3D…",
    errCamera: "Permite el acceso a la cámara para el probador AR.",
    errFace: "No se pudo cargar la detección facial.",
    errGlb: "No se pudo cargar el modelo 3D (GLB). Comprueba que el archivo sea público y accesible.",
    errGeneric: "AR no disponible en este dispositivo.",
  },
};

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

function injectGlobalStyles(root) {
  const old = document.getElementById("omafit-ar-styles");
  if (old) old.remove();

  const rawFont = resolveArFontFamilyStack(root);
  const stack = formatCssFontFamilyStack(rawFont);
  const appliedStack = stack || "'Outfit', system-ui, sans-serif";
  const primary =
    (root?.dataset?.primaryColor || root?.style?.getPropertyValue("--omafit-ar-primary") || "#810707")
      .trim()
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
    "button",
    {
      type: "button",
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
      },
    },
    [svgX()],
  );
  closeBtn.setAttribute("data-omafit-ar-close-modal", "1");
  closeBtn.addEventListener("click", onClose);

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

async function runArSession({
  shell,
  mainRow,
  colContent,
  header,
  glbUrl,
  primaryColor,
  t,
  onClose,
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

  /** Mesma proporção do vídeo; overflow visível no contentor AR para não cortar o vídeo/canvas ao flex. */
  const arFit = el("div", {
    style: {
      position: "relative",
      flexShrink: "0",
      overflow: "visible",
      background: "#000",
      boxSizing: "border-box",
    },
  });

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

  const video = el("video", {
    playsInline: true,
    muted: true,
    autoPlay: true,
    style: {
      width: "100%",
      height: "100%",
      objectFit: "contain",
      objectPosition: "50% 50%",
      display: "block",
      background: "#000",
      /** Quase opaco: alguns browsers não atualizam VideoTexture com opacity 0. */
      opacity: "0.01",
      pointerEvents: "none",
    },
  });
  const canvas = el("canvas", {
    style: {
      position: "absolute",
      left: "0",
      top: "0",
      width: "100%",
      height: "100%",
      display: "block",
      background: "transparent",
      pointerEvents: "none",
    },
  });

  arFit.appendChild(video);
  arFit.appendChild(canvas);
  arWrap.appendChild(arFit);
  arWrap.appendChild(loading);
  colContent.style.padding = "0";
  colContent.style.overflow = "auto";
  colContent.style.overflowX = "hidden";
  colContent.style.flex = "1";
  colContent.style.display = "flex";
  colContent.style.flexDirection = "column";
  colContent.appendChild(arWrap);

  let stream;
  let raf;
  let renderer;
  let landmarker;
  let arResizeObserver = null;
  let videoTex = null;
  let videoBg = null;
  let videoBgMat = null;

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
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    if (stream) {
      stream.getTracks().forEach((tr) => tr.stop());
      stream = null;
    }
    video.srcObject = null;
    if (renderer) {
      renderer.dispose();
      renderer = null;
    }
    try {
      if (videoTex) {
        videoTex.dispose();
        videoTex = null;
      }
      if (videoBgMat) {
        videoBgMat.dispose();
        videoBgMat = null;
      }
      if (videoBg) {
        if (videoBg.geometry) videoBg.geometry.dispose();
        videoBg = null;
      }
    } catch {
      /* ignore */
    }
  };

  const headerClose = header.querySelector("[data-omafit-ar-close-modal]");
  if (headerClose) {
    const newBtn = headerClose.cloneNode(true);
    headerClose.parentNode.replaceChild(newBtn, headerClose);
    newBtn.addEventListener("click", () => {
      cleanup();
      onClose();
    });
  }

  try {
    const [{ FaceLandmarker, FilesetResolver }, THREE, { GLTFLoader }] = await Promise.all([
      import(ESM_VISION),
      import(ESM_THREE),
      import(ESM_GLTF),
    ]);

    const arRootEarly = typeof document !== "undefined" ? document.getElementById("omafit-ar-root") : null;
    const poseSourceEarly = (arRootEarly?.dataset?.arPoseSource ? String(arRootEarly.dataset.arPoseSource) : "")
      .trim()
      .toLowerCase();
    /** `landmarks` = só base olhos/plano; vazio ou `matrix` = tentar quaternion da matriz MP primeiro (recomendado). */
    const poseLandmarksOnly = poseSourceEarly === "landmarks";

    const mirrorSelfieRaw = (arRootEarly?.dataset?.arMirrorSelfie ? String(arRootEarly.dataset.arMirrorSelfie) : "")
      .trim()
      .toLowerCase();
    /** `1−x` nos landmarks (espelho “selfie” no espaço normalizado). */
    const normXMirror = mirrorSelfieRaw === "1" || mirrorSelfieRaw === "true" || mirrorSelfieRaw === "on";
    const sceneXMirrorRaw = String(arRootEarly?.dataset?.arSceneXMirror ?? "")
      .trim()
      .toLowerCase();
    /**
     * Por defeito **ligado** (vazio ou 1): nega NDC X + espelha plano WebGL.
     * Desligar no tema: `data-ar-scene-x-mirror="0"` ou `false` ou `off`.
     */
    const sceneMirrorXNdc = !/^(0|false|off)$/i.test(sceneXMirrorRaw);
    /** Textura de fundo: scale X negativo exige DoubleSide e deve acompanhar qualquer espelho horizontal. */
    const arVideoMirrorX = normXMirror || sceneMirrorXNdc;

    const landmarkerOpts = {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      numFaces: 1,
      minFaceDetectionConfidence: 0.25,
      minFacePresenceConfidence: 0.25,
      minTrackingConfidence: 0.25,
      outputFaceBlendshapes: false,
      /** Matriz canónica→face (MP); posição no Three continua planar (sem `z` do landmark no raio). */
      outputFacialTransformationMatrixes: true,
    };

    try {
      const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
      landmarker = await FaceLandmarker.createFromOptions(vision, landmarkerOpts);
    } catch {
      const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
      landmarker = await FaceLandmarker.createFromOptions(vision, {
        ...landmarkerOpts,
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
      });
    }

    stream = await omafitArGetUserMediaStream();
    video.srcObject = stream;
    await video.play();
    for (let i = 0; i < 40 && (!video.videoWidth || !video.videoHeight); i += 1) {
      await new Promise((r) => setTimeout(r, 50));
    }

    loading.style.display = "none";

    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    canvas.width = w;
    canvas.height = h;

    function layoutArFit() {
      const vw = video.videoWidth || w;
      const vh = video.videoHeight || h;
      const rect = arWrap.getBoundingClientRect();
      const rw = Math.max(1, rect.width);
      const rh = Math.max(1, rect.height);
      const ar = vw / vh;
      let dispW;
      let dispH;
      if (rw / rh > ar) {
        dispH = rh;
        dispW = rh * ar;
      } else {
        dispW = rw;
        dispH = rw / ar;
      }
      arFit.style.width = `${dispW}px`;
      arFit.style.height = `${dispH}px`;
    }
    layoutArFit();
    arResizeObserver = new ResizeObserver(() => layoutArFit());
    arResizeObserver.observe(arWrap);
    requestAnimationFrame(() => layoutArFit());

    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: false });
    renderer.setSize(w, h, false);
    /** 1:1 com `video.videoWidth/Height` — DPR>1 com setSize(w,h) altera canvas.width e pode desalinhar ray/landmark vs o que se vê. */
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1;

    const scene = new THREE.Scene();
    /**
     * FOV vertical ~63° alinha à câmara virtual usada na geometria do Face Landmarker (documentação / issues MP).
     * FOV diferente desloca o raio NDC relativamente ao modelo interno dos landmarks.
     */
    const MP_FACE_TASK_VFOV = 63;
    const camera = new THREE.PerspectiveCamera(MP_FACE_TASK_VFOV, w / h, 0.01, 10);
    camera.position.set(0, 0, 0.6);
    camera.up.set(0, 1, 0);
    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.45));

    const camZ = 0.6;
    const zPlane = -0.34;
    const distCamToPlane = camZ - zPlane;

    /** Plano com o mesmo frame que o raycast — elimina desvio entre <video> CSS e canvas WebGL. */
    videoTex = new THREE.VideoTexture(video);
    videoTex.colorSpace = THREE.SRGBColorSpace;
    videoTex.minFilter = THREE.LinearFilter;
    videoTex.magFilter = THREE.LinearFilter;
    videoBgMat = new THREE.MeshBasicMaterial({
      map: videoTex,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
      side: arVideoMirrorX ? THREE.DoubleSide : THREE.FrontSide,
    });
    videoBg = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), videoBgMat);
    videoBg.frustumCulled = false;
    videoBg.renderOrder = -1000;
    scene.add(videoBg);

    const loader = new GLTFLoader();
    loader.setCrossOrigin("anonymous");
    const gltf = await new Promise((resolve, reject) => {
      loader.load(glbUrl, resolve, undefined, reject);
    });
    const glasses = gltf.scene;
    glasses.frustumCulled = false;
    glasses.traverse((child) => {
      if (child.isMesh) {
        child.frustumCulled = false;
        const colorAttr = child.geometry && child.geometry.getAttribute
          ? child.geometry.getAttribute("color")
          : null;
        if (!child.material && colorAttr) {
          child.material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true });
        }
        if (child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          for (const mat of mats) {
            if (!mat) continue;
            if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
            if (mat.emissiveMap) mat.emissiveMap.colorSpace = THREE.SRGBColorSpace;
            if (colorAttr && "vertexColors" in mat) mat.vertexColors = true;
            // Em AR com vídeo de fundo, materiais muito metálicos perdem cor perceptível.
            // Neutraliza PBR para priorizar fidelidade cromática do produto.
            if ("metalness" in mat) mat.metalness = 0;
            if ("roughness" in mat) mat.roughness = 1;
            if ("envMapIntensity" in mat) mat.envMapIntensity = 0;
            if ("emissiveIntensity" in mat) mat.emissiveIntensity = 1;
            // Preserva cores do GLB sem "lavar" por tone mapping.
            mat.toneMapped = false;
            mat.needsUpdate = true;
          }
        }
      }
    });
    const autoOrient = new THREE.Group();
    autoOrient.rotation.order = "YXZ";
    autoOrient.rotation.set(0, 0, 0);
    autoOrient.add(glasses);

    let baseGlbScale = 1;
    {
      autoOrient.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(autoOrient);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
      autoOrient.position.sub(center);
      baseGlbScale = 1 / maxDim;
      autoOrient.scale.setScalar(baseGlbScale);
      const normWidth = Math.max(size.x / maxDim, 1e-4);
      glasses.userData._omafitNormWidth = normWidth;
      autoOrient.userData._omafitNormWidth = normWidth;
    }

    /**
     * Rotação fixa só em `glbBind` (ordem YXZ): fusão do antigo q_glbBind * q_modelFix (−90° X no modelFix
     * + 0,90,180° no glbBind). `modelFix` sem Euler (0,0,0).
     * Override: `data-ar-glb-yxz` no #omafit-ar-root; se vazio, tenta `data-ar-model-yxz` (Liquid antigo).
     */
    const rad = (d) => (d * Math.PI) / 180;
    const arCfgRoot = typeof document !== "undefined" ? document.getElementById("omafit-ar-root") : null;
    function parseYxzDegString(raw, defX, defY, defZ) {
      const s = String(raw || "").trim();
      if (!s) return { x: defX, y: defY, z: defZ };
      const p = s.split(/[\s,;]+/).map((t) => Number(t.trim()));
      if (p.length < 3 || p.some((n) => Number.isNaN(n))) return { x: defX, y: defY, z: defZ };
      return { x: p[0], y: p[1], z: p[2] };
    }
    const qM0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(rad(-90), 0, 0, "YXZ"));
    const qG0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rad(90), rad(180), "YXZ"));
    const qMerged0 = qG0.clone().multiply(qM0);
    const eMerged0 = new THREE.Euler().setFromQuaternion(qMerged0, "YXZ");
    const defX = (eMerged0.x * 180) / Math.PI;
    const defY = (eMerged0.y * 180) / Math.PI;
    const defZ = (eMerged0.z * 180) / Math.PI;
    const rawGlb = (arCfgRoot?.dataset?.arGlbYxz ? String(arCfgRoot.dataset.arGlbYxz) : "").trim();
    const rawModel = (arCfgRoot?.dataset?.arModelYxz ? String(arCfgRoot.dataset.arModelYxz) : "").trim();
    const glbDeg = parseYxzDegString(rawGlb || rawModel, defX, defY, defZ);

    const modelFix = new THREE.Group();
    modelFix.rotation.order = "YXZ";
    modelFix.rotation.set(0, 0, 0);
    modelFix.add(autoOrient);

    const glbBind = new THREE.Group();
    glbBind.rotation.order = "YXZ";
    const AR_GLB_BIND_X_DEG = glbDeg.x;
    const AR_GLB_BIND_Y_DEG = glbDeg.y;
    const AR_GLB_BIND_Z_DEG = glbDeg.z;
    glbBind.rotation.set(rad(AR_GLB_BIND_X_DEG), rad(AR_GLB_BIND_Y_DEG), rad(AR_GLB_BIND_Z_DEG));
    glbBind.add(modelFix);

    /**
     * Ajuste fino cabeça↔GLB (YXZ). Vazio = 0,0,0; ex. 0,180,180 se o export precisar.
     */
    const rawPoseCorr = (arCfgRoot?.dataset?.arPoseCorrYxz ? String(arCfgRoot.dataset.arPoseCorrYxz) : "").trim();
    const poseCorrDeg = parseYxzDegString(rawPoseCorr, 0, 0, 0);
    const poseCorr = new THREE.Group();
    poseCorr.rotation.order = "YXZ";
    poseCorr.rotation.set(rad(poseCorrDeg.x), rad(poseCorrDeg.y), rad(poseCorrDeg.z));

    // #region agent log
    __omafitArDbgLog({
      location: "omafit-ar-widget.js:runArSession",
      message: "glb scene bound",
      hypothesisId: "H5",
      data: {
        glbBindYXZdeg: { x: AR_GLB_BIND_X_DEG, y: AR_GLB_BIND_Y_DEG, z: AR_GLB_BIND_Z_DEG },
        poseCorrYXZdeg: { x: poseCorrDeg.x, y: poseCorrDeg.y, z: poseCorrDeg.z },
        poseMode: "mpFov63+planarLandmarks+mpMatrixQuat+midEyesWearOffset",
        modelFixYXZdeg: { x: 0, y: 0, z: 0 },
      },
    });
    // #endregion

    const faceRoot = new THREE.Group();
    faceRoot.frustumCulled = false;
    faceRoot.matrixAutoUpdate = true;
    faceRoot.add(poseCorr);
    poseCorr.add(glbBind);
    scene.add(faceRoot);

    const dirLt = new THREE.DirectionalLight(0xffffff, 0.35);
    dirLt.position.set(0.35, 0.55, 0.45);
    scene.add(dirLt);

    const arFacePlane = new THREE.Plane();
    arFacePlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, zPlane));
    function syncVideoBackgroundPlane() {
      if (!videoBg) return;
      const vfov = (camera.fov * Math.PI) / 180;
      const ph = 2 * Math.tan(vfov / 2) * distCamToPlane;
      const pw = ph * camera.aspect;
      if (pw > 1e-8 && ph > 1e-8) {
        /** Espelho X: alinha textura WebGL ao raycast (normXMirror ou sceneMirrorXNdc). */
        videoBg.scale.set(arVideoMirrorX ? -pw : pw, ph, 1);
        /** Ligeiramente atrás do plano do raycast para reduzir z-fighting com o GLB. */
        videoBg.position.set(0, 0, zPlane - 0.002);
      }
    }
    syncVideoBackgroundPlane();
    const arRaycaster = new THREE.Raycaster();
    const arHit = new THREE.Vector3();
    const frameToIpdRatio = 1.84;
    /** Espelhos horizontais: ver `normXMirror` / `sceneMirrorXNdc` (lidos no início da sessão). */

    function normX(px) {
      return normXMirror ? 1 - px : px;
    }

    /** `data-ar-flip-ipd-axis="1"`: inverte sentido do eixo X (olho esquerdo → direito) na base Z×X. */
    const flipIpdRaw = (arCfgRoot?.dataset?.arFlipIpdAxis ? String(arCfgRoot.dataset.arFlipIpdAxis) : "")
      .trim()
      .toLowerCase();
    const flipIpdAxis = flipIpdRaw === "1" || flipIpdRaw === "true" || flipIpdRaw === "on";

    /** Suavização posição/rotação/escala (0.2–1). 1 = cola ao landmark; vazio = 0.92. `data-ar-pose-lerp`. */
    const poseLerpRaw = (arCfgRoot?.dataset?.arPoseLerp ? String(arCfgRoot.dataset.arPoseLerp) : "").trim();
    const poseLerpAlpha = (() => {
      if (!poseLerpRaw) return 0.92;
      const n = Number(poseLerpRaw);
      if (!Number.isFinite(n)) return 0.92;
      return Math.min(1, Math.max(0.2, n));
    })();
    const scaleFollow = 0.72;

    /** Rectângulo object-fit:contain; se o contentor já tem o mesmo aspect que o vídeo, usa tudo (evita offsets por float). */
    function getObjectFitContainRect(containerW, containerH, intrinsicW, intrinsicH) {
      const cw = Math.max(1, containerW);
      const ch = Math.max(1, containerH);
      const arC = cw / ch;
      const arI = intrinsicW / intrinsicH;
      const eps = 0.002;
      if (Math.abs(arC - arI) < eps) {
        return { ox: 0, oy: 0, drawW: cw, drawH: ch };
      }
      if (arC > arI) {
        const drawH = ch;
        const drawW = ch * arI;
        return { ox: (cw - drawW) * 0.5, oy: 0, drawW, drawH };
      }
      const drawW = cw;
      const drawH = cw / arI;
      return { ox: 0, oy: (ch - drawH) * 0.5, drawW, drawH };
    }

    /**
     * Projeta só **x,y** normalizados do MP no plano z=zPlane (NDC + Raycaster).
     * O `z` do landmark **não** entra na posição: em Web costuma distorcer vs câmara real e causa desvio estável
     * (discussões MP + Three; matriz facial cobre pose 3D quando usada).
     */
    function landmarkToWorldOnPlane(p) {
      if (!p) return null;
      const vw = video.videoWidth || w;
      const vh = video.videoHeight || h;
      /** `video.client*` alinha ao rect desenhado do elemento (object-fit), como o olho vê o frame. */
      const dispW = Math.max(1, video.clientWidth || arFit.clientWidth || vw);
      const dispH = Math.max(1, video.clientHeight || arFit.clientHeight || vh);
      const r = getObjectFitContainRect(dispW, dispH, vw, vh);
      const xn = normX(p.x);
      const bx = r.ox + xn * r.drawW;
      const by = r.oy + p.y * r.drawH;
      const bufX = (bx / dispW) * vw;
      const bufY = (by / dispH) * vh;
      let ndcX = (bufX / vw) * 2 - 1;
      if (sceneMirrorXNdc) ndcX *= -1;
      const ndcY = -((bufY / vh) * 2 - 1);
      arRaycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
      const hit = arRaycaster.ray.intersectPlane(arFacePlane, arHit);
      if (hit == null) {
        const vFov = (camera.fov * Math.PI) / 180;
        const halfH = Math.tan(vFov / 2) * distCamToPlane;
        const halfW = halfH * camera.aspect;
        return new THREE.Vector3(ndcX * halfW, ndcY * halfH, zPlane);
      }
      return arHit.clone();
    }

    const poseQuatScratch = new THREE.Quaternion();
    const rotMatScratch = new THREE.Matrix4();
    const mpFaceMat = new THREE.Matrix4();
    const mpTmpPos = new THREE.Vector3();
    const mpTmpScl = new THREE.Vector3();
    const vecX = new THREE.Vector3();
    const vecY = new THREE.Vector3();
    const _zWant = new THREE.Vector3();
    const headWearOffsetLocal = new THREE.Vector3();
    const worldUpRef = new THREE.Vector3(0, 1, 0);

    function resetFaceRootTransform() {
      faceRoot.position.set(0, 0, 0);
      faceRoot.quaternion.set(0, 0, 0, 1);
      faceRoot.scale.set(1, 1, 1);
    }

    function applyGlassesPose(res, doSnap = false) {
      camera.updateMatrixWorld(true);
      const lm = res.faceLandmarks[0];
      if (!lm) return false;

      /** MediaPipe: 33 = olho direito, 263 = esquerdo; 133/362 = cantos internos. */
      const eyeRightLm = lm[33];
      const eyeLeftLm = lm[263];
      const nose = lm[1];
      if (!eyeRightLm || !eyeLeftLm || !nose) return false;

      const ipdNorm = Math.hypot(eyeRightLm.x - eyeLeftLm.x, eyeRightLm.y - eyeLeftLm.y);
      if (ipdNorm < 0.02) return false;

      const pEyeRight = landmarkToWorldOnPlane(eyeRightLm);
      const pEyeLeft = landmarkToWorldOnPlane(eyeLeftLm);
      const ipdWorld = pEyeRight.distanceTo(pEyeLeft);
      const modelNormWidth =
        autoOrient.userData._omafitNormWidth || glasses.userData._omafitNormWidth || 1;
      const faceScale = Math.max(0.06, Math.min(0.28, (ipdWorld * frameToIpdRatio) / modelNormWidth));

      const pBridge = lm[168] ? landmarkToWorldOnPlane(lm[168]) : null;
      const midEyes = new THREE.Vector3().addVectors(pEyeRight, pEyeLeft).multiplyScalar(0.5);
      /** Ancoragem da rotação: ponto entre olhos (estável); ponte só mistura ligeiramente a posição. */
      const anchorRot = midEyes;
      const anchorPos = midEyes.clone();
      if (pBridge) anchorPos.lerp(pBridge, 0.22);

      /** +Z local da cabeça = direção ancoragem → câmara (frente da face na cena). */
      _zWant.subVectors(camera.position, anchorRot);
      if (_zWant.lengthSq() < 1e-14) return false;
      _zWant.normalize();

      const mtx = res.facialTransformationMatrixes && res.facialTransformationMatrixes[0];
      const mtxData = mtx && mtx.data;
      const basisRaw = (arCfgRoot?.dataset?.arPoseBasis ? String(arCfgRoot.dataset.arPoseBasis) : "")
        .trim()
        .toLowerCase();
      const forceBasisOnly = basisRaw === "1" || basisRaw === "true" || basisRaw === "on";
      let usedMpMatrix = false;
      if (!forceBasisOnly && !poseLandmarksOnly && mtxData && mtxData.length >= 16) {
        mpFaceMat.fromArray(mtxData);
        /** Proto / Web: `data` costuma ser row-major; Three `fromArray` espera column-major → transpor. */
        const noTr = (arCfgRoot?.dataset?.arMpMatrixNotranspose ? String(arCfgRoot.dataset.arMpMatrixNotranspose) : "")
          .trim()
          .toLowerCase();
        if (noTr !== "1" && noTr !== "true" && noTr !== "on") mpFaceMat.transpose();
        mpFaceMat.decompose(mpTmpPos, poseQuatScratch, mpTmpScl);
        poseQuatScratch.normalize();
        const qFin = [poseQuatScratch.x, poseQuatScratch.y, poseQuatScratch.z, poseQuatScratch.w].every(
          Number.isFinite,
        );
        const ql =
          poseQuatScratch.x ** 2 +
          poseQuatScratch.y ** 2 +
          poseQuatScratch.z ** 2 +
          poseQuatScratch.w ** 2;
        usedMpMatrix = qFin && Math.abs(ql - 1) < 0.05;
      }
      if (!usedMpMatrix) {
        /**
         * Base RH explícita (evita lookAt+post-giro ambíguo com glbBind):
         * Z = vista; X = interpupilar no plano ⊥ Z; Y = Z×X; depois alinhar Y a +Y mundo para não ficar de cabeça para baixo.
         */
        if (flipIpdAxis) vecX.subVectors(pEyeLeft, pEyeRight);
        else vecX.subVectors(pEyeRight, pEyeLeft);
        vecX.addScaledVector(_zWant, -vecX.dot(_zWant));
        if (vecX.lengthSq() < 1e-14) return false;
        vecX.normalize();
        vecY.crossVectors(_zWant, vecX);
        if (vecY.lengthSq() < 1e-14) return false;
        vecY.normalize();
        if (vecY.dot(worldUpRef) < 0) {
          vecY.negate();
          vecX.negate();
        }
        rotMatScratch.makeBasis(vecX, vecY, _zWant);
        poseQuatScratch.setFromRotationMatrix(rotMatScratch);
      }
      /** Opcional: `data-ar-invert-pose-quat="1"` no #omafit-ar-root (correção rara de convenção). */
      const invQRaw = (arCfgRoot?.dataset?.arInvertPoseQuat ? String(arCfgRoot.dataset.arInvertPoseQuat) : "")
        .trim()
        .toLowerCase();
      const invertPoseQuat = invQRaw === "1" || invQRaw === "true" || invQRaw === "on";
      if (invertPoseQuat) poseQuatScratch.invert();

      // #region agent log
      if (!__omafitArDbgPoseOkOnce) {
        __omafitArDbgPoseOkOnce = true;
        __omafitArDbgLog({
          location: "omafit-ar-widget.js:applyGlassesPose",
          message: "first pose ok",
          hypothesisId: "H5",
          data: {
            ipdNorm: Math.round(ipdNorm * 1000) / 1000,
            poseW: Math.round(poseQuatScratch.w * 1000) / 1000,
          },
        });
      }
      // #endregion

      /**
       * Posição do `faceRoot`: `Matrix4.compose` mental = T(world) * R(quat).
       * Offset em **espaço local da cabeça** (−Y sobe ligeiramente à ponte; +Z afasta da face).
       */
      headWearOffsetLocal.set(0, -0.011, 0.017);
      headWearOffsetLocal.applyQuaternion(poseQuatScratch);
      const targetPos = anchorPos.add(headWearOffsetLocal);

      if (doSnap) {
        faceRoot.position.copy(targetPos);
        faceRoot.quaternion.copy(poseQuatScratch);
        faceRoot.scale.setScalar(faceScale);
      } else {
        faceRoot.position.lerp(targetPos, poseLerpAlpha);
        faceRoot.quaternion.slerp(poseQuatScratch, poseLerpAlpha);
        const s = faceRoot.scale.x || faceScale;
        faceRoot.scale.setScalar(s + (faceScale - s) * scaleFollow);
      }
      faceRoot.quaternion.normalize();
      return true;
    }

    faceRoot.visible = false;
    let poseHadFaceLastFrame = false;

    function frame() {
      raf = requestAnimationFrame(frame);
      if (!landmarker || !video.videoWidth) {
        syncVideoBackgroundPlane();
        renderer.render(scene, camera);
        return;
      }
      const vwF = video.videoWidth || w;
      const vhF = video.videoHeight || h;
      if (
        vwF > 0 &&
        vhF > 0 &&
        (renderer.domElement.width !== vwF ||
          renderer.domElement.height !== vhF ||
          camera.userData._aspW !== vwF ||
          camera.userData._aspH !== vhF)
      ) {
        camera.userData._aspW = vwF;
        camera.userData._aspH = vhF;
        canvas.width = vwF;
        canvas.height = vhF;
        renderer.setSize(vwF, vhF, false);
        camera.aspect = vwF / vhF;
        camera.updateProjectionMatrix();
        syncVideoBackgroundPlane();
      }
      const ts =
        typeof video.currentTime === "number" && Number.isFinite(video.currentTime)
          ? Math.round(video.currentTime * 1000)
          : Math.round(performance.now());
      const res = landmarker.detectForVideo(video, ts);
      if (!res.faceLandmarks || !res.faceLandmarks[0]) {
        faceRoot.visible = false;
        poseHadFaceLastFrame = false;
        resetFaceRootTransform();
        syncVideoBackgroundPlane();
        renderer.render(scene, camera);
        return;
      }

      const ok = applyGlassesPose(res, !poseHadFaceLastFrame);
      // #region agent log
      if (!ok && !__omafitArDbgPoseFailOnce) {
        __omafitArDbgPoseFailOnce = true;
        __omafitArDbgLog({
          location: "omafit-ar-widget.js:frame",
          message: "pose false with landmarks",
          hypothesisId: "H5",
          data: { hadLm: true },
        });
      }
      // #endregion
      faceRoot.visible = ok;
      if (!ok) resetFaceRootTransform();
      poseHadFaceLastFrame = ok;
      syncVideoBackgroundPlane();
      renderer.render(scene, camera);
    }
    raf = requestAnimationFrame(frame);
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
      !/face|landmarker|wasm|vision/i.test(msg);
    loading.textContent = isCam ? t.errCamera : isGlb ? t.errGlb : t.errFace;
    cleanup();
  }
}

let __omafitArMainStarted = false;

async function main() {
  const root = document.getElementById("omafit-ar-root");
  if (!root) return;
  if (__omafitArMainStarted) return;
  __omafitArMainStarted = true;

  const glbUrl = (
    root.dataset.glbUrl ||
    root.getAttribute("data-glb-url") ||
    ""
  ).trim();
  if (!glbUrl) {
    __omafitArMainStarted = false;
    return;
  }

  const primaryColor = root.dataset.primaryColor || "#810707";
  const productTitle = root.dataset.productTitle || "Produto";
  const productImage = root.dataset.productImage || "";
  let logoUrl = (root.dataset.storeLogo || root.getAttribute("data-store-logo") || "").trim();
  if (logoUrl.startsWith("//")) logoUrl = `https:${logoUrl}`;
  const shopName = (root.dataset.shopName || root.getAttribute("data-shop-name") || "").trim();
  const linkText = root.dataset.linkText || "Experimentar óculos (AR)";
  const lang = pickLocale(root.dataset.locale);
  const t = COPY[lang] || COPY.pt;
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

  injectGlobalStyles(root);

  let modal = null;

  function closeModal() {
    if (modal?.parentNode) modal.parentNode.removeChild(modal);
    modal = null;
    document.body.style.overflow = "";
  }

  function openModal() {
    if (modal) return;
    document.body.style.overflow = "hidden";
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

function startOmafitAr() {
  return main().catch((e) => {
    console.error("[omafit-ar]", e);
    __omafitArMainStarted = false;
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
