const CANVA_API_BASE = "https://api.canva.com/rest/v1";

function getAccessToken() {
  return (process.env.CANVA_ACCESS_TOKEN || "").trim();
}

export function isCanvaConfigured() {
  return Boolean(getAccessToken());
}

function authHeaders(extra = {}) {
  const token = getAccessToken();
  if (!token) throw new Error("canva_not_configured");
  return {
    Authorization: `Bearer ${token}`,
    ...extra,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function canvaRequest(path, options = {}) {
  const response = await fetch(`${CANVA_API_BASE}${path}`, {
    ...options,
    headers: {
      ...authHeaders(options.headers || {}),
    },
    signal: options.signal || AbortSignal.timeout(60000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.message || data?.error?.message || `Canva HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}

async function pollAssetUpload(jobId, maxAttempts = 40) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const data = await canvaRequest(`/asset-uploads/${jobId}`);
    const status = data?.job?.status;
    if (status === "success") return data.job;
    if (status === "failed") {
      throw new Error(data?.job?.error?.message || "asset_upload_failed");
    }
    await sleep(1500);
  }
  throw new Error("asset_upload_timeout");
}

async function pollMergeJob(jobId, maxAttempts = 40) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const data = await canvaRequest(`/merges/${jobId}`);
    const status = data?.job?.status;
    if (status === "success") return data.job;
    if (status === "failed") {
      throw new Error(data?.job?.error?.message || "merge_failed");
    }
    await sleep(1500);
  }
  throw new Error("merge_timeout");
}

export async function uploadPngAsset(buffer, name) {
  const safeName = String(name || "slide").slice(0, 48);
  const metadata = JSON.stringify({
    name_base64: Buffer.from(safeName, "utf8").toString("base64"),
  });

  const response = await fetch(`${CANVA_API_BASE}/asset-uploads`, {
    method: "POST",
    headers: authHeaders({
      "Content-Type": "application/octet-stream",
      "Asset-Upload-Metadata": metadata,
    }),
    body: buffer,
    signal: AbortSignal.timeout(120000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.message || `asset_upload HTTP ${response.status}`);
  }

  if (data?.job?.status === "success" && data?.job?.asset?.id) {
    return data.job.asset.id;
  }
  if (!data?.job?.id) throw new Error("asset_upload_no_job");
  const completed = await pollAssetUpload(data.job.id);
  return completed.asset.id;
}

export async function createDesignFromAsset(assetId, title) {
  const data = await canvaRequest("/designs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "type_and_asset",
      design_type: {
        type: "custom",
        width: 1080,
        height: 1080,
      },
      asset_id: assetId,
      title: String(title || "Omafit Carousel").slice(0, 255),
    }),
  });
  return data.design;
}

async function appendPageToDesign(targetDesignId, sourceDesignId, afterPageNumber) {
  const data = await canvaRequest("/merges", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "modify_existing_design",
      design_id: targetDesignId,
      operations: [
        {
          type: "insert_pages",
          source: {
            type: "design",
            design_id: sourceDesignId,
            page_numbers: [1],
          },
          after_page_number: afterPageNumber,
        },
      ],
    }),
  });

  if (data?.job?.status === "success") return data.job;
  if (!data?.job?.id) throw new Error("merge_no_job");
  return pollMergeJob(data.job.id);
}

/**
 * Envia slides PNG para o Canva e monta um design multi-página (carrossel).
 * Requer CANVA_ACCESS_TOKEN com scopes asset:write e design:content:write.
 */
export async function pushCarouselToCanva(slideBuffers, title) {
  if (!isCanvaConfigured()) {
    return { success: false, error: "canva_not_configured" };
  }
  if (!slideBuffers?.length) {
    return { success: false, error: "no_slides" };
  }

  const designIds = [];
  for (let i = 0; i < slideBuffers.length; i += 1) {
    const assetId = await uploadPngAsset(slideBuffers[i], `omafit-slide-${i + 1}.png`);
    const design = await createDesignFromAsset(
      assetId,
      `${title} — slide ${i + 1}`,
    );
    designIds.push(design.id);
  }

  let mainDesignId = designIds[0];
  let mainDesign = null;

  for (let i = 1; i < designIds.length; i += 1) {
    const job = await appendPageToDesign(mainDesignId, designIds[i], i);
    mainDesign = job?.result?.design || mainDesign;
  }

  if (!mainDesign) {
    const fetched = await canvaRequest(`/designs/${mainDesignId}`);
    mainDesign = fetched.design;
  }

  return {
    success: true,
    designId: mainDesign?.id || mainDesignId,
    editUrl: mainDesign?.urls?.edit_url || null,
    viewUrl: mainDesign?.urls?.view_url || null,
    pageCount: mainDesign?.page_count || slideBuffers.length,
  };
}
