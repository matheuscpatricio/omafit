import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * Webhook obrigatório de conformidade: customers/redact
 * 
 * Este webhook é acionado quando um cliente solicita a remoção
 * de seus dados pessoais (conformidade com GDPR, CCPA, etc.)
 * 
 * A verificação HMAC é feita automaticamente pelo authenticate.webhook
 */
export const action = async ({ request }) => {
  try {
    // authenticate.webhook verifica automaticamente a assinatura HMAC
    // Se a verificação falhar, uma exceção será lançada
    const { payload, shop, topic } = await authenticate.webhook(request);

    console.log(`[Compliance Webhook] Received ${topic} webhook for ${shop}`);
    console.log(`[Compliance Webhook] Customer ID: ${payload.customer?.id || payload.customer_id}`);
    console.log(`[Compliance Webhook] Customer Email: ${payload.customer?.email || "N/A"}`);

    // De acordo com a documentação da Shopify, você deve:
    // 1. Remover todos os dados pessoais do cliente armazenados pelo app
    // 2. Manter apenas dados agregados/anônimos se necessário para fins legais

    // Exemplo de implementação: remover dados do cliente do Supabase
    try {
      const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
      const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
      const customerId = payload.customer?.id || payload.customer_id;

      if (supabaseUrl && supabaseKey && customerId) {
        // Aqui você deve implementar a lógica para remover dados do cliente
        // Por exemplo, se você armazena dados de clientes em alguma tabela:
        // await fetch(`${supabaseUrl}/rest/v1/seu_tabela?customer_id=eq.${customerId}`, {
        //   method: 'DELETE',
        //   headers: {
        //     'apikey': supabaseKey,
        //     'Authorization': `Bearer ${supabaseKey}`,
        //   }
        // });

        console.log(`[Compliance Webhook] Customer data redaction requested for customer ${customerId}`);
      }
    } catch (error) {
      console.error(`[Compliance Webhook] Error removing customer data:`, error);
      // Não falhar o webhook se houver erro na remoção de dados
      // A Shopify espera que você tente remover os dados, mas não falhe o webhook
    }

    return new Response(null, { status: 200 });
  } catch (error) {
    console.error(`[Compliance Webhook] Error processing customers/redact:`, error);
    
    // Se a verificação HMAC falhar, authenticate.webhook lançará uma exceção
    // Retornar 401 para indicar falha de autenticação
    if (error.message?.includes("HMAC") || error.message?.includes("signature")) {
      return new Response("Unauthorized", { status: 401 });
    }
    
    // Outros erros retornam 500
    return new Response("Internal Server Error", { status: 500 });
  }
};
