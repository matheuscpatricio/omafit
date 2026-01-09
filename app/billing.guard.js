/**
 * Billing Guard - Middleware para proteger rotas que exigem billing ativo
 *
 * Use estas funções para garantir que a loja tem uma assinatura ativa
 * antes de permitir acesso a features premium
 */

import { redirect } from 'react-router-dom';
const json = (data, init) => Response.json(data, init);
import { getShopBilling, isEnterprisePlan } from './shopify-billing.server';

/**
 * Verifica se a loja tem billing ativo
 * @param {string} shopDomain - Domínio da loja
 * @param {boolean} allowEnterprise - Permitir plano Enterprise (default: true)
 * @returns {Promise<Object>} { hasAccess: boolean, shop: Object|null, reason: string }
 */
export async function checkBillingAccess(shopDomain, allowEnterprise = true) {
  try {
    const shop = await getShopBilling(shopDomain);

    // Loja não encontrada
    if (!shop) {
      return {
        hasAccess: false,
        shop: null,
        reason: 'no_billing_configured',
        message: 'Por favor, configure seu plano de assinatura.'
      };
    }

    // Plano Enterprise
    if (shop.plan === 'enterprise') {
      if (allowEnterprise) {
        return {
          hasAccess: true,
          shop,
          reason: 'enterprise',
          message: 'Acesso via plano Enterprise'
        };
      } else {
        return {
          hasAccess: false,
          shop,
          reason: 'enterprise_not_allowed',
          message: 'Esta feature não está disponível no plano Enterprise'
        };
      }
    }

    // Verificar status de billing
    if (shop.billing_status !== 'active') {
      return {
        hasAccess: false,
        shop,
        reason: 'billing_inactive',
        message: `Assinatura ${shop.billing_status}. Por favor, ative seu plano.`
      };
    }

    // Tudo ok!
    return {
      hasAccess: true,
      shop,
      reason: 'active',
      message: 'Acesso autorizado'
    };

  } catch (error) {
    console.error('Erro ao verificar billing:', error);
    return {
      hasAccess: false,
      shop: null,
      reason: 'error',
      message: 'Erro ao verificar assinatura'
    };
  }
}

/**
 * Middleware para proteger rotas (Remix loader/action)
 * Se não tiver billing ativo, retorna erro JSON
 *
 * @param {string} shopDomain - Domínio da loja
 * @param {Object} options - Opções
 * @param {boolean} options.allowEnterprise - Permitir Enterprise (default: true)
 * @param {string} options.redirectTo - Redirecionar para esta URL se não tiver acesso (default: null)
 * @returns {Promise<Object|null>} null se tem acesso, Response se não tem
 */
export async function requireBilling(shopDomain, options = {}) {
  const { allowEnterprise = true, redirectTo = null } = options;

  const result = await checkBillingAccess(shopDomain, allowEnterprise);

  if (result.hasAccess) {
    // Tem acesso, retornar null (deixar continuar)
    return null;
  }

  // Não tem acesso
  if (redirectTo) {
    // Redirecionar para página de billing
    return redirect(redirectTo);
  } else {
    // Retornar erro JSON
    return json(
      {
        error: result.message,
        reason: result.reason,
        hasAccess: false
      },
      { status: 403 }
    );
  }
}

/**
 * Verifica se a loja atingiu o limite de imagens do mês
 * @param {string} shopDomain - Domínio da loja
 * @returns {Promise<Object>} { withinLimit: boolean, used: number, included: number, remaining: number }
 */
export async function checkImageLimit(shopDomain) {
  const shop = await getShopBilling(shopDomain);

  if (!shop) {
    return {
      withinLimit: false,
      used: 0,
      included: 0,
      remaining: 0,
      error: 'Loja não encontrada'
    };
  }

  // Plano Enterprise não tem limite
  if (shop.plan === 'enterprise') {
    return {
      withinLimit: true,
      used: shop.images_used_month || 0,
      included: 999999,
      remaining: 999999,
      isEnterprise: true
    };
  }

  const used = shop.images_used_month || 0;
  const included = shop.images_included || 0;
  const remaining = Math.max(0, included - used);

  // Verificar se está dentro do limite
  // Nota: Não bloqueamos se ultrapassar, apenas informamos
  // O billing por uso cobrará automaticamente pelas extras
  return {
    withinLimit: used <= included,
    used,
    included,
    remaining,
    percentage: Math.min(100, Math.round((used / included) * 100))
  };
}

/**
 * Wrapper para uso em loaders/actions do Remix
 *
 * Exemplo de uso:
 *
 * export const loader = async ({ request }) => {
 *   const { session } = await authenticate.admin(request);
 *   const shopDomain = session.shop;
 *
 *   // Verificar billing
 *   const billingError = await requireBilling(shopDomain, {
 *     redirectTo: '/app/billing'
 *   });
 *   if (billingError) return billingError;
 *
 *   // Se chegou aqui, tem billing ativo!
 *   // ... resto da lógica ...
 * };
 */

/**
 * Middleware mais simples para usar em qualquer função
 * Lança exceção se não tiver billing ativo
 *
 * @param {string} shopDomain - Domínio da loja
 * @throws {Error} Se não tiver billing ativo
 */
export async function assertBillingActive(shopDomain) {
  const result = await checkBillingAccess(shopDomain);

  if (!result.hasAccess) {
    throw new Error(result.message);
  }

  return result.shop;
}
