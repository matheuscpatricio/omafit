/**
 * Script de Teste do Widget Omafit
 * 
 * Execute este código no Console do navegador (F12) em uma página de produto
 * para diagnosticar problemas com o widget.
 */

(function() {
  console.log('🔍 === DIAGNÓSTICO DO WIDGET OMAFIT ===\n');
  
  // 1. Verificar se script está carregado
  console.log('1️⃣ Verificando se script está carregado...');
  const scriptLoaded = typeof window.openOmafitModal !== 'undefined';
  console.log('   Script carregado:', scriptLoaded ? '✅ SIM' : '❌ NÃO');
  if (!scriptLoaded) {
    console.warn('   ⚠️ O script omafit-widget.js não está carregado!');
    console.warn('   ⚠️ Verifique se o bloco está adicionado ao tema.');
  }
  
  // 2. Verificar elemento root
  console.log('\n2️⃣ Verificando elemento root...');
  const root = document.getElementById('omafit-widget-root');
  if (root) {
    console.log('   ✅ Root element encontrado:', root);
    console.log('   Shop domain (root):', root.dataset.shopDomain || 'NÃO DEFINIDO');
    console.log('   Product ID:', root.dataset.productId || 'NÃO DEFINIDO');
  } else {
    console.error('   ❌ Root element NÃO encontrado!');
    console.error('   ❌ O bloco "Omafit embed" não está na página.');
    console.error('   ⚠️ Adicione o bloco no editor de tema.');
  }
  
  // 3. Verificar shop domain do Shopify
  console.log('\n3️⃣ Verificando shop domain...');
  if (window.Shopify && window.Shopify.shop) {
    console.log('   ✅ Shop domain (Shopify):', window.Shopify.shop);
  } else {
    console.warn('   ⚠️ window.Shopify.shop não disponível');
  }
  
  // 4. Verificar se link já existe
  console.log('\n4️⃣ Verificando se link já foi inserido...');
  const existingLink = document.querySelector('.omafit-try-on-link');
  if (existingLink) {
    console.log('   ✅ Link já existe na página:', existingLink);
    console.log('   Texto do link:', existingLink.textContent);
  } else {
    console.warn('   ⚠️ Link ainda não foi inserido');
  }
  
  // 5. Verificar botão de carrinho
  console.log('\n5️⃣ Verificando botão de carrinho...');
  const addToCartSelectors = [
    'button[name="add"]',
    'button[type="submit"][name="add"]',
    '.product-form__submit',
    'form[action*="/cart/add"] button[type="submit"]',
    '[name="add"]',
    'button[data-add-to-cart]',
    '.btn--add-to-cart'
  ];
  
  let foundButton = null;
  for (const sel of addToCartSelectors) {
    const btn = document.querySelector(sel);
    if (btn && btn.offsetParent !== null) {
      foundButton = btn;
      console.log('   ✅ Botão encontrado com seletor:', sel);
      break;
    }
  }
  
  if (!foundButton) {
    console.warn('   ⚠️ Botão "Adicionar ao carrinho" não encontrado');
    console.warn('   ⚠️ O widget pode não conseguir inserir o link automaticamente');
  }
  
  // 6. Tentar buscar configuração manualmente
  console.log('\n6️⃣ Tentando buscar configuração do Supabase...');
  const rootElement = document.getElementById('omafit-widget-root');
  let shopDomain = '';
  
  if (rootElement && rootElement.dataset.shopDomain) {
    shopDomain = rootElement.dataset.shopDomain;
  } else if (window.Shopify && window.Shopify.shop) {
    shopDomain = window.Shopify.shop;
  } else {
    const urlMatch = window.location.hostname.match(/([a-zA-Z0-9-]+\.myshopify\.com)/);
    if (urlMatch) {
      shopDomain = urlMatch[1];
    }
  }
  
  console.log('   Shop domain detectado:', shopDomain || 'NÃO ENCONTRADO');
  
  if (shopDomain) {
    // Tentar buscar configuração (você precisará substituir as credenciais)
    console.log('   ⚠️ Para verificar configuração no Supabase, execute:');
    console.log(`   fetch('https://lhkgnirolvbmomeduoaj.supabase.co/rest/v1/widget_keys?shop_domain=eq.${shopDomain}&select=is_active,public_id', {
      headers: {
        'apikey': 'SUA_CHAVE_AQUI',
        'Authorization': 'Bearer SUA_CHAVE_AQUI'
      }
    }).then(r => r.json()).then(console.log);`);
  }
  
  // 7. Tentar inicializar manualmente se possível
  console.log('\n7️⃣ Tentando inicializar manualmente...');
  if (typeof initOmafit === 'function') {
    console.log('   ✅ initOmafit disponível, tentando inicializar...');
    initOmafit().then(() => {
      console.log('   ✅ Inicialização concluída');
    }).catch(err => {
      console.error('   ❌ Erro ao inicializar:', err);
    });
  } else {
    console.warn('   ⚠️ initOmafit não está disponível (pode estar encapsulado)');
    if (scriptLoaded) {
      console.log('   💡 Tente chamar window.openOmafitModal() diretamente');
    }
  }
  
  // 8. Resumo
  console.log('\n📊 === RESUMO ===');
  console.log('Script carregado:', scriptLoaded ? '✅' : '❌');
  console.log('Root element:', root ? '✅' : '❌');
  console.log('Shop domain:', shopDomain ? '✅ ' + shopDomain : '❌');
  console.log('Botão carrinho:', foundButton ? '✅' : '❌');
  console.log('Link inserido:', existingLink ? '✅' : '❌');
  
  if (!scriptLoaded || !root || !shopDomain || !foundButton) {
    console.log('\n⚠️ PROBLEMAS DETECTADOS:');
    if (!scriptLoaded) console.log('   - Script não está carregando');
    if (!root) console.log('   - Bloco não está no tema');
    if (!shopDomain) console.log('   - Shop domain não detectado');
    if (!foundButton) console.log('   - Botão de carrinho não encontrado');
  } else {
    console.log('\n✅ Tudo parece estar OK!');
    if (!existingLink) {
      console.log('   ⚠️ Mas o link ainda não foi inserido.');
      console.log('   ⚠️ Pode ser que o widget esteja desabilitado no banco.');
      console.log('   💡 Execute o script supabase/patches/habilitar_widget.sql no Supabase.');
    }
  }
  
  console.log('\n🔍 === FIM DO DIAGNÓSTICO ===\n');
})();
