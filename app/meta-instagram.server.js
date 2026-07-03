const GRAPH_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

function getMetaAppId() {
  return (process.env.META_APP_ID || process.env.FACEBOOK_APP_ID || "").trim();
}

function getMetaAppSecret() {
  return (process.env.META_APP_SECRET || process.env.FACEBOOK_APP_SECRET || "").trim();
}

export function isMetaAppConfigured() {
  return Boolean(getMetaAppId() && getMetaAppSecret());
}

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

/**
 * Troca token curto (~1h) por token de usuário longo (~60 dias).
 */
export async function exchangeForLongLivedUserToken(shortLivedToken) {
  const appId = getMetaAppId();
  const appSecret = getMetaAppSecret();
  if (!appId || !appSecret) {
    throw new Error("meta_app_not_configured");
  }

  const data = await graphGet("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortLivedToken,
  });

  if (!data.access_token) throw new Error("long_lived_exchange_failed");
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in ?? null,
    tokenType: "user_long_lived",
  };
}

/**
 * Lista páginas com token de Página (não expira) e conta Instagram vinculada.
 */
export async function fetchPageInstagramAccounts(userAccessToken) {
  const data = await graphGet("/me/accounts", {
    fields: "id,name,access_token,instagram_business_account{id,username}",
    access_token: userAccessToken,
  });

  const pages = (data.data || [])
    .filter((page) => page?.instagram_business_account?.id)
    .map((page) => ({
      pageId: page.id,
      pageName: page.name,
      pageAccessToken: page.access_token,
      instagramBusinessAccountId: page.instagram_business_account.id,
      instagramUsername: page.instagram_business_account.username || null,
    }));

  return pages;
}

/**
 * Fluxo completo: token curto do Explorer → token de Página (recomendado para Railway).
 */
export async function resolveInstagramPageToken(shortLivedToken, preferredUsername) {
  const trimmed = String(shortLivedToken || "").trim();
  if (!trimmed) throw new Error("short_lived_token_required");

  const longLived = await exchangeForLongLivedUserToken(trimmed);
  const pages = await fetchPageInstagramAccounts(longLived.accessToken);

  if (!pages.length) {
    throw new Error(
      "no_instagram_page_found: vincule @omafit.co a uma Página Facebook e use um token com pages_show_list",
    );
  }

  const preferred = String(preferredUsername || "omafit.co")
    .replace(/^@/, "")
    .toLowerCase();
  const match =
    pages.find((p) => p.instagramUsername?.toLowerCase() === preferred) || pages[0];

  return {
    success: true,
    instagramAccessToken: match.pageAccessToken,
    instagramBusinessAccountId: match.instagramBusinessAccountId,
    instagramUsername: match.instagramUsername,
    pageId: match.pageId,
    pageName: match.pageName,
    tokenType: "page",
    expiresAt: null,
    note:
      "Use o token de Página como INSTAGRAM_ACCESS_TOKEN no Railway — não expira enquanto a Página existir.",
  };
}

export async function debugAccessToken(accessToken) {
  const appId = getMetaAppId();
  const appSecret = getMetaAppSecret();
  if (!appId || !appSecret) return null;

  try {
    const data = await graphGet("/debug_token", {
      input_token: accessToken,
      access_token: `${appId}|${appSecret}`,
    });
    const info = data.data || {};
    return {
      isValid: info.is_valid === true,
      expiresAt: info.expires_at ? new Date(info.expires_at * 1000).toISOString() : null,
      type: info.type || null,
    };
  } catch {
    return null;
  }
}

export async function fetchInstagramProfile(accessToken, accountId) {
  const fields = "followers_count,media_count,username,profile_picture_url";
  return graphGet(`/${encodeURIComponent(accountId)}`, {
    fields,
    access_token: accessToken,
  });
}
