import { Form, useLoaderData, useRevalidator } from "react-router";
import { useCallback, useEffect, useState } from "react";
import { requirePartnersAuth } from "../partners-auth.server";
import { fetchPartnersDashboardStats } from "../partners-dashboard.server";
import { isShopifyPartnersApiConfigured } from "../shopify-partners-api.server";

export const loader = async ({ request }) => {
  await requirePartnersAuth(request);
  const stats = await fetchPartnersDashboardStats();
  return {
    stats,
    partnersApiConfigured: isShopifyPartnersApiConfigured(),
  };
};

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
        <p className="omafit-partners-muted">Nenhuma loja registrada.</p>
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
                <tr key={row.id || row.domain || row.storeId || i}>
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

export default function PartnersDashboardPage() {
  const { stats, partnersApiConfigured } = useLoaderData();
  const revalidator = useRevalidator();
  const [autoRefresh, setAutoRefresh] = useState(false);

  const refresh = useCallback(() => {
    revalidator.revalidate();
  }, [revalidator]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [autoRefresh, refresh]);

  const shopify = stats.shopify;
  const nuvemshop = stats.nuvemshop;
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
          <button type="button" className="omafit-partners-btn omafit-partners-btn--secondary" onClick={refresh}>
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

      <section className="omafit-partners-section">
        <h2 className="omafit-partners-section-title">
          <span className="omafit-partners-badge omafit-partners-badge--shopify">Shopify</span>
          Dados operacionais (Supabase)
        </h2>
        <div className="omafit-partners-metrics-grid">
          <MetricCard label="Lojas registradas" value={formatNumber(shopify?.totalStores)} />
          <MetricCard label="Billing ativo" value={formatNumber(shopify?.activeBilling)} />
          <MetricCard
            label="MRR estimado"
            value={formatCurrency(shopify?.estimatedMrrUsd)}
            hint="Com base nos planos ativos"
          />
          <MetricCard label="Widgets ativos" value={formatNumber(shopify?.activeWidgets)} />
          <MetricCard label="Try-ons (total)" value={formatNumber(shopify?.tryOnSessionsTotal)} />
          <MetricCard
            label="Try-ons (mês)"
            value={formatNumber(shopify?.tryOnSessionsThisMonth)}
          />
          <MetricCard label="Pedidos Omafit" value={formatNumber(shopify?.ordersTotal)} />
          <MetricCard
            label="Receita pedidos (total)"
            value={formatCurrency(shopify?.orderRevenueTotal)}
          />
        </div>

        <div className="omafit-partners-cards-row">
          <PlanBreakdown title="Lojas por plano" byPlan={shopify?.storesByPlan} />
          <StoresTable
            title="Lojas recentes"
            rows={shopify?.recentStores}
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
      </section>

      <section className="omafit-partners-section">
        <h2 className="omafit-partners-section-title">
          <span className="omafit-partners-badge omafit-partners-badge--shopify">Shopify</span>
          Partner Dashboard API
        </h2>
        {!partnersApiConfigured ? (
          <div className="omafit-partners-banner omafit-partners-banner--info">
            Configure <code>SHOPIFY_PARTNER_ORG_ID</code>, <code>SHOPIFY_PARTNER_ACCESS_TOKEN</code> e{" "}
            <code>SHOPIFY_PARTNER_APP_GID</code> para sincronizar instalações e cobranças do Partner
            Dashboard.
          </div>
        ) : null}
        <div className="omafit-partners-metrics-grid">
          <MetricCard label="Instalações (API)" value={formatNumber(partnersApi?.installs)} />
          <MetricCard label="Desinstalações (API)" value={formatNumber(partnersApi?.uninstalls)} />
          <MetricCard
            label="Lojas ativas (estim.)"
            value={formatNumber(partnersApi?.activeStoresEstimate)}
            hint="Instalações − desinstalações"
          />
          <MetricCard label="Eventos de cobrança" value={formatNumber(partnersApi?.charges)} />
        </div>
        {partnersApi?.paginationLimited ? (
          <p className="omafit-partners-muted">
            Limite de paginação atingido — valores podem ser parciais.
          </p>
        ) : null}
        {partnersApi?.error && partnersApi.error !== "not_configured" ? (
          <div className="omafit-partners-banner omafit-partners-banner--warn">
            Erro Partner API: {partnersApi.error}
          </div>
        ) : null}
      </section>

      <section className="omafit-partners-section">
        <h2 className="omafit-partners-section-title">
          <span className="omafit-partners-badge omafit-partners-badge--nuvem">Nuvemshop</span>
          Dados operacionais
        </h2>
        {nuvemshop?.note ? (
          <div className="omafit-partners-banner omafit-partners-banner--info">{nuvemshop.note}</div>
        ) : null}
        <div className="omafit-partners-metrics-grid">
          <MetricCard label="Lojas registradas" value={formatNumber(nuvemshop?.totalStores)} />
          <MetricCard label="Lojas ativas" value={formatNumber(nuvemshop?.activeStores)} />
        </div>
        <div className="omafit-partners-cards-row">
          <PlanBreakdown title="Lojas por plano" byPlan={nuvemshop?.storesByPlan} />
          <StoresTable
            title="Lojas recentes"
            rows={nuvemshop?.recentStores}
            columns={[
              { key: "id", label: "ID", render: (r) => r.storeId || "—" },
              { key: "name", label: "Nome", render: (r) => r.name || "—" },
              { key: "plan", label: "Plano", render: (r) => r.plan || "—" },
              {
                key: "active",
                label: "Ativa",
                render: (r) => (r.isActive === false ? "Não" : "Sim"),
              },
            ]}
          />
        </div>
      </section>

      <section className="omafit-partners-section omafit-partners-section--summary">
        <h2>Resumo consolidado</h2>
        <div className="omafit-partners-summary">
          <div>
            <span className="omafit-partners-summary-label">Total lojas (ambas plataformas)</span>
            <span className="omafit-partners-summary-value">
              {formatNumber((shopify?.totalStores || 0) + (nuvemshop?.totalStores || 0))}
            </span>
          </div>
          <div>
            <span className="omafit-partners-summary-label">MRR Shopify (estim.)</span>
            <span className="omafit-partners-summary-value">
              {formatCurrency(shopify?.estimatedMrrUsd)}
            </span>
          </div>
          <div>
            <span className="omafit-partners-summary-label">Try-ons este mês</span>
            <span className="omafit-partners-summary-value">
              {formatNumber(shopify?.tryOnSessionsThisMonth)}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
