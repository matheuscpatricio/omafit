import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`[Webhook] Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  // Marcar loja como inativa no Supabase
  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

    if (supabaseUrl && supabaseKey) {
      const response = await fetch(
        `${supabaseUrl}/rest/v1/widget_keys?shop_domain=eq.${encodeURIComponent(shop)}`,
        {
          method: 'PATCH',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify({
            is_active: false,
            updated_at: new Date().toISOString()
          })
        }
      );

      if (response.ok) {
        console.log(`[Webhook] Loja ${shop} marcada como inativa no Supabase`);
      } else {
        const errorText = await response.text();
        console.warn(`[Webhook] Erro ao marcar loja como inativa: ${response.status} - ${errorText}`);
      }
    } else {
      console.warn('[Webhook] Variáveis de ambiente do Supabase não configuradas');
    }
  } catch (error) {
    console.error(`[Webhook] Erro ao atualizar Supabase:`, error);
    // Não falhar o webhook se houver erro no Supabase
  }

  return new Response();
};
