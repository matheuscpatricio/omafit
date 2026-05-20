/**
 * Calibração AR — funções puras (cliente + servidor).
 * Não importar módulos `.server.js` daqui.
 */

import {
  normalizeAccessoryType,
  AR_ACCESSORY_TYPE_DEFAULT,
} from "./ar-accessory-type.shared.js";

/** Posições de rotação expostas no admin (graus) — pulseira e outros tipos não-óculos. */
export const AR_ROTATION_PRESET_DEGREES = Object.freeze([-90, 0, 90]);

/** Óculos: intervalo e passo dos sliders de rotação na calibração. */
export const AR_GLASSES_ROTATION_MIN_DEG = -180;
export const AR_GLASSES_ROTATION_MAX_DEG = 180;
export const AR_GLASSES_ROTATION_STEP_DEG = 5;

/**
 * Arredonda para o múltiplo de 5° mais próximo e limita a [−180, 180].
 * Usado nos sliders de óculos e ao guardar calibração de eyewear.
 */
export function snapArRotationFineDeg(deg) {
  const n = Number(deg);
  if (!Number.isFinite(n)) return 0;
  const clamped = Math.min(
    AR_GLASSES_ROTATION_MAX_DEG,
    Math.max(AR_GLASSES_ROTATION_MIN_DEG, n),
  );
  const snapped = Math.round(clamped / AR_GLASSES_ROTATION_STEP_DEG) * AR_GLASSES_ROTATION_STEP_DEG;
  if (snapped > AR_GLASSES_ROTATION_MAX_DEG) return AR_GLASSES_ROTATION_MAX_DEG;
  if (snapped < AR_GLASSES_ROTATION_MIN_DEG) return AR_GLASSES_ROTATION_MIN_DEG;
  return snapped;
}

/**
 * Arredonda para a posição pré-definida mais próxima (−90°, 0°, 90°).
 * Usado nos sliders da página de calibração e ao guardar rotação.
 */
export function snapArRotationPresetDeg(deg) {
  const n = Number(deg);
  if (!Number.isFinite(n)) return 0;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < AR_ROTATION_PRESET_DEGREES.length; i++) {
    const p = AR_ROTATION_PRESET_DEGREES[i];
    const d = Math.abs(n - p);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

function snapRotationDegForAccessoryType(deg, accessoryType) {
  const type = normalizeAccessoryType(accessoryType) || AR_ACCESSORY_TYPE_DEFAULT;
  if (type === "glasses") return snapArRotationFineDeg(deg);
  return snapArRotationPresetDeg(deg);
}

export function sanitizeArCalibrationInput(raw, accessoryType) {
  const src = raw && typeof raw === "object" ? raw : {};
  const num = (v, def) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  };
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const snapRot = (v) =>
    snapRotationDegForAccessoryType(clamp(num(v, 0), -180, 180), accessoryType);
  return {
    rx: snapRot(src.rx),
    ry: snapRot(src.ry),
    rz: snapRot(src.rz),
    bridgeY: clamp(num(src.bridgeY, 0), -0.5, 0.5),
    wearX: clamp(num(src.wearX, 0), -0.1, 0.1),
    wearY: clamp(num(src.wearY, 0), -0.15, 0.15),
    wearZ: clamp(num(src.wearZ, 0), -0.1, 0.1),
    scale: clamp(num(src.scale, 1), 0.3, 3),
  };
}

const AR_CALIBRATION_DEFAULTS_BY_TYPE = {
  glasses: {},
  necklace: { wearY: -0.12 },
  watch: { scale: 1, wearY: 0 },
  bracelet: { scale: 1.1, wearY: 0 },
};

const DEFAULT_AR_CALIBRATION = sanitizeArCalibrationInput({});

export function defaultArCalibration(accessoryType) {
  const type = normalizeAccessoryType(accessoryType) || AR_ACCESSORY_TYPE_DEFAULT;
  const overrides = AR_CALIBRATION_DEFAULTS_BY_TYPE[type] || {};
  return sanitizeArCalibrationInput({ ...DEFAULT_AR_CALIBRATION, ...overrides }, type);
}

/** Só a rotação vem do metafield guardado; posição/escala usam sempre os defaults do tipo. */
export function buildCalibrationForRotationEditor(defaultCal, saved, accessoryType) {
  const type = normalizeAccessoryType(accessoryType) || AR_ACCESSORY_TYPE_DEFAULT;
  const merged = sanitizeArCalibrationInput(
    {
      ...defaultCal,
      rx: saved && Number.isFinite(Number(saved.rx)) ? Number(saved.rx) : defaultCal.rx,
      ry: saved && Number.isFinite(Number(saved.ry)) ? Number(saved.ry) : defaultCal.ry,
      rz: saved && Number.isFinite(Number(saved.rz)) ? Number(saved.rz) : defaultCal.rz,
    },
    type,
  );
  if (type === "bracelet") {
    return sanitizeArCalibrationInput({ ...merged, rx: 0, ry: 0 }, type);
  }
  return merged;
}
