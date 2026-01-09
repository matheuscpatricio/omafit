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
    // Esta função roda apenas no cliente (navegador)
    // window.ENV é exposto pelo loader do React Router (app.jsx)
    // As variáveis são passadas do servidor para o cliente via loader
    const supabaseUrl = typeof window !== 'undefined' && window.ENV?.VITE_SUPABASE_URL ? window.ENV.VITE_SUPABASE_URL : '';
    const supabaseKey = typeof window !== 'undefined' && window.ENV?.VITE_SUPABASE_ANON_KEY ? window.ENV.VITE_SUPABASE_ANON_KEY : '';

    if (!supabaseUrl || !supabaseKey) {
      console.warn('[ReactivateShop] Variáveis de ambiente do Supabase não configuradas');
      return { success: false, error: 'Supabase não configurado' };
    }

    // Verificar se a loja existe e está inativa
    const checkResponse = await fetch(
      `${supabaseUrl}/rest/v1/widget_keys?shop_domain=eq.${encodeURIComponent(shopDomain)}&select=is_active,public_id`,
      {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!checkResponse.ok) {
      console.error(`[ReactivateShop] Erro ao verificar loja: ${checkResponse.status}`);
      return { success: false, error: `Erro HTTP: ${checkResponse.status}` };
    }

    const shopData = await checkResponse.json();
    
    if (!shopData || shopData.length === 0) {
      // Loja não existe, pode ser a primeira instalação
      console.log(`[ReactivateShop] Loja ${shopDomain} não encontrada em widget_keys. Pode ser primeira instalação.`);
      
      // Gerar public_id baseado no shop_domain (hash SHA256 truncado)
      // Usar Web Crypto API para gerar hash similar ao do SQL
      let publicId;
      if (typeof crypto !== 'undefined' && crypto.subtle) {
        const encoder = new TextEncoder();
        const data = encoder.encode(shopDomain);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        publicId = `wgt_pub_${hashHex.substring(0, 24)}`;
      } else {
        // Fallback para navegadores sem Web Crypto API
        let hash = 0;
        for (let i = 0; i < shopDomain.length; i++) {
          const char = shopDomain.charCodeAt(i);
          hash = ((hash << 5) - hash) + char;
          hash = hash & hash;
        }
        publicId = `wgt_pub_${Math.abs(hash).toString(36).substring(0, 24)}`;
      }
      
      // Criar novo registro
      const createResponse = await fetch(
        `${supabaseUrl}/rest/v1/widget_keys`,
        {
          method: 'POST',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify({
            shop_domain: shopDomain,
            public_id: publicId,
            is_active: true
          })
        }
      );

      if (createResponse.ok) {
        console.log(`[ReactivateShop] Loja ${shopDomain} criada e ativada`);
        return { success: true, created: true, publicId };
      } else {
        const errorText = await createResponse.text();
        console.error(`[ReactivateShop] Erro ao criar loja: ${errorText}`);
        return { success: false, error: errorText };
      }
    }

    const shop = shopData[0];
    
    // Se já está ativa, não precisa fazer nada
    if (shop.is_active === true) {
      console.log(`[ReactivateShop] Loja ${shopDomain} já está ativa`);
      return { success: true, alreadyActive: true, publicId: shop.public_id };
    }

    // Reativar a loja
    const reactivateResponse = await fetch(
      `${supabaseUrl}/rest/v1/widget_keys?shop_domain=eq.${encodeURIComponent(shopDomain)}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          is_active: true,
          updated_at: new Date().toISOString()
        })
      }
    );

    if (reactivateResponse.ok) {
      const updatedData = await reactivateResponse.json();
      console.log(`[ReactivateShop] Loja ${shopDomain} reativada com sucesso`);
      return { 
        success: true, 
        reactivated: true, 
        publicId: updatedData[0]?.public_id || shop.public_id 
      };
    } else {
      const errorText = await reactivateResponse.text();
      console.error(`[ReactivateShop] Erro ao reativar loja: ${errorText}`);
      return { success: false, error: errorText };
    }
  } catch (error) {
    console.error('[ReactivateShop] Erro inesperado:', error);
    return { success: false, error: error.message };
  }
}

