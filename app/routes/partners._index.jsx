import { Form, useLoaderData, useRevalidator } from "react-router";
import { useCallback, useEffect, useState } from "react";
import { requirePartnersAuth } from "../partners-auth.server";
import { fetchPartnersDashboardStats } from "../partners-dashboard.server";
import { isShopifyPartnersApiConfigured } from "../shopify-partners-api.server";
import { getZohoMailDeliveryMode, isZohoMailConfigured } from "../zoho-mail.server";

export const loader = async ({ request }) => {
  await requirePartnersAuth(request);
  const stats = await fetchPartnersDashboardStats();
  return {
    stats,
    partnersApiConfigured: isShopifyPartnersApiConfigured(),
    zohoMailConfigured: isZohoMailConfigured(),
    zohoMailMode: getZohoMailDeliveryMode(),
  };
};

const TABS = [
  { id: "marketing", label: "Marketing & Aquisição" },
  { id: "product", label: "Produto" },
  { id: "churn", label: "Churn" },
];

function formatNumber(value) {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("pt-BR").format(value);
}

function formatCurrency(value, currency = "USD") {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value) {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value}%`;
}

function MetricCard({ label, value, hint }) {
  return (
    <div className="omafit-partners-metric">
      <span className="omafit-partners-metric-label">{label}</span>
      <span className="omafit-partners-metric-value">{value}</span>
      {hint ? <span className="omafit-partners-metric-hint">{hint}</span> : null}
    </div>
  );
}

function PlanBreakdown({ title, byPlan }) {
  const entries = Object.entries(byPlan || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    return (
      <div className="omafit-partners-card">
        <h3>{title}</h3>
        <p className="omafit-partners-muted">Nenhum dado ainda.</p>
      </div>
    );
  }
  return (
    <div className="omafit-partners-card">
      <h3>{title}</h3>
      <ul className="omafit-partners-plan-list">
        {entries.map(([plan, count]) => (
          <li key={plan}>
            <span className="omafit-partners-plan-name">{plan}</span>
            <span className="omafit-partners-plan-count">{formatNumber(count)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StoresTable({ title, rows, columns }) {
  return (
    <div className="omafit-partners-card omafit-partners-card--wide">
      <h3>{title}</h3>
      {!rows?.length ? (
        <p className="omafit-partners-muted">Nenhum registro.</p>
      ) : (
        <div className="omafit-partners-table-wrap">
          <table className="omafit-partners-table">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col.key}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.id || row.domain || row.storeId || row.key || i}>
                  {columns.map((col) => (
                    <td key={col.key}>{col.render(row)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TopList({ title, items }) {
  return (
    <div className="omafit-partners-card">
      <h3>{title}</h3>
      {!items?.length ? (
        <p className="omafit-partners-muted">Nenhum dado ainda.</p>
      ) : (
        <ul className="omafit-partners-plan-list">
          {items.map((item) => (
            <li key={item.key}>
              <span className="omafit-partners-plan-name">{item.key}</span>
              <span className="omafit-partners-plan-count">{formatNumber(item.count)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MarketingTab({ data, partnersApiConfigured, partnersApi }) {
  return (
    <div className="omafit-partners-tab-panel">
      <p className="omafit-partners-tab-desc">
        Aquisição de lojistas, conversão do funil e receita atribuída ao Omafit.
      </p>
      <div className="omafit-partners-metrics-grid">
        <MetricCard label="Instalações (Partner API)" value={formatNumber(data.installs)} />
        <MetricCard label="Novas lojas (mês)" value={formatNumber(data.newStoresMonth)} />
        <MetricCard label="Lojas ativas (estim.)" value={formatNumber(data.activeStoresEstimate)} />
        <MetricCard label="Billing ativo" value={formatNumber(data.activeBilling)} />
        <MetricCard label="MRR estimado" value={formatCurrency(data.estimatedMrrUsd)} />
        <MetricCard label="Try-ons (mês)" value={formatNumber(data.tryOnsMonth)} />
        <MetricCard label="Pedidos Omafit (mês)" value={formatNumber(data.ordersMonth)} />
        <MetricCard
          label="Conversão try-on → pedido"
          value={formatPercent(data.conversionRate)}
          hint="Pedidos do mês / try-ons do mês"
        />
        <MetricCard
          label="Receita pedidos (mês)"
          value={formatCurrency(data.orderRevenueMonth)}
        />
        <MetricCard label="Eventos de cobrança" value={formatNumber(data.charges)} />
      </div>
      <div className="omafit-partners-cards-row">
        <PlanBreakdown title="Mix de planos (aquisição)" byPlan={data.storesByPlan} />
        <StoresTable
          title="Instalações recentes"
          rows={data.recentInstalls}
          columns={[
            { key: "domain", label: "Loja", render: (r) => r.domain || "—" },
            { key: "plan", label: "Plano", render: (r) => r.plan || "—" },
            { key: "billing", label: "Billing", render: (r) => r.billingStatus || "—" },
            {
              key: "created",
              label: "Instalado",
              render: (r) =>
                r.createdAt ? new Date(r.createdAt).toLocaleDateString("pt-BR") : "—",
            },
          ]}
        />
      </div>
      <div className="omafit-partners-summary omafit-partners-summary--inline">
        <div>
          <span className="omafit-partners-summary-label">Shopify</span>
          <span className="omafit-partners-summary-value">
            {formatNumber(data.platformBreakdown?.shopify)}
          </span>
        </div>
        <div>
          <span className="omafit-partners-summary-label">Nuvemshop</span>
          <span className="omafit-partners-summary-value">
            {formatNumber(data.platformBreakdown?.nuvemshop)}
          </span>
        </div>
        <div>
          <span className="omafit-partners-summary-label">Total lojas</span>
          <span className="omafit-partners-summary-value">{formatNumber(data.totalStores)}</span>
        </div>
      </div>
      {!partnersApiConfigured && partnersApi?.error === "not_configured" ? (
        <div className="omafit-partners-banner omafit-partners-banner--info">
          Métricas de instalação via Partner API exigem <code>SHOPIFY_PARTNER_ACCESS_TOKEN</code>.
        </div>
      ) : null}
    </div>
  );
}

function ProductTab({ data }) {
  return (
    <div className="omafit-partners-tab-panel">
      <p className="omafit-partners-tab-desc">
        Uso do widget, engajamento de try-on e desempenho por loja.
      </p>
      <div className="omafit-partners-metrics-grid">
        <MetricCard label="Try-ons (total)" value={formatNumber(data.tryOnsTotal)} />
        <MetricCard label="Try-ons (mês)" value={formatNumber(data.tryOnsMonth)} />
        <MetricCard
          label="Média try-ons / loja"
          value={formatNumber(data.avgTryOnsPerStore)}
          hint="Lojas com billing ativo"
        />
        <MetricCard label="Sessões concluídas" value={formatNumber(data.completedSessions)} />
        <MetricCard
          label="Taxa de conclusão"
          value={formatPercent(data.completionRate)}
        />
        <MetricCard label="Imagens usadas (mês)" value={formatNumber(data.imagesUsedMonth)} />
        <MetricCard label="Widgets ativos" value={formatNumber(data.activeWidgets)} />
        <MetricCard label="Lojas pagantes" value={formatNumber(data.payingStores)} />
        <MetricCard label="Pedidos (mês)" value={formatNumber(data.ordersMonth)} />
        <MetricCard
          label="Receita pedidos (mês)"
          value={formatCurrency(data.orderRevenueMonth)}
        />
      </div>
      <div className="omafit-partners-cards-row">
        <TopList title="Top lojas por try-on" items={data.topStoresByTryons} />
        <TopList title="Top lojas por pedidos" items={data.topStoresByOrders} />
      </div>
    </div>
  );
}

function ChurnEmailButton({ domain, ownerEmail, zohoMailConfigured }) {
  const [status, setStatus] = useState("idle");
  const [feedback, setFeedback] = useState("");

  const sendEmail = async () => {
    if (!domain || status === "loading") return;
    setStatus("loading");
    setFeedback("");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);

    try {
      const response = await fetch("/api/partners/churn-email", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shopDomain: domain }),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const errorMessages = {
          zoho_not_configured: "Zoho não configurado",
          owner_email_missing: "E-mail da loja não encontrado",
          shop_not_found: "Loja não encontrada",
          railway_smtp_blocked:
            "SMTP bloqueado no Railway — configure ZOHO_ZEPTOMAIL_TOKEN",
          zoho_from_missing: "Defina ZOHO_MAIL_FROM no servidor",
          zeptomail_timeout: "ZeptoMail demorou para responder",
          smtp_timeout: "SMTP expirou — use ZOHO_ZEPTOMAIL_TOKEN no Railway",
        };
        const raw = String(data.error || "");
        const mapped =
          errorMessages[raw] ||
          (raw.startsWith("zeptomail_send_failed")
            ? `ZeptoMail: ${raw.replace("zeptomail_send_failed: ", "")}`
            : null);
        throw new Error(mapped || raw || "Falha ao enviar");
      }
      setStatus("sent");
      setFeedback(`Enviado para ${data.to}`);
    } catch (err) {
      setStatus("error");
      if (err?.name === "AbortError") {
        setFeedback("Tempo esgotado — verifique ZOHO_ZEPTOMAIL_TOKEN no Railway");
      } else {
        setFeedback(err?.message || "Erro ao enviar");
      }
    } finally {
      clearTimeout(timer);
    }
  };

  if (!zohoMailConfigured) {
    return <span className="omafit-partners-muted omafit-partners-cell-hint">Zoho off</span>;
  }

  return (
    <div className="omafit-partners-row-action">
      <button
        type="button"
        className="omafit-partners-btn omafit-partners-btn--small omafit-partners-btn--secondary"
        onClick={sendEmail}
        disabled={status === "loading" || status === "sent"}
        title={ownerEmail ? `Enviar para ${ownerEmail}` : "Busca e-mail no cadastro da loja"}
      >
        {status === "loading" ? "Enviando…" : status === "sent" ? "Enviado" : "Enviar e-mail"}
      </button>
      {feedback ? (
        <span
          className={`omafit-partners-cell-hint${status === "error" ? " omafit-partners-cell-hint--error" : ""}`}
        >
          {feedback}
        </span>
      ) : null}
    </div>
  );
}

function ChurnTab({ data, partnersApi, zohoMailConfigured, zohoMailMode }) {
  return (
    <div className="omafit-partners-tab-panel">
      <p className="omafit-partners-tab-desc">
        Desinstalações, billing inativo e lojas em risco de churn.
      </p>
      <div className="omafit-partners-metrics-grid">
        <MetricCard label="Desinstalações (API)" value={formatNumber(data.uninstalls)} />
        <MetricCard
          label="Taxa de churn (estim.)"
          value={formatPercent(data.churnRateEstimate)}
          hint="Desinstalações / instalações ou billing inativo"
        />
        <MetricCard label="Billing inativo" value={formatNumber(data.inactiveBilling)} />
        <MetricCard label="Widgets inativos" value={formatNumber(data.inactiveWidgets)} />
        <MetricCard
          label="Lojas ativas (estim.)"
          value={formatNumber(data.activeStoresEstimate)}
        />
        <MetricCard
          label="Gap widget × billing"
          value={formatNumber(data.widgetGap)}
          hint="Widgets ativos acima de lojas pagantes"
        />
      </div>
      <StoresTable
        title="Lojas com billing inativo"
        rows={data.inactiveBillingStores}
        columns={[
          { key: "domain", label: "Loja", render: (r) => r.domain || "—" },
          { key: "plan", label: "Plano", render: (r) => r.plan || "—" },
          { key: "billing", label: "Status", render: (r) => r.billingStatus || "—" },
          {
            key: "images",
            label: "Imagens/mês",
            render: (r) => formatNumber(r.imagesUsedMonth),
          },
          {
            key: "action",
            label: "Contato",
            render: (r) => (
              <ChurnEmailButton
                domain={r.domain}
                ownerEmail={r.ownerEmail}
                zohoMailConfigured={zohoMailConfigured}
              />
            ),
          },
        ]}
      />
      {!zohoMailConfigured ? (
        <div className="omafit-partners-banner omafit-partners-banner--info">
          Envio de e-mail exige <code>ZOHO_ZEPTOMAIL_TOKEN</code> (recomendado no Railway) ou{" "}
          <code>ZOHO_SMTP_USER</code> + <code>ZOHO_SMTP_PASSWORD</code>.
        </div>
      ) : zohoMailMode === "smtp" ? (
        <div className="omafit-partners-banner omafit-partners-banner--warn">
          No Railway (plano Hobby), SMTP é bloqueado. Adicione{" "}
          <code>ZOHO_ZEPTOMAIL_TOKEN</code> do{" "}
          <a href="https://www.zoho.com/zeptomail/" target="_blank" rel="noreferrer">
            Zoho ZeptoMail
          </a>{" "}
          e mantenha <code>ZOHO_MAIL_FROM</code> com o domínio verificado.
        </div>
      ) : null}
      {partnersApi?.error && partnersApi.error !== "not_configured" ? (
        <div className="omafit-partners-banner omafit-partners-banner--warn">
          Erro Partner API: {partnersApi.error}
        </div>
      ) : null}
    </div>
  );
}

export default function PartnersDashboardPage() {
  const { stats, partnersApiConfigured, zohoMailConfigured, zohoMailMode } = useLoaderData();
  const revalidator = useRevalidator();
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [activeTab, setActiveTab] = useState("marketing");

  const refresh = useCallback(() => {
    revalidator.revalidate();
  }, [revalidator]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [autoRefresh, refresh]);

  const tabs = stats.tabs;
  const partnersApi = stats.partnersApi;

  return (
    <div className="omafit-partners-page">
      <header className="omafit-partners-header">
        <div>
          <h1>Partners Dashboard</h1>
          <p className="omafit-partners-muted">
            Atualizado em {new Date(stats.generatedAt).toLocaleString("pt-BR")}
          </p>
        </div>
        <div className="omafit-partners-header-actions">
          <label className="omafit-partners-checkbox">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh (1 min)
          </label>
          <button
            type="button"
            className="omafit-partners-btn omafit-partners-btn--secondary"
            onClick={refresh}
          >
            Atualizar
          </button>
          <Form method="post" action="/partners/login">
            <input type="hidden" name="intent" value="logout" />
            <button type="submit" className="omafit-partners-btn omafit-partners-btn--ghost">
              Sair
            </button>
          </Form>
        </div>
      </header>

      {stats.error ? (
        <div className="omafit-partners-banner omafit-partners-banner--warn">
          {stats.error}
        </div>
      ) : null}

      <nav className="omafit-partners-tabs" aria-label="Seções do dashboard">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`omafit-partners-tab${activeTab === tab.id ? " is-active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
            aria-selected={activeTab === tab.id}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === "marketing" && tabs?.marketing ? (
        <MarketingTab
          data={tabs.marketing}
          partnersApiConfigured={partnersApiConfigured}
          partnersApi={partnersApi}
        />
      ) : null}
      {activeTab === "product" && tabs?.product ? (
        <ProductTab data={tabs.product} />
      ) : null}
      {activeTab === "churn" && tabs?.churn ? (
        <ChurnTab
          data={tabs.churn}
          partnersApi={partnersApi}
          zohoMailConfigured={zohoMailConfigured}
          zohoMailMode={zohoMailMode}
        />
      ) : null}
    </div>
  );
}
