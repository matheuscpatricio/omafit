import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * Webhook obrigatório de conformidade: shop/redact
 * 
 * Este webhook é acionado quando uma loja solicita a remoção
 * de todos os dados relacionados à loja (conformidade com GDPR, CCPA, etc.)
 * 
 * A verificação HMAC é feita automaticamente pelo authenticate.webhook
 */
export const action = async ({ request }) => {
  try {
    // authenticate.webhook verifica automaticamente a assinatura HMAC
    // Se a verificação falhar, uma exceção será lançada
    const { payload, shop, topic } = await authenticate.webhook(request);

    console.log(`[Compliance Webhook] Received ${topic} webhook for ${shop}`);
    console.log(`[Compliance Webhook] Shop Domain: ${shop}`);

    // De acordo com a documentação da Shopify, você deve:
    // 1. Remover todos os dados da loja armazenados pelo app
    // 2. Manter apenas dados agregados/anônimos se necessário para fins legais

    // Exemplo de implementação: remover dados da loja do Supabase
    try {
      const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
      const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

      if (supabaseUrl && supabaseKey) {
        // Remover dados da loja do Supabase
        const response = await fetch(
          `${supabaseUrl}/rest/v1/widget_keys?shop_domain=eq.${encodeURIComponent(shop)}`,
          {
            method: 'DELETE',
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json',
            }
          }
        );

        if (response.ok) {
          console.log(`[Compliance Webhook] Shop data removed from Supabase for ${shop}`);
        } else {
          const errorText = await response.text();
          console.warn(`[Compliance Webhook] Error removing shop data: ${response.status} - ${errorText}`);
        }
      }

      // Remover sessão do banco de dados local (Prisma)
      if (shop) {
        await db.session.deleteMany({ where: { shop } });
        console.log(`[Compliance Webhook] Session data removed for ${shop}`);
      }
    } catch (error) {
      console.error(`[Compliance Webhook] Error removing shop data:`, error);
      // Não falhar o webhook se houver erro na remoção de dados
      // A Shopify espera que você tente remover os dados, mas não falhe o webhook
    }

    return new Response(null, { status: 200 });
  } catch (error) {
    console.error(`[Compliance Webhook] Error processing shop/redact:`, error);
    
    // Se a verificação HMAC falhar, authenticate.webhook lançará uma exceção
    // Retornar 401 para indicar falha de autenticação
    if (error.message?.includes("HMAC") || error.message?.includes("signature")) {
      return new Response("Unauthorized", { status: 401 });
    }
    
    // Outros erros retornam 500
    return new Response("Internal Server Error", { status: 500 });
  }
};
