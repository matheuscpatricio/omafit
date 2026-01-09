// Omafit - Widget oficial adaptado para Theme App Extension
(function () {
  // Configuração global (será preenchida pela API)
  let OMAFIT_CONFIG = null;

  // Carregar fontes do Google Fonts
  const fontsToLoad = [
    'Outfit:wght@100..900',
    'Playfair+Display:wght@400..900',
    'Raleway:wght@100..900',
    'Inter:opsz,wght@14..32,100..900'
  ];

  fontsToLoad.forEach((font) => {
    const fontName = font.split(':')[0];
    if (!document.querySelector('link[href*="' + fontName + '"]')) {
      const link = document.createElement('link');
      link.href = 'https://fonts.googleapis.com/css2?family=' + font + '&display=swap';
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
  });

  // Normalizar URLs
  function normalizeUrl(url) {
    if (!url) return null;
    if (url.startsWith('//')) {
      return 'https:' + url;
    }
    return url;
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
    let productHandle = '';

    // Pegar do elemento omafit-widget-root primeiro (prioridade)
    const rootElement = document.getElementById('omafit-widget-root');
    if (rootElement) {
      productId = rootElement.dataset.productId || '';
      productHandle = rootElement.dataset.productHandle || '';
    }

    // Se não tiver, tentar window.meta.product
    if (!productId && window.meta && window.meta.product) {
      productId = window.meta.product.id;
      productName = window.meta.product.title;
    } else if (
      !productId &&
      window.ShopifyAnalytics &&
      window.ShopifyAnalytics.meta &&
      window.ShopifyAnalytics.meta.product
    ) {
      productId = window.ShopifyAnalytics.meta.product.id;
      productName = window.ShopifyAnalytics.meta.product.name;
    }

    // Nome do produto
    if (!productName) {
      const nameEl = document.querySelector(
        '.product-single__title, h1.product__title, .product__title, [itemprop="name"]'
      );
      if (nameEl) productName = nameEl.textContent.trim();
    }

    // Handle do produto
    if (!productHandle) {
      const urlParts = window.location.pathname.split('/products/');
      if (urlParts.length > 1) {
        productHandle = urlParts[1].split('/')[0];
      }
    }

    return { productId, productName, productHandle };
  }

  // Buscar configuração do Omafit diretamente do Supabase
  async function fetchOmafitConfig() {
    try {
      const rootElement = document.getElementById('omafit-widget-root');
      let shopDomain = '';
      let publicId = '';

      if (rootElement) {
        shopDomain = rootElement.dataset.shopDomain || '';
        publicId = rootElement.dataset.publicId || '';
      }

      // Tentar detectar shop domain do Shopify
      if (!shopDomain && window.Shopify && window.Shopify.shop) {
        shopDomain = window.Shopify.shop;
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

      console.log('🔍 Shop domain detectado:', shopDomain);

      if (!shopDomain) {
        console.warn('⚠️ Shop domain não encontrado, usando configuração padrão');
        // Retornar configuração padrão mas continuar funcionando
        return {
          publicId: publicId || 'wgt_pub_default',
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

      // Buscar configuração diretamente do Supabase REST API
      const supabaseUrl = 'https://lhkgnirolvbmomeduoaj.supabase.co';
      const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxoa2duaXJvbHZibW9tZWR1b2FqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc3NjE2NDYsImV4cCI6MjA2MzMzNzY0Nn0.aSBMJMT8TiAqvdO_Z9D_oINLaQrFMZIK5IEQJG6KaOI';

      // Buscar widget_configurations, shopify_shops e widget_keys para obter publicId válido
      const [configResponse, shopResponse, widgetKeyResponse] = await Promise.all([
        fetch(
          `${supabaseUrl}/rest/v1/widget_configurations?shop_domain=eq.${encodeURIComponent(shopDomain)}&select=id,shop_domain,link_text,store_logo,primary_color,widget_enabled,created_at,updated_at`,
          {
            headers: {
              'apikey': supabaseAnonKey,
              'Authorization': `Bearer ${supabaseAnonKey}`,
              'Content-Type': 'application/json'
            }
          }
        ),
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
      if (widgetKeyResponse.ok) {
        try {
          const widgetKeyText = await widgetKeyResponse.text();
          if (widgetKeyText && widgetKeyText.trim().length > 0) {
            const widgetKeyData = JSON.parse(widgetKeyText);
            if (widgetKeyData && widgetKeyData.length > 0 && widgetKeyData[0].public_id && widgetKeyData[0].is_active) {
              validPublicId = widgetKeyData[0].public_id;
              console.log('✅ PublicId válido obtido de widget_keys:', validPublicId);
            }
          }
        } catch (e) {
          console.warn('⚠️ Erro ao obter publicId de widget_keys:', e);
        }
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
      
      // Mapear campos do banco de dados para o formato esperado pelo widget
      const mappedConfig = {
        publicId: validPublicId,
        linkText: config?.link_text || 'Experimentar virtualmente',
        storeName: config?.store_name || '',
        storeLogo: config?.store_logo || '',
        fontFamily: 'inherit', // Usar fonte da loja automaticamente
        colors: {
          primary: config?.primary_color || '#810707',
          background: '#ffffff',
          text: config?.primary_color || '#810707',
          overlay: (config?.primary_color || '#810707') + 'CC'
        },
        shopDomain: shopDomain
      };
      
      console.log('✅ Configuração mapeada:', {
        linkText: mappedConfig.linkText,
        storeLogo: mappedConfig.storeLogo ? '✅ Presente' : '❌ Ausente',
        primaryColor: mappedConfig.colors.primary,
        shopDomain: mappedConfig.shopDomain
      });
      
      return mappedConfig;
    } catch (error) {
      console.error('❌ Erro ao buscar configuração:', error);
      // Retornar configuração padrão em caso de erro
      return {
        publicId: 'wgt_pub_default',
        linkText: 'Experimentar virtualmente',
        storeName: '',
        storeLogo: '',
        fontFamily: 'inherit', // Usar fonte da loja automaticamente
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

  // Buscar tabelas de medidas do Supabase
  async function fetchSizeCharts(shopDomain, gender) {
    try {
      if (!shopDomain) {
        return null;
      }

      const supabaseUrl = 'https://lhkgnirolvbmomeduoaj.supabase.co';
      const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxoa2duaXJvbHZibW9tZWR1b2FqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc3NjE2NDYsImV4cCI6MjA2MzMzNzY0Nn0.aSBMJMT8TiAqvdO_Z9D_oINLaQrFMZIK5IEQJG6KaOI';

      // Tentar buscar tabela específica do gênero, ou unissex como fallback
      let genderToFetch = gender;
      if (gender !== 'male' && gender !== 'female') {
        genderToFetch = 'unisex';
      }

      const response = await fetch(
        `${supabaseUrl}/rest/v1/size_charts?shop_domain=eq.${encodeURIComponent(shopDomain)}&gender=eq.${genderToFetch}&select=sizes`,
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
          return data[0].sizes;
        }
      }

      // Se não encontrou, tentar unissex como fallback
      if (genderToFetch !== 'unisex') {
        const unisexResponse = await fetch(
          `${supabaseUrl}/rest/v1/size_charts?shop_domain=eq.${encodeURIComponent(shopDomain)}&gender=eq.unisex&select=sizes`,
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
            return unisexData[0].sizes;
          }
        }
      }

      return null;
    } catch (error) {
      console.error('❌ Erro ao buscar tabelas de medidas:', error);
      return null;
    }
  }

  // Calcular tamanho recomendado baseado nas medidas do usuário e tabelas de medidas
  async function calculateRecommendedSize(userMeasurements, shopDomain) {
    try {
      const { gender, height, weight, bodyType, fit } = userMeasurements;
      
      // Buscar tabela de medidas correspondente
      const sizeChart = await fetchSizeCharts(shopDomain, gender);
      
      if (!sizeChart || sizeChart.length === 0) {
        console.warn('⚠️ Nenhuma tabela de medidas encontrada para este gênero');
        return null;
      }

      // Calcular medidas estimadas do usuário
      // Fórmula básica: usar altura e peso com fatores de tipo de corpo e ajuste
      const baseChest = height * 0.45 * bodyType * fit;
      const baseWaist = height * 0.35 * bodyType * fit;
      const baseHip = height * 0.50 * bodyType * fit;

      // Encontrar o tamanho mais próximo comparando com a tabela
      let bestMatch = null;
      let smallestDifference = Infinity;

      sizeChart.forEach((size) => {
        const chest = parseFloat(size.peito) || 0;
        const waist = parseFloat(size.cintura) || 0;
        const hip = parseFloat(size.quadril) || 0;

        if (chest > 0 && waist > 0 && hip > 0) {
          // Calcular diferença total (distância euclidiana)
          const diff = Math.sqrt(
            Math.pow(chest - baseChest, 2) +
            Math.pow(waist - baseWaist, 2) +
            Math.pow(hip - baseHip, 2)
          );

          if (diff < smallestDifference) {
            smallestDifference = diff;
            bestMatch = size.size;
          }
        }
      });

      console.log('✅ Tamanho recomendado calculado:', bestMatch, 'Diferença:', smallestDifference);
      return bestMatch;
    } catch (error) {
      console.error('❌ Erro ao calcular tamanho recomendado:', error);
      return null;
    }
  }

  // Função que abre o modal do Omafit
  window.openOmafitModal = async function () {
    // Se configuração não estiver carregada, tentar carregar agora
    if (!OMAFIT_CONFIG) {
      console.warn('⚠️ Omafit: configuração não carregada, tentando carregar agora...');
      try {
        OMAFIT_CONFIG = await fetchOmafitConfig();
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

    const productInfo = getProductInfo();
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
      storeName: OMAFIT_CONFIG.storeName || 'Omafit',
      primaryColor: OMAFIT_CONFIG.colors?.primary || '#810707',
      // storeLogo será enviado via postMessage
      fontFamily: detectedFontFamily, // Usar fonte detectada da loja
      fontWeight: OMAFIT_CONFIG.fontWeight || '',
      fontStyle: OMAFIT_CONFIG.fontStyle || ''
    };

    // Garantir que shopDomain está disponível
    const shopDomain = OMAFIT_CONFIG.shopDomain || '';
    
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

    // Construir URL apenas com dados essenciais (evitar 414 URI Too Long)
    const publicIdToUse = OMAFIT_CONFIG.publicId || 'wgt_pub_default';
    console.log('🔑 PublicId sendo usado:', publicIdToUse);
    
    let widgetUrl =
      'https://omafit.netlify.app/widget' +
      '?productImage=' + encodeURIComponent(productImage) +
      '&productId=' + encodeURIComponent(productInfo.productId || 'unknown') +
      '&productName=' + encodeURIComponent(productInfo.productName || 'Produto') +
      '&publicId=' + encodeURIComponent(publicIdToUse) +
      '&shopDomain=' + encodeURIComponent(shopDomain) +
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
        // Enviar todas as imagens do produto (não apenas as 3 primeiras)
        if (allProductImages.length > 3) {
          iframe.contentWindow.postMessage({
            type: 'omafit-product-images',
            images: allProductImages
          }, 'https://omafit.netlify.app');
          console.log('📤 Enviadas', allProductImages.length, 'imagens via postMessage');
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
            }, 'https://omafit.netlify.app');
            console.log('📤 Logo enviado via postMessage (tamanho:', logoSize, 'chars, preview:', logoPreview, ')');
            
            // Também incluir logo na atualização de configuração
            iframe.contentWindow.postMessage({
              type: 'omafit-config-update',
              primaryColor: OMAFIT_CONFIG.colors?.primary || '#810707',
              storeName: OMAFIT_CONFIG.storeName || 'Omafit',
              storeLogo: OMAFIT_CONFIG.storeLogo, // Incluir logo na configuração também
              fontFamily: detectedFontFamily // Enviar fonte detectada
            }, 'https://omafit.netlify.app');
            console.log('📤 Configuração enviada via postMessage (com logo):', {
              primaryColor: OMAFIT_CONFIG.colors?.primary,
              storeName: OMAFIT_CONFIG.storeName,
              storeLogo: '✅ Presente (' + logoSize + ' chars)',
              fontFamily: detectedFontFamily
            });
          } else {
            console.warn('⚠️ Logo inválido (nem URL nem base64 válido):', {
              isUrl: isUrl,
              isBase64: isBase64,
              tamanho: logoSize,
              preview: logoPreview
            });
            
            // Enviar atualização de configuração sem logo (logo inválido)
            iframe.contentWindow.postMessage({
              type: 'omafit-config-update',
              primaryColor: OMAFIT_CONFIG.colors?.primary || '#810707',
              storeName: OMAFIT_CONFIG.storeName || 'Omafit',
              fontFamily: detectedFontFamily
            }, 'https://omafit.netlify.app');
            console.log('📤 Configuração enviada via postMessage (sem logo - inválido):', {
              primaryColor: OMAFIT_CONFIG.colors?.primary,
              fontFamily: detectedFontFamily
            });
          }
        } else {
          console.warn('⚠️ Logo não encontrado em OMAFIT_CONFIG.storeLogo');
          console.warn('⚠️ OMAFIT_CONFIG completo:', OMAFIT_CONFIG);
          
          // Enviar atualização de configuração sem logo
          iframe.contentWindow.postMessage({
            type: 'omafit-config-update',
            primaryColor: OMAFIT_CONFIG.colors?.primary || '#810707',
            storeName: OMAFIT_CONFIG.storeName || 'Omafit',
            fontFamily: detectedFontFamily
          }, 'https://omafit.netlify.app');
          console.log('📤 Configuração enviada via postMessage (sem logo):', {
            primaryColor: OMAFIT_CONFIG.colors?.primary,
            fontFamily: detectedFontFamily
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
      // Inserir logo após o botão de carrinho
      if (addToCartButton.parentNode) {
        addToCartButton.parentNode.insertBefore(container, addToCartButton.nextSibling);
        console.log('✅ Widget inserido após botão de carrinho');
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

    // Inserir logo após o botão de carrinho
    if (addToCartButton.parentNode) {
      addToCartButton.parentNode.insertBefore(container, addToCartButton.nextSibling);
    } else {
      // fallback: tenta inserir no root, se existir
      const root = document.getElementById('omafit-widget-root');
      if (root) {
        root.appendChild(container);
      } else {
        document.body.appendChild(container);
      }
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
          shopDomain: ''
        };
      }

      console.log('✅ Configuração carregada:', OMAFIT_CONFIG);

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
            shopDomain: ''
          };
        }
        insertOmafitLinkUnderAddToCart();
      } catch (err) {
        console.error('❌ Erro crítico ao inserir widget:', err);
      }
    }
  }

  // Inicializar widget
  function startInit() {
    console.log('🚀 Omafit: Iniciando widget...');
    console.log('📋 Estado do documento:', document.readyState);
    console.log('🏪 Shopify disponível:', !!window.Shopify);
    
    if (document.readyState === 'loading') {
      console.log('⏳ Aguardando DOMContentLoaded...');
      document.addEventListener('DOMContentLoaded', function() {
        console.log('✅ DOMContentLoaded disparado');
        initOmafit();
      });
    } else {
      console.log('✅ DOM já está pronto, inicializando imediatamente');
      // Aguardar um pouco para garantir que elementos estão renderizados
      setTimeout(initOmafit, 100);
    }
  }

  // Tentar múltiplas vezes se necessário (para SPAs)
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