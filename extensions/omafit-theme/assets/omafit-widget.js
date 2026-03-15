// Omafit - Widget oficial adaptado para Theme App Extension
(function () {
  const OMAFIT_WIDGET_ORIGIN = 'https://omafit.netlify.app';
  const OMAFIT_DEBUG = typeof window !== 'undefined' && (window.omafitDebug === true || /[?&]omafit_debug=1/.test(window.location.search));

  // Configuração global (será preenchida pela API)
  let OMAFIT_CONFIG = null;

  // Carregar fontes do Google Fonts apenas quando o modal for aberto (evita bloquear carregamento inicial)
  const fontsToLoad = [
    'Outfit:wght@100..900',
    'Playfair+Display:wght@400..900',
    'Raleway:wght@100..900',
    'Inter:opsz,wght@14..32,100..900'
  ];

  function loadOmafitFontsWhenNeeded() {
    fontsToLoad.forEach((font) => {
      const fontName = font.split(':')[0];
      if (!document.querySelector('link[href*="' + fontName + '"]')) {
        const link = document.createElement('link');
        link.href = 'https://fonts.googleapis.com/css2?family=' + font + '&display=swap';
        link.rel = 'stylesheet';
        document.head.appendChild(link);
      }
    });
  }

  // Normalizar URLs
  function normalizeUrl(url) {
    if (!url) return null;
    if (url.startsWith('//')) {
      return 'https:' + url;
    }
    return url;
  }

  function decodeHtmlEntities(value) {
    const raw = String(value || '');
    if (!raw) return '';
    const textarea = document.createElement('textarea');
    textarea.innerHTML = raw;
    return textarea.value || '';
  }

  function normalizeProductDescriptionText(value) {
    const raw = String(value || '');
    if (!raw) return '';
    const withoutHtml = raw.replace(/<[^>]*>/g, ' ');
    const decoded = decodeHtmlEntities(withoutHtml);
    return decoded.replace(/\s+/g, ' ').trim();
  }

  function sanitizeProductHandle(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return raw.split('?')[0].split('#')[0].trim();
  }

  function extractProductHandleFromPathname() {
    try {
      const pathname = String(window.location.pathname || '');
      const marker = '/products/';
      const idx = pathname.indexOf(marker);
      if (idx === -1) return '';
      const rest = pathname.slice(idx + marker.length);
      const handle = rest.split('/')[0];
      return sanitizeProductHandle(decodeURIComponent(handle));
    } catch (_err) {
      return '';
    }
  }

  function extractDescriptionFromJsonLd() {
    try {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const script of scripts) {
        const raw = script.textContent || '';
        if (!raw.trim()) continue;
        let data;
        try {
          data = JSON.parse(raw);
        } catch (_err) {
          continue;
        }
        const nodes = Array.isArray(data) ? data : [data];
        for (const node of nodes) {
          if (!node || typeof node !== 'object') continue;
          const typeValue = Array.isArray(node['@type']) ? node['@type'].join(',') : String(node['@type'] || '');
          if (typeValue.toLowerCase().indexOf('product') === -1) continue;
          const desc = String(node.description || '').trim();
          if (desc) return desc;
        }
      }
    } catch (_err) {
      // non-blocking
    }
    return '';
  }

  // Obter só imagens de produto, usando várias fontes de dados Shopify
  async function getOnlyProductImages() {
    // 1. window.meta.product
    if (window.meta && window.meta.product) {
      const p = window.meta.product;
      const imgs = [];

      if (Array.isArray(p.media)) {
        p.media.forEach((m) => {
          if (m.src) imgs.push(normalizeUrl(m.src));
          else if (m.preview_image && m.preview_image.src) imgs.push(normalizeUrl(m.preview_image.src));
        });
      }

      if (Array.isArray(p.images)) {
        p.images.forEach((i) => imgs.push(normalizeUrl(i)));
      }

      if (imgs.length > 0) {
        console.log('✅ Imagens encontradas via window.meta.product:', imgs.length);
        return [...new Set(imgs)];
      }
    }

    // 2. ShopifyAnalytics
    if (
      window.ShopifyAnalytics &&
      window.ShopifyAnalytics.meta &&
      window.ShopifyAnalytics.meta.product &&
      Array.isArray(window.ShopifyAnalytics.meta.product.images)
    ) {
      const imgs = window.ShopifyAnalytics.meta.product.images.map((i) => normalizeUrl(i));
      console.log('✅ Imagens encontradas via ShopifyAnalytics:', imgs.length);
      return imgs;
    }

    // 3. Fallback /products/{handle}.js
    const handlePart = window.location.pathname.split('/products/')[1];
    if (handlePart) {
      const handle = handlePart.split('/')[0];
      try {
        const res = await fetch('/products/' + handle + '.js');
        const product = await res.json();
        if (Array.isArray(product.images)) {
          const imgs = product.images.map((i) => normalizeUrl(i));
          console.log('✅ Imagens encontradas via product.js:', imgs.length);
          return imgs;
        }
      } catch (e) {
        console.error('Erro ao buscar produto:', e);
      }
    }

    return [];
  }

  // Tentar encontrar imagem do produto na página
  function getProductImageFromPage() {
    // 1. Elemento #omafit-featured-image (se loja quiser configurar)
    const omafitImage = document.querySelector('#omafit-featured-image');
    if (omafitImage) {
      if (omafitImage.dataset && omafitImage.dataset.src) {
        console.log('✅ Imagem via #omafit-featured-image[data-src]');
        return normalizeUrl(omafitImage.dataset.src);
      }
      if (omafitImage.src) {
        console.log('✅ Imagem via #omafit-featured-image[src]');
        return normalizeUrl(omafitImage.src);
      }
      const dataSrcAttr = omafitImage.getAttribute('data-src');
      if (dataSrcAttr) {
        console.log('✅ Imagem via #omafit-featured-image[data-src] (getAttribute)');
        return normalizeUrl(dataSrcAttr);
      }
    }

    // 2. Meta og:image
    const ogImage = document.querySelector('meta[property="og:image"]');
    if (ogImage) {
      const content = ogImage.getAttribute('content');
      if (content) {
        console.log('✅ Imagem via og:image');
        return normalizeUrl(content);
      }
    }

    // 3. Selectores comuns de tema Shopify
    const shopifySelectors = [
      '.product__media--featured img',
      '.product__media img[src*="cdn.shopify.com"]',
      '.product-single__photo img',
      '[data-product-featured-media] img'
    ];

    for (const selector of shopifySelectors) {
      const img = document.querySelector(selector);
      if (img && img.src) {
        console.log('✅ Imagem via seletor Shopify:', selector);
        return normalizeUrl(img.src);
      }
    }

    // 4. Fallback: primeira imagem grande
    const allImages = document.querySelectorAll('.product__media img, .product img, [class*="product"] img');
    for (const img of allImages) {
      if (img.naturalWidth > 300 && img.naturalHeight > 300) {
        console.log('✅ Imagem via fallback (imagem grande)');
        return normalizeUrl(img.src);
      }
    }

    console.warn('⚠️ Nenhuma imagem de produto encontrada');
    return null;
  }

  // Capturar info do produto
  function getProductInfo() {
    let productId = '';
    let productName = '';
    let productDescription = '';
    let productDescriptionHtml = '';
    let productHandle = '';

    // Pegar do elemento omafit-widget-root primeiro (prioridade)
    const rootElement = document.getElementById('omafit-widget-root');
    if (rootElement) {
      productId = rootElement.dataset.productId || '';
      productHandle = rootElement.dataset.productHandle || '';
      productName = rootElement.dataset.productTitle || '';
      productDescription = rootElement.dataset.productDescription || '';
      productDescriptionHtml = rootElement.dataset.productDescriptionHtml || '';
    }

    // Complementar dados por window.meta.product (mesmo quando productId já existe)
    if (window.meta && window.meta.product) {
      productId = productId || window.meta.product.id;
      productName = productName || window.meta.product.title;
      productDescription = productDescription || window.meta.product.description || '';
      productDescriptionHtml = productDescriptionHtml || window.meta.product.description || '';
    } else if (
      window.ShopifyAnalytics &&
      window.ShopifyAnalytics.meta &&
      window.ShopifyAnalytics.meta.product
    ) {
      productId = productId || window.ShopifyAnalytics.meta.product.id;
      productName = productName || window.ShopifyAnalytics.meta.product.name;
    }

    // Nome do produto
    if (!productName) {
      const nameEl = document.querySelector(
        '.product-single__title, h1.product__title, .product__title, [itemprop="name"]'
      );
      if (nameEl) productName = nameEl.textContent.trim();
    }

    // Descrição do produto
    if (!productDescription) {
      const descEl = document.querySelector(
        '.product__description, .product-single__description, [itemprop="description"]'
      );
      if (descEl) {
        productDescription = (descEl.textContent || '').trim();
        productDescriptionHtml = productDescriptionHtml || (descEl.innerHTML || '');
      }
    }

    if (!productDescription) {
      const jsonLdDescription = extractDescriptionFromJsonLd();
      if (jsonLdDescription) {
        productDescription = jsonLdDescription;
      }
    }

    if (!productDescription) {
      const ogDescription = document.querySelector('meta[property="og:description"]');
      if (ogDescription && ogDescription.content) {
        productDescription = ogDescription.content.trim();
      }
    }

    // Handle do produto
    if (!productHandle) {
      productHandle = extractProductHandleFromPathname();
    }

    productHandle = sanitizeProductHandle(productHandle);
    const finalDescriptionText = normalizeProductDescriptionText(productDescription);
    const finalDescriptionHtml = String(productDescriptionHtml || '').trim();
    return {
      productId,
      productName,
      productDescription: finalDescriptionText,
      productDescriptionHtml: finalDescriptionHtml,
      productHandle
    };
  }

  async function enrichProductInfo(productInfo) {
    try {
      const info = productInfo || {};
      const handle = info.productHandle ? String(info.productHandle).trim() : '';
      if (!handle) return info;

      // Só consulta o endpoint da Shopify se faltar algum campo-chave
      if (info.productName && info.productDescription) return info;

      const response = await fetch(`/products/${encodeURIComponent(handle)}.js`);
      if (!response.ok) return info;

      const data = await response.json();
      const shopifyDescriptionHtml = typeof data?.description === 'string' ? data.description : '';
      const shopifyDescriptionText = normalizeProductDescriptionText(shopifyDescriptionHtml);
      const currentDescriptionText = normalizeProductDescriptionText(info.productDescription || '');
      const currentDescriptionHtml = String(info.productDescriptionHtml || '').trim();
      return {
        productId: info.productId || data?.id || '',
        productName: info.productName || data?.title || '',
        productDescription: shopifyDescriptionText || currentDescriptionText,
        productDescriptionHtml: shopifyDescriptionHtml || currentDescriptionHtml,
        productHandle: handle
      };
    } catch (_err) {
      return productInfo;
    }
  }

  function detectStoreDisplayName(shopDomain) {
    try {
      // 1) Meta OG costuma refletir o nome comercial da loja
      const ogSiteName = document.querySelector('meta[property="og:site_name"]');
      if (ogSiteName && ogSiteName.content && ogSiteName.content.trim()) {
        return ogSiteName.content.trim();
      }

      // 2) application-name (quando definido pelo tema)
      const appName = document.querySelector('meta[name="application-name"]');
      if (appName && appName.content && appName.content.trim()) {
        return appName.content.trim();
      }

      // 3) Título da página: "Produto - Nome da loja"
      if (document.title && document.title.trim()) {
        const title = document.title.trim();
        const parts = title.split(' - ').map(function (p) { return p.trim(); }).filter(Boolean);
        if (parts.length > 1) return parts[parts.length - 1];
      }

    } catch (_err) {
      // non-blocking
    }

    return '';
  }

  function ensureStoreName(configObj) {
    try {
      const cfg = configObj || {};
      const current = cfg.storeName ? String(cfg.storeName).trim() : '';
      if (current) return current;

      const domain = cfg.shopDomain ? String(cfg.shopDomain).trim() : '';
      const detected = detectStoreDisplayName(domain);
      if (detected && String(detected).trim()) return String(detected).trim();
    } catch (_err) {
      // non-blocking
    }
    return '';
  }

  function detectStoreLanguage() {
    try {
      var candidates = [
        window.Shopify && window.Shopify.locale ? String(window.Shopify.locale) : '',
        window.Shopify && window.Shopify.language ? String(window.Shopify.language) : '',
        document.documentElement && document.documentElement.lang ? String(document.documentElement.lang) : '',
        navigator.language ? String(navigator.language) : ''
      ].map(function (v) { return String(v || '').trim(); }).filter(Boolean);

      for (var i = 0; i < candidates.length; i += 1) {
        var raw = candidates[i].replace('_', '-');
        var normalized = raw.match(/^[a-z]{2}(-[A-Z]{2})?$/i) ? raw : '';
        if (normalized) {
          var parts = normalized.split('-');
          var lang = (parts[0] || '').toLowerCase();
          var region = parts[1] ? parts[1].toUpperCase() : '';
          return region ? (lang + '-' + region) : lang;
        }
      }
    } catch (_err) {
      // non-blocking
    }
    return 'pt-BR';
  }

  function normalizeLanguageTag(value) {
    try {
      var raw = String(value || '').trim().replace('_', '-');
      if (!raw) return '';
      if (!/^[a-z]{2}(-[A-Z]{2})?$/i.test(raw)) return '';
      var parts = raw.split('-');
      var lang = (parts[0] || '').toLowerCase();
      var region = parts[1] ? parts[1].toUpperCase() : '';
      return region ? (lang + '-' + region) : lang;
    } catch (_e) {
      return '';
    }
  }

  function normalizeOptionName(value) {
    return String(value || '').trim().toLowerCase();
  }

  function isSizeOptionName(name) {
    const n = normalizeOptionName(name);
    return n === 'size' || n === 'tamanho' || n === 'talla' || n === 'taille';
  }

  function isColorOptionName(name) {
    const n = normalizeOptionName(name);
    return n === 'color' || n === 'cor' || n === 'colour' || n === 'couleur';
  }

  function inferSizeValue(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const n = raw.toLowerCase();
    if (/^(pp|p|m|g|gg|xg|xs|s|l|xl|xxl|xxxl)$/.test(n)) return raw;
    if (/^\d{1,3}(\s?(br|eu|us))?$/i.test(raw)) return raw;
    return '';
  }

  async function fetchProductJsonByHandle(productHandle) {
    const handle = sanitizeProductHandle(productHandle);
    if (!handle) return null;
    try {
      const res = await fetch('/products/' + encodeURIComponent(handle) + '.js');
      if (!res.ok) return null;
      return await res.json();
    } catch (_err) {
      return null;
    }
  }

  async function getCurrentProductData(productInfo) {
    const info = productInfo || getProductInfo();
    const handle = sanitizeProductHandle(info && info.productHandle ? info.productHandle : '');
    const byHandle = await fetchProductJsonByHandle(handle);
    if (byHandle && Array.isArray(byHandle.variants) && byHandle.variants.length > 0) {
      return byHandle;
    }

    if (window.meta && window.meta.product && Array.isArray(window.meta.product.variants)) {
      const p = window.meta.product;
      return {
        id: p.id,
        title: p.title || '',
        description: p.description || '',
        options: p.options || [],
        variants: p.variants || []
      };
    }

    if (
      window.ShopifyAnalytics &&
      window.ShopifyAnalytics.meta &&
      window.ShopifyAnalytics.meta.product &&
      Array.isArray(window.ShopifyAnalytics.meta.product.variants)
    ) {
      const p = window.ShopifyAnalytics.meta.product;
      return {
        id: p.id,
        title: p.name || '',
        description: '',
        options: p.options || [],
        variants: p.variants || []
      };
    }

    return null;
  }

  function buildProductVariantCatalog(productData) {
    const emptyCatalog = { sizes: [], colors: [], variants: [] };
    if (!productData || !Array.isArray(productData.variants) || productData.variants.length === 0) {
      return emptyCatalog;
    }

    const options = Array.isArray(productData.options) ? productData.options : [];
    const optionNames = options.map(function (opt) {
      return typeof opt === 'string' ? opt : (opt && opt.name ? String(opt.name) : '');
    });
    const sizeOptionIndex = optionNames.findIndex(isSizeOptionName);
    const colorOptionIndex = optionNames.findIndex(isColorOptionName);
    const sizeSet = new Set();
    const colorSet = new Set();

    const variants = productData.variants.map(function (variant) {
      const values = [variant.option1, variant.option2, variant.option3]
        .map(function (v) { return String(v || '').trim(); });

      const namedOptions = {};
      for (let i = 0; i < values.length; i += 1) {
        if (!values[i]) continue;
        const key = optionNames[i] || ('option' + (i + 1));
        namedOptions[key] = values[i];
      }

      if (sizeOptionIndex >= 0 && values[sizeOptionIndex]) {
        sizeSet.add(values[sizeOptionIndex]);
      }
      if (colorOptionIndex >= 0 && values[colorOptionIndex]) {
        colorSet.add(values[colorOptionIndex]);
      }

      if (sizeOptionIndex < 0) {
        values.forEach(function (v) {
          const inferred = inferSizeValue(v);
          if (inferred) sizeSet.add(inferred);
        });
      }

      if (colorOptionIndex < 0) {
        values.forEach(function (v) {
          if (!v) return;
          const inferredSize = inferSizeValue(v);
          if (!inferredSize) colorSet.add(v);
        });
      }

      return {
        id: variant.id,
        title: variant.title || '',
        available: !!variant.available,
        options: namedOptions
      };
    });

    return {
      sizes: Array.from(sizeSet),
      colors: Array.from(colorSet),
      variants: variants
    };
  }

  async function getCurrentProductVariantCatalog(productInfo) {
    const productData = await getCurrentProductData(productInfo);
    return buildProductVariantCatalog(productData);
  }

  // Buscar um produto complementar da MESMA coleção do produto atual
  async function getComplementaryProduct(currentCollectionHandle) {
    try {
      if (!currentCollectionHandle) {
        console.warn('⚠️ Collection handle atual não informado; não será sugerido produto de outra coleção.');
        return null;
      }

      const productInfo = getProductInfo();
      const currentProductHandle = productInfo && productInfo.productHandle ? productInfo.productHandle : '';

      // Buscar produtos apenas da coleção atual
      const collectionProductsResponse = await fetch(`/collections/${currentCollectionHandle}/products.json?limit=20`);
      if (!collectionProductsResponse.ok) {
        console.warn('⚠️ Não foi possível buscar produtos da coleção atual');
        return null;
      }

      const collectionProductsData = await collectionProductsResponse.json();
      const products = collectionProductsData.products || [];

      if (products.length === 0) {
        console.log('⚠️ Nenhum produto encontrado na coleção atual');
        return null;
      }

      // Evitar recomendar o próprio produto atual
      var candidateProducts = products.filter(function (p) {
        return p && p.handle && p.handle !== currentProductHandle;
      });

      if (candidateProducts.length === 0) {
        console.log('⚠️ Não há produto complementar na mesma coleção (apenas o produto atual).');
        return null;
      }

      // Selecionar um produto aleatório da mesma coleção
      const randomProduct = candidateProducts[Math.floor(Math.random() * candidateProducts.length)];
      const productUrl = `/products/${randomProduct.handle}`;
      const fullProductUrl = window.location.origin + productUrl;

      console.log('✅ Produto complementar encontrado na mesma coleção:', {
        title: randomProduct.title,
        handle: randomProduct.handle,
        url: fullProductUrl,
        collectionHandle: currentCollectionHandle
      });

      return {
        title: randomProduct.title,
        handle: randomProduct.handle,
        url: fullProductUrl,
        collectionTitle: currentCollectionHandle
      };
    } catch (error) {
      console.error('❌ Erro geral ao buscar produto complementar:', error);
      return null;
    }
  }

  // Buscar configuração do Omafit diretamente do Supabase
  async function fetchOmafitConfig() {
    try {
      const rootElement = document.getElementById('omafit-widget-root');
      let shopDomain = '';
      let publicId = '';
      let shopNameFromRoot = '';

      if (rootElement) {
        shopDomain = rootElement.dataset.shopDomain || '';
        publicId = rootElement.dataset.publicId || '';
        shopNameFromRoot = rootElement.dataset.shopName || '';
        
        // Se shop.domain retornar apenas o nome da loja (sem .myshopify.com), adicionar
        if (shopDomain && !shopDomain.includes('.')) {
          shopDomain = shopDomain + '.myshopify.com';
        }
      }

      // Tentar detectar shop domain do Shopify
      if (!shopDomain && window.Shopify && window.Shopify.shop) {
        shopDomain = window.Shopify.shop;
        console.log('✅ Shop domain obtido do window.Shopify.shop:', shopDomain);
      }
      
      // Tentar obter do window.Shopify.myshop
      if (!shopDomain && window.Shopify && window.Shopify.myshop) {
        shopDomain = window.Shopify.myshop;
        console.log('✅ Shop domain obtido do window.Shopify.myshop:', shopDomain);
      }

      // Tentar extrair do meta tag
      if (!shopDomain) {
        const shopMeta = document.querySelector('meta[name="shopify-checkout-api-token"]');
        if (shopMeta && shopMeta.content) {
          try {
            const tokenData = JSON.parse(atob(shopMeta.content.split('.')[1]));
            if (tokenData.iss) {
              shopDomain = tokenData.iss.replace('https://', '').replace('http://', '');
            }
          } catch (e) {
            // Ignorar erro
          }
        }
      }

      // Tentar extrair da URL
      if (!shopDomain) {
        const urlMatch = window.location.hostname.match(/([a-zA-Z0-9-]+\.myshopify\.com)/);
        if (urlMatch) {
          shopDomain = urlMatch[1];
        }
      }

      // Fallback final: usar hostname atual (suporta domínio customizado da loja)
      if (!shopDomain && window.location && window.location.hostname) {
        shopDomain = window.location.hostname;
      }

      console.log('🔍 Shop domain detectado:', shopDomain);

      if (!shopDomain) {
        console.warn('⚠️ Shop domain não encontrado, usando configuração padrão');
        // Retornar configuração padrão mas continuar funcionando
        return {
          publicId: publicId || 'wgt_pub_default',
          linkText: 'Experimentar virtualmente',
          storeName: shopNameFromRoot || '',
          storeLogo: '',
          fontFamily: 'inherit',
          colors: {
            primary: '#810707',
            background: '#ffffff',
            text: '#810707',
            overlay: '#810707CC'
          },
          shopDomain: '',
          widgetEnabled: true,
          isActive: true
        };
      }

      // Buscar configuração diretamente do Supabase REST API
      const supabaseUrl = 'https://lhkgnirolvbmomeduoaj.supabase.co';
      const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxoa2duaXJvbHZibW9tZWR1b2FqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc3NjE2NDYsImV4cCI6MjA2MzMzNzY0Nn0.aSBMJMT8TiAqvdO_Z9D_oINLaQrFMZIK5IEQJG6KaOI';

      // Buscar widget_configurations com fallback para bancos sem excluded_collections
      const configHeaders = {
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json'
      };
      let configResponse = await fetch(
        `${supabaseUrl}/rest/v1/widget_configurations?shop_domain=eq.${encodeURIComponent(shopDomain)}&select=id,shop_domain,link_text,store_logo,primary_color,widget_enabled,excluded_collections,admin_locale,created_at,updated_at`,
        { headers: configHeaders }
      );
      if (!configResponse.ok) {
        const configErrorText = await configResponse.text().catch(function () { return ''; });
        const missingExcludedColumn =
          configResponse.status === 400 &&
          configErrorText &&
          configErrorText.indexOf('excluded_collections') !== -1;
        if (missingExcludedColumn) {
          console.warn('⚠️ Coluna excluded_collections não encontrada no banco. Repetindo busca sem essa coluna.');
          configResponse = await fetch(
            `${supabaseUrl}/rest/v1/widget_configurations?shop_domain=eq.${encodeURIComponent(shopDomain)}&select=id,shop_domain,link_text,store_logo,primary_color,widget_enabled,admin_locale,created_at,updated_at`,
            { headers: configHeaders }
          );
        } else {
          console.warn('⚠️ Não foi possível buscar configuração do Supabase. Status:', configResponse.status, configErrorText);
        }
      }

      // Buscar shopify_shops e widget_keys para obter publicId válido
      const [shopResponse, widgetKeyResponse] = await Promise.all([
        fetch(
          `${supabaseUrl}/rest/v1/shopify_shops?shop_domain=eq.${encodeURIComponent(shopDomain)}&select=public_id,id`,
          {
            headers: {
              'apikey': supabaseAnonKey,
              'Authorization': `Bearer ${supabaseAnonKey}`,
              'Content-Type': 'application/json'
            }
          }
        ),
        fetch(
          `${supabaseUrl}/rest/v1/widget_keys?shop_domain=eq.${encodeURIComponent(shopDomain)}&select=public_id,is_active`,
          {
            headers: {
              'apikey': supabaseAnonKey,
              'Authorization': `Bearer ${supabaseAnonKey}`,
              'Content-Type': 'application/json'
            }
          }
        )
      ]);

      let config = null;
      let validPublicId = publicId || 'wgt_pub_default';
      
      // Prioridade 1: Tentar obter publicId da tabela widget_keys (mais confiável)
      let isWidgetActive = true; // Default true para permitir funcionar na primeira instalação
      let widgetKeyFound = false;
      
      if (widgetKeyResponse.ok) {
        try {
          const widgetKeyText = await widgetKeyResponse.text();
          if (widgetKeyText && widgetKeyText.trim().length > 0) {
            const widgetKeyData = JSON.parse(widgetKeyText);
            if (widgetKeyData && widgetKeyData.length > 0) {
              widgetKeyFound = true;
              
              if (widgetKeyData[0].public_id) {
                validPublicId = widgetKeyData[0].public_id;
              }
              
              // Só verificar is_active se widget_keys foi encontrado
              // Se não encontrou, permitir funcionar (pode ser primeira instalação)
              if (widgetKeyData[0].is_active === false) {
                isWidgetActive = false;
                console.warn('⚠️ Widget encontrado em widget_keys mas is_active=false');
              } else if (widgetKeyData[0].is_active === true) {
                isWidgetActive = true;
                console.log('✅ Widget encontrado e ativo em widget_keys. PublicId:', validPublicId);
              } else {
                // is_active pode ser null/undefined, tratar como true
                isWidgetActive = true;
                console.log('✅ Widget encontrado em widget_keys (is_active não especificado, tratando como true). PublicId:', validPublicId);
              }
            } else {
              console.log('ℹ️ Nenhum registro encontrado em widget_keys. Permissão para funcionar (primeira instalação).');
            }
          }
        } catch (e) {
          console.warn('⚠️ Erro ao obter publicId de widget_keys:', e);
          // Em caso de erro, permitir funcionar
          isWidgetActive = true;
        }
      } else {
        console.log('ℹ️ widget_keys não encontrado ou erro ao buscar. Status:', widgetKeyResponse.status, 'Permitindo funcionar (pode ser primeira instalação).');
      }
      
      // Prioridade 2: Tentar obter publicId da tabela shopify_shops
      if (validPublicId === (publicId || 'wgt_pub_default') && shopResponse.ok) {
        try {
          const shopDataText = await shopResponse.text();
          if (shopDataText && shopDataText.trim().length > 0) {
            const shopData = JSON.parse(shopDataText);
            if (shopData && shopData.length > 0 && shopData[0].public_id) {
              validPublicId = shopData[0].public_id;
              console.log('✅ PublicId obtido de shopify_shops:', validPublicId);
            } else if (shopData && shopData.length > 0 && shopData[0].id) {
              // Se não tiver public_id, gerar baseado no ID
              validPublicId = `wgt_pub_${shopData[0].id}`;
              console.log('✅ PublicId gerado baseado no ID:', validPublicId);
            }
          }
        } catch (e) {
          console.warn('⚠️ Erro ao obter publicId de shopify_shops:', e);
        }
      }
      
      if (configResponse.ok) {
        const responseText = await configResponse.text();
        if (responseText && responseText.trim().length > 0) {
          try {
            const configData = JSON.parse(responseText);
            if (configData && configData.length > 0) {
              config = configData[0];
            } else if (configData && !Array.isArray(configData)) {
              config = configData;
            }
          } catch (e) {
            console.error('❌ Erro ao fazer parse da configuração:', e);
          }
        }
      } else {
        console.warn('⚠️ Não foi possível buscar configuração do Supabase. Status:', configResponse.status);
      }

      console.log('✅ Configuração do Omafit carregada do banco:', config);
      console.log('📋 Detalhes da configuração:', {
        link_text: config?.link_text,
        store_logo: config?.store_logo ? '✅ Presente (' + (config.store_logo.length) + ' chars, tipo: ' + (config.store_logo.substring(0, 20)) + '...)' : '❌ Ausente',
        primary_color: config?.primary_color || '#810707',
        shop_domain: shopDomain
      });
      
      // Log detalhado do logo se existir
      if (config?.store_logo) {
        const logoPreview = config.store_logo.substring(0, 100);
        console.log('🖼️ Logo carregado do banco:', {
          tamanho: config.store_logo.length + ' caracteres',
          preview: logoPreview,
          tipo: config.store_logo.startsWith('data:image') ? 'Base64' : (config.store_logo.startsWith('http') ? 'URL' : 'Desconhecido'),
          valido: (config.store_logo.startsWith('data:image/') || config.store_logo.startsWith('http')) ? '✅' : '⚠️ Formato pode estar incorreto'
        });
      }
      
      const normalizeExcludedCollections = (value) => {
        if (Array.isArray(value)) {
          return value.map(function (item) { return String(item || '').trim(); }).filter(Boolean);
        }
        if (typeof value === 'string' && value.trim()) {
          try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) {
              return parsed.map(function (item) { return String(item || '').trim(); }).filter(Boolean);
            }
          } catch (_err) {
            return value.split(',').map(function (item) { return item.trim(); }).filter(Boolean);
          }
        }
        return [];
      };

      const excludedCollections = normalizeExcludedCollections(config && config.excluded_collections);
      const currentCollectionHandle = rootElement && rootElement.dataset ? (rootElement.dataset.collectionHandle || '') : '';
      const productCollectionHandles = rootElement && rootElement.dataset && rootElement.dataset.collectionHandles
        ? rootElement.dataset.collectionHandles.split(',').map(function (item) { return item.trim(); }).filter(Boolean)
        : [];
      const hasExcludedProductCollection = productCollectionHandles.some(function (handle) {
        return excludedCollections.indexOf(handle) !== -1;
      });
      const isCollectionExcluded =
        (!!currentCollectionHandle && excludedCollections.indexOf(currentCollectionHandle) !== -1) ||
        hasExcludedProductCollection;

      // Verificar se widget está habilitado na configuração
      // Se não houver configuração, considerar habilitado por padrão
      const widgetEnabled = config ? (config.widget_enabled !== false) : true;
      
      // Widget só está desabilitado se:
      // 1. widget_enabled explicitamente false NA CONFIGURAÇÃO, OU
      // 2. widget_keys foi encontrado E is_active é explicitamente false
      // Se widget_keys não foi encontrado, permitir funcionar (primeira instalação)
      const finalWidgetEnabled = widgetEnabled && (widgetKeyFound ? isWidgetActive : true) && !isCollectionExcluded;
      
      console.log('📊 Status do widget:', {
        configExists: !!config,
        widgetKeysFound: widgetKeyFound,
        widgetEnabledInConfig: widgetEnabled,
        isActiveInWidgetKeys: widgetKeyFound ? isWidgetActive : 'N/A (não encontrado)',
        currentCollectionHandle: currentCollectionHandle || '(vazio)',
        productCollectionHandles: productCollectionHandles,
        excludedCollections: excludedCollections,
        isCollectionExcluded: isCollectionExcluded,
        finalStatus: finalWidgetEnabled ? '✅ HABILITADO' : '❌ DESABILITADO',
        motivo: !finalWidgetEnabled ? 
          (!widgetEnabled ? 'widget_enabled=false na configuração' : 
           (widgetKeyFound && !isWidgetActive ? 'is_active=false em widget_keys' :
            (isCollectionExcluded ? 'coleção atual está na lista de exclusão' : 'desconhecido'))) : 
          'Widget habilitado'
      });
      
      // Mapear campos do banco de dados para o formato esperado pelo widget
      const mappedConfig = {
        publicId: validPublicId,
        linkText: config?.link_text || 'Experimentar virtualmente',
        storeName:
          shopNameFromRoot ||
          config?.store_name ||
          config?.storeName ||
          config?.shop_name ||
          config?.name ||
          '',
        storeLogo: config?.store_logo || '',
        fontFamily: 'inherit', // Usar fonte da loja automaticamente
        colors: {
          primary: config?.primary_color || '#810707',
          background: '#ffffff',
          text: config?.primary_color || '#810707',
          overlay: (config?.primary_color || '#810707') + 'CC'
        },
        adminLocale: config?.admin_locale || '',
        shopDomain: shopDomain,
        widgetEnabled: finalWidgetEnabled,
        isActive: isWidgetActive,
        excludedCollections: excludedCollections
      };
      mappedConfig.storeName = ensureStoreName(mappedConfig);
      
      console.log('✅ Configuração mapeada:', {
        linkText: mappedConfig.linkText,
        storeLogo: mappedConfig.storeLogo ? '✅ Presente' : '❌ Ausente',
        primaryColor: mappedConfig.colors.primary,
        shopDomain: mappedConfig.shopDomain
      });
      
      return mappedConfig;
    } catch (error) {
      console.error('❌ Erro ao buscar configuração:', error);
      // Retornar configuração padrão em caso de erro (widget habilitado por padrão)
      return {
        publicId: 'wgt_pub_default',
        linkText: 'Experimentar virtualmente',
        storeName: shopNameFromRoot || '',
        storeLogo: '',
        fontFamily: 'inherit', // Usar fonte da loja automaticamente
        colors: {
          primary: '#810707',
          background: '#ffffff',
          text: '#810707',
          overlay: '#810707CC'
        },
        shopDomain: '',
        widgetEnabled: true,
        isActive: true
      };
    }
  }

  // Buscar tabela de medidas do Supabase por loja, coleção e gênero
  // collectionHandle: handle da coleção (ex: 'camisetas'); '' = tabela padrão da loja
  async function fetchSizeCharts(shopDomain, collectionHandle, gender) {
    try {
      if (!shopDomain) return null;

      const supabaseUrl = 'https://lhkgnirolvbmomeduoaj.supabase.co';
      const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxoa2duaXJvbHZibW9tZWR1b2FqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc3NjE2NDYsImV4cCI6MjA2MzMzNzY0Nn0.aSBMJMT8TiAqvdO_Z9D_oINLaQrFMZIK5IEQJG6KaOI';

      const coll = typeof collectionHandle === 'string' ? collectionHandle : '';
      let genderToFetch = gender;
      if (gender !== 'male' && gender !== 'female') genderToFetch = 'unisex';

      const response = await fetch(
        `${supabaseUrl}/rest/v1/size_charts?shop_domain=eq.${encodeURIComponent(shopDomain)}&collection_handle=eq.${encodeURIComponent(coll)}&gender=eq.${genderToFetch}&select=sizes,measurement_refs,collection_type,collection_elasticity`,
        {
          headers: {
            'apikey': supabaseAnonKey,
            'Authorization': `Bearer ${supabaseAnonKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.ok) {
        const data = await response.json();
        if (data && data.length > 0 && data[0].sizes) {
            return {
            sizes: data[0].sizes,
              collectionType: data[0].collection_type || '',
              collectionElasticity: data[0].collection_elasticity || '',
            measurementRefs: Array.isArray(data[0].measurement_refs) && data[0].measurement_refs.length === 3
              ? data[0].measurement_refs
              : ['peito', 'cintura', 'quadril']
          };
        }
      }

      if (genderToFetch !== 'unisex') {
        const unisexResponse = await fetch(
          `${supabaseUrl}/rest/v1/size_charts?shop_domain=eq.${encodeURIComponent(shopDomain)}&collection_handle=eq.${encodeURIComponent(coll)}&gender=eq.unisex&select=sizes,measurement_refs,collection_type,collection_elasticity`,
          {
            headers: {
              'apikey': supabaseAnonKey,
              'Authorization': `Bearer ${supabaseAnonKey}`,
              'Content-Type': 'application/json'
            }
          }
        );
        if (unisexResponse.ok) {
          const unisexData = await unisexResponse.json();
          if (unisexData && unisexData.length > 0 && unisexData[0].sizes) {
            return {
              sizes: unisexData[0].sizes,
              collectionType: unisexData[0].collection_type || '',
              collectionElasticity: unisexData[0].collection_elasticity || '',
              measurementRefs: Array.isArray(unisexData[0].measurement_refs) && unisexData[0].measurement_refs.length === 3
                ? unisexData[0].measurement_refs
                : ['peito', 'cintura', 'quadril']
            };
          }
        }
      }

      return null;
    } catch (error) {
      console.error('❌ Erro ao buscar tabelas de medidas:', error);
      return null;
    }
  }

  async function fetchCollectionType(shopDomain, collectionHandle) {
    try {
      if (!shopDomain) return '';
      const supabaseUrl = 'https://lhkgnirolvbmomeduoaj.supabase.co';
      const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxoa2duaXJvbHZibW9tZWR1b2FqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc3NjE2NDYsImV4cCI6MjA2MzMzNzY0Nn0.aSBMJMT8TiAqvdO_Z9D_oINLaQrFMZIK5IEQJG6KaOI';
      const coll = typeof collectionHandle === 'string' ? collectionHandle : '';

      const headers = {
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json'
      };

      const parseCollectionType = function (rows) {
        if (!Array.isArray(rows) || rows.length === 0) return '';
        const validTypes = ['upper', 'lower', 'full'];
        for (const row of rows) {
          if (row && validTypes.indexOf(row.collection_type) !== -1) {
            return row.collection_type;
          }
        }
        return '';
      };

      let response = await fetch(
        `${supabaseUrl}/rest/v1/size_charts?shop_domain=eq.${encodeURIComponent(shopDomain)}&collection_handle=eq.${encodeURIComponent(coll)}&select=collection_type`,
        { headers: headers }
      );

      if (!response.ok) {
        const errorText = await response.text().catch(function () { return ''; });
        const missingColumn = errorText.indexOf('collection_type') !== -1 && (errorText.indexOf('column') !== -1 || errorText.indexOf('42703') !== -1);
        if (missingColumn) return '';
        return '';
      }

      let data = await response.json();
      let collectionType = parseCollectionType(data);
      if (collectionType) return collectionType;

      if (coll) {
        response = await fetch(
          `${supabaseUrl}/rest/v1/size_charts?shop_domain=eq.${encodeURIComponent(shopDomain)}&collection_handle=eq.${encodeURIComponent('')}&select=collection_type`,
          { headers: headers }
        );
        if (response.ok) {
          data = await response.json();
          collectionType = parseCollectionType(data);
          if (collectionType) return collectionType;
        }
      }

      return '';
    } catch (_error) {
      return '';
    }
  }

  // Buscar nome/título da coleção atual a partir do handle
  async function fetchCollectionTitle(collectionHandle) {
    try {
      const coll = typeof collectionHandle === 'string' ? collectionHandle : '';
      if (!coll) return '';

      const response = await fetch(`/collections/${encodeURIComponent(coll)}.json`);
      if (!response.ok) return '';

      const data = await response.json();
      return (data && data.collection && data.collection.title) ? String(data.collection.title) : '';
    } catch (_err) {
      return '';
    }
  }

  async function fetchCollectionElasticity(shopDomain, collectionHandle) {
    try {
      if (!shopDomain) return '';
      const supabaseUrl = 'https://lhkgnirolvbmomeduoaj.supabase.co';
      const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxoa2duaXJvbHZibW9tZWR1b2FqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc3NjE2NDYsImV4cCI6MjA2MzMzNzY0Nn0.aSBMJMT8TiAqvdO_Z9D_oINLaQrFMZIK5IEQJG6KaOI';
      const coll = typeof collectionHandle === 'string' ? collectionHandle : '';

      const headers = {
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json'
      };

      const parseCollectionElasticity = function (rows) {
        if (!Array.isArray(rows) || rows.length === 0) return '';
        const validElasticities = ['structured', 'light_flex', 'flexible', 'high_elasticity'];
        for (const row of rows) {
          if (row && validElasticities.indexOf(row.collection_elasticity) !== -1) {
            return row.collection_elasticity;
          }
        }
        return '';
      };

      let response = await fetch(
        `${supabaseUrl}/rest/v1/size_charts?shop_domain=eq.${encodeURIComponent(shopDomain)}&collection_handle=eq.${encodeURIComponent(coll)}&select=collection_elasticity`,
        { headers: headers }
      );

      if (!response.ok) {
        const errorText = await response.text().catch(function () { return ''; });
        const missingColumn = errorText.indexOf('collection_elasticity') !== -1 && (errorText.indexOf('column') !== -1 || errorText.indexOf('42703') !== -1);
        if (missingColumn) return '';
        return '';
      }

      let data = await response.json();
      let collectionElasticity = parseCollectionElasticity(data);
      if (collectionElasticity) return collectionElasticity;

      if (coll) {
        response = await fetch(
          `${supabaseUrl}/rest/v1/size_charts?shop_domain=eq.${encodeURIComponent(shopDomain)}&collection_handle=eq.${encodeURIComponent('')}&select=collection_elasticity`,
          { headers: headers }
        );
        if (response.ok) {
          data = await response.json();
          collectionElasticity = parseCollectionElasticity(data);
          if (collectionElasticity) return collectionElasticity;
        }
      }

      return '';
    } catch (_error) {
      return '';
    }
  }

  // Estimar valor de uma referência de medida a partir de altura, peso, bodyType e fit
  function estimateMeasurement(ref, height, weight, bodyType, fit) {
    const h = parseFloat(height) || 170;
    const w = parseFloat(weight) || 70;
    const b = parseFloat(bodyType) || 1;
    const f = parseFloat(fit) || 1;
    switch (ref) {
      case 'peito': return h * 0.45 * b * f;
      case 'cintura': return h * 0.35 * b * f;
      case 'quadril': return h * 0.50 * b * f;
      case 'comprimento': return h * 0.42 * b * f;
      case 'tornozelo': return Math.min(30, Math.max(18, 20 + (w / 70) * 4));
      default: return 0;
    }
  }

  // Calcular tamanho recomendado: tabela por coleção + gênero, usando as 3 referências configuradas
  async function calculateRecommendedSize(userMeasurements, shopDomain, collectionHandle) {
    try {
      const { gender, height, weight, bodyType, fit } = userMeasurements;
      const coll = typeof collectionHandle === 'string' ? collectionHandle : '';

      const chart = await fetchSizeCharts(shopDomain, coll, gender);
      if (!chart || !chart.sizes || chart.sizes.length === 0) {
        console.warn('⚠️ Nenhuma tabela de medidas encontrada para esta coleção/gênero');
        return null;
      }

      const refs = chart.measurementRefs || ['peito', 'cintura', 'quadril'];
      const userValues = refs.map(function (ref) {
        return estimateMeasurement(ref, height, weight, bodyType, fit);
      });

      let bestMatch = null;
      let smallestDifference = Infinity;

      chart.sizes.forEach(function (size) {
        const tableValues = refs.map(function (ref) {
          return parseFloat(size[ref]) || 0;
        });
        const allValid = tableValues.every(function (v) { return v > 0; });
        if (!allValid) return;

        let diff = 0;
        for (let i = 0; i < refs.length; i++) {
          diff += Math.pow(tableValues[i] - userValues[i], 2);
        }
        diff = Math.sqrt(diff);
        if (diff < smallestDifference) {
          smallestDifference = diff;
          bestMatch = size.size;
        }
      });

      console.log('✅ Tamanho recomendado:', bestMatch, 'Diferença:', smallestDifference);
      return bestMatch;
    } catch (error) {
      console.error('❌ Erro ao calcular tamanho recomendado:', error);
      return null;
    }
  }

  // Função que abre o modal do Omafit
  window.openOmafitModal = async function () {
    // Carregar fontes apenas quando o usuário abre o modal (não bloqueia carregamento da página)
    loadOmafitFontsWhenNeeded();

    // Se configuração não estiver carregada, tentar carregar agora
    if (!OMAFIT_CONFIG) {
      console.warn('⚠️ Omafit: configuração não carregada, tentando carregar agora...');
      try {
        OMAFIT_CONFIG = await fetchOmafitConfig();
        if (OMAFIT_CONFIG) {
          OMAFIT_CONFIG.storeName = ensureStoreName(OMAFIT_CONFIG);
        }
        if (!OMAFIT_CONFIG) {
          console.error('❌ Não foi possível carregar configuração do Omafit');
          // Usar configuração padrão
          OMAFIT_CONFIG = {
            publicId: 'wgt_pub_default',
            linkText: 'Experimentar virtualmente',
            storeName: '',
            storeLogo: '',
            fontFamily: 'inherit',
            colors: {
              primary: '#810707',
              background: '#ffffff',
              text: '#810707',
              overlay: '#810707CC'
            },
            shopDomain: ''
          };
        }
      } catch (e) {
        console.error('❌ Erro ao carregar configuração:', e);
        // Usar configuração padrão em caso de erro
        OMAFIT_CONFIG = {
          publicId: 'wgt_pub_default',
          linkText: 'Experimentar virtualmente',
          storeName: '',
          storeLogo: '',
          fontFamily: 'inherit',
          colors: {
            primary: '#810707',
            background: '#ffffff',
            text: '#810707',
            overlay: '#810707CC'
          },
          shopDomain: ''
        };
      }
    }

    OMAFIT_CONFIG.storeName = ensureStoreName(OMAFIT_CONFIG);
    
    console.log('📦 OMAFIT_CONFIG antes de abrir modal:', OMAFIT_CONFIG);

    const productImage = getProductImageFromPage();

    if (!productImage) {
      alert(
        'Não foi possível detectar a imagem do produto nesta página.\nVerifique se você está em uma página de produto.'
      );
      return;
    }

    const allProductImages = await getOnlyProductImages();
    console.log('📸 Total de imagens encontradas:', allProductImages.length);

    let productInfo = getProductInfo();
    productInfo = await enrichProductInfo(productInfo);
    const productVariantCatalog = await getCurrentProductVariantCatalog(productInfo);
    const currentProductData = await getCurrentProductData(productInfo);
    if (!productInfo.productDescription && currentProductData && currentProductData.description) {
      productInfo.productDescription = normalizeProductDescriptionText(currentProductData.description);
      productInfo.productDescriptionHtml = String(currentProductData.description || '').trim();
    }
    const isMobile = window.innerWidth <= 768;

    const overlay = document.createElement('div');
    overlay.className = 'omafit-modal-overlay';
    overlay.style.cssText =
      'position: fixed;' +
      'top: 0;' +
      'left: 0;' +
      'width: 100%;' +
      'height: 100%;' +
      'background: rgba(0, 0, 0, 0);' +
      'z-index: 999999;' +
      'display: flex;' +
      'align-items: center;' +
      'justify-content: center;' +
      (isMobile ? 'padding: 0;' : 'padding: 20px;') +
      'box-sizing: border-box;' +
      'backdrop-filter: blur(0px);' +
      'transition: all 0.4s ease-in-out;' +
      'opacity: 0;';

    const iframe = document.createElement('iframe');

    // Detectar fonte da loja do CSS computado
    function getStoreFontFamily() {
      try {
        // Tentar obter do body ou elemento principal
        const body = document.body;
        if (body) {
          const computedStyle = window.getComputedStyle(body);
          const fontFamily = computedStyle.fontFamily;
          if (fontFamily && fontFamily !== 'inherit') {
            // Pegar a primeira fonte da lista (remover aspas se houver)
            const firstFont = fontFamily.split(',')[0].trim().replace(/['"]/g, '');
            console.log('🎨 Fonte da loja detectada:', firstFont);
            return firstFont;
          }
        }
      } catch (e) {
        console.warn('⚠️ Erro ao detectar fonte da loja:', e);
      }
      return 'inherit';
    }

    const detectedFontFamily = getStoreFontFamily();

    // Montar configuração - NÃO incluir storeLogo (base64) na URL para evitar 414
    // O widget buscará do Supabase usando shopDomain
    const config = {
      storeName: OMAFIT_CONFIG.storeName || '',
      primaryColor: OMAFIT_CONFIG.colors?.primary || '#810707',
      // storeLogo será enviado via postMessage
      fontFamily: detectedFontFamily, // Usar fonte detectada da loja
      fontWeight: OMAFIT_CONFIG.fontWeight || '',
      fontStyle: OMAFIT_CONFIG.fontStyle || ''
    };

    // Garantir que shopDomain está disponível
    const shopDomain = OMAFIT_CONFIG.shopDomain || '';
    const storeLanguage =
      normalizeLanguageTag(OMAFIT_CONFIG.adminLocale) ||
      normalizeLanguageTag(detectStoreLanguage()) ||
      'pt-BR';
    const detectedStoreName = detectStoreDisplayName(shopDomain);
    const resolvedStoreName =
      (OMAFIT_CONFIG.storeName && String(OMAFIT_CONFIG.storeName).trim()) ||
      (detectedStoreName && String(detectedStoreName).trim()) ||
      '';
    config.storeName = resolvedStoreName;
    const rootEl = document.getElementById('omafit-widget-root');
    let collectionHandle = (rootEl && rootEl.dataset && rootEl.dataset.collectionHandle) ? rootEl.dataset.collectionHandle : '';
    let collectionTitle = (rootEl && rootEl.dataset && rootEl.dataset.collectionTitle) ? rootEl.dataset.collectionTitle : '';
    const defaultGender = (rootEl && rootEl.dataset && rootEl.dataset.defaultGender) ? rootEl.dataset.defaultGender : '';
    if (!collectionTitle && collectionHandle) {
      collectionTitle = await fetchCollectionTitle(collectionHandle);
    }
    const collectionType = await fetchCollectionType(shopDomain, collectionHandle);
    const collectionElasticity = await fetchCollectionElasticity(shopDomain, collectionHandle);
    
    // Buscar produto complementar (usa coleção atual se houver; senão busca de qualquer coleção)
    const complementaryProduct = await getComplementaryProduct(collectionHandle);
    
    // Limitar imagens na URL - passar apenas as primeiras 3 para evitar URL muito longa
    const limitedImages = allProductImages.slice(0, 3);
    
    console.log('📦 Configuração sendo enviada ao widget:', {
      shopDomain: shopDomain,
      config: {
        ...config,
        storeLogo: OMAFIT_CONFIG.storeLogo ? '✅ Presente (será enviado via postMessage)' : '❌ Ausente'
      },
      productImage: productImage ? '✅' : '❌',
      productImages: allProductImages.length,
      limitedImages: limitedImages.length,
      primaryColor: config.primaryColor,
      storeName: config.storeName
    });
    console.log('🧩 Catálogo de variantes extraído:', {
      sizes: productVariantCatalog.sizes.length,
      colors: productVariantCatalog.colors.length,
      variants: productVariantCatalog.variants.length
    });

    // Construir URL apenas com dados essenciais (evitar 414 URI Too Long)
    const publicIdToUse = OMAFIT_CONFIG.publicId || 'wgt_pub_default';
    console.log('🔑 PublicId sendo usado:', publicIdToUse);
    
    const productDescriptionFull = normalizeProductDescriptionText(
      productInfo.productDescription ||
      (currentProductData && currentProductData.description ? currentProductData.description : '')
    );
    const productDescriptionHtml = String(
      productInfo.productDescriptionHtml ||
      (currentProductData && currentProductData.description ? currentProductData.description : '') ||
      ''
    ).trim();
    const productDescriptionForUrl = productDescriptionFull.slice(0, 500);
    const variantCatalogList = Array.isArray(productVariantCatalog.variants) ? productVariantCatalog.variants : [];
    const availableSizesList = Array.isArray(productVariantCatalog.sizes) ? productVariantCatalog.sizes : [];
    const availableColorsList = Array.isArray(productVariantCatalog.colors) ? productVariantCatalog.colors : [];

    let widgetUrl =
      'https://omafit.netlify.app/widget' +
      '?productImage=' + encodeURIComponent(productImage) +
      '&productId=' + encodeURIComponent(productInfo.productId || 'unknown') +
      '&productName=' + encodeURIComponent(productInfo.productName || 'Produto') +
      (productDescriptionForUrl ? '&productDescription=' + encodeURIComponent(productDescriptionForUrl) : '') +
      (productDescriptionForUrl ? '&product_description=' + encodeURIComponent(productDescriptionForUrl) : '') +
      '&publicId=' + encodeURIComponent(publicIdToUse) +
      '&shopDomain=' + encodeURIComponent(shopDomain) +
      '&shop_domain=' + encodeURIComponent(shopDomain) +
      '&shopName=' + encodeURIComponent(resolvedStoreName) +
      '&shop_name=' + encodeURIComponent(resolvedStoreName) +
      '&storeName=' + encodeURIComponent(resolvedStoreName) +
      '&store_name=' + encodeURIComponent(resolvedStoreName) +
      '&language=' + encodeURIComponent(storeLanguage) +
      '&locale=' + encodeURIComponent(storeLanguage) +
      (collectionHandle ? '&collectionHandle=' + encodeURIComponent(collectionHandle) : '') +
      (collectionTitle ? '&collectionTitle=' + encodeURIComponent(collectionTitle) : '') +
      (collectionTitle ? '&collectionName=' + encodeURIComponent(collectionTitle) : '') +
      (defaultGender ? '&defaultGender=' + encodeURIComponent(defaultGender) : '') +
      (collectionType ? '&collectionType=' + encodeURIComponent(collectionType) : '') +
      (collectionElasticity ? '&collectionElasticity=' + encodeURIComponent(collectionElasticity) : '') +
      (complementaryProduct ? '&complementaryProductUrl=' + encodeURIComponent(complementaryProduct.url) : '') +
      (complementaryProduct ? '&recommendedProductUrl=' + encodeURIComponent(complementaryProduct.url) : '') +
      (complementaryProduct ? '&recommendedProductName=' + encodeURIComponent(complementaryProduct.title) : '') +
      '&config=' + encodeURIComponent(JSON.stringify(config));
    
    // Se houver imagens, passar apenas as primeiras 3 na URL para evitar URL muito longa
    // O widget pode buscar o resto usando productId se necessário
    if (limitedImages.length > 0) {
      const urlWithImages = widgetUrl + '&productImages=' + encodeURIComponent(JSON.stringify(limitedImages));
      // Verificar se URL não está muito longa (limite ~2000 caracteres para evitar 414)
      if (urlWithImages.length < 2000) {
        widgetUrl = urlWithImages;
      } else {
        console.warn('⚠️ URL muito longa, passando apenas primeira imagem. Widget buscará o resto usando productId.');
      }
    }
    
    console.log('🔗 URL do widget (tamanho:', widgetUrl.length, 'chars):', widgetUrl.substring(0, 200) + '...');
    
    // Se URL ainda estiver muito longa, usar postMessage para enviar dados grandes
    if (widgetUrl.length > 2000) {
      console.warn('⚠️ URL ainda muito longa, usando postMessage para enviar dados grandes');
      // Remover productImages da URL se estiver muito longa
      widgetUrl = widgetUrl.split('&productImages=')[0];
    }

    iframe.src = widgetUrl;
    iframe.allow = 'camera; microphone; fullscreen';
    iframe.style.cssText =
      'width: 95vw;' +
      'max-width: 1000px;' +
      'height: 85vh;' +
      'max-height: 800px;' +
      'border: none;' +
      'border-radius: 16px;' +
      'background: ' + OMAFIT_CONFIG.colors.background + ';' +
      'box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);' +
      'transform: scale(0.9);' +
      'opacity: 0;' +
      'transition: all 0.4s ease-in-out;';

    const loadingContainer = document.createElement('div');
    loadingContainer.style.cssText =
      'position: absolute;' +
      'top: 50%;' +
      'left: 50%;' +
      'transform: translate(-50%, -50%);' +
      'text-align: center;' +
      'z-index: 1000000;';

    const loadingText = document.createElement('div');
    loadingText.style.cssText =
      'color: white;' +
      'font-size: 16px;' +
      'font-family: ' + OMAFIT_CONFIG.fontFamily + ';' +
      'margin-top: 15px;' +
      'font-weight: 500;';
    loadingText.textContent = 'Carregando try-on virtual...';

    const spinner = document.createElement('div');
    spinner.style.cssText =
      'width: 50px;' +
      'height: 50px;' +
      'border: 4px solid rgba(255,255,255,0.3);' +
      'border-top-color: white;' +
      'border-radius: 50%;' +
      'animation: spin 1s linear infinite;' +
      'margin: 0 auto 15px;';

    loadingContainer.appendChild(spinner);
    loadingContainer.appendChild(loadingText);

    iframe.addEventListener('load', function () {
      if (loadingContainer.parentNode) {
        loadingContainer.parentNode.removeChild(loadingContainer);
      }
      
      // Enviar dados grandes via postMessage para evitar URL muito longa
      try {
        // Enviar collectionHandle e defaultGender para o app Netlify usar ao buscar tabela de medidas no Supabase
        const sharedWidgetData = {
          productDescription: productDescriptionFull,
          product_description: productDescriptionFull,
          productDescriptionHtml: productDescriptionHtml,
          product_description_html: productDescriptionHtml,
          selectedImage: productImage || '',
          selected_image: productImage || '',
          productImage: productImage || '',
          product_image: productImage || '',
          variantCatalog: variantCatalogList,
          variant_catalog: variantCatalogList,
          availableSizes: availableSizesList,
          available_sizes: availableSizesList,
          availableColors: availableColorsList,
          available_colors: availableColorsList,
          sizes: availableSizesList,
          colors: availableColorsList,
          variants: variantCatalogList,
          productCatalog: productVariantCatalog,
          product_catalog: productVariantCatalog
        };

        const sendWidgetPayloads = function () {
          if (!iframe.contentWindow) return;

          iframe.contentWindow.postMessage({
          type: 'omafit-context',
          language: storeLanguage,
          locale: storeLanguage,
          storeLanguage: storeLanguage,
          shopName: resolvedStoreName,
          shop_name: resolvedStoreName,
          storeName: resolvedStoreName,
          store_name: resolvedStoreName,
          productName: productInfo.productName || '',
          product_name: productInfo.productName || '',
          ...sharedWidgetData,
          collectionHandle: typeof collectionHandle === 'string' ? collectionHandle : '',
          collectionTitle: typeof collectionTitle === 'string' ? collectionTitle : '',
          collectionName: typeof collectionTitle === 'string' ? collectionTitle : '',
          defaultGender: typeof defaultGender === 'string' ? defaultGender : '',
          collectionType: typeof collectionType === 'string' ? collectionType : '',
          collectionElasticity: typeof collectionElasticity === 'string' ? collectionElasticity : '',
          complementaryProduct: complementaryProduct || null,
          recommendedProductName: complementaryProduct ? complementaryProduct.title : '',
          recommendedProductUrl: complementaryProduct ? complementaryProduct.url : ''
          }, OMAFIT_WIDGET_ORIGIN);

          // Enviar produto complementar em mensagem dedicada (com nomes que o app Netlify usa)
          if (complementaryProduct) {
            iframe.contentWindow.postMessage({
              type: 'omafit-complementary-product',
              complementaryProduct: {
                title: complementaryProduct.title,
                handle: complementaryProduct.handle,
                url: complementaryProduct.url,
                collectionTitle: complementaryProduct.collectionTitle
              },
              recommendedProductName: complementaryProduct.title,
              recommendedProductUrl: complementaryProduct.url
            }, OMAFIT_WIDGET_ORIGIN);
          }

          // Enviar todas as imagens do produto (não apenas as 3 primeiras)
          if (allProductImages.length > 3) {
            iframe.contentWindow.postMessage({
              type: 'omafit-product-images',
              images: allProductImages
            }, OMAFIT_WIDGET_ORIGIN);
          }

          // Enviar logo se existir (base64 pode ser muito grande para URL)
          if (OMAFIT_CONFIG.storeLogo) {
            const logoSize = OMAFIT_CONFIG.storeLogo.length;
            const logoPreview = OMAFIT_CONFIG.storeLogo.substring(0, 50) + '...';
            
            // Validar logo antes de enviar (aceita URL ou base64)
            const isUrl = OMAFIT_CONFIG.storeLogo.startsWith('http://') || 
                         OMAFIT_CONFIG.storeLogo.startsWith('https://');
            const isBase64 = OMAFIT_CONFIG.storeLogo.startsWith('data:image/') && 
                            OMAFIT_CONFIG.storeLogo.includes('base64,') &&
                            logoSize > 500; // Logo muito pequeno pode estar truncado
            const isValidLogo = isUrl || isBase64;
            
            if (isValidLogo) {
              // Enviar logo separadamente
              iframe.contentWindow.postMessage({
                type: 'omafit-store-logo',
                logo: OMAFIT_CONFIG.storeLogo
              }, OMAFIT_WIDGET_ORIGIN);
              
              // Também incluir logo na atualização de configuração
              iframe.contentWindow.postMessage({
                type: 'omafit-config-update',
                language: storeLanguage,
                locale: storeLanguage,
                storeLanguage: storeLanguage,
                primaryColor: OMAFIT_CONFIG.colors?.primary || '#810707',
                storeName: resolvedStoreName,
                store_name: resolvedStoreName,
                shopName: resolvedStoreName,
                shop_name: resolvedStoreName,
                productName: productInfo.productName || '',
                product_name: productInfo.productName || '',
                ...sharedWidgetData,
                storeLogo: OMAFIT_CONFIG.storeLogo, // Incluir logo na configuração também
                fontFamily: detectedFontFamily, // Enviar fonte detectada
                shopDomain: shopDomain,
                collectionHandle: collectionHandle || '',
                collectionTitle: collectionTitle || '',
                collectionName: collectionTitle || '',
                defaultGender: defaultGender || '',
                collectionType: collectionType || '',
                collectionElasticity: collectionElasticity || '',
                complementaryProduct: complementaryProduct || null,
                recommendedProductName: complementaryProduct ? complementaryProduct.title : '',
                recommendedProductUrl: complementaryProduct ? complementaryProduct.url : ''
              }, OMAFIT_WIDGET_ORIGIN);
            } else {
              // Enviar atualização de configuração sem logo (logo inválido)
              iframe.contentWindow.postMessage({
                type: 'omafit-config-update',
                language: storeLanguage,
                locale: storeLanguage,
                storeLanguage: storeLanguage,
                primaryColor: OMAFIT_CONFIG.colors?.primary || '#810707',
                storeName: resolvedStoreName,
                store_name: resolvedStoreName,
                shopName: resolvedStoreName,
                shop_name: resolvedStoreName,
                productName: productInfo.productName || '',
                product_name: productInfo.productName || '',
                ...sharedWidgetData,
                fontFamily: detectedFontFamily,
                shopDomain: shopDomain,
                collectionHandle: collectionHandle || '',
                collectionTitle: collectionTitle || '',
                collectionName: collectionTitle || '',
                defaultGender: defaultGender || '',
                collectionType: collectionType || '',
                collectionElasticity: collectionElasticity || '',
                complementaryProduct: complementaryProduct || null,
                recommendedProductName: complementaryProduct ? complementaryProduct.title : '',
                recommendedProductUrl: complementaryProduct ? complementaryProduct.url : ''
              }, OMAFIT_WIDGET_ORIGIN);
            }
          } else {
            // Enviar atualização de configuração sem logo
            iframe.contentWindow.postMessage({
              type: 'omafit-config-update',
              language: storeLanguage,
              locale: storeLanguage,
              storeLanguage: storeLanguage,
              primaryColor: OMAFIT_CONFIG.colors?.primary || '#810707',
              storeName: resolvedStoreName,
              store_name: resolvedStoreName,
              shopName: resolvedStoreName,
              shop_name: resolvedStoreName,
              productName: productInfo.productName || '',
              product_name: productInfo.productName || '',
              ...sharedWidgetData,
              fontFamily: detectedFontFamily, // Enviar fonte detectada
              shopDomain: shopDomain,
              collectionHandle: collectionHandle || '',
              collectionTitle: collectionTitle || '',
              collectionName: collectionTitle || '',
              defaultGender: defaultGender || '',
              collectionType: collectionType || '',
              collectionElasticity: collectionElasticity || '',
              complementaryProduct: complementaryProduct || null,
              recommendedProductName: complementaryProduct ? complementaryProduct.title : '',
              recommendedProductUrl: complementaryProduct ? complementaryProduct.url : ''
            }, OMAFIT_WIDGET_ORIGIN);
          }
        };

        // Primeira entrega + retries para cobrir timing de mount no iframe.
        sendWidgetPayloads();
        setTimeout(sendWidgetPayloads, 350);
        setTimeout(sendWidgetPayloads, 1200);
        setTimeout(sendWidgetPayloads, 2500);

        console.log('📤 Payload completo enviado ao widget:', {
          variant_catalog: variantCatalogList.length,
          available_sizes: availableSizesList.length,
          available_colors: availableColorsList.length,
          product_description: productDescriptionFull ? '✅' : '❌'
        });

        if (collectionHandle || defaultGender || complementaryProduct) {
          console.log('📤 Contexto enviado via postMessage:', {
            collectionHandle: collectionHandle || '(vazio)',
            collectionTitle: collectionTitle || '(vazio)',
            defaultGender: defaultGender || '(vazio)',
            collectionType: collectionType || '(vazio)',
            collectionElasticity: collectionElasticity || '(vazio)',
            complementaryProduct: complementaryProduct ? complementaryProduct.url : '(nenhum)'
          });
        }
      } catch (e) {
        console.warn('⚠️ Erro ao enviar dados via postMessage:', e);
      }
    });

    iframe.addEventListener('error', function () {
      if (loadingContainer.parentNode) {
        loadingContainer.innerHTML =
          '<div style="padding: 20px; text-align: center; background: white; border-radius: 12px; font-family: ' +
          OMAFIT_CONFIG.fontFamily +
          ';">' +
          '<div style="font-size: 18px; margin-bottom: 10px;">⚠️ Erro ao carregar o widget</div>' +
          '<div style="font-size: 14px; opacity: 0.8; margin-top: 10px;">Tente novamente mais tarde</div>' +
          '</div>';
      }
    });

    if (!document.getElementById('omafit-spinner-style')) {
      const spinnerStyle = document.createElement('style');
      spinnerStyle.id = 'omafit-spinner-style';
      spinnerStyle.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
      document.head.appendChild(spinnerStyle);
    }

    const iframeContainer = document.createElement('div');
    iframeContainer.style.cssText =
      'position: relative;' +
      'width: 95vw;' +
      'max-width: 1000px;' +
      'height: 85vh;' +
      'max-height: 800px;';

    const closeButton = document.createElement('button');
    closeButton.innerHTML = '×';
    closeButton.style.cssText =
      'position: absolute;' +
      'top: 12px;' +
      'right: 12px;' +
      'width: 36px;' +
      'height: 36px;' +
      'border: none;' +
      'border-radius: 0;' +
      'background: transparent;' +
      'color: #333;' +
      'font-size: 32px;' +
      'cursor: pointer;' +
      'display: flex;' +
      'align-items: center;' +
      'justify-content: center;' +
      'z-index: 1000001;' +
      'font-weight: 300;' +
      'line-height: 1;' +
      'padding: 4px;' +
      'transition: opacity 0.2s;' +
      'opacity: 0.7;';

    const closeModal = function () {
      if (document.body.contains(overlay)) {
        overlay.style.background = 'rgba(0, 0, 0, 0)';
        overlay.style.backdropFilter = 'blur(0px)';
        overlay.style.opacity = '0';
        iframe.style.transform = 'scale(0.9)';
        iframe.style.opacity = '0';

        setTimeout(function () {
          if (document.body.contains(overlay)) {
            document.body.removeChild(overlay);
            document.body.style.overflow = '';
          }
        }, 400);
      }
    };

    closeButton.addEventListener('mouseenter', function () {
      this.style.opacity = '1';
    });
    closeButton.addEventListener('mouseleave', function () {
      this.style.opacity = '0.7';
    });

    closeButton.addEventListener('click', closeModal);

    if (!isMobile) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) {
          closeModal();
        }
      });
    }

    const handleEscape = function (e) {
      if (e.key === 'Escape') {
        closeModal();
        document.removeEventListener('keydown', handleEscape);
      }
    };
    document.addEventListener('keydown', handleEscape);

    iframeContainer.appendChild(iframe);
    iframeContainer.appendChild(closeButton);
    overlay.appendChild(loadingContainer);
    overlay.appendChild(iframeContainer);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    setTimeout(function () {
      if (!isMobile) {
        overlay.style.background = 'rgba(0, 0, 0, 0.6)';
        overlay.style.backdropFilter = 'blur(4px)';
      }
      overlay.style.opacity = '1';
      iframe.style.transform = 'scale(1)';
      iframe.style.opacity = '1';
    }, 10);
  };

  // --- Add to cart (mensagens do iframe) ---
  // Recebe type: "omafit-add-to-cart-request" e responde com "omafit-add-to-cart-result".
  // Origens permitidas: OMAFIT_CART_ALLOWED_ORIGINS. Idempotência por requestId.
  // Origens permitidas para add-to-cart (remover localhost em produção)
  const OMAFIT_CART_ALLOWED_ORIGINS = [
    'https://omafit.netlify.app',
    'https://omafit.com',
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  ];
  const OMAFIT_PROCESSED_REQUEST_IDS = new Set();
  const OMAFIT_REQUEST_ID_MAX_AGE_MS = 5 * 60 * 1000;
  let OMAFIT_LAST_REQUEST_ID_CLEANUP = 0;
  const OMAFIT_CART_SECTION_IDS = [
    'cart-drawer',
    'cart-icon-bubble',
    'cart-live-region-text',
    'main-cart-items',
    'main-cart-footer'
  ];

  function isValidAddToCartMessage(event) {
    if (!event || !event.data || event.data.type !== 'omafit-add-to-cart-request') {
      return false;
    }
    if (OMAFIT_CART_ALLOWED_ORIGINS.indexOf(event.origin) === -1) {
      console.warn('[OmafitCart] Origem não permitida:', event.origin);
      return false;
    }
    var p = event.data.payload && typeof event.data.payload === 'object' ? event.data.payload : event.data;
    var requestId = p && (p.requestId !== undefined ? p.requestId : event.data.requestId);
    if (!p || typeof requestId === 'undefined') {
      console.warn('[OmafitCart] Payload inválido: requestId obrigatório');
      return false;
    }
    if (!p.product || typeof p.product.id === 'undefined' || !p.product.name) {
      console.warn('[OmafitCart] Payload inválido: product.id e product.name obrigatórios');
      return false;
    }
    if (!p.selection || typeof p.selection !== 'object') {
      console.warn('[OmafitCart] Payload inválido: selection obrigatório');
      return false;
    }
    if (p.shop_domain !== undefined && typeof p.shop_domain !== 'string') {
      return false;
    }
    return true;
  }

  function normalizeText(value) {
    if (value == null) return '';
    return String(value).trim().toLowerCase();
  }

  function normalizeSize(size) {
    var n = normalizeText(size);
    if (!n) return '';
    n = n.replace(/(\d+)\s*br\s*$/i, '$1 br');
    const aliasMap = {
      'pp': 'pp', 'p': 'p', 'xs': 'xs', 's': 's', 'm': 'm', 'g': 'g', 'l': 'l', 'gg': 'gg', 'xg': 'xg',
      'xl': 'xl', 'xxl': 'xxl', 'xxxl': 'xxxl',
      '36': '36', '38': '38', '40': '40', '42': '42', '44': '44', '46': '46', '48': '48',
      '36 br': '36', '38 br': '38', '40 br': '40', '42 br': '42', '44 br': '44', '46 br': '46', '48 br': '48'
    };
    return aliasMap[n] || n;
  }

  function extractColorCandidatesFromVariant(variant) {
    const candidates = { optionValues: [], imageUrl: null };
    if (!variant) return candidates;
    [variant.option1, variant.option2, variant.option3].forEach(function (opt) {
      if (opt) candidates.optionValues.push(normalizeText(opt));
    });
    var img = variant.featured_image || variant.featured_image_url;
    if (img && (img.src || img.url)) {
      candidates.imageUrl = normalizeUrl(img.src || img.url) || null;
    }
    return candidates;
  }

  function getVariantsByImageFromProduct(productData, selectionImageUrl) {
    if (!productData || !selectionImageUrl) return [];
    var normalizedSel = normalizeUrl(selectionImageUrl);
    var variantIds = new Set();
    var images = productData.images || productData.media || [];
    images.forEach(function (img) {
      var src = (img.src || img.url || (img.preview_image && img.preview_image.src)) || '';
      if (normalizeUrl(src) === normalizedSel && Array.isArray(img.variant_ids)) {
        img.variant_ids.forEach(function (vid) { variantIds.add(vid); });
      }
    });
    return (productData.variants || []).filter(function (v) { return variantIds.has(v.id); });
  }

  function hexToColorNames(hex) {
    if (!hex || typeof hex !== 'string') return [];
    var h = hex.replace(/^#/, '').toLowerCase();
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var map = {
      '000000': ['preto', 'black'], 'ffffff': ['branco', 'white'], 'fff': ['branco', 'white'],
      '808080': ['cinza', 'gray', 'grey'], 'c0c0c0': ['cinza', 'silver'],
      '800000': ['marrom', 'brown'], 'a52a2a': ['marrom', 'brown'],
      'ff0000': ['vermelho', 'red'], 'f00': ['vermelho', 'red'],
      'ffa500': ['laranja', 'orange'], 'ffd700': ['dourado', 'gold'],
      'ffff00': ['amarelo', 'yellow'], 'ff0': ['amarelo', 'yellow'],
      '008000': ['verde', 'green'], '00ff00': ['verde', 'green'],
      '0000ff': ['azul', 'blue'], '00f': ['azul', 'blue'],
      '4b0082': ['indigo'], '8b00ff': ['violeta', 'violet'],
      'ff00ff': ['magenta'], 'f0f': ['magenta'],
      'ffc0cb': ['rosa', 'pink'], 'deb887': ['bege', 'beige'], 'f5f5dc': ['bege', 'beige'],
      'daa520': ['dourado', 'gold'], '000080': ['azul marinho', 'navy']
    };
    return map[h] || [];
  }

  function resolveVariantFromSelection(productDataOrArg, selectionArg) {
    var productData = productDataOrArg;
    var selection = selectionArg;
    if (productDataOrArg && typeof productDataOrArg === 'object' && productDataOrArg.productData !== undefined) {
      productData = productDataOrArg.productData;
      selection = productDataOrArg.selection || {};
    }
    if (!productData || !Array.isArray(productData.variants) || productData.variants.length === 0) {
      return { variant: null, error: 'Produto sem variantes' };
    }
    selection = selection || {};
    var variants = productData.variants;
    var options = productData.options || [];
    var sizeOptionIndex = options.findIndex(function (o) {
      var name = normalizeText(typeof o === 'string' ? o : (o && o.name));
      return name === 'size' || name === 'tamanho' || name === 'talle' || name === 'talla';
    });
    var colorOptionIndex = options.findIndex(function (o) {
      var name = normalizeText(typeof o === 'string' ? o : (o && o.name));
      return name === 'color' || name === 'cor' || name === 'colour' || name === 'couleur';
    });

    var wantedSize = normalizeSize(selection.recommended_size);
    var selectionImageUrl = selection.image_url ? normalizeUrl(selection.image_url) : null;
    var selectionColorHex = (selection.color_hex && String(selection.color_hex).trim()) ? String(selection.color_hex).trim().toLowerCase() : null;

    var bySize = variants;
    if (sizeOptionIndex >= 0 && wantedSize) {
      bySize = variants.filter(function (v) {
        var opt = v['option' + (sizeOptionIndex + 1)];
        return normalizeSize(opt) === wantedSize || normalizeText(opt) === wantedSize;
      });
      if (bySize.length === 0) {
        bySize = variants;
      }
    }

    var byImage = [];
    if (selectionImageUrl && bySize.length > 0) {
      byImage = bySize.filter(function (v) {
        var c = extractColorCandidatesFromVariant(v);
        return c.imageUrl && c.imageUrl === selectionImageUrl;
      });
      if (byImage.length === 0) {
        var byProductImage = getVariantsByImageFromProduct(productData, selectionImageUrl);
        byImage = bySize.filter(function (v) { return byProductImage.some(function (vi) { return vi.id === v.id; }); });
      }
    }

    var byColorHex = [];
    if (byImage.length === 0 && selectionColorHex && colorOptionIndex >= 0 && bySize.length > 0) {
      var inferredColorNames = hexToColorNames(selectionColorHex);
      if (inferredColorNames.length > 0) {
        var nameSet = new Set(inferredColorNames.map(normalizeText));
        byColorHex = bySize.filter(function (v) {
          var colorVal = v['option' + (colorOptionIndex + 1)];
          return colorVal && nameSet.has(normalizeText(colorVal));
        });
      }
    }

    var chosen = null;
    if (byImage.length > 0) {
      chosen = byImage.find(function (v) { return v.available; }) || byImage[0];
    }
    if (!chosen && byColorHex.length > 0) {
      chosen = byColorHex.find(function (v) { return v.available; }) || byColorHex[0];
    }
    if (!chosen && bySize.length > 0) {
      chosen = bySize.find(function (v) { return v.available; }) || bySize[0];
    }
    if (!chosen && variants.length > 0) {
      chosen = variants.find(function (v) { return v.available; }) || variants[0];
    }

    if (!chosen) {
      return { variant: null, error: 'Nenhuma variante disponível para a seleção' };
    }
    return { variant: chosen, error: null };
  }

  function addToCart(params) {
    var variantId = params.variantId;
    var quantity = Math.max(1, parseInt(params.quantity, 10) || 1);
    var properties = params.properties || {};
    const requestBody = {
      id: variantId,
      quantity: quantity,
      properties: properties,
      sections: OMAFIT_CART_SECTION_IDS,
      sections_url: window.location.pathname || '/'
    };
    return fetch('/cart/add.js', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    })
      .then(function (res) {
        return res.text().then(function (body) {
          console.log('[OmafitCart] /cart/add.js status:', res.status);
          console.log('[OmafitCart] /cart/add.js body:', body);
          var parsed = null;
          try { parsed = body ? JSON.parse(body) : {}; } catch (_) { parsed = {}; }
          if (res.ok) {
            return { success: true, cart: parsed, variantId: variantId };
          }
          var msg = (parsed && (parsed.description || parsed.message)) || ('Erro ao adicionar ao carrinho (HTTP ' + res.status + ')');
          return { success: false, message: msg, status: res.status, body: parsed };
        });
      })
      .catch(function (err) {
        return { success: false, message: 'Erro de rede ao adicionar ao carrinho', debug: { reason: err && err.message } };
      });
  }

  function waitMs(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function renderThemeCartFromResponse(addResponse) {
    if (!addResponse || !addResponse.sections) return false;
    var cartUi = document.querySelector('cart-drawer') || document.querySelector('cart-notification');
    if (!cartUi || typeof cartUi.renderContents !== 'function') return false;
    try {
      cartUi.renderContents(addResponse);
      console.log('[OmafitCart] UI de carrinho atualizada via renderContents do tema.');
      return true;
    } catch (e) {
      console.warn('[OmafitCart] Falha ao usar renderContents do tema:', e);
      return false;
    }
  }

  async function fetchUpdatedCart() {
    for (var attempt = 0; attempt < 3; attempt += 1) {
      try {
        var url = '/cart.js?_=' + Date.now() + '_' + attempt;
        var res = await fetch(url, {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'Accept': 'application/json' }
        });
        if (!res.ok) {
          console.warn('[OmafitCart] /cart.js status inválido:', res.status, 'tentativa', attempt + 1);
        } else {
          var cart = await res.json();
          // Em alguns temas o primeiro GET após add ainda pode vir desatualizado.
          if (cart && typeof cart.item_count === 'number' && cart.item_count > 0) return cart;
          if (attempt === 2) return cart || null;
        }
      } catch (e) {
        console.warn('[OmafitCart] Erro ao buscar /cart.js (tentativa ' + (attempt + 1) + '):', e);
      }
      await waitMs(180);
    }
    return null;
  }

  function replaceSectionInDom(sectionId, sectionHtml) {
    if (!sectionHtml) return false;
    var parser = new DOMParser();
    var doc = parser.parseFromString(sectionHtml, 'text/html');
    var sectionSelector = '#shopify-section-' + sectionId;
    var currentSection = document.querySelector(sectionSelector);
    var newSection = doc.querySelector(sectionSelector);

    if (currentSection && newSection) {
      currentSection.replaceWith(newSection);
      return true;
    }

    // Fallback para temas que retornam snippet sem wrapper da section.
    var fallbackTargets = {
      'cart-icon-bubble': '#cart-icon-bubble, .cart-count-bubble, [data-cart-icon-bubble]',
      'cart-live-region-text': '#cart-live-region-text, [data-cart-live-region-text]',
      'cart-drawer': 'cart-drawer, #CartDrawer, .drawer--cart, [data-cart-drawer]'
    };
    var targetSelector = fallbackTargets[sectionId];
    if (!targetSelector) return false;
    var target = document.querySelector(targetSelector);
    if (!target) return false;
    var bodyHtml = (doc.body && doc.body.innerHTML) ? doc.body.innerHTML : sectionHtml;
    target.innerHTML = bodyHtml;
    return true;
  }

  async function refreshThemeCartSections() {
    var sectionIds = OMAFIT_CART_SECTION_IDS;
    try {
      var sectionsParam = sectionIds.map(function (id) { return encodeURIComponent(id); }).join(',');
      var res = await fetch('/?sections=' + sectionsParam + '&_=' + Date.now(), {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Accept': 'application/json' }
      });
      if (!res.ok) {
        console.warn('[OmafitCart] Falha ao buscar sections do carrinho:', res.status);
        return null;
      }
      var sections = await res.json();
      if (!sections || typeof sections !== 'object') return null;

      var replacedCount = 0;
      sectionIds.forEach(function (id) {
        if (replaceSectionInDom(id, sections[id])) replacedCount += 1;
      });
      console.log('[OmafitCart] Section Rendering aplicado. Sections atualizadas:', replacedCount);
      return sections;
    } catch (e) {
      console.warn('[OmafitCart] Erro ao aplicar Section Rendering API:', e);
      return null;
    }
  }

  function notifyThemeCartUpdate(cart) {
    try {
      if (window.Shopify && typeof window.Shopify.onCartUpdate === 'function') {
        window.Shopify.onCartUpdate(cart || null);
        console.log('[OmafitCart] Shopify.onCartUpdate disparado.');
      }
    } catch (e) {
      console.warn('[OmafitCart] Erro ao disparar Shopify.onCartUpdate:', e);
    }
  }

  function dispatchCartUpdatedEvents(cart) {
    var detail = { source: 'omafit_tryon', cart: cart || null };
    var eventNames = [
      'cart:refresh',
      'cart:updated',
      'cart-updated',
      'cart:change',
      'theme:cart:refresh'
    ];
    eventNames.forEach(function (name) {
      try { document.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (_) {}
      try { window.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (_) {}
    });
    console.log('[OmafitCart] Eventos de atualização de carrinho disparados:', eventNames);
  }

  function openCartDrawerIfRequested(shouldOpenDrawer) {
    if (!shouldOpenDrawer) return;
    try {
      document.dispatchEvent(new CustomEvent('cart:open', { detail: { source: 'omafit_tryon' } }));
      document.dispatchEvent(new CustomEvent('cart-drawer:open', { detail: { source: 'omafit_tryon' } }));
      window.dispatchEvent(new CustomEvent('cart:open', { detail: { source: 'omafit_tryon' } }));
      window.dispatchEvent(new CustomEvent('cart-drawer:open', { detail: { source: 'omafit_tryon' } }));
    } catch (_) {}

    var drawerToggle = document.querySelector(
      '[data-cart-drawer-toggle], [data-cart-toggle], .js-cart-toggle, button[aria-controls*="CartDrawer"], button[aria-label*="cart"], button[aria-label*="Cart"]'
    );
    if (drawerToggle && typeof drawerToggle.click === 'function') {
      drawerToggle.click();
      console.log('[OmafitCart] Drawer de carrinho aberto via toggle do tema.');
      return;
    }
    console.log('[OmafitCart] Solicitação para abrir drawer enviada, sem toggle detectado.');
  }

  function postResultToIframe(targetWindow, targetOrigin, resultPayload) {
    if (!targetWindow || !targetWindow.postMessage) return;
    var payload = resultPayload && typeof resultPayload === 'object' ? resultPayload : {};
    var finalMessage = {
      type: 'omafit-add-to-cart-result',
      payload: {
        requestId: payload.requestId,
        success: !!payload.success,
        message: payload.message || '',
        cart: payload.cart,
        variantId: payload.variantId,
        debug: payload.debug
      }
    };
    console.log('[OmafitCart] resultado enviado iframe:', finalMessage);
    try {
      targetWindow.postMessage(finalMessage, targetOrigin);
    } catch (e) {
      console.warn('[OmafitCart] Erro ao enviar resultado ao iframe:', e);
    }
  }

  async function fetchProductWithVariants() {
    const info = getProductInfo();
    const handle = (info.productHandle || '').trim();
    if (!handle) return null;
    try {
      const res = await fetch('/products/' + encodeURIComponent(handle) + '.js');
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.warn('[OmafitCart] Erro ao buscar produto:', e);
      return null;
    }
  }

  window.addEventListener('message', async function (event) {
    if (!isValidAddToCartMessage(event)) return;

    var payload = event.data.payload && typeof event.data.payload === 'object' ? event.data.payload : event.data;
    var requestId = payload.requestId !== undefined ? payload.requestId : event.data.requestId;
    var source = event.source;
    var origin = event.origin;

    if (OMAFIT_PROCESSED_REQUEST_IDS.has(requestId)) {
      console.log('[OmafitCart] Requisição duplicada ignorada:', requestId);
      postResultToIframe(source, origin, {
        requestId: requestId,
        success: false,
        message: 'Requisição duplicada',
        debug: { reason: 'idempotency' }
      });
      return;
    }
    if (Date.now() - OMAFIT_LAST_REQUEST_ID_CLEANUP > OMAFIT_REQUEST_ID_MAX_AGE_MS) {
      OMAFIT_PROCESSED_REQUEST_IDS.clear();
      OMAFIT_LAST_REQUEST_ID_CLEANUP = Date.now();
    }
    OMAFIT_PROCESSED_REQUEST_IDS.add(requestId);

    const selection = payload.selection || {};
    const quantity = payload.quantity === undefined ? 1 : Math.max(0, parseInt(payload.quantity, 10) || 1);
    const shopDomain = payload.shop_domain;
    const metadata = payload.metadata || {};
    const shouldOpenDrawer = !!(payload.open_cart_drawer || metadata.open_cart_drawer);

    console.log('[OmafitCart] Add-to-cart solicitado:', requestId, payload.product);

    var productData = await fetchProductWithVariants();
    if (!productData) {
      postResultToIframe(source, origin, {
        requestId: requestId,
        success: false,
        message: 'Produto não encontrado na página atual',
        debug: { reason: 'product_fetch' }
      });
      return;
    }

    var payloadProductId = String(payload.product.id || '').replace(/^.*\/(\d+)$/, '$1');
    var currentProductId = String(productData.id || '').replace(/^.*\/(\d+)$/, '$1');
    if (payloadProductId && currentProductId && payloadProductId !== currentProductId) {
      console.warn('[OmafitCart] product.id do payload não corresponde ao produto da página:', payloadProductId, 'vs', currentProductId);
      postResultToIframe(source, origin, {
        requestId: requestId,
        success: false,
        message: 'Produto da solicitação não corresponde à página atual',
        debug: { reason: 'product_mismatch' }
      });
      return;
    }

    var resolved = resolveVariantFromSelection({ productData: productData, selection: selection });
    if (resolved.error || !resolved.variant) {
      postResultToIframe(source, origin, {
        requestId: requestId,
        success: false,
        message: resolved.error || 'Variante não encontrada',
        debug: { reason: 'variant_resolution' }
      });
      return;
    }

    var variantId = resolved.variant.id;
    console.log('[OmafitCart] variantId final:', variantId);
    var properties = { _source: 'omafit_tryon' };
    if (metadata.session_id) properties._omafit_session_id = metadata.session_id;
    var cartLanguage =
      normalizeLanguageTag(metadata.language) ||
      normalizeLanguageTag(OMAFIT_CONFIG.adminLocale) ||
      normalizeLanguageTag(detectStoreLanguage()) ||
      '';
    if (cartLanguage) properties._omafit_language = cartLanguage;

    var addResult = await addToCart({ variantId: variantId, quantity: quantity || 1, properties: properties });

    if (addResult.success) {
      var renderedByTheme = renderThemeCartFromResponse(addResult.cart);
      var updatedCart = await fetchUpdatedCart();
      if (!renderedByTheme) {
        await refreshThemeCartSections();
      }
      notifyThemeCartUpdate(updatedCart || addResult.cart || null);
      dispatchCartUpdatedEvents(updatedCart || addResult.cart || null);
      openCartDrawerIfRequested(shouldOpenDrawer);
      postResultToIframe(source, origin, {
        requestId: requestId,
        success: true,
        message: 'Adicionado ao carrinho',
        cart: updatedCart || addResult.cart,
        variantId: variantId
      });
    } else {
      postResultToIframe(source, origin, {
        requestId: requestId,
        success: false,
        message: addResult.message || 'Erro ao adicionar ao carrinho',
        variantId: variantId,
        debug: addResult.debug || (addResult.body ? { body: addResult.body } : undefined)
      });
    }
  });

  // Criar o link do widget
  function createOmafitLink() {
    const link = document.createElement('a');
    link.href = 'javascript:void(0);';
    link.className = 'omafit-try-on-link';
    link.textContent = OMAFIT_CONFIG?.linkText || 'Experimentar virtualmente';

    // Estilos do link usando a cor primária
    const primaryColor = OMAFIT_CONFIG?.colors?.primary || OMAFIT_CONFIG?.colors?.text || '#810707';
    link.style.fontFamily = OMAFIT_CONFIG?.fontFamily || 'inherit';
    link.style.fontSize = 'inherit';
    link.style.fontWeight = 'inherit';
    link.style.lineHeight = 'inherit';
    link.style.color = primaryColor;
    link.style.textDecoration = 'underline';
    link.style.textDecorationColor = primaryColor;
    link.style.textUnderlineOffset = '3px';
    link.style.cursor = 'pointer';
    link.style.transition = 'all 0.2s ease';
    link.style.display = 'inline-block';

    link.addEventListener('mouseenter', function () {
      this.style.opacity = '0.7';
      this.style.textDecorationThickness = '2px';
      // Preconnect ao abrir o modal (aquecimento de conexão antes do clique)
      if (!document.querySelector('link[rel="preconnect"][href="' + OMAFIT_WIDGET_ORIGIN + '"]')) {
        const preconnect = document.createElement('link');
        preconnect.rel = 'preconnect';
        preconnect.href = OMAFIT_WIDGET_ORIGIN;
        preconnect.crossOrigin = 'anonymous';
        document.head.appendChild(preconnect);
      }
    });
    link.addEventListener('mouseleave', function () {
      this.style.opacity = '1';
      this.style.textDecorationThickness = '1px';
    });

    link.addEventListener('click', function (e) {
      e.preventDefault();
      if (typeof window.openOmafitModal === 'function') {
        window.openOmafitModal();
      }
    });

    return link;
  }

  // Criar link Omafit logo abaixo do botão "Adicionar ao carrinho"
  function insertOmafitLinkUnderAddToCart() {
    if (!OMAFIT_CONFIG) {
      console.error('Omafit: configuração não carregada, não é possível inserir link');
      // Usar configuração padrão
      OMAFIT_CONFIG = {
        linkText: 'Experimentar virtualmente',
        colors: { primary: '#810707', text: '#810707' },
        fontFamily: 'inherit',
        shopDomain: ''
      };
    }

    // Verificar se já existe um link Omafit (evitar duplicatas)
    if (document.querySelector('.omafit-try-on-link')) {
      console.log('✅ Link Omafit já existe na página');
      return;
    }

    // Tentar alguns seletores comuns de botão de carrinho
    const addToCartSelectors = [
      'button[name="add"]',
      'button[type="submit"][name="add"]',
      '.product-form__submit',
      'form[action*="/cart/add"] button[type="submit"]',
      'form[action*="/cart/add"] input[type="submit"]',
      '[name="add"]',
      'button[data-add-to-cart]',
      '.btn--add-to-cart',
      '.product-form__cart-submit',
      'button.product-form__cart-submit'
    ];

    // Seletores comuns do botão/contêiner "Compre já" (dynamic checkout)
    const buyNowSelectors = [
      '.shopify-payment-button',
      '.shopify-payment-button__button',
      'shopify-buy-it-now-button',
      '[data-shopify="payment-button"]'
    ];

    function findFirstVisible(selectors, root) {
      const scope = root || document;
      for (const sel of selectors) {
        const el = scope.querySelector(sel);
        if (el && el.offsetParent !== null) return { element: el, selector: sel };
      }
      return null;
    }

    let addToCartButton = null;
    for (const sel of addToCartSelectors) {
      const btn = document.querySelector(sel);
      if (btn && btn.offsetParent !== null) { // Verificar se está visível
        addToCartButton = btn;
        console.log('✅ Botão encontrado com seletor:', sel);
        break;
      }
    }

    // Criar container e link
    const container = document.createElement('div');
    container.className = 'omafit-widget';
    container.style.textAlign = 'center';
    container.style.marginTop = '16px';
    container.style.marginBottom = '24px';

    const link = createOmafitLink();
    container.appendChild(link);

    if (addToCartButton) {
      // Priorizar posicionamento abaixo do "Compre já", para ficar abaixo dos dois CTAs.
      let anchorElement = null;

      const closestForm = addToCartButton.closest('form');
      const closestProductBlock =
        addToCartButton.closest('.product-form') ||
        addToCartButton.closest('.product') ||
        addToCartButton.closest('[class*="product"]');

      // Busca "Compre já" em raízes mais próximas primeiro (evita pegar botão de outra seção).
      const searchRoots = [
        closestForm?.parentElement || null,
        closestForm || null,
        closestProductBlock || null,
        document
      ].filter(Boolean);

      for (const root of searchRoots) {
        const foundBuyNow = findFirstVisible(buyNowSelectors, root);
        if (foundBuyNow?.element) {
          anchorElement = foundBuyNow.element;
          console.log('✅ Botão/contêiner "Compre já" encontrado com seletor:', foundBuyNow.selector);
          break;
        }
      }

      // Se não encontrar "Compre já", mantém comportamento antigo (abaixo do adicionar ao carrinho).
      if (!anchorElement) {
        anchorElement = addToCartButton;
      }

      if (anchorElement.parentNode) {
        anchorElement.parentNode.insertBefore(container, anchorElement.nextSibling);
        console.log('✅ Widget inserido abaixo dos botões de compra');
      } else {
        // fallback: tenta inserir no root, se existir
        const root = document.getElementById('omafit-widget-root');
        if (root) {
          root.appendChild(container);
          console.log('✅ Widget inserido no root element');
        } else {
          document.body.appendChild(container);
          console.log('✅ Widget inserido no body (fallback)');
        }
      }
    } else {
      console.warn('⚠️ Omafit: botão "Adicionar ao carrinho" não encontrado. Tentando inserir no formulário de produto...');
      
      // Tentar encontrar formulário de produto
      const productForm = document.querySelector('form[action*="/cart/add"], .product-form, form.product-form');
      if (productForm) {
        productForm.appendChild(container);
        console.log('✅ Widget inserido no formulário de produto');
        return;
      }
      
      // Último fallback: inserir em qualquer elemento de produto
      const productSection = document.querySelector('.product, .product-single, [class*="product"]');
      if (productSection) {
        productSection.appendChild(container);
        console.log('✅ Widget inserido na seção de produto');
        return;
      }
      
      // Inserir no body como último recurso
      document.body.appendChild(container);
      console.log('✅ Widget inserido no body (último recurso)');
    }

    // CSS extra para mobile e foco
    const style = document.createElement('style');
    style.textContent =
      '@media (max-width: 768px) {' +
      '  .omafit-modal-overlay {' +
      '    background: transparent !important;' +
      '    backdrop-filter: none !important;' +
      '  }' +
      '  .omafit-modal-overlay > div:not([style*="transform: translate"]) {' +
      '    width: 100vw !important;' +
      '    height: 100vh !important;' +
      '    max-width: none !important;' +
      '    max-height: none !important;' +
      '  }' +
      '  .omafit-modal-overlay iframe {' +
      '    width: 100vw !important;' +
      '    height: 100vh !important;' +
      '    max-width: none !important;' +
      '    max-height: none !important;' +
      '    border-radius: 0 !important;' +
      '  }' +
      '  .omafit-modal-overlay > div > button {' +
      '    position: fixed !important;' +
      '    top: 20px !important;' +
      '    right: 16px !important;' +
      '    z-index: 1000002 !important;' +
      '    background: white !important;' +
      '    border-radius: 50% !important;' +
      '    width: 40px !important;' +
      '    height: 40px !important;' +
      '    box-shadow: 0 2px 8px rgba(0,0,0,0.2) !important;' +
      '  }' +
      '}' +
      '.omafit-try-on-link:focus {' +
      '  outline: 2px solid ' + (OMAFIT_CONFIG.colors?.primary || OMAFIT_CONFIG.colors?.text || '#810707') + ';' +
      '  outline-offset: 2px;' +
      '}';
    document.head.appendChild(style);
  }

  // Inicializar assim que a página e configuração estiverem prontas
  async function initOmafit() {
    try {
      console.log('🚀 Inicializando Omafit...');

      // Buscar configuração via API
      OMAFIT_CONFIG = await fetchOmafitConfig();
      if (OMAFIT_CONFIG) {
        OMAFIT_CONFIG.storeName = ensureStoreName(OMAFIT_CONFIG);
      }

      if (!OMAFIT_CONFIG) {
        console.error('❌ Falha ao carregar configuração do Omafit');
        // Tentar usar configuração padrão mesmo assim
        OMAFIT_CONFIG = {
          publicId: 'wgt_pub_default',
          linkText: 'Experimentar virtualmente',
          storeName: '',
          storeLogo: '',
          fontFamily: 'inherit',
          colors: {
            primary: '#810707',
            background: '#ffffff',
            text: '#810707',
            overlay: '#810707CC'
          },
          shopDomain: '',
          widgetEnabled: true,
          isActive: true
        };
      }

      OMAFIT_CONFIG.storeName = ensureStoreName(OMAFIT_CONFIG);

      console.log('✅ Configuração carregada:', OMAFIT_CONFIG);

      // Verificar se widget está habilitado antes de inserir
      const isEnabled = OMAFIT_CONFIG.widgetEnabled !== false && OMAFIT_CONFIG.isActive !== false;
      
      if (!isEnabled) {
        console.warn('⚠️ Widget Omafit está desabilitado. widgetEnabled:', OMAFIT_CONFIG.widgetEnabled, 'isActive:', OMAFIT_CONFIG.isActive);
        console.warn('⚠️ Para habilitar, configure widget_enabled=true no app e is_active=true em widget_keys');
        return;
      }

      // Aguardar um pouco para garantir que o DOM está pronto
      await new Promise(resolve => setTimeout(resolve, 100));

      // Inserir o widget na página
      insertOmafitLinkUnderAddToCart();

      console.log('✅ Omafit inicializado com sucesso');
    } catch (e) {
      console.error('❌ Omafit: erro ao inicializar widget', e);
      // Tentar inserir mesmo com erro, usando configuração padrão
      try {
        if (!OMAFIT_CONFIG) {
          OMAFIT_CONFIG = {
            publicId: 'wgt_pub_default',
            linkText: 'Experimentar virtualmente',
            colors: { primary: '#810707', text: '#810707' },
            fontFamily: 'inherit',
            shopDomain: '',
            widgetEnabled: true,
            isActive: true
          };
        }
        // Verificar se está habilitado mesmo no fallback
        if (OMAFIT_CONFIG.widgetEnabled !== false && OMAFIT_CONFIG.isActive !== false) {
          insertOmafitLinkUnderAddToCart();
        }
      } catch (err) {
        console.error('❌ Erro crítico ao inserir widget:', err);
      }
    }
  }

  // Inicializar widget (deferido para não bloquear carregamento da página)
  function startInit() {
    function doInit() {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initOmafit);
      } else {
        setTimeout(initOmafit, 50);
      }
    }

    // Usar requestIdleCallback quando disponível para não competir com recursos críticos
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(function() { doInit(); }, { timeout: 2000 });
    } else {
      doInit();
    }
  }

  startInit();
  
  // Também tentar após um delay (para temas que carregam conteúdo dinamicamente)
  setTimeout(function() {
    if (!document.querySelector('.omafit-try-on-link')) {
      console.log('🔄 Tentando inicializar novamente (retry)...');
      initOmafit();
    }
  }, 1000);

  // Observar mudanças no DOM (para SPAs)
  if (typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(function(mutations) {
      if (!document.querySelector('.omafit-try-on-link')) {
        const hasProductForm = document.querySelector('form[action*="/cart/add"], button[name="add"]');
        if (hasProductForm) {
          console.log('🔄 Novo conteúdo detectado, tentando inserir widget...');
          initOmafit();
        }
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
})();