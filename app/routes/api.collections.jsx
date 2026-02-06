/**
 * GET /api/collections
 * Retorna as coleções da loja (handle e title) para uso na página de tabelas de medidas.
 */
import { authenticate } from '../shopify.server';

const GET_COLLECTIONS_QUERY = `#graphql
  query GetCollections {
    collections(first: 250) {
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
    const { admin } = await authenticate.admin(request);
    const response = await admin.graphql(GET_COLLECTIONS_QUERY);
    const json = await response.json();
    const edges = json?.data?.collections?.edges ?? [];
    const collections = edges.map(({ node }) => ({
      id: node.id,
      handle: node.handle ?? '',
      title: node.title ?? node.handle ?? ''
    }));
    return Response.json({ collections });
  } catch (err) {
    console.error('[api.collections] Erro:', err);
    return Response.json({ collections: [] }, { status: 200 });
  }
};
