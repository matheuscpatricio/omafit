/**
 * GET /api/products
 * Retorna produtos da loja (handle e title) para uso na página de tabelas de medidas.
 */
import { authenticate } from '../shopify.server';
import { ensureShopHasActiveBilling } from "../billing-access.server";

const GET_PRODUCTS_QUERY = `#graphql
  query GetProducts {
    products(first: 250) {
      edges {
        node {
          id
          handle
          title
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

    const response = await admin.graphql(GET_PRODUCTS_QUERY);
    const json = await response.json();
    const edges = json?.data?.products?.edges ?? [];
    const products = edges.map(({ node }) => ({
      id: node.id,
      handle: node.handle ?? '',
      title: node.title ?? node.handle ?? ''
    }));

    return Response.json({ products });
  } catch (err) {
    console.error('[api.products] Erro:', err);
    return Response.json({ products: [] }, { status: 200 });
  }
};

