/**
 * POST /api/billing/usage
 *
 * Registra uso de imagens e cria cobrança automática se necessário
 *
 * Body esperado:
 * {
 *   "shopDomain": "minha-loja.myshopify.com",
 *   "imagesCount": 1
 * }
 *
 * Retorna:
 * {
 *   "success": true,
 *   "billed": true,
 *   "amount": 0.17,
 *   "currency": "USD",
 *   "imagesCount": 1,
 *   "message": "..."
 * }
 */

export const registerImageUsage = async (shopDomain, imagesCount = 1) => {
  try {
    if (!shopDomain) {
      throw new Error('shopDomain is required');
    }

    if (typeof imagesCount !== 'number' || imagesCount < 1) {
      throw new Error('imagesCount must be a number greater than 0');
    }

    console.log(`[API Usage] Registering ${imagesCount} images for ${shopDomain}`);

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    const response = await fetch(`${supabaseUrl}/functions/v1/shopify-billing-usage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`
      },
      body: JSON.stringify({
        shopDomain,
        imagesCount
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Error registering usage');
    }

    const result = await response.json();
    return result;

  } catch (error) {
    console.error('[API Usage] Error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

