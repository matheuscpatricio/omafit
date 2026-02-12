/**
 * Utilitário para reativar uma loja no Supabase após reinstalação
 * Esta função verifica se a loja existe em widget_keys e a reativa se necessário
 */

export async function reactivateShop(shopDomain) {
  if (!shopDomain) {
    console.warn('[ReactivateShop] Shop domain não fornecido');
    return { success: false, error: 'Shop domain não fornecido' };
  }

  try {
    const response = await fetch('/api/widget-keys/reactivate', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ shop: shopDomain })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('[ReactivateShop] Erro ao reativar via API:', data?.error || response.status);
      return { success: false, error: data?.error || `Erro HTTP: ${response.status}` };
    }
    return data;
  } catch (error) {
    console.error('[ReactivateShop] Erro inesperado:', error);
    return { success: false, error: error.message };
  }
}

