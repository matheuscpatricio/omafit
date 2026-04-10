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

function injectGlobalStyles() {
  if (document.getElementById("omafit-ar-styles")) return;
  const root = document.getElementById("omafit-ar-root");
  const customFont = root?.dataset?.fontFamily?.trim();
  const shellFont = customFont
    ? customFont.replace(/[<>]/g, "")
    : "'Outfit', system-ui, sans-serif";
  const s = document.createElement("style");
  s.id = "omafit-ar-styles";
  s.textContent = `
    @keyframes omafit-ar-fade-in { from { opacity: 0; } to { opacity: 1; } }
    .omafit-ar-shell { animation: omafit-ar-fade-in 0.35s ease-out; font-family: ${shellFont}; }
    .omafit-ar-link:hover { opacity: 0.7; text-decoration-thickness: 2px; }
    .omafit-ar-try-on-link:focus { outline: 2px solid #810707; outline-offset: 2px; }
  `;
  document.head.appendChild(s);
  if (
    !customFont &&
    !document.querySelector('link[href*="Outfit"][href*="fonts.googleapis"]')
  ) {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href =
      "https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap";
    document.head.appendChild(l);
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

function buildInfoModal({ primaryColor, logoUrl, productTitle, productImage, t, onClose, onStartAr }) {
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
      alt: "",
      style: { maxHeight: "48px", width: "auto", objectFit: "contain" },
    });
    logoWrap.appendChild(img);
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
      flex: "1",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "0",
      background: "#111",
      position: "relative",
    },
  });

  /** Área com a mesma proporção do vídeo que `object-fit: contain` usaria — o canvas deve coincidir pixel a pixel com o frame desenhado. */
  const arFit = el("div", {
    style: {
      position: "relative",
      flexShrink: "0",
      overflow: "hidden",
      background: "#000",
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
      transform: "scaleX(-1)",
    },
  });
  const canvas = el("canvas", {
    style: {
      position: "absolute",
      left: "0",
      top: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
    },
  });

  arFit.appendChild(video);
  arFit.appendChild(canvas);
  arWrap.appendChild(arFit);
  arWrap.appendChild(loading);
  colContent.style.padding = "0";
  colContent.style.overflow = "hidden";
  colContent.style.flex = "1";
  colContent.style.display = "flex";
  colContent.style.flexDirection = "column";
  colContent.appendChild(arWrap);

  let stream;
  let raf;
  let renderer;
  let landmarker;
  let arResizeObserver = null;

  const cleanup = () => {
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

    const landmarkerOpts = {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      numFaces: 1,
      minFaceDetectionConfidence: 0.25,
      minFacePresenceConfidence: 0.25,
      minTrackingConfidence: 0.25,
      outputFaceBlendshapes: false,
      /** Matriz canónica→rosto (recomendado para anexar modelos 3D; ver Google AI Edge Face Landmarker). */
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

    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1;

    const scene = new THREE.Scene();
    // FOV ~63° vertical alinha com a câmara intrínseca usada na matriz facial do Face Landmarker (MediaPipe).
    const camera = new THREE.PerspectiveCamera(63, w / h, 0.01, 10);
    camera.position.set(0, 0, 0);
    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.45));

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

    /** Rotação fixa do GLB (graus, ordem YXZ) — alinhamento TripoSR/export “deitado”; sem heurística automática. */
    const modelFix = new THREE.Group();
    modelFix.rotation.order = "YXZ";
    const AR_GLB_ROT_X_DEG = -90;
    const AR_GLB_ROT_Y_DEG = 0;
    const AR_GLB_ROT_Z_DEG = 180;
    const rad = (d) => (d * Math.PI) / 180;
    modelFix.rotation.set(rad(AR_GLB_ROT_X_DEG), rad(AR_GLB_ROT_Y_DEG), rad(AR_GLB_ROT_Z_DEG));
    modelFix.add(autoOrient);

    const faceRoot = new THREE.Group();
    faceRoot.frustumCulled = false;
    faceRoot.add(modelFix);
    scene.add(faceRoot);

    const dirLt = new THREE.DirectionalLight(0xffffff, 0.35);
    dirLt.position.set(0.35, 0.55, 0.45);
    scene.add(dirLt);

    const camZ = 0;
    const zPlane = -0.42;
    const distCamToPlane = camZ - zPlane;
    const zDepthScale = 0.12;
    const frameToIpdRatio = 1.84; // ligeiramente maior para melhor encaixe visual
    // Vídeo está espelhado em CSS para desinverter selfie; compensar no tracking.
    const mirrorSelfie = true;

    function normX(px) {
      return mirrorSelfie ? 1 - px : px;
    }

    function landmarkToWorldOnPlane(p, useZ) {
      if (!p) return null;
      const xn = normX(p.x);
      const ndcX = xn * 2 - 1;
      const ndcY = -(p.y * 2 - 1);
      const vFov = (camera.fov * Math.PI) / 180;
      const halfH = Math.tan(vFov / 2) * distCamToPlane;
      const halfW = halfH * camera.aspect;
      const zz = zPlane + (useZ ? (p.z || 0) * zDepthScale : 0);
      return new THREE.Vector3(ndcX * halfW, ndcY * halfH, zz);
    }

    const poseQuatScratch = new THREE.Quaternion();
    const rotMatScratch = new THREE.Matrix4();
    const tmpUp = new THREE.Vector3();
    const _xAxis = new THREE.Vector3();
    const _yAxis = new THREE.Vector3();
    const _zAxis = new THREE.Vector3();
    const _zWant = new THREE.Vector3();
    const mpMat = new THREE.Matrix4();
    const flipXMat = new THREE.Matrix4();
    const workMat = new THREE.Matrix4();
    const tmpPos = new THREE.Vector3();
    const tmpQuat = new THREE.Quaternion();
    const tmpScl = new THREE.Vector3();
    const smoothPos = new THREE.Vector3();
    const smoothQuat = new THREE.Quaternion();
    let smoothScale = 0.12;
    let poseSmoothReady = false;

    function resetFaceRootTransform() {
      poseSmoothReady = false;
      faceRoot.matrixAutoUpdate = true;
      faceRoot.matrix.identity();
      faceRoot.position.set(0, 0, 0);
      faceRoot.quaternion.set(0, 0, 0, 1);
      faceRoot.scale.set(1, 1, 1);
    }

    /**
     * Pose principal: matriz facial do MediaPipe (canónico → rosto), espelhada em X para coincidir com o vídeo CSS.
     * Fallback: base ortonormal a partir de landmarks (mesma câmara 63° / z=0 que a matriz assume).
     */
    function applyGlassesPose(res) {
      const lm = res.faceLandmarks[0];
      if (!lm) return false;

      const eL = lm[33];
      const eR = lm[263];
      const nose = lm[1];
      if (!eL || !eR || !nose) return false;

      const ipdNorm = Math.hypot(eR.x - eL.x, eR.y - eL.y);
      if (ipdNorm < 0.02) return false;

      const pL = landmarkToWorldOnPlane(eL, false);
      const pR = landmarkToWorldOnPlane(eR, false);
      const ipdWorld = pL.distanceTo(pR);
      const modelNormWidth =
        autoOrient.userData._omafitNormWidth || glasses.userData._omafitNormWidth || 1;
      const faceScale = Math.max(0.06, Math.min(0.28, (ipdWorld * frameToIpdRatio) / modelNormWidth));

      const mtx = res.facialTransformationMatrixes && res.facialTransformationMatrixes[0];
      const raw = mtx && mtx.data;
      const hasMatrix = raw && raw.length === 16;

      if (hasMatrix) {
        mpMat.fromArray(raw);
        flipXMat.makeScale(-1, 1, 1);
        workMat.multiplyMatrices(flipXMat, mpMat);
        workMat.decompose(tmpPos, tmpQuat, tmpScl);

        tmpScl.setScalar(faceScale);

        if (!poseSmoothReady) {
          smoothPos.copy(tmpPos);
          smoothQuat.copy(tmpQuat);
          smoothScale = faceScale;
          poseSmoothReady = true;
        } else {
          smoothPos.lerp(tmpPos, 0.36);
          if (smoothQuat.dot(tmpQuat) < 0) {
            tmpQuat.set(-tmpQuat.x, -tmpQuat.y, -tmpQuat.z, -tmpQuat.w);
          }
          smoothQuat.slerp(tmpQuat, 0.38);
          smoothScale += (faceScale - smoothScale) * 0.32;
        }

        tmpScl.setScalar(smoothScale);
        workMat.compose(smoothPos, smoothQuat, tmpScl);
        faceRoot.matrixAutoUpdate = false;
        faceRoot.matrix.copy(workMat);
        return true;
      }

      faceRoot.matrixAutoUpdate = true;

      const pBridge = lm[168] ? landmarkToWorldOnPlane(lm[168], true) : null;
      const midEyes = new THREE.Vector3().addVectors(pL, pR).multiplyScalar(0.5);
      const anchor = pBridge || midEyes;

      const pNose = landmarkToWorldOnPlane(nose, false);
      tmpUp.subVectors(midEyes, pNose);
      if (tmpUp.lengthSq() < 1e-14) return false;
      tmpUp.normalize();

      _xAxis.subVectors(pR, pL);
      if (_xAxis.lengthSq() < 1e-14) return false;
      _xAxis.normalize();

      _zWant.subVectors(camera.position, anchor);
      if (_zWant.lengthSq() < 1e-14) return false;
      _zWant.normalize();

      if (Math.abs(tmpUp.dot(_zWant)) > 0.985) return false;

      _yAxis.crossVectors(_zWant, _xAxis);
      if (_yAxis.lengthSq() < 1e-14) return false;
      _yAxis.normalize();
      if (_yAxis.dot(tmpUp) < 0) _yAxis.negate();

      _zAxis.crossVectors(_xAxis, _yAxis);
      if (_zAxis.lengthSq() < 1e-14) return false;
      _zAxis.normalize();
      if (_zAxis.dot(_zWant) < 0) {
        _yAxis.negate();
        _zAxis.crossVectors(_xAxis, _yAxis).normalize();
      }

      rotMatScratch.makeBasis(_xAxis, _yAxis, _zAxis);
      poseQuatScratch.setFromRotationMatrix(rotMatScratch);

      const targetPos = anchor.clone();
      targetPos.addScaledVector(_yAxis, -0.008);
      targetPos.addScaledVector(_zAxis, 0.014);

      faceRoot.position.lerp(targetPos, 0.38);
      faceRoot.quaternion.slerp(poseQuatScratch, 0.38);
      const s = faceRoot.scale.x || faceScale;
      faceRoot.scale.setScalar(s + (faceScale - s) * 0.32);
      return true;
    }

    faceRoot.visible = false;

    function frame() {
      raf = requestAnimationFrame(frame);
      if (!landmarker || !video.videoWidth) {
        renderer.render(scene, camera);
        return;
      }
      const ts = Math.round(performance.now());
      const res = landmarker.detectForVideo(video, ts);
      if (!res.faceLandmarks || !res.faceLandmarks[0]) {
        faceRoot.visible = false;
        resetFaceRootTransform();
        renderer.render(scene, camera);
        return;
      }

      const ok = applyGlassesPose(res);
      faceRoot.visible = ok;
      if (!ok) resetFaceRootTransform();
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

async function main() {
  const root = document.getElementById("omafit-ar-root");
  if (!root) return;

  const glbUrl = root.dataset.glbUrl;
  if (!glbUrl) return;

  const primaryColor = root.dataset.primaryColor || "#810707";
  const productTitle = root.dataset.productTitle || "Produto";
  const productImage = root.dataset.productImage || "";
  const logoUrl = root.dataset.storeLogo || "";
  const linkText = root.dataset.linkText || "Experimentar óculos (AR)";
  const lang = pickLocale(root.dataset.locale);
  const t = COPY[lang] || COPY.pt;
  const autoOpen =
    root.dataset.autoOpen === "1" || root.getAttribute("data-auto-open") === "1";

  injectGlobalStyles();
  const themeFont = root.dataset.fontFamily?.trim();
  if (themeFont) {
    root.style.fontFamily = themeFont;
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
    modal = buildInfoModal({
      primaryColor,
      logoUrl,
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
  });
}

if (typeof window !== "undefined") {
  window.__omafitArStart = startOmafitAr;
}

/** Com arGlbUrl na query (iframe Netlify), o React chama __omafitArStart após montar #omafit-ar-root. */
if (!hasArGlbUrlQueryParam()) {
  startOmafitAr();
}
