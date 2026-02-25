/**
 * GET /api/analytics/sessions
 * Prioriza dados de user_measurements (join com tryon_sessions) e
 * usa session_analytics apenas como fallback.
 * Query: shop_domain, user_id (opcional), since (ISO date opcional).
 */
import { authenticate } from "../shopify.server";
import { ensureShopHasActiveBilling } from "../billing-access.server";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY;

export async function loader({ request }) {
  try {
    const { admin, session } = await authenticate.admin(request);
    const check = await ensureShopHasActiveBilling(admin, session.shop);
    if (!check.active) {
      return Response.json({ error: "billing_inactive" }, { status: 402 });
    }
    const url = new URL(request.url);
    const shopDomain = url.searchParams.get("shop_domain");
    const userId = url.searchParams.get("user_id");
    const since = url.searchParams.get("since");
    const debug = url.searchParams.get("debug") === "1" || url.searchParams.get("debug") === "true";

    if (!shopDomain) {
      return Response.json(
        { error: "shop_domain is required" },
        { status: 400 }
      );
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return Response.json(
        { error: "Supabase not configured on server" },
        { status: 500 }
      );
    }

    const headers = {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    };

    async function fetchSupabaseJson(urlToFetch) {
      const response = await fetch(urlToFetch, { headers });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status} - ${text}`);
      }
      return await response.json();
    }

    const norm = (v) => (v != null ? String(v).toLowerCase() : "");
    const normShop = (s) => (s != null ? String(s).toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "") : "");
    const debugInfo = debug ? { step: "", measurementsFirst: 0, tryonSessionsById: 0, sessionIdsForShop: 0 } : null;
    const withDebug = (payload) => (debug && debugInfo ? { ...payload, debug: debugInfo } : payload);

    // 0) FLUXO INVERTIDO: user_measurements primeiro, depois tryon_sessions (quando tryon_sessions não retorna por shop/user)
    let measurementsFirst = [];
    try {
      const umUrl = `${SUPABASE_URL}/rest/v1/user_measurements?select=*&order=updated_at.desc&limit=500`;
      measurementsFirst = await fetchSupabaseJson(umUrl);
    } catch (_e) {
      try {
        const umUrl = `${SUPABASE_URL}/rest/v1/user_measurements?select=*&limit=500`;
        measurementsFirst = await fetchSupabaseJson(umUrl);
      } catch (_e2) {
        measurementsFirst = [];
      }
    }
    if (Array.isArray(measurementsFirst) && measurementsFirst.length > 0) {
      const sessionIdsFromUm = [...new Set(measurementsFirst.map((m) => m?.tryon_session_id).filter(Boolean))];
      if (sessionIdsFromUm.length > 0) {
        let sessionsById = [];
        for (let i = 0; i < sessionIdsFromUm.length; i += 100) {
          const chunk = sessionIdsFromUm.slice(i, i + 100);
          const inVal = chunk.map((id) => String(id)).join(",");
          const tsUrl = `${SUPABASE_URL}/rest/v1/tryon_sessions?id=in.(${inVal})&select=id,user_id,shop_domain,session_start_time,session_end_time,created_at,updated_at`;
          try {
            const rows = await fetchSupabaseJson(tsUrl);
            if (Array.isArray(rows)) sessionsById = sessionsById.concat(rows);
          } catch (_err) {
            break;
          }
        }
        const sessionIdsForShop = new Set();
        const wantShop = normShop(shopDomain);
        sessionsById.forEach((row) => {
          const matchShop = row.shop_domain && normShop(row.shop_domain) === wantShop;
          const matchUser = userId && row.user_id && norm(row.user_id) === norm(userId);
          if (matchShop || matchUser) sessionIdsForShop.add(norm(row.id));
        });
        const bySessionId = new Map();
        measurementsFirst.forEach((m) => {
          const sid = norm(m?.tryon_session_id);
          if (!sid || !sessionIdsForShop.has(sid)) return;
          if (!bySessionId.has(sid)) bySessionId.set(sid, []);
          bySessionId.get(sid).push(m);
        });
        const combined = [];
        sessionsById.forEach((sessionRow) => {
          const sid = norm(sessionRow?.id);
          if (!sessionIdsForShop.has(sid)) return;
          const list = bySessionId.get(sid) || [];
          if (list.length === 0) return;
          const measurement = list[list.length - 1];
          combined.push({
            ...sessionRow,
            ...measurement,
            created_at:
              sessionRow?.session_start_time ||
              sessionRow?.created_at ||
              measurement?.created_at ||
              measurement?.updated_at ||
              null,
            user_measurements: JSON.stringify(measurement),
          });
        });
        if (combined.length > 0) {
          if (debugInfo) {
            debugInfo.step = "user_measurements_first";
            debugInfo.measurementsFirst = measurementsFirst.length;
            debugInfo.tryonSessionsById = sessionsById.length;
            debugInfo.sessionIdsForShop = sessionIdsForShop.size;
          }
          return Response.json(withDebug({ sessions: combined, source: "user_measurements" }));
        }
      }
    }

    // 1) PRIORIDADE: tryon_sessions + user_measurements
    const selectTryon = "select=id,user_id,shop_domain,session_start_time,session_end_time,created_at,updated_at";
    const orderTryon = "order=session_start_time.desc";
    const orderTryonCreated = "order=created_at.desc";

    const buildTryonUrlByShop = (withSince) => {
      const parts = [
        `shop_domain=eq.${encodeURIComponent(shopDomain)}`,
        selectTryon,
        orderTryon,
        "limit=500",
      ];
      if (userId) parts.unshift(`user_id=eq.${encodeURIComponent(userId)}`);
      if (withSince && since) parts.push(`session_start_time=gte.${encodeURIComponent(since)}`);
      return `${SUPABASE_URL}/rest/v1/tryon_sessions?${parts.join("&")}`;
    };

    const buildTryonUrlByUser = (withSince) => {
      if (!userId) return null;
      const parts = [
        `user_id=eq.${encodeURIComponent(userId)}`,
        selectTryon,
        orderTryon,
        "limit=500",
      ];
      if (withSince && since) parts.push(`session_start_time=gte.${encodeURIComponent(since)}`);
      return `${SUPABASE_URL}/rest/v1/tryon_sessions?${parts.join("&")}`;
    };

    const buildTryonUrlMinimal = () => {
      const parts = [
        "select=id,user_id,created_at,updated_at",
        orderTryonCreated,
        "limit=500",
      ];
      if (userId) parts.unshift(`user_id=eq.${encodeURIComponent(userId)}`);
      return `${SUPABASE_URL}/rest/v1/tryon_sessions?${parts.join("&")}`;
    };

    let tryonSessions = [];
    try {
      tryonSessions = await fetchSupabaseJson(buildTryonUrlByShop(true));
    } catch (_errByShop) {
      tryonSessions = [];
      if (since) {
        try {
          tryonSessions = await fetchSupabaseJson(buildTryonUrlByShop(false));
        } catch (_e) {
          tryonSessions = [];
        }
      }
      if (tryonSessions.length === 0 && userId) {
        try {
          tryonSessions = await fetchSupabaseJson(buildTryonUrlByUser(true));
        } catch (_e) {
          try {
            tryonSessions = await fetchSupabaseJson(buildTryonUrlByUser(false));
          } catch (_e2) {
            try {
              tryonSessions = await fetchSupabaseJson(buildTryonUrlMinimal());
            } catch (_e3) {
              tryonSessions = [];
            }
          }
        }
      }
    }
    if (tryonSessions.length === 0 && userId) {
      try {
        tryonSessions = await fetchSupabaseJson(buildTryonUrlByUser(true));
      } catch (_e) {
        try {
          tryonSessions = await fetchSupabaseJson(buildTryonUrlByUser(false));
        } catch (_e2) {
          try {
            tryonSessions = await fetchSupabaseJson(buildTryonUrlMinimal());
          } catch (_e3) {
            tryonSessions = [];
          }
        }
      }
    }

    if (tryonSessions.length > 0 && shopDomain) {
      const wantShop = normShop(shopDomain);
      const filtered = tryonSessions.filter(
        (row) => !row.shop_domain || normShop(row.shop_domain) === wantShop
      );
      if (filtered.length > 0) tryonSessions = filtered;
    }

    if (Array.isArray(tryonSessions) && tryonSessions.length > 0) {
      const tryonIds = tryonSessions
        .map((row) => row?.id)
        .filter(Boolean)
        .slice(0, 500);

      if (tryonIds.length > 0) {
        // Quebra em lotes para evitar URL grande demais.
        const measurements = [];
        for (let i = 0; i < tryonIds.length; i += 100) {
          const chunk = tryonIds.slice(i, i + 100);
          const inList = chunk.map((id) => String(id)).join(",");
          const measurementsUrl =
            `${SUPABASE_URL}/rest/v1/user_measurements?tryon_session_id=in.(${inList})&select=*`;
          try {
            const rows = await fetchSupabaseJson(measurementsUrl);
            if (Array.isArray(rows)) measurements.push(...rows);
          } catch (err) {
            console.warn("[api.analytics.sessions] user_measurements chunk failed:", err?.message || err);
          }
        }

        if (measurements.length > 0) {
          const bySessionId = new Map();
          measurements.forEach((m) => {
            const sid = norm(m?.tryon_session_id);
            if (!sid) return;
            if (!bySessionId.has(sid)) bySessionId.set(sid, []);
            bySessionId.get(sid).push(m);
          });

          const combined = [];
          tryonSessions.forEach((sessionRow) => {
            const sid = norm(sessionRow?.id);
            const list = bySessionId.get(sid) || [];
            if (list.length === 0) return;
            // Usa o último registro de medição como fonte primária.
            const measurement = list[list.length - 1];
            combined.push({
              ...sessionRow,
              ...measurement,
              created_at:
                sessionRow?.session_start_time ||
                sessionRow?.created_at ||
                measurement?.created_at ||
                measurement?.updated_at ||
                null,
              user_measurements: JSON.stringify(measurement),
            });
          });

          if (combined.length > 0) {
            return Response.json({ sessions: combined, source: "user_measurements" });
          }
        }
      }
    }

    // 2) FALLBACK: session_analytics
    const buildSessionAnalyticsUrl = (withSince) => {
      const parts = [
        `shop_domain=eq.${encodeURIComponent(shopDomain)}`,
        "select=*",
        "order=created_at.desc",
        "limit=500",
      ];
      if (userId) parts.unshift(`user_id=eq.${encodeURIComponent(userId)}`);
      if (withSince && since) parts.push(`created_at=gte.${encodeURIComponent(since)}`);
      return `${SUPABASE_URL}/rest/v1/session_analytics?${parts.join("&")}`;
    };

    let response;
    try {
      response = await fetch(buildSessionAnalyticsUrl(true), { headers });
      if (response.status === 400 && since) {
        response = await fetch(buildSessionAnalyticsUrl(false), { headers });
      }
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        console.error("[api.analytics.sessions] Supabase fallback error:", response.status, text);
        return Response.json(
          { error: "Failed to fetch sessions", details: text },
          { status: response.status }
        );
      }
      let data = await response.json();
      if (!Array.isArray(data)) data = [];

      let umBySession = new Map();
      const tryonIds = data.map((row) => row?.tryon_session_id).filter(Boolean);
      if (tryonIds.length > 0) {
        for (let i = 0; i < tryonIds.length; i += 100) {
          const chunk = tryonIds.slice(i, i + 100);
          const inList = chunk.map((id) => String(id)).join(",");
          try {
            const umUrl = `${SUPABASE_URL}/rest/v1/user_measurements?tryon_session_id=in.(${inList})&select=*&order=updated_at.desc`;
            const rows = await fetchSupabaseJson(umUrl);
            if (Array.isArray(rows)) {
              rows.forEach((m) => {
                const sid = norm(m?.tryon_session_id);
                if (!sid || umBySession.has(sid)) return;
                umBySession.set(sid, m);
              });
            }
          } catch (_err) {
            break;
          }
        }
        if (umBySession.size > 0) {
          data = data.map((row) => {
            const sid = row?.tryon_session_id ? norm(row.tryon_session_id) : "";
            const measurement = umBySession.get(sid);
            if (!measurement) return row;
            return {
              ...row,
              ...measurement,
              user_measurements: JSON.stringify(measurement),
              gender: measurement.gender ?? row.gender,
              recommended_size: measurement.recommended_size ?? measurement.recommendedSize ?? row.recommended_size,
              body_type_index: measurement.body_type_index ?? measurement.bodyTypeIndex ?? row.body_type_index,
              fit_preference_index: measurement.fit_preference_index ?? measurement.fitPreferenceIndex ?? row.fit_preference_index,
              height: measurement.height ?? row.height,
              weight: measurement.weight ?? row.weight,
              collection_handle: measurement.collection_handle ?? measurement.collectionHandle ?? row.collection_handle,
            };
          });
        }
      }
      const source = umBySession.size > 0 ? "session_analytics_with_user_measurements" : "session_analytics";
      return Response.json(withDebug({ sessions: data, source }));
    } catch (fallbackErr) {
      console.error("[api.analytics.sessions] fallback failed:", fallbackErr);
      return Response.json(
        { error: fallbackErr?.message || "Failed to fetch sessions" },
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("[api.analytics.sessions]", err);
    return Response.json(
      { error: err.message || "Server error" },
      { status: 500 }
    );
  }
}
