/**
 * Gera recomendações didáticas por aba do Partners Dashboard.
 * @param {"marketing"|"product"|"churn"|"finance"|"social"} tab
 * @param {object} data
 * @param {{ partnersApiConfigured?: boolean, zohoMailConfigured?: boolean, zohoMailMode?: string, openaiConfigured?: boolean, youtubeApiConfigured?: boolean, instagramApiConfigured?: boolean, instagramPublishConfigured?: boolean }} ctx
 */
export function buildPartnersInsights(tab, data, ctx = {}) {
  const insights = [];

  if (tab === "marketing") {
    if (!ctx.partnersApiConfigured) {
      insights.push({
        id: "partner-api",
        severity: "info",
        title: "Partner API não configurada",
        description: "Instalações e desinstalações via Shopify Partners não estão sendo rastreadas.",
        action: "Configure SHOPIFY_PARTNER_ACCESS_TOKEN e SHOPIFY_PARTNER_ORG_ID no Railway.",
      });
    }

    const conversion = data?.conversionRate;
    if (conversion != null && conversion < 3) {
      insights.push({
        id: "low-conversion",
        severity: "warning",
        title: "Conversão try-on → pedido baixa",
        description: `Taxa atual: ${conversion}%. O funil está perdendo compradores após o provador virtual.`,
        action:
          "Revise posicionamento do widget na PDP, CTA pós try-on e remarketing para lojas com tráfego mas poucos pedidos.",
      });
    }

    const gap = (data?.totalStores || 0) - (data?.activeBilling || 0);
    if (gap > 0) {
      insights.push({
        id: "billing-gap",
        severity: gap >= 3 ? "warning" : "info",
        title: `${gap} loja(s) sem billing ativo`,
        description: "Há lojas instaladas que não estão pagando — receita e retenção em risco.",
        action: "Abra a aba Churn, envie e-mails de reativação e ofereça suporte na configuração do plano.",
      });
    }

    if ((data?.newStoresMonth ?? 0) === 0 && (data?.totalStores ?? 0) > 0) {
      insights.push({
        id: "no-new-stores",
        severity: "warning",
        title: "Nenhuma nova loja neste mês",
        description: "A aquisição desacelerou — dependência de base instalada sem crescimento.",
        action: "Intensifique campanhas na App Store, cases de sucesso e outreach para lojas fashion/eyewear.",
      });
    }

    if ((data?.estimatedMrrUsd ?? 0) > 0 && (data?.activeBilling ?? 0) > 0) {
      insights.push({
        id: "mrr-healthy",
        severity: "success",
        title: "Base pagante ativa",
        description: `MRR estimado de $${data.estimatedMrrUsd} com ${data.activeBilling} loja(s) em billing.`,
        action: "Mantenha foco em expansão de plano (upsell Pro) nas lojas com alto volume de try-on.",
      });
    }
  }

  if (tab === "product") {
    const completion = data?.completionRate;
    if (completion != null && completion < 60) {
      insights.push({
        id: "low-completion",
        severity: "warning",
        title: "Taxa de conclusão de sessões baixa",
        description: `Apenas ${completion}% das sessões são concluídas — usuários abandonam o fluxo AR.`,
        action:
          "Verifique performance do widget em mobile, tempo de carregamento do modelo e instruções na primeira sessão.",
      });
    }

    const gap = (data?.activeWidgets ?? 0) - (data?.payingStores ?? 0);
    if (gap > 0) {
      insights.push({
        id: "widget-billing-gap",
        severity: "info",
        title: "Widgets ativos acima de lojas pagantes",
        description: `${gap} widget(s) ativo(s) sem billing correspondente — possível uso gratuito ou sync pendente.`,
        action: "Sincronize billing via app admin e confira lojas com widget_keys ativos sem plano.",
      });
    }

    const topTryons = data?.topStoresByTryons?.[0];
    if (topTryons && (data?.tryOnsMonth ?? 0) > 0) {
      insights.push({
        id: "top-store",
        severity: "success",
        title: `Destaque: ${topTryons.key}`,
        description: `Líder em try-ons no período (${topTryons.count} sessões).`,
        action: "Use como case interno — peça depoimento e replique a configuração de widget nas outras lojas.",
      });
    }

    if ((data?.avgTryOnsPerStore ?? 0) < 5 && (data?.payingStores ?? 0) > 0) {
      insights.push({
        id: "low-engagement",
        severity: "warning",
        title: "Engajamento médio baixo por loja",
        description: "Lojas pagantes usam pouco o provador em relação ao potencial.",
        action: "Envie playbook de ativação: banner na home, coleção AR e e-mail para base da lojista.",
      });
    }
  }

  if (tab === "churn") {
    const inactive = data?.inactiveBilling ?? 0;
    if (inactive > 0) {
      insights.push({
        id: "churn-billing",
        severity: inactive >= 3 ? "critical" : "warning",
        title: `${inactive} loja(s) com billing inativo`,
        description: "Essas lojas instalaram o app mas não estão pagando — prioridade máxima de retenção.",
        action:
          ctx.zohoMailConfigured
            ? "Use o botão «Enviar e-mail» na tabela abaixo para contato personalizado via Zoho."
            : "Configure ZOHO_ZEPTOMAIL_TOKEN para enviar e-mails de reativação direto do dashboard.",
      });
    }

    const churn = data?.churnRateEstimate;
    if (churn != null && churn >= 15) {
      insights.push({
        id: "high-churn",
        severity: "critical",
        title: "Taxa de churn elevada",
        description: `Estimativa de ${churn}% — saídas superam o saudável para SaaS de nicho.`,
        action: "Agende call com as 3 principais lojas inativas e mapeie bloqueios (preço, UX, suporte).",
      });
    }

    if ((data?.inactiveWidgets ?? 0) > 0) {
      insights.push({
        id: "inactive-widgets",
        severity: "info",
        title: `${data.inactiveWidgets} widget(s) inativo(s)`,
        description: "Chaves de widget desativadas — pode indicar desinstalação parcial ou limpeza manual.",
        action: "Cruze com lista de billing inativo e Partner API para confirmar desinstalações reais.",
      });
    }

    if (inactive === 0 && (data?.uninstalls ?? 0) === 0) {
      insights.push({
        id: "churn-ok",
        severity: "success",
        title: "Churn sob controle",
        description: "Nenhuma loja com billing inativo no momento.",
        action: "Monitore semanalmente e mantenha NPS com as lojas de maior volume de try-on.",
      });
    }
  }

  if (tab === "finance") {
    if (data?.expensesTableExists === false) {
      insights.push({
        id: "expenses-table",
        severity: "warning",
        title: "Tabela de despesas não criada",
        description: "As despesas manuais precisam da tabela partners_expenses no Supabase.",
        action: "Execute o arquivo supabase_partners_expenses.sql no SQL Editor do Supabase.",
      });
    }

    const mrr = Number(data?.estimatedMrrUsd) || 0;
    const expensesMonth = Number(data?.expensesMonth) || 0;
    const net = Number(data?.netMarginMonth);

    if (mrr > 0 && expensesMonth > mrr) {
      insights.push({
        id: "negative-margin",
        severity: "critical",
        title: "Despesas acima do MRR",
        description: `Gastos do mês (${expensesMonth} USD) superam a receita recorrente estimada (${mrr} USD).`,
        action: "Revise custos fixos, adie investimentos não essenciais e priorize reativação de billing inativo.",
      });
    } else if (mrr > 0 && net != null && net < mrr * 0.3) {
      insights.push({
        id: "low-margin",
        severity: "warning",
        title: "Margem mensal apertada",
        description: `Margem estimada de ${data?.marginPercent ?? "—"}% após despesas do mês.`,
        action: "Negocie planos superiores com lojas de alto uso ou reduza custos de infraestrutura.",
      });
    } else if (mrr > 0 && expensesMonth === 0) {
      insights.push({
        id: "no-expenses",
        severity: "info",
        title: "Nenhuma despesa lançada no mês",
        description: "Adicione custos reais (Railway, APIs, ads, ferramentas) para ver margem líquida.",
        action: "Use o formulário abaixo para registrar despesas fixas e variáveis.",
      });
    } else if (mrr > 0 && net != null && net >= mrr * 0.5) {
      insights.push({
        id: "healthy-margin",
        severity: "success",
        title: "Margem saudável",
        description: `MRR estimado ${mrr} USD com margem líquida de ~${data?.marginPercent}%.`,
        action: "Mantenha disciplina de custos e reinvesta em aquisição com ROI mensurável.",
      });
    }

    if (mrr === 0 && (data?.activeBilling ?? 0) === 0) {
      insights.push({
        id: "no-mrr",
        severity: "warning",
        title: "Sem receita recorrente ativa",
        description: "Nenhuma loja com billing ativo — MRR estimado zerado.",
        action: "Foque na aba Churn e Marketing para reativar lojas e converter instalações em pagantes.",
      });
    }
  }

  if (tab === "social") {
    if (!ctx.youtubeApiConfigured) {
      insights.push({
        id: "youtube-api",
        severity: "info",
        title: "Métricas do YouTube indisponíveis",
        description: "O canal @omafit-g3d está vinculado, mas inscritos e views não são buscados em tempo real.",
        action: "Adicione YOUTUBE_API_KEY no Railway (YouTube Data API v3).",
      });
    }

    if (!ctx.instagramApiConfigured) {
      insights.push({
        id: "instagram-api",
        severity: "info",
        title: "Métricas do Instagram indisponíveis",
        description: "O perfil @omafit.co está vinculado — seguidores exigem token Meta Business.",
        action:
          "Configure INSTAGRAM_ACCESS_TOKEN e INSTAGRAM_BUSINESS_ACCOUNT_ID para insights do Instagram.",
      });
    }

    if (data?.instagram?.tokenExpired) {
      insights.push({
        id: "instagram-token-expired",
        severity: "critical",
        title: "Token do Instagram expirado",
        description: "O token no Railway não é mais válido — métricas e publicação falham.",
        action:
          "Atualize INSTAGRAM_ACCESS_TOKEN no Railway com um token de Página do Facebook.",
      });
    }

    if (!ctx.openaiConfigured) {
      insights.push({
        id: "carousel-template",
        severity: "info",
        title: "Copy do carrossel por template",
        description:
          "Sem OPENAI_API_KEY, o texto dos slides é montado automaticamente a partir do tema e da descrição.",
        action:
          "Opcional: configure OPENAI_API_KEY para copy mais criativa nos carrosséis de Instagram.",
      });
    }

    if (ctx.instagramApiConfigured && !ctx.instagramPublishConfigured) {
      insights.push({
        id: "instagram-publish",
        severity: "info",
        title: "Publicação automática indisponível",
        description:
          "O token do Instagram está configurado, mas falta Supabase Storage para hospedar as imagens antes de publicar.",
        action:
          "Configure SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY e crie o bucket público partners-social no Supabase.",
      });
    }
  }

  const order = { critical: 0, warning: 1, info: 2, success: 3 };
  return insights.sort((a, b) => order[a.severity] - order[b.severity]);
}
