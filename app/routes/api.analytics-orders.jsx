/**
 * GET /api/analytics-orders?period=30
 * Retorna contagem de pedidos e devoluções antes/depois do Omafit para a página de Analytics.
 * Requer scope read_orders.
 */
import { authenticate } from '../shopify.server';

export const loader = async ({ request }) => {
  const fallback = {
    ordersBefore: null,
    ordersAfter: null,
    returnsBefore: null,
    returnsAfter: null,
    conversionBefore: null,
    conversionAfter: null,
    installDate: null,
    error: null
  };

  try {
    const { admin, session } = await authenticate.admin(request);
    const shop = session?.shop;
    if (!shop) {
      return Response.json({ ...fallback, error: 'Shop não encontrado' }, { status: 200 });
    }

    const url = new URL(request.url);
    const periodDays = Math.min(365, Math.max(1, parseInt(url.searchParams.get('period') || '30', 10)));

    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    let installDate = null;
    if (supabaseUrl && supabaseKey) {
      try {
        const shopRes = await fetch(
          `${supabaseUrl}/rest/v1/shopify_shops?shop_domain=eq.${encodeURIComponent(shop)}&select=created_at`,
          {
            headers: {
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json'
            }
          }
        );
        if (shopRes.ok) {
          const shopData = await shopRes.json();
          if (shopData?.[0]?.created_at) {
            installDate = shopData[0].created_at;
          }
        }
      } catch (e) {
        console.warn('[api.analytics-orders] Erro ao buscar shop created_at:', e);
      }
    }

    const now = new Date();
    const afterEnd = new Date(now);
    const afterStart = new Date(now);
    afterStart.setDate(afterStart.getDate() - periodDays);

    let beforeStart;
    let beforeEnd;
    if (installDate) {
      const install = new Date(installDate);
      beforeEnd = new Date(install);
      beforeStart = new Date(install);
      beforeStart.setDate(beforeStart.getDate() - periodDays);
    } else {
      beforeEnd = new Date(afterStart);
      beforeStart = new Date(beforeEnd);
      beforeStart.setDate(beforeStart.getDate() - periodDays);
    }

    const afterStartStr = afterStart.toISOString().slice(0, 19) + 'Z';
    const afterEndStr = afterEnd.toISOString().slice(0, 19) + 'Z';
    const beforeStartStr = beforeStart.toISOString().slice(0, 19) + 'Z';
    const beforeEndStr = beforeEnd.toISOString().slice(0, 19) + 'Z';

    const queryAfter = `created_at:>='${afterStartStr}' created_at:<='${afterEndStr}'`;
    const queryBefore = `created_at:>='${beforeStartStr}' created_at:<='${beforeEndStr}'`;

    const ordersCountQuery = `#graphql
      query OrdersCount($q1: String, $q2: String, $q3: String, $q4: String) {
        ordersAfter: ordersCount(query: $q1, limit: null) { count }
        ordersBefore: ordersCount(query: $q2, limit: null) { count }
        returnsAfter: ordersCount(query: $q3, limit: null) { count }
        returnsBefore: ordersCount(query: $q4, limit: null) { count }
      }
    `;

    const returnsQueryAfter = `${queryAfter} return_status:returned`;
    const returnsQueryBefore = `${queryBefore} return_status:returned`;

    const res = await admin.graphql(ordersCountQuery, {
      variables: {
        q1: queryAfter,
        q2: queryBefore,
        q3: returnsQueryAfter,
        q4: returnsQueryBefore
      }
    });
    const json = await res.json();
    const data = json?.data ?? {};
    const ordersAfter = typeof data.ordersAfter?.count === 'number' ? data.ordersAfter.count : 0;
    const ordersBefore = typeof data.ordersBefore?.count === 'number' ? data.ordersBefore.count : 0;
    const returnsAfter = typeof data.returnsAfter?.count === 'number' ? data.returnsAfter.count : 0;
    const returnsBefore = typeof data.returnsBefore?.count === 'number' ? data.returnsBefore.count : 0;

    const conversionAfter = ordersAfter > 0 ? ((ordersAfter - returnsAfter) / ordersAfter) * 100 : null;
    const conversionBefore = ordersBefore > 0 ? ((ordersBefore - returnsBefore) / ordersBefore) * 100 : null;

    return Response.json({
      ordersBefore,
      ordersAfter,
      returnsBefore,
      returnsAfter,
      conversionBefore,
      conversionAfter,
      installDate: installDate || null,
      periodDays,
      error: null
    });
  } catch (err) {
    console.error('[api.analytics-orders]', err);
    return Response.json({
      ...fallback,
      error: err?.message || 'Erro ao buscar pedidos'
    }, { status: 200 });
  }
};
