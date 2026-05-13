/**
 * GET /api/products
 * Retorna produtos da loja (handle, title, coleções) para uso na página de tabelas de medidas
 * e no mapeamento "produto → tabela de medidas".
 */
import { authenticate } from '../shopify.server';
import { ensureShopHasActiveBilling } from "../billing-access.server";

const GET_PRODUCTS_QUERY = `#graphql
  query GetProducts($cursor: String) {
    products(first: 250, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          handle
          title
          collections(first: 50) {
            edges {
              node {
                id
                handle
                title
              }
            }
          }
        }
      }
    }
  }
`;

export const loader = async ({ request }) => {
  try {
    const { admin, session } = await authenticate.admin(request);
    const check = await ensureShopHasActiveBilling(admin, session.shop);
    if (!check.active) {
      return Response.json({ error: "billing_inactive" }, { status: 402 });
    }

    const products = [];
    let cursor = null;
    // Paginação simples: até 4 páginas (1.000 produtos). Suficiente para o caso típico
    // sem causar timeouts no admin do Shopify.
    for (let i = 0; i < 4; i += 1) {
      const response = await admin.graphql(GET_PRODUCTS_QUERY, { variables: { cursor } });
      const json = await response.json();
      const root = json?.data?.products;
      const edges = root?.edges ?? [];
      for (const { node } of edges) {
        const collEdges = node?.collections?.edges ?? [];
        const collections = collEdges
          .map(({ node: c }) => ({
            id: c?.id ?? '',
            handle: String(c?.handle || '').trim(),
            title: c?.title ?? c?.handle ?? ''
          }))
          .filter((c) => c.handle);
        products.push({
          id: node.id,
          handle: node.handle ?? '',
          title: node.title ?? node.handle ?? '',
          collections
        });
      }
      if (!root?.pageInfo?.hasNextPage) break;
      cursor = root.pageInfo.endCursor;
    }

    return Response.json({ products });
  } catch (err) {
    console.error('[api.products] Erro:', err);
    return Response.json({ products: [] }, { status: 200 });
  }
};
