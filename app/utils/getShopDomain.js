/**
 * Obtém o shop domain de várias fontes possíveis
 * @param {URLSearchParams} searchParams - Parâmetros da URL
 * @returns {string|null} - Shop domain ou null se não encontrado
 */
export function getShopDomain(searchParams = null) {
  // 1. Tentar obter da URL (query params)
  if (searchParams) {
    const shopFromUrl = searchParams.get('shop');
    if (shopFromUrl) {
      // Salvar no localStorage para usar como fallback
      if (typeof window !== 'undefined') {
        localStorage.setItem('omafit_shop_domain', shopFromUrl);
      }
      return shopFromUrl;
    }
  }

  // 2. Tentar obter do localStorage
  if (typeof window !== 'undefined') {
    const shopFromStorage = localStorage.getItem('omafit_shop_domain');
    if (shopFromStorage) {
      return shopFromStorage;
    }
  }

  // 3. Tentar obter do window.Shopify (se disponível)
  if (typeof window !== 'undefined' && window.Shopify && window.Shopify.shop) {
    const shopFromShopify = window.Shopify.shop;
    if (shopFromShopify) {
      localStorage.setItem('omafit_shop_domain', shopFromShopify);
      return shopFromShopify;
    }
  }

  // 4. Tentar extrair da URL atual
  if (typeof window !== 'undefined') {
    const urlMatch = window.location.hostname.match(/([a-zA-Z0-9-]+\.myshopify\.com)/);
    if (urlMatch) {
      const shopFromHostname = urlMatch[1];
      localStorage.setItem('omafit_shop_domain', shopFromHostname);
      return shopFromHostname;
    }
  }

  // 5. Tentar obter dos search params da URL atual
  if (typeof window !== 'undefined') {
    const currentParams = new URLSearchParams(window.location.search);
    const shopFromCurrentUrl = currentParams.get('shop');
    if (shopFromCurrentUrl) {
      localStorage.setItem('omafit_shop_domain', shopFromCurrentUrl);
      return shopFromCurrentUrl;
    }
  }

  // Não encontrado - retornar null ao invés de fallback hardcoded
  console.warn('[getShopDomain] Shop domain não encontrado. Verifique se está acessando pelo Shopify Admin.');
  return null;
}









