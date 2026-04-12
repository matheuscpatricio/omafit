/**
 * Omafit AR óculos — mesma hierarquia visual da etapa "info" do TryOnWidget + link como omafit-widget.js.
 * Fluxo: (1) modal info → (2) AR com câmera (MindAR.js face tracking + Three.js), como o try-on oficial.
 * @see https://github.com/hiukim/mind-ar-js
 * @see https://hiukim.github.io/mind-ar-js-doc/face-tracking-examples/tryon
 */
/**
 * Regras de renderização (AR face + try-on) que este ficheiro segue:
 * 1) Um só runtime Three — o mesmo URL de módulo que GLTFLoader e MindAR puxam no esm.sh
 *    (`…/es2022/three.mjs` + `deps=three@VERSÃO`), sem `bundle` no MindAR.
 * 2) Hierarquia: modelo sob `anchor.group`, com grupos `GroupCtor` do MindAR e nós opcionais
 *    wearAlign → poseCorr → glbBind → autoOrient → cena GLB.
 * 3) Espelho selfie só via opções MindAR (`disableFaceMirror` / data attribute), sem CSS scaleX no vídeo.
 * 4) Escala: bbox + unidade base + opcional `faceScale` e multiplicador de tema.
 * 5) GLB canónico no pipeline (worker/API) — aqui só carregamos e afinamos materiais/luzes.
 */
const ESM_THREE_VER = "0.150.1";
const ESM_SH = "https://esm.sh";
/** Mesmo ficheiro que o GLTFLoader do esm.sh importa — evita dois módulos `three`. */
const ESM_THREE_MJS = `${ESM_SH}/three@${ESM_THREE_VER}/es2022/three.mjs`;
const ESM_GLTF_MIND = `${ESM_SH}/three@${ESM_THREE_VER}/examples/jsm/loaders/GLTFLoader.js`;
/** Sem `bundle`: `three` deduplica com `ESM_THREE_MJS`. */
const ESM_MINDAR_FACE_THREE = `${ESM_SH}/mind-ar@1.2.5/dist/mindar-face-three.prod.js?deps=three@${ESM_THREE_VER}`;

const Z_SHELL = 2147483640;

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

  /** MindAR injeta `<video>` + canvas WebGL dentro de `mindarHost`. */
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
    style: {
      position: "absolute",
      inset: "0",
      overflow: "hidden",
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
  colContent.style.padding = "0";
  colContent.style.overflow = "auto";
  colContent.style.overflowX = "hidden";
  colContent.style.flex = "1";
  colContent.style.display = "flex";
  colContent.style.flexDirection = "column";
  colContent.appendChild(arWrap);

  let mindarThree = null;
  let arResizeObserver = null;

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
    const [threeMod, gltfModule, mindFaceMod] = await Promise.all([
      import(ESM_THREE_MJS),
      import(ESM_GLTF_MIND),
      import(ESM_MINDAR_FACE_THREE),
    ]);
    const THREE =
      threeMod.default && typeof threeMod.default.Group === "function" ? threeMod.default : threeMod;
    const { GLTFLoader } = gltfModule;
    const MindARThree = mindFaceMod.MindARThree || mindFaceMod.default;

    const arCfg = typeof document !== "undefined" ? document.getElementById("omafit-ar-root") : null;
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

    const anchorRaw = String(arCfg?.dataset?.arMindarAnchor ?? "168").trim();
    const anchorIndex = Math.max(0, Math.min(477, Math.floor(Number(anchorRaw)) || 168));
    const mindarDmRaw = String(arCfg?.dataset?.arMindarDisableMirror ?? "").trim();
    const mindarDmExplicit = mindarDmRaw.length > 0;
    const mindarDmOff = /^1|true|on$/i.test(mindarDmRaw.toLowerCase());
    const legacyMsRaw = String(arCfg?.dataset?.arMirrorSelfie ?? "").trim();
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

    const fMin = Number(String(arCfg?.dataset?.arMindarFilterMinCf ?? "").trim());
    const fBeta = Number(String(arCfg?.dataset?.arMindarFilterBeta ?? "").trim());
    const mindarOpts = {
      container: mindarHost,
      uiLoading: "no",
      uiScanning: "no",
      uiError: "no",
      disableFaceMirror,
    };
    if (Number.isFinite(fMin)) mindarOpts.filterMinCF = fMin;
    if (Number.isFinite(fBeta)) mindarOpts.filterBeta = fBeta;

    mindarThree = new MindARThree(mindarOpts);
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
     * O MindAR já coloca o grupo no referencial do landmark (ex. 168); não usar os Euler por defeito
     * do antigo modo VTG/MediaPipe — duplicavam correção com GLBs já canonicalizados e “entortavam” no AR.
     * `data-ar-glb-yxz` / `data-ar-model-yxz`: só quando precisares de ajuste fino por export.
     */
    const rawGlb = (arCfg?.dataset?.arGlbYxz ? String(arCfg.dataset.arGlbYxz) : "").trim();
    const rawModel = (arCfg?.dataset?.arModelYxz ? String(arCfg.dataset.arModelYxz) : "").trim();
    const glbDeg = parseEulerDegComponents(rawGlb || rawModel, 0, 0, 0);
    const poseCorrDeg = parseEulerDegComponents(
      (arCfg?.dataset?.arPoseCorrYxz ? String(arCfg.dataset.arPoseCorrYxz) : "").trim(),
      0,
      0,
      0,
    );
    const scaleMulRaw = String(arCfg?.dataset?.arMindarModelScale ?? "").trim();
    const nScale = Number(scaleMulRaw);
    const modelScaleMul = Number.isFinite(nScale) && nScale > 0 ? nScale : 1;

    const loader = new GLTFLoader();
    loader.setCrossOrigin("anonymous");
    const gltf = await new Promise((resolve, reject) => {
      loader.load(glbUrl, resolve, undefined, reject);
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
     * MindAR espera largura da armação ~eixo X da âncora. Muitos GLB (Tripo/canonicalize falhado)
     * têm a maior extensão em Y (em pé) ou Z; alinhamos antes do bbox para não escalar/centrar torto.
     */
    const glbWideAlign = new GroupCtor();
    glbWideAlign.rotation.order = "YXZ";
    glasses.updateMatrixWorld(true);
    const boxPre = new THREE.Box3().setFromObject(glasses);
    const szPre = boxPre.getSize(new THREE.Vector3());
    const wx = szPre.x;
    const wy = szPre.y;
    const wz = szPre.z;
    const wMax = Math.max(wx, wy, wz, 1e-9);
    const tol = 1.06;
    /** Z maior → largura ao longo da profundidade glTF: rodar +90° Y mapeia +Z local → +X. */
    if (wz > wx * tol && wz >= wy) {
      glbWideAlign.rotation.y = Math.PI / 2;
    } else if (wy > wx * tol && wy >= wz) {
      /** Y maior → armação “em pé”: rodar +90° Z mapeia +Y local → −X (largura no eixo X). */
      glbWideAlign.rotation.z = Math.PI / 2;
    }
    glbWideAlign.add(glasses);

    const autoOrient = new GroupCtor();
    autoOrient.add(glbWideAlign);
    autoOrient.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(autoOrient);
    /** GLB válido mas sem meshes/POSITION → bbox vazia; evita escala infinita e erro opaco no render. */
    if (typeof box.isEmpty === "function" && box.isEmpty()) {
      throw new Error(
        "omafit-ar: GLB sem geometria visível (cena vazia ou só nós sem vértices). Confirma o export e o URL público.",
      );
    }
    const center = box.getCenter(new THREE.Vector3());
    const sz = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(sz.x, sz.y, sz.z, 1e-6);
    if (!Number.isFinite(maxDim) || maxDim < 1e-9) {
      throw new Error("omafit-ar: dimensões do GLB inválidas (NaN ou zero).");
    }
    autoOrient.position.sub(center);
    /** Escala ~largura facial; `faceScale` do MindAR (metric) afinará no 1.º frame com face. */
    const baseUnitScale = (0.085 / maxDim) * modelScaleMul;
    autoOrient.scale.setScalar(baseUnitScale);
    autoOrient.userData._omafitMaxDim = maxDim;
    autoOrient.userData._omafitBaseUnitScale = baseUnitScale;

    const poseCorr = new GroupCtor();
    poseCorr.rotation.order = "YXZ";
    poseCorr.rotation.set(rad(poseCorrDeg.x), rad(poseCorrDeg.y), rad(poseCorrDeg.z));
    const glbBind = new GroupCtor();
    glbBind.rotation.order = "YXZ";
    glbBind.rotation.set(rad(glbDeg.x), rad(glbDeg.y), rad(glbDeg.z));
    glbBind.add(autoOrient);
    poseCorr.add(glbBind);

    /** Euler wear manual (vazio = identidade); eixo largura + espelho X tratam-se em `glbWideAlign` / `mirrorX`. */
    let wearRaw = (arCfg?.dataset?.arMindarWearYxz ? String(arCfg.dataset.arMindarWearYxz) : "").trim();
    /** Tema antigo gravava 0,180,180 por defeito — ignorar para não anular o alinhamento automático. */
    if (/^0\s*,\s*180\s*,\s*180\s*$/i.test(wearRaw)) wearRaw = "";
    const wearDeg = parseEulerDegComponents(wearRaw, 0, 0, 0);
    const wearAlign = new GroupCtor();
    wearAlign.rotation.order = "YXZ";
    wearAlign.rotation.set(rad(wearDeg.x), rad(wearDeg.y), rad(wearDeg.z));

    /** Motor VTG: invertia a pose; no MindAR ≈ girar 180° em Y no modelo relativamente à âncora. */
    const invertQ = /^1|true|on$/i.test(
      String(arCfg?.dataset?.arInvertPoseQuat ?? "").trim().toLowerCase(),
    );
    const poseInvert = new GroupCtor();
    if (invertQ) {
      poseInvert.rotation.order = "YXZ";
      poseInvert.rotation.set(0, Math.PI, 0);
    }

    /**
     * Espelho em X: por defeito −1 (GLB Y-up + vídeo selfie MindAR); anular com `data-ar-mindar-skip-default-x-flip`.
     * `data-ar-scene-x-mirror` / `data-ar-flip-ipd-axis` multiplicam o sinal (ambos 1 → +1).
     */
    const skipDefXFlip = /^1|true|on$/i.test(
      String(arCfg?.dataset?.arMindarSkipDefaultXFlip ?? "").trim().toLowerCase(),
    );
    const sceneXM = /^1|true|on$/i.test(
      String(arCfg?.dataset?.arSceneXMirror ?? "").trim().toLowerCase(),
    );
    const flipIpd = /^1|true|on$/i.test(
      String(arCfg?.dataset?.arFlipIpdAxis ?? "").trim().toLowerCase(),
    );
    let mirrorSign = skipDefXFlip ? 1 : -1;
    if (sceneXM) mirrorSign *= -1;
    if (flipIpd) mirrorSign *= -1;
    const mirrorX = new GroupCtor();
    if (mirrorSign < 0) mirrorX.scale.x = -1;
    mirrorX.add(poseCorr);
    poseInvert.add(mirrorX);
    wearAlign.add(poseInvert);
    anchor.group.add(wearAlign);

    arResizeObserver = new ResizeObserver(() => {
      try {
        window.dispatchEvent(new Event("resize"));
      } catch {
        /* ignore */
      }
    });
    arResizeObserver.observe(arWrap);
    requestAnimationFrame(() => {
      try {
        window.dispatchEvent(new Event("resize"));
      } catch {
        /* ignore */
      }
    });

    await mindarThree.start();
    const { renderer, scene, camera } = mindarThree;
    let didFaceScaleBlend = false;
    const useFs = /^1|true|on$/i.test(
      String(arCfg?.dataset?.arMindarUseFaceScale ?? "").trim().toLowerCase(),
    );
    renderer.setAnimationLoop(() => {
      if (useFs && !didFaceScaleBlend) {
        const est = typeof mindarThree.getLatestEstimate === "function" ? mindarThree.getLatestEstimate() : null;
        const fs = est && Number(est.faceScale);
        if (Number.isFinite(fs) && fs > 1e-6) {
          const md = autoOrient.userData._omafitMaxDim;
          const base = autoOrient.userData._omafitBaseUnitScale;
          if (Number.isFinite(md) && md > 0 && Number.isFinite(base)) {
            /** `faceScale` ≈ largura facial métrica; alinhar largura do GLB (~1 após bbox) ao rosto. */
            const k = 1.15;
            autoOrient.scale.setScalar((k * fs) / md);
            didFaceScaleBlend = true;
          }
        }
      }
      renderer.render(scene, camera);
    });

    loading.style.display = "none";

    __omafitArDbgLog({
      location: "omafit-ar-widget.js:runArSession",
      message: "mindar face started",
      hypothesisId: "H5-mindar",
      data: {
        anchorIndex,
        disableFaceMirror,
        mirrorSelfieLegacy: legacyMsRaw || null,
        mindarDisableMirrorExplicit: mindarDmExplicit,
        glbBindYxz: glbDeg,
        mindarWearYxz: wearDeg,
        mindarWearRawEmpty: wearRaw.length === 0,
        mindarSkipDefaultXFlip: skipDefXFlip,
        glbWideAlignRad: {
          x: glbWideAlign.rotation.x,
          y: glbWideAlign.rotation.y,
          z: glbWideAlign.rotation.z,
        },
        glbPreBboxSize: { x: wx, y: wy, z: wz },
        useFaceScale: useFs,
        sceneXMirror: sceneXM,
        flipIpdAxis: flipIpd,
        invertPoseQuat: invertQ,
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
