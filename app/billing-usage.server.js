/**
 * Funções para criar usage charges na Shopify quando o lojista ultrapassa o limite de imagens.
 * Usa App Subscription API - appUsageRecordCreate mutation.
 */

const GET_ACTIVE_SUBSCRIPTION = `#graphql
  query GetActiveSubscription {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        lineItems {
          id
          plan {
            ... on AppRecurringPricing {
              price {
                amount
                currencyCode
              }
              interval
              cappedAmount {
                amount
                currencyCode
              }
            }
          }
        }
      }
    }
  }
`;

const CREATE_USAGE_RECORD = `#graphql
  mutation AppUsageRecordCreate($subscriptionLineItemId: ID!, $price: MoneyInput!, $description: String!) {
    appUsageRecordCreate(
      subscriptionLineItemId: $subscriptionLineItemId
      price: $price
      description: $description
    ) {
      appUsageRecord {
        id
        price {
          amount
          currencyCode
        }
        description
        createdAt
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Obtém a subscription ativa e seu line item ID.
 * @param {object} admin - GraphQL admin client
 * @returns {Promise<{ subscriptionId: string, lineItemId: string, cappedAmount: number } | null>}
 */
export async function getActiveSubscriptionLineItem(admin) {
  try {
    const response = await admin.graphql(GET_ACTIVE_SUBSCRIPTION);
    const json = await response.json();
    const subscriptions = json?.data?.currentAppInstallation?.activeSubscriptions || [];
    const active = subscriptions.find((s) => (s.status || "").toUpperCase() === "ACTIVE");
    
    if (!active) {
      console.warn("[Usage Charge] No active subscription found");
      return null;
    }

    const lineItem = active.lineItems?.[0];
    if (!lineItem || !lineItem.id) {
      console.warn("[Usage Charge] No line item found in active subscription");
      return null;
    }

    const cappedAmount = lineItem.plan?.cappedAmount?.amount || null;
    
    return {
      subscriptionId: active.id,
      lineItemId: lineItem.id,
      cappedAmount: cappedAmount ? parseFloat(cappedAmount) : null,
    };
  } catch (err) {
    console.error("[Usage Charge] Error fetching subscription:", err);
    return null;
  }
}

/**
 * Cria um usage charge (usage record) na Shopify.
 * @param {object} admin - GraphQL admin client
 * @param {string} lineItemId - ID do line item da subscription
 * @param {number} price - Preço por imagem (ex: 0.18)
 * @param {string} currency - Código da moeda (ex: "USD")
 * @param {string} description - Descrição do uso (ex: "Geração de imagem adicional")
 * @returns {Promise<{ success: boolean, usageRecordId?: string, error?: string }>}
 */
export async function createUsageCharge(admin, lineItemId, price, currency = "USD", description = "Geração de imagem adicional") {
  try {
    console.log("[Usage Charge] Creating usage record:", { lineItemId, price, currency, description });
    
    const response = await admin.graphql(CREATE_USAGE_RECORD, {
      variables: {
        subscriptionLineItemId: lineItemId,
        price: {
          amount: price,
          currencyCode: currency,
        },
        description,
      },
    });

    const json = await response.json();
    const data = json?.data?.appUsageRecordCreate;
    const userErrors = data?.userErrors || [];

    if (userErrors.length > 0) {
      const msg = userErrors.map((e) => e.message).join("; ");
      console.error("[Usage Charge] User errors:", msg);
      return { success: false, error: msg };
    }

    const usageRecord = data?.appUsageRecord;
    if (!usageRecord) {
      console.error("[Usage Charge] No usage record returned");
      return { success: false, error: "No usage record returned from Shopify" };
    }

    console.log("[Usage Charge] Usage record created successfully:", {
      id: usageRecord.id,
      price: usageRecord.price,
      description: usageRecord.description,
    });

    return {
      success: true,
      usageRecordId: usageRecord.id,
      price: usageRecord.price,
      description: usageRecord.description,
    };
  } catch (err) {
    console.error("[Usage Charge] Error creating usage record:", err);
    return {
      success: false,
      error: err.message || "Failed to create usage record",
    };
  }
}

/**
 * Verifica se deve criar usage charge e cria se necessário.
 * IMPORTANTE: Esta função deve ser chamada APENAS quando uma nova imagem é gerada que ultrapassa o limite.
 * A edge function do Supabase deve chamar esta API apenas uma vez por imagem gerada.
 * 
 * @param {object} admin - GraphQL admin client
 * @param {number} imagesUsed - Número total de imagens já usadas no mês (após gerar a nova)
 * @param {number} planLimit - Limite de imagens do plano
 * @param {number} pricePerExtra - Preço por imagem extra
 * @param {string} currency - Código da moeda
 * @param {number} imagesCount - Número de imagens sendo geradas nesta chamada (padrão: 1)
 * @returns {Promise<{ created: boolean, usageRecordId?: string, error?: string }>}
 */
export async function createUsageChargeIfNeeded(admin, imagesUsed, planLimit, pricePerExtra, currency = "USD", imagesCount = 1) {
  // Só cria usage charge se ultrapassou o limite
  if (imagesUsed <= planLimit) {
    return { created: false, reason: "Within plan limit" };
  }

  // Calcula quantas imagens desta chamada são extras
  const previousUsed = imagesUsed - imagesCount;
  const extraFromThisCall = Math.max(0, imagesUsed - Math.max(planLimit, previousUsed));
  
  if (extraFromThisCall <= 0) {
    return { created: false, reason: "No extra images in this call" };
  }

  // Obtém subscription ativa
  const subscription = await getActiveSubscriptionLineItem(admin);
  if (!subscription) {
    return { created: false, error: "No active subscription found" };
  }

  // Verifica capped_amount se existir
  if (subscription.cappedAmount !== null) {
    console.log("[Usage Charge] Subscription has capped amount:", subscription.cappedAmount, currency);
    // Nota: A Shopify gerencia o capped_amount automaticamente. Se tentarmos criar um usage record
    // que ultrapassaria o capped, a Shopify retornará erro. Tratamos isso no createUsageCharge.
  }

  // Cria usage charge apenas para as imagens extras desta chamada
  const totalPrice = extraFromThisCall * pricePerExtra;
  const description = extraFromThisCall === 1 
    ? "Geração de imagem adicional" 
    : `Geração de ${extraFromThisCall} imagens adicionais`;

  console.log("[Usage Charge] Creating charge for extra images:", {
    imagesUsed,
    planLimit,
    extraFromThisCall,
    totalPrice,
    currency,
  });

  const result = await createUsageCharge(
    admin,
    subscription.lineItemId,
    totalPrice,
    currency,
    description
  );

  if (result.success) {
    return {
      created: true,
      usageRecordId: result.usageRecordId,
      price: totalPrice,
      currency,
      extraImages: extraFromThisCall,
    };
  }

  return {
    created: false,
    error: result.error,
  };
}

export { GET_ACTIVE_SUBSCRIPTION, CREATE_USAGE_RECORD };
