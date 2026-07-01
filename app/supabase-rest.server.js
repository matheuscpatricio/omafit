const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "";

export function getSupabaseConfig() {
  return { url: SUPABASE_URL, key: SUPABASE_KEY };
}

export function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function supabaseHeaders() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "count=exact",
  };
}

/**
 * @param {string} pathWithQuery - ex: /rest/v1/shopify_shops?select=plan
 * @param {RequestInit} [options]
 */
export async function supabaseFetch(pathWithQuery, options = {}) {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase not configured");
  }
  const url = `${SUPABASE_URL.replace(/\/$/, "")}${pathWithQuery}`;
  return fetchWithTimeout(url, {
    ...options,
    headers: { ...supabaseHeaders(), ...(options.headers || {}) },
  });
}

/**
 * @param {Response} response
 * @returns {Promise<{ data: unknown, total: number|null }>}
 */
export async function parseSupabaseList(response) {
  const contentRange = response.headers.get("content-range") || "";
  const match = contentRange.match(/\/(\d+)$/);
  const total = match ? Number(match[1]) : null;
  const data = await response.json().catch(() => []);
  return { data: Array.isArray(data) ? data : [], total };
}
