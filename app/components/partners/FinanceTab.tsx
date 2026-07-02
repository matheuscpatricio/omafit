import { useState } from "react";
import { DollarSignIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ResponsiveTable } from "@/app/components/partners/ResponsiveTable";

const CHART_COLORS = ["#d96845", "#5baf8a", "#f6f0e2", "#b8522e", "#7a6a58"];

const CATEGORY_LABELS: Record<string, string> = {
  infra: "Infraestrutura",
  marketing: "Marketing",
  ferramentas: "Ferramentas",
  pessoal: "Pessoal",
  outros: "Outros",
};

function formatCurrency(value: unknown, currency = "USD") {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function formatPercent(value: unknown) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return `${value}%`;
}

function currentMonthInputValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

type FinanceData = {
  estimatedMrrUsd?: number;
  mrrByPlan?: Record<string, number>;
  activeBilling?: number;
  expensesMonth?: number;
  expensesTotal?: number;
  expensesByCategory?: Record<string, number>;
  currentMonth?: string;
  netMarginMonth?: number;
  marginPercent?: number | null;
  expenses?: Array<{
    id: number;
    description: string;
    amount: number;
    currency: string;
    category: string;
    expenseMonth: string;
    notes?: string | null;
    createdAt?: string;
  }>;
  expensesTableExists?: boolean;
  expensesError?: string | null;
};

function MetricCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="ring-1 ring-border/60">
      <CardHeader className="pb-2">
        <CardDescription className="text-xs uppercase tracking-wider">{label}</CardDescription>
        <CardTitle className="omafit-partners-metric-value font-medium tabular-nums">
          {value}
        </CardTitle>
      </CardHeader>
      {hint ? (
        <CardContent className="pt-0">
          <p className="text-xs text-muted-foreground">{hint}</p>
        </CardContent>
      ) : null}
    </Card>
  );
}

function MrrVsExpensesChart({
  mrr,
  expensesMonth,
}: {
  mrr: number;
  expensesMonth: number;
}) {
  const data = [
    { label: "MRR estimado", value: mrr, fill: CHART_COLORS[1] },
    { label: "Despesas (mês)", value: expensesMonth, fill: CHART_COLORS[0] },
    {
      label: "Margem líquida",
      value: Math.max(0, mrr - expensesMonth),
      fill: CHART_COLORS[2],
    },
  ];

  const config = {
    value: { label: "USD", color: CHART_COLORS[1] },
  } satisfies ChartConfig;

  return (
    <Card>
      <CardHeader>
        <CardTitle>MRR vs despesas do mês</CardTitle>
        <CardDescription>Comparativo visual da saúde financeira mensal.</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={config} className="omafit-partners-chart">
          <BarChart data={data} margin={{ bottom: 4 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} />
            <YAxis tickLine={false} axisLine={false} width={48} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="value" radius={[6, 6, 0, 0]}>
              {data.map((entry) => (
                <Cell key={entry.label} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

function MrrByPlanCard({ mrrByPlan }: { mrrByPlan?: Record<string, number> }) {
  const entries = Object.entries(mrrByPlan || {}).sort((a, b) => b[1] - a[1]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>MRR por plano</CardTitle>
        <CardDescription>Receita recorrente estimada por tier de assinatura.</CardDescription>
      </CardHeader>
      <CardContent>
        {!entries.length ? (
          <p className="text-sm text-muted-foreground">Nenhuma loja pagante ativa.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {entries.map(([plan, amount], i) => (
              <li key={plan} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2 capitalize">
                  <span
                    className="size-2.5 rounded-full"
                    style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                  />
                  {plan}
                </span>
                <span className="omafit-partners-metric-value font-medium">
                  {formatCurrency(amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function InsightsPanel({
  insights,
}: {
  insights: ReturnType<typeof buildPartnersInsights>;
}) {
  if (!insights.length) return null;

  const insightIcon = {
    critical: DollarSignIcon,
    warning: DollarSignIcon,
    info: DollarSignIcon,
    success: DollarSignIcon,
  };

  const insightStyles = {
    critical: "border-destructive/40 bg-destructive/10",
    warning: "border-primary/35 bg-primary/10",
    info: "border-border bg-card",
    success: "border-accent/35 bg-accent/10",
  };

  return (
    <Card className="ring-1 ring-primary/20">
      <CardHeader>
        <CardTitle>O que fazer agora</CardTitle>
        <CardDescription>Recomendações financeiras com base no MRR e nas despesas lançadas.</CardDescription>
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
                <p className="mt-2 font-medium text-foreground">{item.action}</p>
              </AlertDescription>
            </Alert>
          );
        })}
      </CardContent>
    </Card>
  );
}

export function FinanceTab({
  data,
  onRefresh,
}: {
  data: FinanceData;
  onRefresh: () => void;
}) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("outros");
  const [expenseMonth, setExpenseMonth] = useState(currentMonthInputValue());
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [feedback, setFeedback] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const insights = buildPartnersInsights("finance", data, {});

  const addExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("saving");
    setFeedback("");
    try {
      const response = await fetch("/api/partners/expenses", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          amount: Number(amount),
          category,
          expenseMonth,
          notes: notes || undefined,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || "Falha ao salvar");
      }
      setDescription("");
      setAmount("");
      setNotes("");
      setStatus("idle");
      setFeedback("Despesa adicionada.");
      onRefresh();
    } catch (err) {
      setStatus("error");
      setFeedback(err instanceof Error ? err.message : "Erro ao salvar");
    }
  };

  const removeExpense = async (id: number) => {
    setDeletingId(id);
    try {
      const response = await fetch(`/api/partners/expenses?id=${id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || "Falha ao remover");
      }
      onRefresh();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Erro ao remover");
      setStatus("error");
    } finally {
      setDeletingId(null);
    }
  };

  const mrr = Number(data.estimatedMrrUsd) || 0;
  const expensesMonth = Number(data.expensesMonth) || 0;

  return (
    <div className="flex min-w-0 flex-col gap-4 sm:gap-6">
      <InsightsPanel insights={insights} />

      {data.expensesTableExists === false ? (
        <Alert variant="destructive">
          <AlertTitle>Tabela partners_expenses ausente</AlertTitle>
          <AlertDescription>
            Execute <code className="text-xs">supabase_partners_expenses.sql</code> no Supabase para
            habilitar despesas manuais.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="MRR estimado" value={formatCurrency(mrr)} hint="Lojas com billing ativo" />
        <MetricCard
          label="Despesas (mês)"
          value={formatCurrency(expensesMonth)}
          hint={`Referência: ${data.currentMonth || currentMonthInputValue()}`}
        />
        <MetricCard
          label="Margem líquida (mês)"
          value={formatCurrency(data.netMarginMonth)}
          hint="MRR − despesas do mês"
        />
        <MetricCard
          label="Margem %"
          value={formatPercent(data.marginPercent)}
          hint="Sobre o MRR estimado"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <MrrVsExpensesChart mrr={mrr} expensesMonth={expensesMonth} />
        <MrrByPlanCard mrrByPlan={data.mrrByPlan} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Adicionar despesa</CardTitle>
          <CardDescription>
            Lance custos fixos ou variáveis manualmente — infra, ads, ferramentas, etc.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={addExpense} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
              <span className="font-medium">Descrição</span>
              <input
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex.: Railway hosting, Meta Ads, Fal.ai"
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Valor (USD)</span>
              <input
                required
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Mês de referência</span>
              <input
                required
                type="month"
                value={expenseMonth}
                onChange={(e) => setExpenseMonth(e.target.value)}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Categoria</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
              <span className="font-medium">Notas (opcional)</span>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Detalhes, invoice, observações..."
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <Button
                type="submit"
                disabled={status === "saving" || data.expensesTableExists === false}
                className="w-full sm:w-auto"
              >
                <PlusIcon data-icon="inline-start" />
                {status === "saving" ? "Salvando…" : "Adicionar despesa"}
              </Button>
              {feedback ? (
                <span className={cn("text-sm", status === "error" && "text-destructive")}>
                  {feedback}
                </span>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Despesas registradas</CardTitle>
          <CardDescription>
            Total histórico: {formatCurrency(data.expensesTotal)} · {data.expenses?.length || 0}{" "}
            lançamento(s)
          </CardDescription>
        </CardHeader>
        <CardContent className="min-w-0">
          {!data.expenses?.length ? (
            <p className="text-sm text-muted-foreground">Nenhuma despesa lançada ainda.</p>
          ) : (
            <>
              <div className="omafit-partners-card-list">
                {data.expenses.map((row) => (
                  <div key={row.id} className="omafit-partners-card-list-item">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{row.description}</p>
                        {row.notes ? (
                          <p className="mt-1 text-xs text-muted-foreground">{row.notes}</p>
                        ) : null}
                      </div>
                      <p className="omafit-partners-metric-value shrink-0 text-sm font-medium">
                        {formatCurrency(row.amount, row.currency)}
                      </p>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge variant="outline">
                        {CATEGORY_LABELS[row.category] || row.category}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{row.expenseMonth}</span>
                    </div>
                    <div className="mt-3">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={deletingId === row.id}
                        onClick={() => removeExpense(row.id)}
                      >
                        <Trash2Icon data-icon="inline-start" />
                        Remover
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="omafit-partners-desktop-table">
                <ResponsiveTable minWidth={600}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Descrição</TableHead>
                        <TableHead>Categoria</TableHead>
                        <TableHead>Mês</TableHead>
                        <TableHead>Valor</TableHead>
                        <TableHead className="w-[80px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.expenses.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>
                            <div className="flex flex-col gap-0.5">
                              <span className="max-w-[200px] truncate font-medium">
                                {row.description}
                              </span>
                              {row.notes ? (
                                <span className="text-xs text-muted-foreground">{row.notes}</span>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {CATEGORY_LABELS[row.category] || row.category}
                            </Badge>
                          </TableCell>
                          <TableCell>{row.expenseMonth}</TableCell>
                          <TableCell className="omafit-partners-metric-value">
                            {formatCurrency(row.amount, row.currency)}
                          </TableCell>
                          <TableCell>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={deletingId === row.id}
                              onClick={() => removeExpense(row.id)}
                              title="Remover despesa"
                            >
                              <Trash2Icon />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ResponsiveTable>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
