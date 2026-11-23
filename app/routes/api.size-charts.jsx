/**
 * GET/POST /api/size-charts
 * Admin: listar e gravar tabelas de medidas via service_role (não expõe escrita anon).
 * Widget continua a ler size_charts com a anon key (RLS SELECT).
 */
import { authenticate } from "../shopify.server";
import { ensureShopHasActiveBilling } from "../billing-access.server";
import {
  getSupabaseConfig,
  isSupabaseConfigured,
  supabaseFetch,
} from "../supabase-rest.server.js";

function measurementKey(row) {
  return `${String(row.collection_handle ?? "")}|${String(row.product_handle ?? "")}|${String(row.gender ?? "")}`;
}

function normalizeRow(row, shopDomain) {
  return {
    shop_domain: shopDomain,
    collection_handle: String(row?.collection_handle ?? ""),
    product_handle: String(row?.product_handle ?? ""),
    gender: String(row?.gender ?? ""),
    collection_type: row?.collection_type ?? null,
    collection_elasticity: row?.collection_elasticity ?? null,
    gender_scope: row?.gender_scope ?? "both",
    measurement_refs: Array.isArray(row?.measurement_refs) ? row.measurement_refs : [],
    sizes: Array.isArray(row?.sizes) ? row.sizes : [],
  };
}

async function listCharts(shopDomain) {
  const res = await supabaseFetch(
    `/rest/v1/size_charts?shop_domain=eq.${encodeURIComponent(shopDomain)}&select=*&order=updated_at.desc&limit=1000`,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `size_charts list failed (${res.status})`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function upsertCharts(rows) {
  const path =
    "/rest/v1/size_charts?on_conflict=shop_domain,collection_handle,product_handle,gender";
  const doPost = async (payload) =>
    supabaseFetch(path, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(payload),
    });

  let res = await doPost(rows);
  let errText = "";
  if (!res.ok) {
    errText = await res.text().catch(() => "");
    const missingGenderScope =
      errText.includes("gender_scope") &&
      (errText.includes("column") || errText.includes("42703") || errText.includes("PGRST204"));
    if (missingGenderScope) {
      // eslint-disable-next-line no-unused-vars
      const fallback = rows.map(({ gender_scope, ...rest }) => rest);
      res = await doPost(fallback);
      if (!res.ok) errText = await res.text().catch(() => "");
    }
  }
  if (!res.ok) {
    const missingMeta =
      (errText.includes("collection_type") || errText.includes("collection_elasticity")) &&
      (errText.includes("column") || errText.includes("42703"));
    if (missingMeta) {
      // eslint-disable-next-line no-unused-vars
      const fallback = rows.map(({ collection_type, collection_elasticity, gender_scope, ...rest }) => rest);
      res = await doPost(fallback);
      if (!res.ok) errText = await res.text().catch(() => "");
    }
  }
  if (!res.ok) {
    const legacy = await supabaseFetch("/rest/v1/size_charts", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows),
    });
    if (!legacy.ok) {
      const text = errText || (await legacy.text().catch(() => ""));
      throw new Error(text || `size_charts upsert failed (${res.status})`);
    }
  }
}

async function deleteOrphans(shopDomain, keepKeys) {
  const res = await supabaseFetch(
    `/rest/v1/size_charts?shop_domain=eq.${encodeURIComponent(shopDomain)}&select=id,collection_handle,product_handle,gender&limit=1000`,
  );
  if (!res.ok) {
    if (keepKeys.size === 0) {
      const del = await supabaseFetch(
        `/rest/v1/size_charts?shop_domain=eq.${encodeURIComponent(shopDomain)}`,
        { method: "DELETE" },
      );
      if (!del.ok) {
        console.warn("[api.size-charts] delete shop fallback:", await del.text().catch(() => ""));
      }
    }
    return;
  }
  const existing = await res.json();
  const orphanIds = (Array.isArray(existing) ? existing : [])
    .filter((row) => !keepKeys.has(measurementKey(row)))
    .map((row) => row.id)
    .filter(Boolean);

  for (let i = 0; i < orphanIds.length; i += 50) {
    const batch = orphanIds.slice(i, i + 50);
    const delRes = await supabaseFetch(`/rest/v1/size_charts?id=in.(${batch.join(",")})`, {
      method: "DELETE",
    });
    if (!delRes.ok) {
      console.warn("[api.size-charts] orphan delete:", await delRes.text().catch(() => ""));
    }
  }
}

export const loader = async ({ request }) => {
  try {
    const { admin, session } = await authenticate.admin(request);
    const check = await ensureShopHasActiveBilling(admin, session.shop);
    if (!check.active) {
      return Response.json({ error: "billing_inactive" }, { status: 402 });
    }
    if (!isSupabaseConfigured()) {
      return Response.json({ error: "supabase_not_configured" }, { status: 500 });
    }
    const shopDomain = String(session.shop || "").trim();
    const charts = await listCharts(shopDomain);
    return Response.json({ charts });
  } catch (err) {
    console.error("[api.size-charts] GET:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "load_failed", charts: [] },
      { status: 500 },
    );
  }
};

export const action = async ({ request }) => {
  try {
    const { admin, session } = await authenticate.admin(request);
    const check = await ensureShopHasActiveBilling(admin, session.shop);
    if (!check.active) {
      return Response.json({ error: "billing_inactive" }, { status: 402 });
    }
    if (!isSupabaseConfigured()) {
      return Response.json({ error: "supabase_not_configured" }, { status: 500 });
    }
    const { key } = getSupabaseConfig();
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY && key) {
      console.warn(
        "[api.size-charts] SUPABASE_SERVICE_ROLE_KEY ausente — a gravar com fallback (pode falhar com RLS).",
      );
    }

    const shopDomain = String(session.shop || "").trim();
    const body = await request.json().catch(() => ({}));
    const rawRows = Array.isArray(body?.charts) ? body.charts : [];
    const toSave = rawRows
      .map((row) => normalizeRow(row, shopDomain))
      .filter((row) => row.gender && Array.isArray(row.sizes) && row.sizes.length > 0);

    if (toSave.length > 0) {
      await upsertCharts(toSave);
    }
    await deleteOrphans(shopDomain, new Set(toSave.map(measurementKey)));

    const charts = await listCharts(shopDomain);
    return Response.json({ ok: true, charts });
  } catch (err) {
    console.error("[api.size-charts] POST:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "save_failed" },
      { status: 500 },
    );
  }
};
