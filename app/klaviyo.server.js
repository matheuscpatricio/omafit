const KLAVIYO_API = "https://a.klaviyo.com";
const KLAVIYO_REVISION = "2024-10-15";
const METRIC_NAME = "Omafit Email Captured";

function cleanKey(value) {
  return String(value || "")
    .trim()
    .replace(/^Klaviyo-API-Key\s+/i, "")
    .trim();
}

function klaviyoHeaders(apiKey) {
  return {
    Authorization: `Klaviyo-API-Key ${cleanKey(apiKey)}`,
    revision: KLAVIYO_REVISION,
    Accept: "application/vnd.api+json",
    "Content-Type": "application/vnd.api+json",
  };
}

async function klaviyoRequest(apiKey, path, { method = "GET", body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${KLAVIYO_API}${path}`, {
      method,
      headers: klaviyoHeaders(apiKey),
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { response, json };
  } finally {
    clearTimeout(timer);
  }
}

function klaviyoError(response, json, fallback) {
  if (response.status === 401 || response.status === 403) return "invalid_key";
  const detail = json?.errors?.[0]?.detail || json?.errors?.[0]?.title || "";
  if (response.status === 404) return "invalid_list";
  if (/list/i.test(detail) && /not found|does not exist/i.test(detail)) return "invalid_list";
  if (/api key|authentication|unauthorized/i.test(detail)) return "invalid_key";
  return fallback || "klaviyo_rejected";
}

function accountNameFromPayload(json) {
  const account = Array.isArray(json?.data) ? json.data[0] : json?.data;
  const info = account?.attributes?.contact_information || {};
  return String(info.organization_name || info.default_sender_name || "").trim();
}

/**
 * Confere a chave e, se houver, se a lista existe.
 * @returns {Promise<{ ok: boolean, error?: string, accountName?: string }>}
 */
export async function testKlaviyoConnection(apiKey, listId) {
  const key = cleanKey(apiKey);
  if (!key) return { ok: false, error: "missing_key" };

  let account;
  try {
    account = await klaviyoRequest(key, "/api/accounts/");
  } catch {
    return { ok: false, error: "klaviyo_unreachable" };
  }
  if (!account.response.ok) {
    return { ok: false, error: klaviyoError(account.response, account.json, "invalid_key") };
  }

  const list = String(listId || "").trim();
  if (list) {
    let listRes;
    try {
      listRes = await klaviyoRequest(key, `/api/lists/${encodeURIComponent(list)}/`);
    } catch {
      return { ok: false, error: "klaviyo_unreachable" };
    }
    if (!listRes.response.ok) {
      return { ok: false, error: listRes.response.status === 401 ? "invalid_key" : "invalid_list" };
    }
  }

  return { ok: true, accountName: accountNameFromPayload(account.json) || "Klaviyo" };
}

/**
 * Cria o evento de recuperação e, com lista, inscreve o e-mail com consentimento.
 * Não envia imagem de try-on.
 */
export async function pushEmailToKlaviyo({ apiKey, listId, email, productTitle, productUrl, productHandle, shopDomain }) {
  const key = cleanKey(apiKey);
  const properties = {};
  if (productTitle) properties.ProductName = productTitle;
  if (productUrl) properties.ProductURL = productUrl;
  if (productHandle) properties.ProductHandle = productHandle;

  const day = new Date().toISOString().slice(0, 10);
  const eventBody = {
    data: {
      type: "event",
      attributes: {
        properties,
        time: new Date().toISOString(),
        unique_id: `${shopDomain}|${email}|${productHandle || ""}|${day}`.slice(0, 255),
        metric: {
          data: {
            type: "metric",
            attributes: { name: METRIC_NAME },
          },
        },
        profile: {
          data: {
            type: "profile",
            attributes: {
              email,
              properties: {
                ...(productTitle ? { omafit_last_product_name: productTitle } : {}),
                ...(productUrl ? { omafit_last_product_url: productUrl } : {}),
              },
            },
          },
        },
      },
    },
  };

  let eventRes;
  try {
    eventRes = await klaviyoRequest(key, "/api/events/", { method: "POST", body: eventBody });
  } catch {
    return { ok: false, error: "klaviyo_unreachable" };
  }
  if (!eventRes.response.ok) {
    return { ok: false, error: klaviyoError(eventRes.response, eventRes.json, "klaviyo_rejected") };
  }

  const list = String(listId || "").trim();
  if (!list) return { ok: true, listSkipped: true };

  const subscribeBody = {
    data: {
      type: "profile-subscription-bulk-create-job",
      attributes: {
        custom_source: "Omafit widget",
        profiles: {
          data: [
            {
              type: "profile",
              attributes: {
                email,
                subscriptions: {
                  email: { marketing: { consent: "SUBSCRIBED" } },
                },
              },
            },
          ],
        },
      },
      relationships: {
        list: { data: { type: "list", id: list } },
      },
    },
  };

  let subRes;
  try {
    subRes = await klaviyoRequest(key, "/api/profile-subscription-bulk-create-jobs/", {
      method: "POST",
      body: subscribeBody,
    });
  } catch {
    return { ok: true, listWarning: "list_failed" };
  }
  if (!subRes.response.ok) {
    return { ok: true, listWarning: klaviyoError(subRes.response, subRes.json, "list_failed") };
  }
  return { ok: true };
}
