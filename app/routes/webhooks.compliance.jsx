import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * Webhook de conformidade obrigatório para App Store
 * 
 * Este handler processa três tipos de webhooks de conformidade:
 * - customers/data_request: quando um cliente solicita ver seus dados
 * - customers/redact: quando um cliente solicita remoção de dados
 * - shop/redact: quando uma loja solicita remoção de todos os dados
 * 
 * A verificação HMAC é feita automaticamente pelo authenticate.webhook
 */
export const action = async ({ request }) => {
  try {
    // authenticate.webhook verifica automaticamente a assinatura HMAC
    // Se a verificação falhar, uma exceção será lançada
    const { payload, shop, topic } = await authenticate.webhook(request);

    console.log(`[Compliance Webhook] Received ${topic} webhook for ${shop}`);

    // Processar cada tipo de webhook de conformidade
    switch (topic) {
      case "customers/data_request":
        await handleDataRequest(payload, shop);
        break;

      case "customers/redact":
        await handleCustomerRedact(payload, shop);
        break;

      case "shop/redact":
        await handleShopRedact(payload, shop);
        break;

      default:
        console.warn(`[Compliance Webhook] Unknown topic: ${topic}`);
    }

    return new Response(null, { status: 200 });
  } catch (error) {
    console.error(`[Compliance Webhook] Error processing webhook:`, error);
    
    // Se a verificação HMAC falhar, authenticate.webhook lançará uma exceção
    // Retornar 401 para indicar falha de autenticação
    if (error.message?.includes("HMAC") || error.message?.includes("signature")) {
      return new Response("Unauthorized", { status: 401 });
    }
    
    // Outros erros retornam 500
    return new Response("Internal Server Error", { status: 500 });
  }
};

/**
 * Processa solicitação de dados do cliente (customers/data_request)
 */
async function handleDataRequest(payload, shop) {
  console.log(`[Compliance Webhook] Customer ID: ${payload.customer?.id || payload.customer_id}`);
  console.log(`[Compliance Webhook] Order IDs: ${payload.orders_requested?.join(", ") || "N/A"}`);

  // De acordo com a documentação da Shopify, você deve:
  // 1. Coletar todos os dados do cliente armazenados pelo app
  // 2. Enviar os dados para o endereço especificado em payload.data_request
  
  // Exemplo de implementação:
  // - Buscar dados do cliente no seu banco de dados
  // - Enviar para o endpoint especificado em payload.data_request
  
  // Por enquanto, apenas logamos a requisição
  // Em produção, você deve implementar a lógica de coleta e envio de dados
}

/**
 * Processa solicitação de remoção de dados do cliente (customers/redact)
 */
async function handleCustomerRedact(payload, shop) {
  console.log(`[Compliance Webhook] Customer ID: ${payload.customer?.id || payload.customer_id}`);
  console.log(`[Compliance Webhook] Customer Email: ${payload.customer?.email || "N/A"}`);

  // De acordo com a documentação da Shopify, você deve:
  // 1. Remover todos os dados pessoais do cliente armazenados pelo app
  // 2. Manter apenas dados agregados/anônimos se necessário para fins legais

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
  }
}

/**
 * Processa solicitação de remoção de dados da loja (shop/redact)
 */
async function handleShopRedact(payload, shop) {
  console.log(`[Compliance Webhook] Shop Domain: ${shop}`);

  // De acordo com a documentação da Shopify, você deve:
  // 1. Remover todos os dados da loja armazenados pelo app
  // 2. Manter apenas dados agregados/anônimos se necessário para fins legais

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
  }
}
