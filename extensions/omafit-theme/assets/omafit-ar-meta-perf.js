/**
 * Meta Reality Labs — práticas Web/WebXR aplicadas ao Omafit AR (browser + Quest).
 * Ref.: Meta WebXR Performance Optimization Workflow (frame budget, DPR adaptativo).
 */

/** Orçamentos de frame (ms) — Meta Quest Browser ~72 Hz; mobile ~60/30 Hz. */
export const OMAFIT_META_FRAME_BUDGET_MS = {
  quest72: 13.7,
  mobile60: 16.6,
  mobile30: 33.3,
};

/** Alvo de draw calls em headsets Meta (guia IWSDK / perf workflow). */
export const OMAFIT_META_DRAW_CALL_TARGET = 100;

/**
 * Meta Quest Browser (UA: `OculusBrowser`, token `Quest N`).
 * Não substitui feature detection — só perfil de GPU/câmara.
 * @returns {boolean}
 */
export function omafitDetectMetaQuestBrowser() {
  if (typeof navigator === "undefined") return false;
  const ua = String(navigator.userAgent || "");
  return /OculusBrowser/i.test(ua) || /\bQuest\s*\d/i.test(ua);
}

/**
 * @param {{ questBrowser?: boolean, perfTier?: string }} profile
 * @returns {number}
 */
export function omafitMetaFrameBudgetMs(profile) {
  if (profile?.questBrowser) return OMAFIT_META_FRAME_BUDGET_MS.quest72;
  const tier = String(profile?.perfTier || "medium");
  if (tier === "low") return OMAFIT_META_FRAME_BUDGET_MS.mobile30;
  return OMAFIT_META_FRAME_BUDGET_MS.mobile60;
}

/**
 * Degradação adaptativa de DPR quando o tempo de frame excede o orçamento Meta.
 * Libera GPU → tracking MediaPipe/MindAR recebe frames mais regulares.
 *
 * @param {{
 *   disabled?: boolean,
 *   budgetMs?: number,
 *   getMaxDpr: () => number,
 *   getRenderer: () => { setPixelRatio?: (n: number) => void } | null,
 * }} opts
 */
export function omafitCreateMetaFrameBudgetGovernor(opts) {
  const disabled = Boolean(opts?.disabled);
  const budgetMs = Math.max(8, Number(opts?.budgetMs) || OMAFIT_META_FRAME_BUDGET_MS.mobile60);
  const samples = [];
  const SAMPLE_MAX = 28;
  const WARMUP_SAMPLES = 14;
  let lastTs = 0;
  let currentCap = NaN;
  let overStreak = 0;
  let underStreak = 0;

  function maxDpr() {
    return Math.max(1, Number(opts.getMaxDpr()) || 1.5);
  }

  function applyCap(cap) {
    const r = opts.getRenderer?.();
    if (!r?.setPixelRatio || typeof window === "undefined") return;
    const dpr = window.devicePixelRatio || 1;
    r.setPixelRatio(Math.min(dpr, cap));
  }

  return {
    reset() {
      lastTs = 0;
      currentCap = NaN;
      samples.length = 0;
      overStreak = 0;
      underStreak = 0;
    },
    /** Uma chamada por frame (antes do render). */
    step() {
      if (disabled || typeof performance === "undefined") return;
      const now = performance.now();
      if (lastTs > 0) {
        samples.push(now - lastTs);
        if (samples.length > SAMPLE_MAX) samples.shift();
        if (samples.length >= WARMUP_SAMPLES) {
          const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
          const ceiling = maxDpr();
          if (!Number.isFinite(currentCap)) currentCap = ceiling;

          if (avg > budgetMs * 1.18) {
            overStreak += 1;
            underStreak = 0;
            if (overStreak >= 3 && currentCap > 1) {
              currentCap = Math.max(1, Math.round((currentCap - 0.1) * 100) / 100);
              applyCap(currentCap);
              overStreak = 0;
            }
          } else if (avg < budgetMs * 0.8) {
            underStreak += 1;
            overStreak = 0;
            if (underStreak >= 10 && currentCap < ceiling - 0.04) {
              currentCap = Math.min(ceiling, Math.round((currentCap + 0.05) * 100) / 100);
              applyCap(currentCap);
              underStreak = 0;
            }
          } else {
            overStreak = Math.max(0, overStreak - 1);
            underStreak = Math.max(0, underStreak - 1);
          }
        }
      }
      lastTs = now;
    },
    getCurrentDprCap() {
      return Number.isFinite(currentCap) ? currentCap : maxDpr();
    },
  };
}

/**
 * @param {boolean} cfgDisabled `data-ar-meta-adaptive-dpr="0"`
 * @param {{ questBrowser?: boolean, perfTier?: string }} profile
 */
export function omafitMetaAdaptiveDprDisabled(cfgDisabled, profile) {
  if (cfgDisabled) return true;
  void profile;
  return false;
}

/**
 * DPR efectivo = min(device, perfil, governor adaptativo Meta).
 * @param {number} deviceDpr
 * @param {number} profileMaxCap
 * @param {{ getCurrentDprCap?: () => number } | null} [governor]
 */
export function omafitMetaEffectivePixelRatio(deviceDpr, profileMaxCap, governor) {
  const dpr = Math.max(1, Number(deviceDpr) || 1);
  let cap = Math.max(1, Number(profileMaxCap) || 1.5);
  const gov = governor?.getCurrentDprCap?.();
  if (Number.isFinite(gov) && gov >= 1) cap = Math.min(cap, gov);
  return Math.min(dpr, cap);
}

/**
 * @param {{ setPixelRatio?: (n: number) => void } | null} renderer
 * @param {number} profileMaxCap
 * @param {{ getCurrentDprCap?: () => number } | null} [governor]
 */
export function omafitApplyMetaRendererPixelRatio(renderer, profileMaxCap, governor) {
  if (!renderer?.setPixelRatio || typeof window === "undefined") return;
  const dpr = window.devicePixelRatio || 1;
  renderer.setPixelRatio(
    omafitMetaEffectivePixelRatio(dpr, profileMaxCap, governor),
  );
}

/**
 * Hints pós-criação do WebGLRenderer (Meta: menos trabalho por frame).
 * @param {import("three").WebGLRenderer | null | undefined} renderer
 */
export function omafitApplyMetaRendererPresentationHints(renderer) {
  if (!renderer) return;
  try {
    renderer.sortObjects = true;
    if ("useLegacyLights" in renderer) renderer.useLegacyLights = true;
    else if ("physicallyCorrectLights" in renderer) renderer.physicallyCorrectLights = false;
    if (renderer.shadowMap) renderer.shadowMap.enabled = false;
  } catch {
    /* ignore */
  }
}

/**
 * Presets MindAR One Euro — mais estáveis no Quest Browser (tracking + GPU).
 * @param {{ questBrowser?: boolean, perfTier?: string }} profile
 * @param {string} accessoryType
 * @param {{ minCF?: number, beta?: number }} [defaults]
 */
export function omafitMetaMindarFilterPreset(profile, accessoryType, defaults = {}) {
  const glassesLike =
    accessoryType === "glasses" ||
    accessoryType === "necklace" ||
    Boolean(profile?.questBrowser);
  const baseMin = glassesLike ? 0.00011 : 0.00052;
  const baseBeta = glassesLike ? 0.94 : 0.91;
  if (profile?.questBrowser && !glassesLike) {
    return {
      minCF: defaults.minCF ?? 0.00035,
      beta: defaults.beta ?? 0.92,
    };
  }
  if (profile?.questBrowser && profile?.perfTier === "low") {
    return {
      minCF: defaults.minCF ?? Math.min(baseMin, 0.00009),
      beta: defaults.beta ?? Math.max(baseBeta, 0.95),
    };
  }
  return {
    minCF: defaults.minCF ?? baseMin,
    beta: defaults.beta ?? baseBeta,
  };
}

/**
 * @param {{ questBrowser?: boolean, perfTier?: string }} profile
 * @returns {{ near: number, far: number }}
 */
export function omafitMetaHandCameraClipping(profile) {
  if (profile?.questBrowser) {
    return profile?.perfTier === "high"
      ? { near: 0.022, far: 80 }
      : { near: 0.028, far: 45 };
  }
  if (profile?.perfTier === "low") return { near: 0.028, far: 45 };
  return { near: 0.02, far: 100 };
}

let lastDrawWarnMs = 0;

/**
 * Aviso throttled se draw calls > alvo Meta (só com `?omafit_ar_debug_perf=1`).
 * @param {import("three").WebGLRenderer | null | undefined} renderer
 */
export function omafitMetaMaybeWarnDrawCalls(renderer) {
  try {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search || "").get("omafit_ar_debug_perf") !== "1") {
      return;
    }
    const calls = renderer?.info?.render?.calls;
    if (!Number.isFinite(calls) || calls <= OMAFIT_META_DRAW_CALL_TARGET) return;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (now - lastDrawWarnMs < 4000) return;
    lastDrawWarnMs = now;
    console.warn(
      `[omafit-ar][meta] draw calls=${calls} (alvo Meta <${OMAFIT_META_DRAW_CALL_TARGET}) — reduzir materiais/malhas de oclusão.`,
    );
  } catch {
    /* ignore */
  }
}
