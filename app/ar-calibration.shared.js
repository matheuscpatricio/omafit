/**
 * Calibração AR — funções puras (cliente + servidor).
 * Não importar módulos `.server.js` daqui.
 */

import {
  normalizeAccessoryType,
  AR_ACCESSORY_TYPE_DEFAULT,
} from "./ar-accessory-type.shared.js";

export function sanitizeArCalibrationInput(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const num = (v, def) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  };
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  return {
    rx: clamp(num(src.rx, 0), -180, 180),
    ry: clamp(num(src.ry, 0), -180, 180),
    rz: clamp(num(src.rz, 0), -180, 180),
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
  return sanitizeArCalibrationInput({ ...DEFAULT_AR_CALIBRATION, ...overrides });
}

/** Só a rotação vem do metafield guardado; posição/escala usam sempre os defaults do tipo. */
export function buildCalibrationForRotationEditor(defaultCal, saved, accessoryType) {
  const merged = sanitizeArCalibrationInput({
    ...defaultCal,
    rx: saved && Number.isFinite(Number(saved.rx)) ? Number(saved.rx) : defaultCal.rx,
    ry: saved && Number.isFinite(Number(saved.ry)) ? Number(saved.ry) : defaultCal.ry,
    rz: saved && Number.isFinite(Number(saved.rz)) ? Number(saved.rz) : defaultCal.rz,
  });
  if (accessoryType === "bracelet") {
    return sanitizeArCalibrationInput({ ...merged, rx: 0, ry: 0 });
  }
  return merged;
}
