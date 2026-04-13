/**
 * GET /api/storage/signed-url?bucket=self-hosted-results&path=...&expiresIn=3600
 * Emite URL assinada do Supabase Storage (bucket allowlist). Uso: admin embutido / ferramentas.
 * O pipeline self-hosted deve preferir assinar no próprio worker com SUPABASE_SERVICE_ROLE_KEY.
 */
import { authenticate } from "../shopify.server";
import { ensureShopHasActiveBilling } from "../billing-access.server";
import { storageCreateSignedUrl } from "../ar-eyewear.server.js";

const ALLOWED_BUCKETS = new Set(["self-hosted-results"]);

function isSafeObjectPath(path) {
  const p = String(path || "").trim();
  if (!p || p.length > 2048) return false;
  if (p.includes("..") || p.startsWith("/") || p.includes("\\")) return false;
  return true;
}

export async function loader({ request }) {
  try {
    const { admin, session } = await authenticate.admin(request);
    const billing = await ensureShopHasActiveBilling(admin, session.shop);
    if (!billing.active) {
      return Response.json({ error: "billing_inactive" }, { status: 402 });
    }

    const url = new URL(request.url);
    const bucket = String(url.searchParams.get("bucket") || "").trim();
    const objectPath = String(url.searchParams.get("path") || "").trim();
    const expiresRaw = url.searchParams.get("expiresIn");
    const expiresIn = Math.min(
      604800,
      Math.max(60, Number(expiresRaw) > 0 ? Math.floor(Number(expiresRaw)) : 3600),
    );

    if (!ALLOWED_BUCKETS.has(bucket)) {
      return Response.json({ error: "bucket_not_allowed" }, { status: 400 });
    }
    if (!isSafeObjectPath(objectPath)) {
      return Response.json({ error: "invalid_path" }, { status: 400 });
    }

    const signedUrl = await storageCreateSignedUrl(bucket, objectPath, expiresIn);
    return Response.json({
      ok: true,
      signedUrl,
      bucket,
      path: objectPath,
      expiresIn,
    });
  } catch (e) {
    const msg = String(e?.message || e || "signed_url_failed");
    if (/unauthorized|401/i.test(msg)) {
      return Response.json({ ok: false, error: msg }, { status: 401 });
    }
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
