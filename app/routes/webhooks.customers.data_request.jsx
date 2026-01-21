import { authenticate } from "../shopify.server";

/**
 * Webhook obrigatório de conformidade: customers/data_request
 * 
 * Este webhook é acionado quando um cliente solicita ver os dados
 * que a loja possui sobre ele (conformidade com GDPR, CCPA, etc.)
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
    console.log(`[Compliance Webhook] Order IDs: ${payload.orders_requested?.join(", ") || "N/A"}`);

    // De acordo com a documentação da Shopify, você deve:
    // 1. Coletar todos os dados do cliente armazenados pelo app
    // 2. Enviar os dados para o endereço especificado em payload.data_request
    
    // Exemplo de implementação:
    // - Buscar dados do cliente no seu banco de dados
    // - Enviar para o endpoint especificado em payload.data_request
    
    // Por enquanto, apenas logamos a requisição
    // Em produção, você deve implementar a lógica de coleta e envio de dados

    return new Response(null, { status: 200 });
  } catch (error) {
    console.error(`[Compliance Webhook] Error processing customers/data_request:`, error);
    
    // Se a verificação HMAC falhar, authenticate.webhook lançará uma exceção
    // Retornar 401 para indicar falha de autenticação
    if (error.message?.includes("HMAC") || error.message?.includes("signature")) {
      return new Response("Unauthorized", { status: 401 });
    }
    
    // Outros erros retornam 500
    return new Response("Internal Server Error", { status: 500 });
  }
};
