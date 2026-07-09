/** Loja piloto Shopify (Arrascaneta) — default enquanto feature está em teste. */
export const DEFAULT_WHATSAPP_PILOT_STORE_KEYS = ["arrascaneta-2.myshopify.com"];

export function normalizeWhatsappStoreKey(key) {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

/** Pilot ativo por default. Defina `OMAFIT_WHATSAPP_PILOT_STORE_KEYS=*` para desligar e usar só Growth+. */
export function isWhatsappPilotRestrictionActive() {
  const raw = process.env.OMAFIT_WHATSAPP_PILOT_STORE_KEYS;
  if (raw === "*") return false;
  return true;
}

export function getWhatsappPilotStoreKeys() {
  const raw = process.env.OMAFIT_WHATSAPP_PILOT_STORE_KEYS;
  if (raw === "*") return new Set();
  if (raw && raw.trim()) {
    return new Set(
      raw
        .split(",")
        .map((part) => normalizeWhatsappStoreKey(part))
        .filter(Boolean),
    );
  }
  return new Set(DEFAULT_WHATSAPP_PILOT_STORE_KEYS.map(normalizeWhatsappStoreKey));
}

export function isStoreWhatsappPilotAllowed(storeKey) {
  const normalized = normalizeWhatsappStoreKey(storeKey);
  if (!normalized) return false;
  if (!isWhatsappPilotRestrictionActive()) return true;
  return getWhatsappPilotStoreKeys().has(normalized);
}

export const WHATSAPP_PILOT_ONLY_HINT =
  "Try On Marketing está em piloto e disponível apenas em lojas selecionadas.";

export function whatsappMarketingAccessDeniedHint() {
  return isWhatsappPilotRestrictionActive()
    ? WHATSAPP_PILOT_ONLY_HINT
    : "Try On Marketing requires an active Growth plan or higher.";
}
