const COLLECTION_PRODUCTS_QUERY = `#graphql
  query WhatsappCampaignCollectionProducts($handle: String!, $first: Int!) {
    collectionByHandle(handle: $handle) {
      products(first: $first) {
        edges {
          node {
            handle
            title
            featuredImage {
              url
            }
            images(first: 1) {
              edges {
                node {
                  url
                }
              }
            }
            onlineStoreUrl
          }
        }
      }
    }
  }
`;

export function normalizeShopHost(shopDomain) {
  const host = String(shopDomain || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  if (!host) return "";
  if (host.includes(".")) return host;
  return `${host}.myshopify.com`;
}

export async function loadWhatsappCampaignCatalogProducts(admin, shopHost, handles, limit = 40) {
  const unique = new Map();
  const normalizedLimit = Math.min(Math.max(Number(limit) || 40, 1), 50);

  for (const handle of handles) {
    const collectionHandle = String(handle || "").trim();
    if (!collectionHandle) continue;

    const response = await admin.graphql(COLLECTION_PRODUCTS_QUERY, {
      variables: { handle: collectionHandle, first: normalizedLimit },
    });
    const json = await response.json();
    if (json?.errors?.length) {
      const message = json.errors.map((e) => e.message).join("; ");
      throw new Error(message || "GraphQL catalog query failed");
    }

    const edges = json?.data?.collectionByHandle?.products?.edges || [];
    if (!json?.data?.collectionByHandle) {
      console.warn("[whatsapp-catalog] collection not found", collectionHandle, shopHost);
    }

    for (const { node } of edges) {
      const productHandle = String(node?.handle || "").trim();
      const imageUrl = String(
        node?.featuredImage?.url ||
          node?.images?.edges?.[0]?.node?.url ||
          "",
      ).trim();
      if (!productHandle || !imageUrl || unique.has(productHandle)) continue;
      const productUrl =
        String(node?.onlineStoreUrl || "").trim() ||
        `https://${shopHost}/products/${productHandle}`;
      unique.set(productHandle, {
        handle: productHandle,
        title: String(node?.title || productHandle),
        imageUrl,
        productUrl,
      });
    }
  }

  return Array.from(unique.values());
}
