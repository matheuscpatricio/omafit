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
    const shorten = (msg) => {
      const text = String(msg || '').trim();
      if (!text) return '';
      return text.length > 180 ? `${text.slice(0, 180)}...` : text;
    };

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
      const conciseError = shorten(data?.error) || `Erro HTTP: ${response.status}`;
      console.warn('[ReactivateShop] Falha não crítica ao reativar:', conciseError);
      return { success: false, error: conciseError };
    }
    return data;
  } catch (error) {
    const conciseError = error?.message ? String(error.message) : 'Erro inesperado';
    console.warn('[ReactivateShop] Erro inesperado (não crítico):', conciseError);
    return { success: false, error: conciseError };
  }
}

