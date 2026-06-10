/** Código persistido em `error_message` ao publicar um envio mais recente. */
export const AR_EYEWEAR_SUPERSEDED_PREFIX = "superseded_by:";

export function isSupersededArEyewearErrorMessage(errorMessage) {
  const s = String(errorMessage || "").trim();
  if (!s) return false;
  if (s.startsWith(AR_EYEWEAR_SUPERSEDED_PREFIX)) return true;
  return /^Superseded by published asset /i.test(s);
}

/**
 * @param {string | null | undefined} errorMessage
 * @param {(key: string, vars?: Record<string, unknown>) => string} t
 */
export function formatArEyewearErrorMessage(errorMessage, t) {
  if (!errorMessage) return null;
  if (isSupersededArEyewearErrorMessage(errorMessage)) {
    return t("arEyewear.supersededByPublished");
  }
  return String(errorMessage);
}

/** @param {string} keepAssetId */
export function buildSupersededArEyewearErrorMessage(keepAssetId) {
  return `${AR_EYEWEAR_SUPERSEDED_PREFIX}${String(keepAssetId || "").trim()}`;
}
