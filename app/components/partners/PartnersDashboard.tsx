import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  InfoIcon,
  LightbulbIcon,
  MailIcon,
  RefreshCwIcon,
  SparklesIcon,
  TrendingUpIcon,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from "recharts";
import { buildPartnersInsights } from "@/app/lib/partners-insights";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { FinanceTab } from "@/app/components/partners/FinanceTab";
import { SocialTab } from "@/app/components/partners/SocialTab";
import { ResponsiveTable } from "@/app/components/partners/ResponsiveTable";

const CHART_COLORS = ["#d96845", "#5baf8a", "#f6f0e2", "#b8522e", "#7a6a58"];

function formatNumber(value: unknown) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return new Intl.NumberFormat("pt-BR").format(Number(value));
}

function formatCurrency(value: unknown, currency = "USD") {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number(value));
}

function formatPercent(value: unknown) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return `${value}%`;
}

const insightIcon = {
  critical: AlertTriangleIcon,
  warning: AlertTriangleIcon,
  info: InfoIcon,
  success: CheckCircle2Icon,
};

const insightStyles = {
  critical: "border-destructive/40 bg-destructive/10",
  warning: "border-primary/35 bg-primary/10",
  info: "border-border bg-card",
  success: "border-accent/35 bg-accent/10",
};

function MetricCard({
  label,
  value,
  hint,
  trend,
}: {
  label: string;
  value: string;
  hint?: string;
  trend?: "up" | "neutral";
}) {
  return (
    <Card className="ring-1 ring-border/60">
      <CardHeader className="pb-2">
        <CardDescription className="text-xs uppercase tracking-wider">{label}</CardDescription>
        <CardTitle className="omafit-partners-metric-value font-medium tabular-nums">
          {value}
        </CardTitle>
      </CardHeader>
      {(hint || trend) && (
        <CardContent className="flex flex-col gap-1 pt-0">
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
          {trend === "up" ? (
            <div className="flex items-center gap-1 text-xs text-accent">
              <TrendingUpIcon data-icon="inline-start" />
              Em crescimento
            </div>
          ) : null}
        </CardContent>
      )}
    </Card>
  );
}

function InsightsPanel({
  insights,
}: {
  insights: ReturnType<typeof buildPartnersInsights>;
}) {
  if (!insights.length) return null;

  return (
    <Card className="ring-1 ring-primary/20">
      <CardHeader>
        <div className="flex items-center gap-2">
          <LightbulbIcon className="text-primary" />
          <CardTitle>O que fazer agora</CardTitle>
        </div>
        <CardDescription>
          Recomendações automáticas com base nas métricas atuais — priorize itens críticos primeiro.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {insights.map((item) => {
          const Icon = insightIcon[item.severity];
          return (
            <Alert key={item.id} className={cn(insightStyles[item.severity])}>
              <Icon />
              <AlertTitle className="flex flex-wrap items-center gap-2">
                {item.title}
                <Badge variant="outline" className="text-[0.65rem] uppercase">
                  {item.severity}
                </Badge>
              </AlertTitle>
              <AlertDescription>
                <p>{item.description}</p>
                <p className="mt-2 flex flex-col gap-1 font-medium text-foreground sm:flex-row sm:items-start sm:gap-1.5">
                  <ArrowRightIcon data-icon="inline-start" className="mt-0.5 hidden shrink-0 text-primary sm:block" />
                  {item.action}
                </p>
              </AlertDescription>
            </Alert>
          );
        })}
      </CardContent>
    </Card>
  );
}

function FunnelChart({
  installs,
  activeBilling,
  tryOns,
  orders,
}: {
  installs: number | null;
  activeBilling: number | null;
  tryOns: number | null;
  orders: number | null;
}) {
  const data = [
    { stage: "Instalações", stageShort: "Instal.", value: installs ?? 0, fill: CHART_COLORS[0] },
    { stage: "Billing ativo", stageShort: "Billing", value: activeBilling ?? 0, fill: CHART_COLORS[1] },
    { stage: "Try-ons (mês)", stageShort: "Try-ons", value: tryOns ?? 0, fill: CHART_COLORS[2] },
    { stage: "Pedidos (mês)", stageShort: "Pedidos", value: orders ?? 0, fill: CHART_COLORS[3] },
  ];

  const config = {
    value: { label: "Volume", color: CHART_COLORS[0] },
  } satisfies ChartConfig;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Funil de aquisição</CardTitle>
        <CardDescription>
          Da instalação ao pedido — identifique onde o funil estreita.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={config} className="omafit-partners-chart">
          <BarChart data={data} layout="vertical" margin={{ left: 4, right: 8, top: 4, bottom: 4 }}>
            <CartesianGrid horizontal={false} />
            <XAxis type="number" hide />
            <YAxis
              dataKey="stage"
              type="category"
              width={72}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11 }}
              tickFormatter={(_value, index) => data[index]?.stageShort ?? _value}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="value" radius={6}>
              {data.map((entry) => (
                <Cell key={entry.stage} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

function PlanMixChart({ byPlan }: { byPlan: Record<string, number> | undefined }) {
  const entries = Object.entries(byPlan || {}).sort((a, b) => b[1] - a[1]);
  const data = entries.map(([name, value], i) => ({
    name,
    value,
    fill: CHART_COLORS[i % CHART_COLORS.length],
  }));

  const config = Object.fromEntries(
    data.map((d) => [d.name, { label: d.name, color: d.fill }]),
  ) satisfies ChartConfig;

  if (!data.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Mix de planos</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Nenhum dado ainda.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mix de planos</CardTitle>
        <CardDescription>Distribuição de lojas por plano contratado.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4 sm:flex-row">
          <ChartContainer config={config} className="omafit-partners-chart mx-auto max-w-[200px]">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent hideLabel />} />
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={48} strokeWidth={2}>
              {data.map((entry) => (
                <Cell key={entry.name} fill={entry.fill} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
        <ul className="flex w-full flex-col gap-2 text-sm">
          {data.map((d) => (
            <li key={d.name} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ background: d.fill }} />
                {d.name}
              </span>
              <span className="omafit-partners-metric-value font-medium">{d.value}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function TopStoresChart({
  title,
  items,
  description,
}: {
  title: string;
  items: { key: string; count: number }[] | undefined;
  description: string;
}) {
  const data = (items || []).slice(0, 6).map((item) => ({
    store: item.key.replace(".myshopify.com", ""),
    count: item.count,
  }));

  const config = {
    count: { label: "Total", color: CHART_COLORS[1] },
  } satisfies ChartConfig;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {!data.length ? (
          <p className="text-sm text-muted-foreground">Nenhum dado ainda.</p>
        ) : (
          <ChartContainer config={config} className="omafit-partners-chart">
            <BarChart data={data} margin={{ bottom: 4 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="store" tickLine={false} axisLine={false} hide />
              <YAxis tickLine={false} axisLine={false} width={32} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="count" fill={CHART_COLORS[1]} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

function ChurnEmailButton({
  domain,
  ownerEmail,
  zohoMailConfigured,
}: {
  domain?: string;
  ownerEmail?: string | null;
  zohoMailConfigured: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">("idle");
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
        const errorMessages: Record<string, string> = {
          zoho_not_configured: "Zoho não configurado",
          owner_email_missing: "E-mail da loja não encontrado",
          shop_not_found: "Loja não encontrada",
          railway_smtp_blocked: "Configure ZOHO_ZEPTOMAIL_TOKEN",
          zoho_from_missing: "Defina ZOHO_MAIL_FROM",
          zeptomail_timeout: "ZeptoMail demorou",
          smtp_timeout: "SMTP expirou",
        };
        const raw = String(data.error || "");
        throw new Error(
          errorMessages[raw] ||
            (raw.startsWith("zeptomail_send_failed")
              ? raw.replace("zeptomail_send_failed: ", "")
              : raw || "Falha ao enviar"),
        );
      }
      setStatus("sent");
      setFeedback(`Enviado para ${data.to}`);
    } catch (err) {
      setStatus("error");
      setFeedback(
        err instanceof Error && err.name === "AbortError"
          ? "Tempo esgotado"
          : err instanceof Error
            ? err.message
            : "Erro",
      );
    } finally {
      clearTimeout(timer);
    }
  };

  if (!zohoMailConfigured) {
    return <span className="text-xs text-muted-foreground">Zoho off</span>;
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        size="sm"
        variant={status === "sent" ? "secondary" : "outline"}
        onClick={sendEmail}
        disabled={status === "loading" || status === "sent"}
        title={ownerEmail ? `Enviar para ${ownerEmail}` : "Busca e-mail no cadastro"}
      >
        <MailIcon data-icon="inline-start" />
        {status === "loading" ? "Enviando…" : status === "sent" ? "Enviado" : "E-mail"}
      </Button>
      {feedback ? (
        <span className={cn("text-[0.65rem]", status === "error" && "text-destructive")}>
          {feedback}
        </span>
      ) : null}
    </div>
  );
}

type DashboardProps = {
  stats: {
    generatedAt: string;
    error?: string | null;
    tabs?: {
      marketing?: Record<string, unknown>;
      product?: Record<string, unknown>;
      churn?: Record<string, unknown>;
      finance?: Record<string, unknown>;
      social?: Record<string, unknown>;
    } | null;
    partnersApi?: { error?: string };
  };
  partnersApiConfigured: boolean;
  zohoMailConfigured: boolean;
  zohoMailMode: string;
  canvaConfigured: boolean;
  openaiConfigured: boolean;
  youtubeApiConfigured: boolean;
  instagramApiConfigured: boolean;
  metaAppConfigured: boolean;
  onRefresh: () => void;
};

export function PartnersDashboard({
  stats,
  partnersApiConfigured,
  zohoMailConfigured,
  zohoMailMode,
  canvaConfigured,
  openaiConfigured,
  youtubeApiConfigured,
  instagramApiConfigured,
  metaAppConfigured,
  onRefresh,
}: DashboardProps) {
  const [autoRefresh, setAutoRefresh] = useState(false);

  const refresh = useCallback(() => {
    onRefresh();
  }, [onRefresh]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [autoRefresh, refresh]);

  const ctx = useMemo(
    () => ({ partnersApiConfigured, zohoMailConfigured, zohoMailMode }),
    [partnersApiConfigured, zohoMailConfigured, zohoMailMode],
  );

  const marketing = stats.tabs?.marketing as Record<string, unknown> | undefined;
  const product = stats.tabs?.product as Record<string, unknown> | undefined;
  const churn = stats.tabs?.churn as Record<string, unknown> | undefined;
  const finance = stats.tabs?.finance as Record<string, unknown> | undefined;
  const social = stats.tabs?.social as Record<string, unknown> | undefined;

  const marketingInsights = useMemo(
    () => (marketing ? buildPartnersInsights("marketing", marketing, ctx) : []),
    [marketing, ctx],
  );
  const productInsights = useMemo(
    () => (product ? buildPartnersInsights("product", product, ctx) : []),
    [product, ctx],
  );
  const churnInsights = useMemo(
    () => (churn ? buildPartnersInsights("churn", churn, ctx) : []),
    [churn, ctx],
  );

  const conversionProgress = Math.min(100, Number(marketing?.conversionRate) || 0);

  return (
    <div className="omafit-partners-page">
      <header className="flex min-w-0 flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-col gap-2.5 sm:gap-3">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <span className="omafit-partners-wordmark text-xl text-foreground sm:text-2xl">Omafit</span>
            <Badge variant="outline" className="text-[0.65rem] uppercase tracking-wider sm:text-xs">
              Partners
            </Badge>
          </div>
          <h1 className="text-2xl font-normal italic text-primary sm:text-3xl lg:text-4xl">
            Centro de crescimento
          </h1>
          <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground sm:text-sm">
            Métricas de aquisição, produto, churn, financeiro e redes sociais com recomendações práticas. Atualizado em{" "}
            <span className="block sm:inline">{new Date(stats.generatedAt).toLocaleString("pt-BR")}</span>.
          </p>
        </div>
        <div className="omafit-partners-header-actions">
          <label className="col-span-2 flex items-center gap-2 text-xs text-muted-foreground sm:col-span-1">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="size-4 rounded border-border"
            />
            Auto-refresh
          </label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="omafit-partners-btn-full"
            onClick={refresh}
          >
            <RefreshCwIcon data-icon="inline-start" />
            Atualizar
          </Button>
          <form method="post" action="/partners/login" className="w-full sm:w-auto">
            <input type="hidden" name="intent" value="logout" />
            <Button type="submit" variant="ghost" size="sm" className="w-full sm:w-auto">
              Sair
            </Button>
          </form>
        </div>
      </header>

      {stats.error ? (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>Erro nos dados</AlertTitle>
          <AlertDescription>{stats.error}</AlertDescription>
        </Alert>
      ) : null}

      <Tabs defaultValue="marketing" className="flex min-w-0 flex-col gap-4 sm:gap-6">
        <div className="omafit-partners-tabs-scroll">
          <TabsList className="omafit-partners-tabs-list bg-muted">
            <TabsTrigger value="marketing" className="omafit-partners-tab-trigger">
              <span className="sm:hidden">Marketing</span>
              <span className="hidden sm:inline">Marketing & Aquisição</span>
            </TabsTrigger>
            <TabsTrigger value="product" className="omafit-partners-tab-trigger">
              Produto
            </TabsTrigger>
            <TabsTrigger value="churn" className="omafit-partners-tab-trigger">
              Churn
            </TabsTrigger>
            <TabsTrigger value="finance" className="omafit-partners-tab-trigger">
              Financeiro
            </TabsTrigger>
            <TabsTrigger value="social" className="omafit-partners-tab-trigger">
              <span className="sm:hidden">Social</span>
              <span className="hidden sm:inline">Redes Sociais</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="marketing" className="flex min-w-0 flex-col gap-4 sm:gap-6">
          {marketing ? (
            <>
              <InsightsPanel insights={marketingInsights} />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard label="Instalações" value={formatNumber(marketing.installs)} />
                <MetricCard label="Novas lojas (mês)" value={formatNumber(marketing.newStoresMonth)} />
                <MetricCard label="MRR estimado" value={formatCurrency(marketing.estimatedMrrUsd)} />
                <MetricCard
                  label="Conversão try-on → pedido"
                  value={formatPercent(marketing.conversionRate)}
                  hint="Meta saudável: acima de 3%"
                />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <FunnelChart
                  installs={marketing.installs as number}
                  activeBilling={marketing.activeBilling as number}
                  tryOns={marketing.tryOnsMonth as number}
                  orders={marketing.ordersMonth as number}
                />
                <PlanMixChart byPlan={marketing.storesByPlan as Record<string, number>} />
              </div>
              <Card>
                <CardHeader>
                  <CardTitle>Conversão do funil</CardTitle>
                  <CardDescription>
                    Pedidos do mês em relação à meta de conversão (3%).
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  <div className="flex justify-between text-sm">
                    <span>Taxa atual</span>
                    <span className="omafit-partners-metric-value font-medium">
                      {formatPercent(marketing.conversionRate)}
                    </span>
                  </div>
                  <Progress value={conversionProgress} className="h-2" />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Instalações recentes</CardTitle>
                </CardHeader>
                <CardContent className="min-w-0">
                  <div className="omafit-partners-card-list">
                    {((marketing.recentInstalls as Array<Record<string, unknown>>) || []).map(
                      (row) => (
                        <div key={String(row.domain)} className="omafit-partners-card-list-item">
                          <p className="truncate text-sm font-medium">{String(row.domain)}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <Badge variant="outline">{String(row.plan || "—")}</Badge>
                            <Badge variant="outline">{String(row.billingStatus || "—")}</Badge>
                            <span>
                              {row.createdAt
                                ? new Date(String(row.createdAt)).toLocaleDateString("pt-BR")
                                : "—"}
                            </span>
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                  <div className="omafit-partners-desktop-table">
                    <ResponsiveTable minWidth={560}>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Loja</TableHead>
                            <TableHead>Plano</TableHead>
                            <TableHead>Billing</TableHead>
                            <TableHead>Instalado</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {((marketing.recentInstalls as Array<Record<string, unknown>>) || []).map(
                            (row) => (
                              <TableRow key={String(row.domain)}>
                                <TableCell className="max-w-[180px] truncate font-medium">
                                  {String(row.domain)}
                                </TableCell>
                                <TableCell>{String(row.plan || "—")}</TableCell>
                                <TableCell>
                                  <Badge variant="outline">{String(row.billingStatus || "—")}</Badge>
                                </TableCell>
                                <TableCell>
                                  {row.createdAt
                                    ? new Date(String(row.createdAt)).toLocaleDateString("pt-BR")
                                    : "—"}
                                </TableCell>
                              </TableRow>
                            ),
                          )}
                        </TableBody>
                      </Table>
                    </ResponsiveTable>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : null}
        </TabsContent>

        <TabsContent value="product" className="flex min-w-0 flex-col gap-4 sm:gap-6">
          {product ? (
            <>
              <InsightsPanel insights={productInsights} />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard label="Try-ons (mês)" value={formatNumber(product.tryOnsMonth)} />
                <MetricCard
                  label="Taxa de conclusão"
                  value={formatPercent(product.completionRate)}
                />
                <MetricCard label="Widgets ativos" value={formatNumber(product.activeWidgets)} />
                <MetricCard label="Lojas pagantes" value={formatNumber(product.payingStores)} />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <TopStoresChart
                  title="Top lojas por try-on"
                  items={product.topStoresByTryons as { key: string; count: number }[]}
                  description="Onde o provador virtual está sendo mais usado."
                />
                <TopStoresChart
                  title="Top lojas por pedidos"
                  items={product.topStoresByOrders as { key: string; count: number }[]}
                  description="Lojas que mais convertem após o try-on."
                />
              </div>
            </>
          ) : null}
        </TabsContent>

        <TabsContent value="churn" className="flex min-w-0 flex-col gap-4 sm:gap-6">
          {churn ? (
            <>
              <InsightsPanel insights={churnInsights} />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard
                  label="Taxa de churn"
                  value={formatPercent(churn.churnRateEstimate)}
                  hint="Quanto menor, melhor"
                />
                <MetricCard label="Billing inativo" value={formatNumber(churn.inactiveBilling)} />
                <MetricCard label="Desinstalações" value={formatNumber(churn.uninstalls)} />
                <MetricCard label="Gap widget × billing" value={formatNumber(churn.widgetGap)} />
              </div>
              {!zohoMailConfigured ? (
                <Alert>
                  <InfoIcon />
                  <AlertTitle>E-mail não configurado</AlertTitle>
                  <AlertDescription>
                    Configure <code className="text-xs">ZOHO_ZEPTOMAIL_TOKEN</code> no Railway para
                    enviar e-mails de reativação.
                  </AlertDescription>
                </Alert>
              ) : zohoMailMode === "smtp" ? (
                <Alert>
                  <InfoIcon />
                  <AlertTitle>SMTP bloqueado no Railway</AlertTitle>
                  <AlertDescription>
                    Use <code className="text-xs">ZOHO_ZEPTOMAIL_TOKEN</code> (API HTTPS) em vez de
                    SMTP.
                  </AlertDescription>
                </Alert>
              ) : null}
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <SparklesIcon className="text-primary" />
                    <CardTitle>Lojas com billing inativo</CardTitle>
                  </div>
                  <CardDescription>
                    Contate cada loja para entender o motivo e oferecer suporte na reativação.
                  </CardDescription>
                </CardHeader>
                <CardContent className="min-w-0">
                  <div className="omafit-partners-card-list">
                    {((churn.inactiveBillingStores as Array<Record<string, unknown>>) || []).map(
                      (row) => (
                        <div key={String(row.domain)} className="omafit-partners-card-list-item">
                          <p className="truncate text-sm font-medium">{String(row.domain)}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <Badge variant="outline">{String(row.plan || "—")}</Badge>
                            <Badge variant="destructive">{String(row.billingStatus || "—")}</Badge>
                            <span className="text-xs text-muted-foreground">
                              Imagens/mês: {formatNumber(row.imagesUsedMonth)}
                            </span>
                          </div>
                          <div className="mt-3">
                            <ChurnEmailButton
                              domain={String(row.domain)}
                              ownerEmail={row.ownerEmail as string}
                              zohoMailConfigured={zohoMailConfigured}
                            />
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                  <div className="omafit-partners-desktop-table">
                    <ResponsiveTable minWidth={640}>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Loja</TableHead>
                            <TableHead>Plano</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Imagens/mês</TableHead>
                            <TableHead>Contato</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {((churn.inactiveBillingStores as Array<Record<string, unknown>>) || []).map(
                            (row) => (
                              <TableRow key={String(row.domain)}>
                                <TableCell className="max-w-[200px] truncate font-medium">
                                  {String(row.domain)}
                                </TableCell>
                                <TableCell>{String(row.plan || "—")}</TableCell>
                                <TableCell>
                                  <Badge variant="destructive">
                                    {String(row.billingStatus || "—")}
                                  </Badge>
                                </TableCell>
                                <TableCell className="omafit-partners-metric-value">
                                  {formatNumber(row.imagesUsedMonth)}
                                </TableCell>
                                <TableCell>
                                  <ChurnEmailButton
                                    domain={String(row.domain)}
                                    ownerEmail={row.ownerEmail as string}
                                    zohoMailConfigured={zohoMailConfigured}
                                  />
                                </TableCell>
                              </TableRow>
                            ),
                          )}
                        </TableBody>
                      </Table>
                    </ResponsiveTable>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : null}
        </TabsContent>

        <TabsContent value="finance" className="flex min-w-0 flex-col gap-4 sm:gap-6">
          {finance ? (
            <FinanceTab data={finance} onRefresh={refresh} />
          ) : null}
        </TabsContent>

        <TabsContent value="social" className="flex min-w-0 flex-col gap-4 sm:gap-6">
          {social ? (
            <SocialTab
              data={social}
              canvaConfigured={canvaConfigured}
              openaiConfigured={openaiConfigured}
              youtubeApiConfigured={youtubeApiConfigured}
              instagramApiConfigured={instagramApiConfigured}
              metaAppConfigured={metaAppConfigured}
            />
          ) : null}
        </TabsContent>
      </Tabs>

      <Separator />
      <footer className="flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span className="break-words">Omafit Partners · dados Supabase + Shopify Partner API</span>
        <span className="flex items-center gap-1">
          <SparklesIcon className="size-3 shrink-0 text-accent" />
          <span className="truncate">Identidade omafit-widget</span>
        </span>
      </footer>
    </div>
  );
}
