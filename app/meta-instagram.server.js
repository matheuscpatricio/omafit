const GRAPH_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export function getInstagramEnvCredentials() {
  return {
    accessToken: (process.env.INSTAGRAM_ACCESS_TOKEN || "").trim(),
    accountId: (process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || "").trim(),
  };
}

export function isTokenExpiredError(message) {
  const text = String(message || "");
  return /expired|session has expired|error validating access token/i.test(text);
}

async function graphGet(path, params = {}) {
  const url = new URL(`${GRAPH_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    const message = data?.error?.message || `Graph API HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}

export async function fetchInstagramProfile(accessToken, accountId) {
  const fields = "followers_count,media_count,username,profile_picture_url";
  return graphGet(`/${encodeURIComponent(accountId)}`, {
    fields,
    access_token: accessToken,
  });
}
