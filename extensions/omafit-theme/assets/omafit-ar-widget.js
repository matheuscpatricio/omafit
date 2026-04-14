/**
 * MindAR óculos no tema (via bloco Omafit embed) — etapa "info" alinhada ao TryOnWidget + link como omafit-widget.js.
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

/**
 * Evita GLB “preso” em cache (Three.Cache + CDN) quando o URL do ficheiro não muda mas o conteúdo sim.
 * `data-ar-glb-version` no DOM deve mudar quando o produto é guardado (Liquid).
 */
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
    errHttps: "Abre a loja em HTTPS (ou localhost). Sem contexto seguro o browser não pede a câmera.",
    errMediaDevices: "Este browser não expõe a câmera aqui. Experimenta Chrome/Edge actualizado ou outro perfil.",
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
    errHttps: "Open the store over HTTPS (or localhost). Without a secure context the browser won't prompt for the camera.",
    errMediaDevices: "This browser doesn't expose the camera here. Try an updated Chrome/Edge or another profile.",
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
    errHttps: "Abre la tienda en HTTPS (o localhost). Sin contexto seguro el navegador no pedirá la cámara.",
    errMediaDevices: "Este navegador no expone la cámara aquí. Prueba Chrome/Edge actualizado u otro perfil.",
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
    /* Temas que metem × via ::before/::after em <button> — sem isto parecem dois X sobrepostos. */
    /* `div[role=button]` evita regras globais do tema em `button::before` (X duplicado). */
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
    const [threeMod, gltfModule, mindFaceMod] = await getOmafitArModuleBundle();
    const THREE =
      threeMod.default && typeof threeMod.default.Group === "function" ? threeMod.default : threeMod;
    const { GLTFLoader } = gltfModule;
    const MindARThree = mindFaceMod.MindARThree || mindFaceMod.default;

    const arCfg = typeof document !== "undefined" ? document.getElementById("omafit-ar-root") : null;
    const embedCfg = typeof document !== "undefined" ? document.getElementById("omafit-widget-root") : null;
    /** Valor não vazio em `#omafit-widget-root` sobrepõe `#omafit-ar-root` (evita só o wear no embed e o resto “partido”). */
    function cfgAttr(camelKey, fallback = "") {
      const ek = embedCfg?.dataset?.[camelKey];
      if (ek !== undefined && String(ek).trim() !== "") return String(ek).trim();
      const ak = arCfg?.dataset?.[camelKey];
      if (ak !== undefined && String(ak).trim() !== "") return String(ak).trim();
      return String(fallback ?? "").trim();
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

    const fMin = Number(String(cfgAttr("arMindarFilterMinCf", "")).trim());
    const fBeta = Number(String(cfgAttr("arMindarFilterBeta", "")).trim());
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

    /**
     * O MindAR já coloca o grupo no referencial do landmark (ex. 168); não usar os Euler por defeito
     * do antigo modo VTG/MediaPipe — duplicavam correção com GLBs já canonicalizados e “entortavam” no AR.
     * `data-ar-glb-yxz` / `data-ar-model-yxz`: só quando precisares de ajuste fino por export.
     */
    const rawGlb = cfgAttr("arGlbYxz", "");
    const rawModel = cfgAttr("arModelYxz", "");
    const glbDeg = parseEulerDegComponents(rawGlb || rawModel, 0, 0, 0);
    const poseCorrDeg = parseEulerDegComponents(cfgAttr("arPoseCorrYxz", ""), 0, 0, 0);
    const scaleMulRaw = cfgAttr("arMindarModelScale", "");
    const nScale = Number(scaleMulRaw);
    const modelScaleMul = Number.isFinite(nScale) && nScale > 0 ? nScale : 1;

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
     * GLBs gerados pela app Omafit já passam por `canonicalizeArEyewearGlbBuffer` (nó `omafit_ar_canonical`).
     * Aplicar `glbWideAlign` em cima disso duplica a rotação e deixa o modelo “de lado” / invertido no widget.
     */
    let hasOmafitCanonicalNode = false;
    glasses.traverse((obj) => {
      if (obj && obj.name === "omafit_ar_canonical") hasOmafitCanonicalNode = true;
    });
    const skipGlbWideAlignAttr = /^1|true|on$/i.test(cfgAttr("arMindarSkipGlbWideAlign", "").toLowerCase());
    const skipGlbWideAlign = hasOmafitCanonicalNode || skipGlbWideAlignAttr;

    /** Um frame: materiais/morphs/skin a estabilizar antes do `Box3` (bbox mais fiável no 1.º render). */
    await new Promise((resolve) => requestAnimationFrame(resolve));
    glasses.updateMatrixWorld(true);

    /**
     * MindAR espera largura da armação ~eixo X da âncora. Só para GLB **sem** canónico Omafit / sem largura em X.
     */
    const glbWideAlign = new GroupCtor();
    glbWideAlign.rotation.order = "YXZ";
    glasses.updateMatrixWorld(true);
    const boxPre = new THREE.Box3().setFromObject(glasses);
    const szPre = boxPre.getSize(new THREE.Vector3());
    const wx = szPre.x;
    const wy = szPre.y;
    const wz = szPre.z;
    /**
     * Margem alta: GLBs canónicos (largura ≈ X) não devem apanhar rotação extra — evita “virado”/lado.
     * Sentidos −90° (em vez de +90°) alinham Tripo/Omafit típicos ao eixo X esperado pelo MindAR na âncora 168.
     */
    const tol = 1.38;
    const xAxisAlreadyWidth = wx >= wy && wx >= wz;
    if (!skipGlbWideAlign && !xAxisAlreadyWidth) {
      /** Z maior → largura na profundidade: −90° Y mapeia +Z local → +X (referencial rosto). */
      if (wz > wx * tol && wz >= wy) {
        glbWideAlign.rotation.y = -Math.PI / 2;
      } else if (wy > wx * tol && wy >= wz) {
        /** Y maior (armação “em pé”): −90° Z alinha largura ao eixo X sem inclinar para a “esquerda”. */
        glbWideAlign.rotation.z = -Math.PI / 2;
      }
    }
    glbWideAlign.add(glasses);

    // --- Sign disambiguation (runtime) ---
    // Analysis uses WORLD-space vertex positions (after glbWideAlign + any
    // parent transforms like omafit_ar_canonical).  The bake must convert
    // the world-space rotation into each mesh's LOCAL geometry space:
    //   localBake = inv(meshWorldMat) * worldBake * meshWorldMat
    const sfOverride = cfgAttr("arCanonicalFixYxz", "").trim();
    let _sfFlipY = false, _sfFlipZ = false;
    function bakeWorldRotationIntoGeometries(worldMat) {
      glasses.traverse((obj) => {
        if (!obj.isMesh || !obj.geometry) return;
        obj.updateMatrixWorld(true);
        const wm = obj.matrixWorld;
        const wmInv = wm.clone().invert();
        const localBake = wmInv.clone().multiply(worldMat).multiply(wm);
        obj.geometry.applyMatrix4(localBake);
      });
    }
    if (sfOverride) {
      const sfD = parseEulerDegComponents(sfOverride, 0, 0, 0);
      const sfBakeMat = new THREE.Matrix4();
      sfBakeMat.makeRotationFromEuler(new THREE.Euler(rad(sfD.x), rad(sfD.y), rad(sfD.z), "YXZ"));
      glbWideAlign.updateMatrixWorld(true);
      bakeWorldRotationIntoGeometries(sfBakeMat);
    } else {
      glbWideAlign.updateMatrixWorld(true);
      const sfPos = [];
      glasses.traverse((obj) => {
        if (!obj.isMesh || !obj.geometry) return;
        const pa = obj.geometry.getAttribute("position");
        if (!pa) return;
        obj.updateMatrixWorld(true);
        const wm = obj.matrixWorld;
        for (let i = 0; i < pa.count; i++) {
          const vv = new THREE.Vector3(pa.getX(i), pa.getY(i), pa.getZ(i));
          vv.applyMatrix4(wm);
          sfPos.push(vv);
        }
      });
      if (sfPos.length > 16) {
        const sfB = new THREE.Box3();
        for (const v of sfPos) sfB.expandByPoint(v);
        const sfC = sfB.getCenter(new THREE.Vector3());
        const sfS = sfB.getSize(new THREE.Vector3());
        const shw = sfS.x / 2, shh = sfS.y / 2, shd = sfS.z / 2;
        if (shh > 1e-6 && shw > 1e-6 && shd > 1e-6) {
          const cb = sfPos.filter((v) => Math.abs(v.x - sfC.x) < shw * 0.35);
          if (cb.length > 8) {
            const tC = cb.filter((v) => v.y > sfC.y);
            const bC = cb.filter((v) => v.y < sfC.y);
            if (tC.length > 2 && bC.length > 2) {
              const tZS = Math.max(...tC.map((v) => v.z)) - Math.min(...tC.map((v) => v.z));
              const bZS = Math.max(...bC.map((v) => v.z)) - Math.min(...bC.map((v) => v.z));
              if (tZS > bZS * 1.08) _sfFlipY = true;
            }
          }
          if (!_sfFlipY && sfPos.length > 20) {
            const sortedY = sfPos.slice().sort((a, b) => a.y - b.y);
            const sn = Math.max(8, Math.floor(sortedY.length * 0.08));
            const bSlice = sortedY.slice(0, sn);
            const tSlice = sortedY.slice(sortedY.length - sn);
            const tXSp = Math.max(...tSlice.map((v) => v.x)) - Math.min(...tSlice.map((v) => v.x));
            const bXSp = Math.max(...bSlice.map((v) => v.x)) - Math.min(...bSlice.map((v) => v.x));
            if (tXSp > bXSp * 1.08) _sfFlipY = true;
          }
          const outer = sfPos.filter((v) => Math.abs(v.x - sfC.x) > shw * 0.6);
          if (outer.length > 4) {
            const zv = outer.map((v) => v.z - sfC.z).sort((a, b) => Math.abs(b) - Math.abs(a));
            const topN = zv.slice(0, Math.max(4, Math.floor(zv.length * 0.15)));
            const mez = topN.reduce((s, z) => s + z, 0) / topN.length;
            if (mez < -shd * 0.12) _sfFlipZ = true;
          }
        }
        let sfBakeMat = null;
        if (_sfFlipY && _sfFlipZ) sfBakeMat = new THREE.Matrix4().makeRotationX(Math.PI);
        else if (_sfFlipY) sfBakeMat = new THREE.Matrix4().makeRotationZ(Math.PI);
        else if (_sfFlipZ) sfBakeMat = new THREE.Matrix4().makeRotationY(Math.PI);
        if (sfBakeMat) {
          bakeWorldRotationIntoGeometries(sfBakeMat);
        }
      }
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
    /** Escala ~largura facial; `faceScale` do MindAR (metric) afinará no 1.º frame com face. */
    const baseUnitScale = (0.085 / maxDim) * modelScaleMul;
    // position = -scale * pivot so that: position + scale * pivot = 0.
    autoOrient.position.set(
      -center.x * baseUnitScale,
      -center.y * baseUnitScale,
      -center.z * baseUnitScale,
    );
    autoOrient.scale.setScalar(baseUnitScale);
    autoOrient.userData._omafitMaxDim = maxDim;
    autoOrient.userData._omafitBaseUnitScale = baseUnitScale;
    autoOrient.userData._omafitPivot = center.clone();

    const poseCorr = new GroupCtor();
    poseCorr.rotation.order = "YXZ";
    poseCorr.rotation.set(rad(poseCorrDeg.x), rad(poseCorrDeg.y), rad(poseCorrDeg.z));
    const glbBind = new GroupCtor();
    glbBind.rotation.order = "YXZ";
    glbBind.rotation.set(rad(glbDeg.x), rad(glbDeg.y), rad(glbDeg.z));
    const wearPosRaw = cfgAttr("arMindarWearPosition", "");
    const wearPosM = parseXyzMeters(wearPosRaw, 0, 0, 0);
    const wearPosition = new GroupCtor();
    wearPosition.position.set(wearPosM.x, wearPosM.y, wearPosM.z);
    wearPosition.add(autoOrient);
    glbBind.add(wearPosition);
    poseCorr.add(glbBind);

    /** Euler wear manual (vazio = identidade); eixo largura + espelho X tratam-se em `glbWideAlign` / `mirrorX`. */
    /** Euler wear: #omafit-widget-root tem prioridade; depois #omafit-ar-root. */
    const wearRaw = cfgAttr("arMindarWearYxz", "");
    const wearDeg = parseEulerDegComponents(wearRaw, 0, 0, 0);
    const disableIpdSnap = /^1|true|on$/i.test(cfgAttr("arMindarDisableIpdSnap", "").toLowerCase());
    const wearAlign = new GroupCtor();
    wearAlign.rotation.order = "YXZ";
    /** Com IPD snap o Euler wear entra no quaternion de `ipdSnap` (evita duplicar rotação). */
    if (disableIpdSnap) {
      wearAlign.rotation.set(rad(wearDeg.x), rad(wearDeg.y), rad(wearDeg.z));
    } else {
      wearAlign.rotation.set(0, 0, 0);
    }

    /** Motor VTG: invertia a pose; no MindAR ≈ girar 180° em Y no modelo relativamente à âncora. */
    const invertQ = /^1|true|on$/i.test(cfgAttr("arInvertPoseQuat", "").toLowerCase());
    const poseInvert = new GroupCtor();
    if (invertQ) {
      poseInvert.rotation.order = "YXZ";
      poseInvert.rotation.set(0, Math.PI, 0);
    }

    /**
     * Espelho X: com alinhamento IPD activo o defeito é +1 (o snap corrige o eixo); sem IPD mantém −1 se não `skip-default-x-flip`.
     * `data-ar-scene-x-mirror` / `data-ar-flip-ipd-axis` invertem o sinal (ambos 1 → +1).
     */
    const skipDefXFlip = /^1|true|on$/i.test(cfgAttr("arMindarSkipDefaultXFlip", "").toLowerCase());
    const sceneXM = /^1|true|on$/i.test(cfgAttr("arSceneXMirror", "").toLowerCase());
    const flipIpd = /^1|true|on$/i.test(cfgAttr("arFlipIpdAxis", "").toLowerCase());
    /**
     * Troca 33↔263: o vector interpupilar fica oposto; corrige óculos “invertidos” quando
     * `disableFaceMirror` + `skip-default-x-flip` não coincidem com o referencial do MindAR.
     */
    const ipdSwapEnds = /^1|true|on$/i.test(cfgAttr("arIpdSwapEnds", "").toLowerCase());
    /**
     * Com IPD snap o alinhamento quaternion já orienta +X à linha interpupilar; o defeito antigo (+1)
     * deixava alguns GLB canónicos espelhados / “de lado”. −1 alinha ao mesmo referencial que sem IPD.
     */
    let mirrorSign = disableIpdSnap ? (skipDefXFlip ? 1 : -1) : skipDefXFlip ? 1 : -1;
    if (sceneXM) mirrorSign *= -1;
    if (flipIpd) mirrorSign *= -1;
    const mirrorX = new GroupCtor();
    if (mirrorSign < 0) mirrorX.scale.x = -1;
    mirrorX.add(poseCorr);
    poseInvert.add(mirrorX);
    wearAlign.add(poseInvert);

    /** Alinha +X do modelo ao vetor interpupilar (MediaPipe 468: 33 → 263) no espaço local da âncora. */
    const ipdSnap = new GroupCtor();
    ipdSnap.name = "omafit_ipd_snap";
    const _vX = new THREE.Vector3(1, 0, 0);
    const _u = new THREE.Vector3();
    const _invAnchorWorld = new THREE.Matrix4();
    const _qSnap = new THREE.Quaternion();
    const _qWear = new THREE.Quaternion();
    const _eulerWear = new THREE.Euler(0, 0, 0, "YXZ");
    /** Mesma transl. que `getLandmarkMatrix` do MindAR (coluna de transl., sem escala em t). */
    function landmarkWorldPos(fm, idx, ml) {
      if (!fm || !ml || idx < 0 || idx >= ml.length) return null;
      const t = ml[idx];
      if (!t || t.length < 3) return null;
      return new THREE.Vector3(
        fm[0] * t[0] + fm[1] * t[1] + fm[2] * t[2] + fm[3],
        fm[4] * t[0] + fm[5] * t[1] + fm[6] * t[2] + fm[7],
        fm[8] * t[0] + fm[9] * t[1] + fm[10] * t[2] + fm[11],
      );
    }
    const LM_IPD_RIGHT = 33;
    const LM_IPD_LEFT = 263;

    ipdSnap.add(wearAlign);
    anchor.group.add(ipdSnap);

    const { renderer, scene, camera } = mindarThree;
    let didFaceScaleBlend = false;
    const useFs = /^1|true|on$/i.test(cfgAttr("arMindarUseFaceScale", "").toLowerCase());
    renderer.setAnimationLoop(() => {
      const estLoop =
        typeof mindarThree.getLatestEstimate === "function" ? mindarThree.getLatestEstimate() : null;
      /** Até haver `metricLandmarks`, `ipdSnap.quaternion` fica identidade — 1–2 frames podem parecer “desalinhados”. */
      if (!disableIpdSnap) {
        const ml = estLoop && estLoop.metricLandmarks;
        const fm = estLoop && estLoop.faceMatrix;
        if (ml && fm && Array.isArray(ml) && ml.length > LM_IPD_LEFT) {
          const idxA = ipdSwapEnds ? LM_IPD_LEFT : LM_IPD_RIGHT;
          const idxB = ipdSwapEnds ? LM_IPD_RIGHT : LM_IPD_LEFT;
          const pA = landmarkWorldPos(fm, idxA, ml);
          const pB = landmarkWorldPos(fm, idxB, ml);
          if (pA && pB && pA.distanceToSquared(pB) > 1e-12) {
            const vW = pB.clone().sub(pA).normalize();
            anchor.group.updateMatrixWorld(true);
            _invAnchorWorld.copy(anchor.group.matrixWorld).invert();
            const dA = vW.clone().transformDirection(_invAnchorWorld).normalize();
            if (dA.lengthSq() > 0.04) {
              _eulerWear.set(rad(wearDeg.x), rad(wearDeg.y), rad(wearDeg.z), "YXZ");
              _qWear.setFromEuler(_eulerWear);
              _u.copy(_vX).applyQuaternion(_qWear);
              _qSnap.setFromUnitVectors(_u, dA);
              if (Math.abs(_u.dot(dA) + 1) < 1e-4) {
                _qSnap.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
              }
              ipdSnap.quaternion.copy(_qSnap).multiply(_qWear);
            }
          }
        }
      }
      if (useFs && !didFaceScaleBlend) {
        const fs = estLoop && Number(estLoop.faceScale);
        if (Number.isFinite(fs) && fs > 1e-6) {
          const md = autoOrient.userData._omafitMaxDim;
          const base = autoOrient.userData._omafitBaseUnitScale;
          if (Number.isFinite(md) && md > 0 && Number.isFinite(base)) {
            /** `faceScale` ≈ largura facial métrica; alinhar largura do GLB (~1 após bbox) ao rosto. */
            const k = 1.15;
            const newScale = (k * fs) / md;
            autoOrient.scale.setScalar(newScale);
            const pivot = autoOrient.userData._omafitPivot;
            if (pivot) {
              autoOrient.position.set(
                -pivot.x * newScale,
                -pivot.y * newScale,
                -pivot.z * newScale,
              );
            }
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
        mindarWearPositionM: wearPosM,
        mindarWearPositionFrom: embedCfg?.dataset?.arMindarWearPosition != null &&
          String(embedCfg.dataset.arMindarWearPosition).trim() !== ""
          ? "omafit-widget-root"
          : (arCfg?.dataset?.arMindarWearPosition != null &&
                String(arCfg.dataset.arMindarWearPosition).trim() !== ""
              ? "omafit-ar-root"
              : "none"),
        ipdSwapEnds,
        mindarWearYxz: wearDeg,
        mindarWearRawEmpty: wearRaw.length === 0,
        mindarDisableIpdSnap: disableIpdSnap,
        mindarSkipDefaultXFlip: skipDefXFlip,
        glbWideAlignRad: {
          x: glbWideAlign.rotation.x,
          y: glbWideAlign.rotation.y,
          z: glbWideAlign.rotation.z,
        },
        hasOmafitCanonicalNode,
        skipGlbWideAlign,
        signFixFlipY: _sfFlipY,
        signFixFlipZ: _sfFlipZ,
        signFixOverride: sfOverride || null,
        xAxisAlreadyWidth,
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
  const primaryColor =
    (adminBrand?.primary || root.dataset.primaryColor || "#810707").trim().replace(/[<>]/g, "") ||
    "#810707";
  const productTitle = root.dataset.productTitle || "Produto";
  const productImage = root.dataset.productImage || "";
  let logoUrl = (
    adminBrand?.storeLogo ||
    (root.dataset.storeLogo || root.getAttribute("data-store-logo") || "").trim()
  ).trim();
  if (logoUrl.startsWith("//")) logoUrl = `https:${logoUrl}`;
  const shopName = (root.dataset.shopName || root.getAttribute("data-shop-name") || "").trim();
  const linkText =
    (adminBrand?.linkText || root.dataset.linkText || "Experimentar óculos (AR)").trim() ||
    "Experimentar óculos (AR)";
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
