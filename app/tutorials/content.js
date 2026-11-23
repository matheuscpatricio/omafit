/**
 * Documentos de tutorial exibidos no admin (widget e tabelas de medidas).
 * Conteúdo voltado ao lojista — linguagem clara, sem jargão técnico interno.
 */

const widgetTutorial = {
  "pt-BR": {
    title: "Tutorial: Widget do provador virtual",
    subtitle:
      "Guia completo de como o widget funciona na sua loja e o que cada configuração desta página controla.",
    sections: [
      {
        heading: "1. O que é o widget?",
        paragraphs: [
          "O widget Omafit é o botão ou link que aparece na página de produto da sua loja. Quando o cliente clica, abre o provador virtual: ele envia uma foto (ou usa a câmera), recebe a recomendação de tamanho e vê como a peça fica no corpo.",
          "Você não precisa colar código manualmente no tema. Depois que o app Omafit está instalado e habilitado no tema, o widget é injetado automaticamente nas páginas de produto.",
        ],
      },
      {
        heading: "2. Como ativar na loja (checklist)",
        paragraphs: [
          "Se o link/botão não aparecer na vitrine, confira nesta ordem:",
        ],
        bullets: [
          "Plano Omafit ativo (sem plano ativo o admin redireciona para a página de planos).",
          "App habilitado no tema: abra o Editor de tema → App embeds / incorporações do app → ative o Omafit.",
          "Nesta página, deixe o widget ligado (habilitado) e clique em Salvar configuração.",
          "O produto não pode estar só em coleções que você marcou como excluídas.",
          "Atualize a página do produto (às vezes leva alguns minutos para refletir).",
        ],
      },
      {
        heading: "3. Texto do link / botão",
        paragraphs: [
          "É o texto que o cliente vê na página de produto (ex.: “Experimentar virtualmente”).",
          "Dica: use uma chamada clara e curta. O logo da loja não aparece nesse botão — ele aparece dentro do provador, depois que o cliente abre a experiência.",
        ],
      },
      {
        heading: "4. Posição na página de produto",
        paragraphs: [
          "Você escolhe se o CTA do Omafit fica abaixo ou acima dos botões de compra (Adicionar ao carrinho / checkout dinâmico).",
          "Abaixo dos botões é o padrão e costuma funcionar bem na maioria dos temas. Acima pode aumentar a visibilidade se o bloco de compra for muito longo.",
        ],
      },
      {
        heading: "5. Estilo: link ou botão",
        paragraphs: [
          "Link: texto sublinhado, mais discreto, combina com temas minimalistas.",
          "Botão: borda na cor predominante e cantos arredondados (você controla o raio). Use quando quiser destacar o try-on como ação principal ao lado da compra.",
        ],
      },
      {
        heading: "6. Layout do provador",
        paragraphs: [
          "Define a experiência depois que o cliente abre o Omafit:",
        ],
        bullets: [
          "Minimalista — fluxo simples e direto.",
          "Guiado — jornada mais assistida, com mais orientação passo a passo.",
          "Editorial (Growth+) — visual mais premium; no desktop a imagem de fundo fica à direita e no mobile no topo, com degradê na cor predominante.",
        ],
        paragraphsAfter: [
          "A imagem de fundo do layout Editorial é opcional. Se não enviar, o layout ainda funciona com a cor da marca.",
        ],
      },
      {
        heading: "7. Logo e cor predominante",
        paragraphs: [
          "Logo: aparece dentro do provador (cabeçalho e layouts personalizados). Formatos JPG, PNG ou GIF, até 2 MB.",
          "Cor predominante: usada no link/botão da vitrine e nos destaques da interface do try-on. A fonte do widget herda a tipografia da sua loja automaticamente.",
        ],
      },
      {
        heading: "8. Coleções onde o widget NÃO deve aparecer",
        paragraphs: [
          "Marque coleções em que o try-on não faz sentido (acessórios sem medida de corpo, kits, gift cards, etc.).",
          "Se um produto pertence a uma coleção excluída, o widget fica oculto na página desse produto. Produtos sem relação com coleções excluídas continuam mostrando o CTA normalmente.",
        ],
      },
      {
        heading: "9. Consultor de estilo (Growth+)",
        paragraphs: [
          "Nos planos Growth ou superiores, após o try-on o cliente pode ver um chat de consultor de estilo: sugere combinações, permite experimentar peças relacionadas e orienta a adicionar ao carrinho.",
          "Se o seu plano não incluir o recurso, a opção aparece bloqueada nesta página — faça upgrade para liberar.",
        ],
      },
      {
        heading: "10. Relação com as tabelas de medidas",
        paragraphs: [
          "O widget usa as tabelas configuradas em Tabelas de medidas para sugerir o tamanho certo. Sem tabela aplicável ao produto, a recomendação de tamanho pode ficar oculta — o try-on visual ainda pode funcionar, mas a sugestão de tamanho depende dessas tabelas.",
          "Prioridade: tabela específica do produto → tabela da coleção → tabela global (padrão da loja). Detalhes completos estão no tutorial da página Tabelas de medidas.",
        ],
      },
      {
        heading: "11. Boas práticas e resolução rápida de dúvidas",
        bullets: [
          "Sempre clique em Salvar depois de alterar texto, posição, cor, logo ou coleções.",
          "Teste em um produto real da vitrine (não só no preview do admin) em desktop e celular.",
          "Se o CTA sumiu: verifique tema habilitado, widget ligado e coleções excluídas.",
          "Se a cor/logo não atualizou: aguarde alguns minutos e limpe o cache do navegador.",
          "Para recomendação de tamanho imprecisa: revise tipo de produto, elasticidade e valores em cm nas tabelas de medidas.",
        ],
      },
    ],
  },
  en: {
    title: "Tutorial: Virtual try-on widget",
    subtitle:
      "Complete guide to how the widget works in your store and what each setting on this page controls.",
    sections: [
      {
        heading: "1. What is the widget?",
        paragraphs: [
          "The Omafit widget is the button or link on your product page. When shoppers click it, the virtual try-on opens: they upload a photo (or use the camera), get a size recommendation, and see how the item looks on them.",
          "You do not need to paste code into the theme. After the Omafit app is installed and enabled in the theme, the widget is injected automatically on product pages.",
        ],
      },
      {
        heading: "2. How to enable it (checklist)",
        paragraphs: ["If the link/button does not appear on the storefront, check in this order:"],
        bullets: [
          "Active Omafit plan (without an active plan the admin redirects to billing).",
          "App enabled in the theme: Theme editor → App embeds → turn Omafit on.",
          "On this page, keep the widget enabled and click Save configuration.",
          "The product must not only belong to collections you marked as excluded.",
          "Refresh the product page (changes can take a few minutes).",
        ],
      },
      {
        heading: "3. Link / button text",
        paragraphs: [
          "This is the text shoppers see on the product page (e.g. “Try virtual fit”).",
          "Tip: keep it short and clear. Your store logo does not appear on this CTA — it appears inside the try-on after they open the experience.",
        ],
      },
      {
        heading: "4. Position on the product page",
        paragraphs: [
          "Choose whether the Omafit CTA sits below or above the buy buttons (Add to cart / dynamic checkout).",
          "Below is the default and works well on most themes. Above can help if the purchase block is very long.",
        ],
      },
      {
        heading: "5. Style: link or button",
        paragraphs: [
          "Link: underlined text, more discreet, fits minimal themes.",
          "Button: border in your primary color with adjustable corner radius. Use it when you want try-on to stand out next to purchase.",
        ],
      },
      {
        heading: "6. Try-on layout",
        paragraphs: ["Controls the experience after the shopper opens Omafit:"],
        bullets: [
          "Minimalist — simple, direct flow.",
          "Guided — more assisted, step-by-step journey.",
          "Editorial (Growth+) — premium look; background image on the right on desktop and at the top on mobile, blended with your primary color.",
        ],
        paragraphsAfter: [
          "The Editorial background image is optional. Without it, the layout still works with your brand color.",
        ],
      },
      {
        heading: "7. Logo and primary color",
        paragraphs: [
          "Logo: shown inside the try-on (header and custom layouts). JPG, PNG or GIF, up to 2 MB.",
          "Primary color: used on the storefront CTA and try-on highlights. The widget font inherits your store typography automatically.",
        ],
      },
      {
        heading: "8. Collections where the widget should NOT appear",
        paragraphs: [
          "Select collections where try-on does not make sense (non-apparel accessories, kits, gift cards, etc.).",
          "If a product belongs to an excluded collection, the widget is hidden on that product page. Other products keep showing the CTA.",
        ],
      },
      {
        heading: "9. Style consultant (Growth+)",
        paragraphs: [
          "On Growth plans or higher, after try-on shoppers can see a style consultant chat: outfit suggestions, related try-ons, and add-to-cart guidance.",
          "If your plan does not include it, the option appears locked — upgrade to unlock.",
        ],
      },
      {
        heading: "10. Relationship with size charts",
        paragraphs: [
          "The widget uses the charts configured under Size charts to recommend size. Without an applicable chart, size recommendation may be hidden — visual try-on can still work, but size suggestion depends on those tables.",
          "Priority: product-specific chart → collection chart → global (store default). Full details are in the Size charts tutorial.",
        ],
      },
      {
        heading: "11. Best practices and quick troubleshooting",
        bullets: [
          "Always click Save after changing text, position, color, logo, or collections.",
          "Test on a real storefront product (not only admin preview) on desktop and mobile.",
          "If the CTA disappeared: check theme embed, widget enabled, and excluded collections.",
          "If color/logo did not update: wait a few minutes and clear browser cache.",
          "If size recommendations are off: review product type, elasticity, and cm values in size charts.",
        ],
      },
    ],
  },
  es: {
    title: "Tutorial: Widget del probador virtual",
    subtitle:
      "Guía completa de cómo funciona el widget en tu tienda y qué controla cada ajuste de esta página.",
    sections: [
      {
        heading: "1. ¿Qué es el widget?",
        paragraphs: [
          "El widget Omafit es el botón o enlace en la página de producto. Al hacer clic, se abre el probador virtual: el cliente envía una foto (o usa la cámara), recibe la talla recomendada y ve cómo le queda la prenda.",
          "No necesitas pegar código en el tema. Con la app instalada y activada en el tema, el widget se inyecta automáticamente en las páginas de producto.",
        ],
      },
      {
        heading: "2. Cómo activarlo (lista de comprobación)",
        paragraphs: ["Si el enlace/botón no aparece en la tienda, revisa en este orden:"],
        bullets: [
          "Plan Omafit activo (sin plan activo el admin redirige a facturación).",
          "App activada en el tema: Editor del tema → Incorporaciones de la app → activa Omafit.",
          "En esta página, deja el widget activado y pulsa Guardar configuración.",
          "El producto no debe pertenecer solo a colecciones que marcaste como excluidas.",
          "Actualiza la página del producto (a veces tarda unos minutos).",
        ],
      },
      {
        heading: "3. Texto del enlace / botón",
        paragraphs: [
          "Es el texto que ve el cliente en la página de producto (p. ej. “Probar virtualmente”).",
          "Consejo: usa un texto corto y claro. El logo no aparece en ese CTA — aparece dentro del probador al abrirlo.",
        ],
      },
      {
        heading: "4. Posición en la página de producto",
        paragraphs: [
          "Elige si el CTA de Omafit queda debajo o encima de los botones de compra.",
          "Debajo es el valor predeterminado y suele funcionar bien. Encima puede ayudar si el bloque de compra es muy largo.",
        ],
      },
      {
        heading: "5. Estilo: enlace o botón",
        paragraphs: [
          "Enlace: texto subrayado, más discreto.",
          "Botón: borde con el color principal y radio de esquinas ajustable. Úsalo para destacar el try-on junto a la compra.",
        ],
      },
      {
        heading: "6. Diseño del probador",
        paragraphs: ["Define la experiencia después de abrir Omafit:"],
        bullets: [
          "Minimalista — flujo simple y directo.",
          "Guiado — recorrido más asistido, paso a paso.",
          "Editorial (Growth+) — look premium; imagen de fondo a la derecha en desktop y arriba en móvil, con degradado del color principal.",
        ],
        paragraphsAfter: [
          "La imagen de fondo Editorial es opcional. Sin ella, el layout sigue funcionando con el color de marca.",
        ],
      },
      {
        heading: "7. Logo y color principal",
        paragraphs: [
          "Logo: se muestra dentro del probador. JPG, PNG o GIF, hasta 2 MB.",
          "Color principal: se usa en el CTA de la tienda y en los destacados del try-on. La fuente se hereda de la tienda.",
        ],
      },
      {
        heading: "8. Colecciones donde el widget NO debe aparecer",
        paragraphs: [
          "Marca colecciones donde el try-on no tiene sentido (accesorios sin talla de cuerpo, kits, tarjetas regalo, etc.).",
          "Si un producto pertenece a una colección excluida, el widget se oculta en esa página.",
        ],
      },
      {
        heading: "9. Consultor de estilo (Growth+)",
        paragraphs: [
          "En planes Growth o superiores, tras el try-on el cliente puede ver un chat de consultor: sugiere combinaciones, permite probar prendas relacionadas y orienta a añadir al carrito.",
          "Si tu plan no lo incluye, la opción aparece bloqueada — actualiza el plan para liberarla.",
        ],
      },
      {
        heading: "10. Relación con las tablas de medidas",
        paragraphs: [
          "El widget usa las tablas de Tablas de medidas para sugerir la talla. Sin tabla aplicable, la recomendación puede ocultarse; el try-on visual puede seguir funcionando.",
          "Prioridad: tabla del producto → tabla de colección → tabla global. Los detalles están en el tutorial de Tablas de medidas.",
        ],
      },
      {
        heading: "11. Buenas prácticas y solución rápida",
        bullets: [
          "Siempre pulsa Guardar tras cambiar texto, posición, color, logo o colecciones.",
          "Prueba en un producto real de la tienda (no solo en el admin) en escritorio y móvil.",
          "Si desapareció el CTA: revisa la incorporación del tema, widget activo y colecciones excluidas.",
          "Si color/logo no cambió: espera unos minutos y limpia la caché del navegador.",
          "Si la talla recomendada falla: revisa tipo de producto, elasticidad y valores en cm en las tablas.",
        ],
      },
    ],
  },
};

const sizeChartTutorial = {
  "pt-BR": {
    title: "Tutorial: Tabelas de medidas",
    subtitle:
      "Guia completo de como montar as tabelas para o Omafit recomendar o tamanho certo aos seus clientes.",
    sections: [
      {
        heading: "1. Por que as tabelas importam?",
        paragraphs: [
          "As tabelas de medidas são a base da recomendação de tamanho no provador. O Omafit compara as medidas do corpo do cliente (peito, cintura, quadril ou tamanho do pé) com os valores que você cadastra aqui.",
          "Quanto mais fiéis forem os números à sua modelagem real, melhor a precisão. Tabelas genéricas ou inventadas reduzem a qualidade da sugestão.",
        ],
      },
      {
        heading: "2. Duas formas de configurar",
        paragraphs: ["Nesta página você escolhe o escopo da tabela:"],
        bullets: [
          "Por coleção — ideal quando vários produtos da mesma coleção compartilham a mesma tabela (ex.: “Calças jeans”).",
          "Por produto — sobrescreve a tabela da coleção só para aquele produto (ex.: um modelo oversized ou com caimento diferente).",
        ],
        paragraphsAfter: [
          "Existe também a opção padrão (toda a loja): use quando quiser uma tabela global de fallback para produtos sem tabela própria nem de coleção.",
        ],
      },
      {
        heading: "3. Ordem de prioridade (como o widget escolhe a tabela)",
        paragraphs: [
          "Na página do produto, o widget decide assim:",
        ],
        bullets: [
          "1º — Tabela específica do produto (aba Configurar por produto).",
          "2º — Tabela de uma das coleções do produto (a mais específica disponível).",
          "3º — Tabela global / padrão da loja.",
          "4º — Se não houver nenhuma, a recomendação de tamanho fica oculta para aquele produto.",
        ],
        paragraphsAfter: [
          "Use o botão “Ver tabela por produto” no topo desta página para auditar qual tabela cada produto está recebendo.",
        ],
      },
      {
        heading: "4. Público (gênero da tabela)",
        paragraphs: [
          "Para cada coleção ou produto você define o público:",
        ],
        bullets: [
          "Roupas masculinas e femininas — o cliente escolhe o gênero na calculadora; você configura as tabelas masculina e/ou feminina (e unissex, se quiser).",
          "Apenas masculinas / apenas femininas — o cliente não precisa escolher gênero; os manequins e a tabela ficam no gênero correto.",
        ],
        paragraphsAfter: [
          "Ative só as tabelas que fizerem sentido. Uma tabela desativada não é usada na recomendação.",
        ],
      },
      {
        heading: "5. Tipo de produto",
        paragraphs: ["Escolha uma opção — isso muda quais medidas o motor usa:"],
        bullets: [
          "Parte de cima — camisas, jaquetas, regatas… (foco em peito/ombros).",
          "Parte de baixo — calças, shorts, bermudas… (foco em cintura/quadril).",
          "Corpo inteiro — vestidos, macacões, conjuntos…",
          "Calçado — usa apenas o tamanho do pé em cm (referência fixa).",
        ],
      },
      {
        heading: "6. Elasticidade do tecido",
        paragraphs: [
          "Para roupas (não calçado), diga como o tecido se comporta. Isso ajusta a tolerância da recomendação:",
        ],
        bullets: [
          "Estruturado — alfaiataria, jeans rígido, sem elastano (mais rigoroso).",
          "Leve flexibilidade — até cerca de 3% elastano.",
          "Flexível — malha e stretch.",
          "Alta elasticidade — ribana, knit, peças muito ajustáveis (mais permissivo).",
        ],
      },
      {
        heading: "7. Referências de medida e tamanhos",
        paragraphs: [
          "Para roupas, escolha exatamente 3 referências (ex.: peito, cintura, quadril) e preencha cada tamanho (P, M, G…) com os valores em centímetros da sua grade.",
          "Para calçado, a referência é fixa: tamanho do pé (cm). Cadastre cada numeração com a medida correspondente do pé.",
          "Use os mesmos critérios da sua ficha técnica / tabela oficial da marca. Evite misturar polegadas com centímetros.",
        ],
      },
      {
        heading: "8. Fluxo recomendado para começar",
        bullets: [
          "Comece pela coleção mais vendida (ou pela tabela padrão da loja).",
          "Defina público, tipo de produto e elasticidade.",
          "Ative a(s) tabela(s) de gênero necessárias e cadastre todos os tamanhos.",
          "Salve as tabelas.",
          "Abra “Ver tabela por produto” e confira se os produtos certos herdaram a tabela.",
          "Para exceções (caimento diferente), crie uma tabela por produto.",
          "Teste no widget: abra um produto na loja e faça um try-on de prova.",
        ],
      },
      {
        heading: "9. Erros comuns (e como evitar)",
        bullets: [
          "Tabela só na coleção A, mas o produto está só na coleção B → o widget não encontra a tabela. Use a global ou configure a coleção correta / o produto.",
          "Produto com tabela própria desatualizada → a tabela do produto sempre vence a da coleção; atualize ou desative a do produto.",
          "Valores em cm errados ou invertidos entre tamanhos → a sugestão fica inconsistente.",
          "Tipo “parte de cima” em calças (ou o contrário) → o motor prioriza as medidas erradas.",
          "Esquecer de clicar em Salvar tabelas → nada muda na loja.",
        ],
      },
      {
        heading: "10. Relação com o widget",
        paragraphs: [
          "Mesmo com tabelas perfeitas, o CTA do try-on precisa estar visível: widget habilitado, app ativo no tema e produto fora de coleções excluídas (veja o tutorial da página Widget).",
          "As tabelas alimentam a sugestão de tamanho; a personalização visual (texto, cor, layout) fica na página Widget.",
        ],
      },
    ],
  },
  en: {
    title: "Tutorial: Size charts",
    subtitle:
      "Complete guide to building charts so Omafit can recommend the right size to your customers.",
    sections: [
      {
        heading: "1. Why charts matter",
        paragraphs: [
          "Size charts power size recommendations in the try-on. Omafit compares the shopper’s body measurements (chest, waist, hip, or foot size) with the values you enter here.",
          "The closer the numbers are to your real grading, the better the accuracy. Generic or made-up charts reduce suggestion quality.",
        ],
      },
      {
        heading: "2. Two ways to configure",
        paragraphs: ["On this page you choose the chart scope:"],
        bullets: [
          "By collection — best when many products in the same collection share one chart (e.g. “Denim jeans”).",
          "By product — overrides the collection chart for that product only (e.g. an oversized fit).",
        ],
        paragraphsAfter: [
          "There is also a store-wide default: use it as a global fallback for products with neither a product nor a collection chart.",
        ],
      },
      {
        heading: "3. Priority order (how the widget picks a chart)",
        paragraphs: ["On the product page, the widget decides like this:"],
        bullets: [
          "1st — Product-specific chart (Configure by product tab).",
          "2nd — Chart from one of the product’s collections (most specific available).",
          "3rd — Global / store default chart.",
          "4th — If none exist, size recommendation is hidden for that product.",
        ],
        paragraphsAfter: [
          "Use “View product mapping” at the top of this page to audit which chart each product receives.",
        ],
      },
      {
        heading: "4. Audience (chart gender)",
        paragraphs: ["For each collection or product you set the audience:"],
        bullets: [
          "Men’s and women’s — the shopper picks gender in the calculator; you configure male and/or female charts (and unisex if needed).",
          "Men only / women only — shoppers skip gender choice; mannequins and charts stay on the correct gender.",
        ],
        paragraphsAfter: [
          "Enable only the charts that make sense. A disabled chart is not used for recommendations.",
        ],
      },
      {
        heading: "5. Product type",
        paragraphs: ["Pick one option — this changes which measurements the engine emphasizes:"],
        bullets: [
          "Tops — shirts, jackets, tanks… (chest/shoulders focus).",
          "Bottoms — pants, shorts… (waist/hip focus).",
          "Full body — dresses, jumpsuits, sets…",
          "Footwear — uses only foot size in cm (fixed reference).",
        ],
      },
      {
        heading: "6. Fabric elasticity",
        paragraphs: [
          "For apparel (not footwear), describe how the fabric behaves. This adjusts recommendation tolerance:",
        ],
        bullets: [
          "Structured — tailored, rigid denim, no elastane (stricter).",
          "Light stretch — up to about 3% elastane.",
          "Flexible — knits and stretch fabrics.",
          "High elasticity — rib, knit, highly adjustable pieces (more permissive).",
        ],
      },
      {
        heading: "7. Measurement references and sizes",
        paragraphs: [
          "For apparel, choose exactly 3 references (e.g. chest, waist, hip) and fill each size (S, M, L…) with centimetre values from your grade.",
          "For footwear, the reference is fixed: foot size (cm). Enter each shoe size with the matching foot measurement.",
          "Use the same criteria as your tech pack / brand size chart. Do not mix inches and centimetres.",
        ],
      },
      {
        heading: "8. Recommended setup flow",
        bullets: [
          "Start with your best-selling collection (or the store default chart).",
          "Set audience, product type, and elasticity.",
          "Enable the needed gender charts and enter all sizes.",
          "Save the charts.",
          "Open “View product mapping” and confirm the right products inherited the chart.",
          "For exceptions, create a product-level chart.",
          "Test in the widget on a live product page.",
        ],
      },
      {
        heading: "9. Common mistakes",
        bullets: [
          "Chart only on collection A while the product is only in collection B → widget finds nothing. Use global, fix the collection, or set the product chart.",
          "Outdated product chart → product charts always win over collection charts; update or disable the product one.",
          "Wrong or inverted cm values across sizes → inconsistent suggestions.",
          "“Tops” type on pants (or the reverse) → engine weights the wrong measurements.",
          "Forgetting Save charts → nothing changes on the storefront.",
        ],
      },
      {
        heading: "10. Relationship with the widget",
        paragraphs: [
          "Even with perfect charts, the try-on CTA must be visible: widget enabled, app embed on, product not only in excluded collections (see the Widget tutorial).",
          "Charts feed size suggestions; visual personalization (text, color, layout) lives on the Widget page.",
        ],
      },
    ],
  },
  es: {
    title: "Tutorial: Tablas de medidas",
    subtitle:
      "Guía completa para crear tablas y que Omafit recomiende la talla correcta a tus clientes.",
    sections: [
      {
        heading: "1. Por qué importan las tablas",
        paragraphs: [
          "Las tablas de medidas son la base de la recomendación de talla. Omafit compara las medidas del cuerpo del cliente (pecho, cintura, cadera o talla del pie) con los valores que registras aquí.",
          "Cuanto más fieles sean los números a tu patronaje real, mejor la precisión. Tablas genéricas o inventadas reducen la calidad de la sugerencia.",
        ],
      },
      {
        heading: "2. Dos formas de configurar",
        paragraphs: ["En esta página eliges el alcance de la tabla:"],
        bullets: [
          "Por colección — ideal cuando varios productos de la misma colección comparten tabla (p. ej. “Jeans”).",
          "Por producto — sustituye la tabla de la colección solo para ese producto (p. ej. un modelo oversized).",
        ],
        paragraphsAfter: [
          "También existe la opción predeterminada (toda la tienda): úsala como respaldo global cuando no hay tabla de producto ni de colección.",
        ],
      },
      {
        heading: "3. Orden de prioridad (cómo elige el widget)",
        paragraphs: ["En la página de producto, el widget decide así:"],
        bullets: [
          "1.º — Tabla específica del producto (pestaña Configurar por producto).",
          "2.º — Tabla de una de las colecciones del producto (la más específica disponible).",
          "3.º — Tabla global / predeterminada de la tienda.",
          "4.º — Si no hay ninguna, la recomendación de talla se oculta para ese producto.",
        ],
        paragraphsAfter: [
          "Usa “Ver tabla por producto” arriba para auditar qué tabla recibe cada producto.",
        ],
      },
      {
        heading: "4. Público (género de la tabla)",
        paragraphs: ["Para cada colección o producto defines el público:"],
        bullets: [
          "Ropa de hombre y de mujer — el cliente elige género en la calculadora; configuras tablas masculina y/o femenina (y unisex si quieres).",
          "Solo hombre / solo mujer — el cliente no elige género; maniquíes y tabla quedan en el género correcto.",
        ],
        paragraphsAfter: [
          "Activa solo las tablas que tengan sentido. Una tabla desactivada no se usa en la recomendación.",
        ],
      },
      {
        heading: "5. Tipo de producto",
        paragraphs: ["Elige una opción — cambia qué medidas prioriza el motor:"],
        bullets: [
          "Parte de arriba — camisas, chaquetas, camisetas…",
          "Parte de abajo — pantalones, shorts…",
          "Cuerpo entero — vestidos, monos, conjuntos…",
          "Calzado — solo talla del pie en cm (referencia fija).",
        ],
      },
      {
        heading: "6. Elasticidad del tejido",
        paragraphs: [
          "Para ropa (no calzado), indica cómo se comporta el tejido. Ajusta la tolerancia de la recomendación:",
        ],
        bullets: [
          "Estructurado — sastrería, denim rígido, sin elastano (más estricto).",
          "Ligera flexibilidad — hasta ~3% elastano.",
          "Flexible — punto y stretch.",
          "Alta elasticidad — canalé, knit, piezas muy ajustables (más permisivo).",
        ],
      },
      {
        heading: "7. Referencias de medida y tallas",
        paragraphs: [
          "Para ropa, elige exactamente 3 referencias (p. ej. pecho, cintura, cadera) y rellena cada talla (S, M, L…) con valores en centímetros de tu grade.",
          "Para calzado, la referencia es fija: talla del pie (cm).",
          "Usa los mismos criterios que tu ficha técnica. No mezcles pulgadas y centímetros.",
        ],
      },
      {
        heading: "8. Flujo recomendado para empezar",
        bullets: [
          "Empieza por la colección más vendida (o la tabla predeterminada).",
          "Define público, tipo de producto y elasticidad.",
          "Activa las tablas de género necesarias y registra todas las tallas.",
          "Guarda las tablas.",
          "Abre “Ver tabla por producto” y comprueba la herencia.",
          "Para excepciones, crea una tabla por producto.",
          "Prueba en el widget en un producto real de la tienda.",
        ],
      },
      {
        heading: "9. Errores frecuentes",
        bullets: [
          "Tabla solo en la colección A y el producto solo en B → el widget no encuentra tabla.",
          "Tabla de producto desactualizada → siempre gana a la de colección; actualízala o desactívala.",
          "Valores en cm erróneos o invertidos → sugerencias inconsistentes.",
          "Tipo “parte de arriba” en pantalones (o al revés) → el motor prioriza mal.",
          "Olvidar Guardar tablas → no cambia nada en la tienda.",
        ],
      },
      {
        heading: "10. Relación con el widget",
        paragraphs: [
          "Aunque las tablas estén perfectas, el CTA del try-on debe ser visible: widget activo, app en el tema y producto fuera de colecciones excluidas (ver tutorial de Widget).",
          "Las tablas alimentan la talla; la personalización visual está en la página Widget.",
        ],
      },
    ],
  },
};

const TUTORIALS = {
  widget: widgetTutorial,
  sizeChart: sizeChartTutorial,
};

export function getTutorialDoc(key, locale) {
  const pack = TUTORIALS[key];
  if (!pack) return null;
  const lang =
    locale && String(locale).toLowerCase().startsWith("pt")
      ? "pt-BR"
      : locale && String(locale).toLowerCase().startsWith("es")
        ? "es"
        : "en";
  return pack[lang] || pack.en || null;
}
