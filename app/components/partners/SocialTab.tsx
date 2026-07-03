import { useState } from "react";
import {
  CameraIcon,
  ExternalLinkIcon,
  PlayIcon,
  SparklesIcon,
  DownloadIcon,
  InfoIcon,
} from "lucide-react";
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
import { cn } from "@/lib/utils";

type SocialProfile = {
  configured?: boolean;
  handle?: string;
  url?: string;
  subscribers?: number | null;
  views?: number | null;
  videoCount?: number | null;
  followers?: number | null;
  mediaCount?: number | null;
  title?: string | null;
  thumbnailUrl?: string | null;
  profilePictureUrl?: string | null;
  tokenExpired?: boolean;
  error?: string | null;
};

type SocialData = {
  youtube?: SocialProfile;
  instagram?: SocialProfile;
  links?: {
    instagram?: string;
    youtube?: string;
  };
};

type CarouselPreview = {
  index: number;
  theme: string;
  kind: string;
  title: string;
  dataUrl: string;
};

type GenerateResult = {
  success: boolean;
  source?: string;
  slideCount?: number;
  previews?: CarouselPreview[];
  canva?: {
    success: boolean;
    editUrl?: string | null;
    viewUrl?: string | null;
    error?: string | null;
  };
  canvaConfigured?: boolean;
  error?: string;
};

function formatNumber(value: unknown) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return new Intl.NumberFormat("pt-BR").format(Number(value));
}

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

function InsightsPanel({
  insights,
}: {
  insights: ReturnType<typeof buildPartnersInsights>;
}) {
  if (!insights.length) return null;
  return (
    <Card className="ring-1 ring-primary/20">
      <CardHeader>
        <CardTitle>O que fazer agora</CardTitle>
        <CardDescription>Recomendações para redes sociais e conteúdo Omafit.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {insights.map((item) => (
          <Alert key={item.id} className="border-border bg-card">
            <InfoIcon />
            <AlertTitle>{item.title}</AlertTitle>
            <AlertDescription>
              <p>{item.description}</p>
              <p className="mt-2 font-medium text-foreground">{item.action}</p>
            </AlertDescription>
          </Alert>
        ))}
      </CardContent>
    </Card>
  );
}

function SocialProfileCard({
  platform,
  profile,
  icon: Icon,
  metrics,
}: {
  platform: string;
  profile?: SocialProfile;
  icon: typeof CameraIcon;
  metrics: { label: string; value: string }[];
}) {
  const avatar = profile?.thumbnailUrl || profile?.profilePictureUrl;

  return (
    <Card className="ring-1 ring-border/60">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            {avatar ? (
              <img
                src={avatar}
                alt=""
                className="size-12 rounded-full border border-border object-cover"
              />
            ) : (
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <Icon className="size-5 text-primary" />
              </div>
            )}
            <div>
              <CardTitle className="text-lg">{platform}</CardTitle>
              <CardDescription>@{profile?.handle || "—"}</CardDescription>
            </div>
          </div>
          {profile?.url ? (
            <Button variant="outline" size="sm" asChild>
              <a href={profile.url} target="_blank" rel="noopener noreferrer">
                <ExternalLinkIcon data-icon="inline-start" />
                Abrir
              </a>
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {profile?.title ? (
          <p className="text-sm text-muted-foreground">{profile.title}</p>
        ) : null}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {metrics.map((m) => (
            <div key={m.label} className="rounded-lg border border-border/60 bg-card/50 p-3">
              <p className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
                {m.label}
              </p>
              <p className="omafit-partners-metric-value mt-1 text-lg font-medium">{m.value}</p>
            </div>
          ))}
        </div>
        {profile?.error ? (
          <p className="text-xs text-destructive">Erro ao buscar dados: {profile.error}</p>
        ) : !profile?.configured ? (
          <p className="text-xs text-muted-foreground">
            Perfil vinculado — configure a API para métricas em tempo real.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.click();
}

export function SocialTab({
  data,
  canvaConfigured,
  openaiConfigured,
  youtubeApiConfigured,
  instagramApiConfigured,
  metaAppConfigured,
}: {
  data: SocialData;
  canvaConfigured: boolean;
  openaiConfigured: boolean;
  youtubeApiConfigured: boolean;
  instagramApiConfigured: boolean;
  metaAppConfigured: boolean;
}) {
  const [theme, setTheme] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"idle" | "generating" | "error">("idle");
  const [feedback, setFeedback] = useState("");
  const [result, setResult] = useState<GenerateResult | null>(null);

  const [shortToken, setShortToken] = useState("");
  const [tokenStatus, setTokenStatus] = useState<"idle" | "loading" | "error">("idle");
  const [tokenFeedback, setTokenFeedback] = useState("");
  const [tokenResult, setTokenResult] = useState<{
    instagramAccessToken?: string;
    instagramBusinessAccountId?: string;
    instagramUsername?: string;
    pageName?: string;
    note?: string;
  } | null>(null);

  const ctx = { canvaConfigured, openaiConfigured, youtubeApiConfigured, instagramApiConfigured };
  const insights = buildPartnersInsights("social", data, ctx);

  const youtube = data.youtube;
  const instagram = data.instagram;

  const exchangeInstagramToken = async (e: React.FormEvent) => {
    e.preventDefault();
    setTokenStatus("loading");
    setTokenFeedback("");
    setTokenResult(null);
    try {
      const response = await fetch("/api/partners/instagram-token", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shortLivedToken: shortToken, preferredUsername: "omafit.co" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || payload.hint || "Falha ao gerar token");
      }
      setTokenResult(payload);
      setTokenStatus("idle");
      setTokenFeedback("Token de Página gerado — cole no Railway e faça redeploy.");
      setShortToken("");
    } catch (err) {
      setTokenStatus("error");
      setTokenFeedback(err instanceof Error ? err.message : "Erro ao trocar token");
    }
  };

  const generate = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("generating");
    setFeedback("");
    setResult(null);
    try {
      const response = await fetch("/api/partners/social-carousel", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme, description, pushToCanva: true }),
      });
      const payload = (await response.json().catch(() => ({}))) as GenerateResult;
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Falha ao gerar carrossel");
      }
      setResult(payload);
      setStatus("idle");
      setFeedback(
        payload.canva?.success
          ? "Carrossel criado no Canva — abra o link para editar."
          : "Slides gerados — baixe as imagens ou configure o Canva para envio automático.",
      );
    } catch (err) {
      setStatus("error");
      setFeedback(err instanceof Error ? err.message : "Erro ao gerar");
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-4 sm:gap-6">
      <InsightsPanel insights={insights} />

      <div className="grid gap-4 lg:grid-cols-2">
        <SocialProfileCard
          platform="Instagram"
          profile={instagram}
          icon={CameraIcon}
          metrics={[
            { label: "Seguidores", value: formatNumber(instagram?.followers) },
            { label: "Publicações", value: formatNumber(instagram?.mediaCount) },
          ]}
        />
        <SocialProfileCard
          platform="YouTube"
          profile={youtube}
          icon={PlayIcon}
          metrics={[
            { label: "Inscritos", value: formatNumber(youtube?.subscribers) },
            { label: "Visualizações", value: formatNumber(youtube?.views) },
            { label: "Vídeos", value: formatNumber(youtube?.videoCount) },
          ]}
        />
      </div>

      {instagram?.tokenExpired || instagram?.error ? (
        <Alert variant="destructive">
          <InfoIcon />
          <AlertTitle>Token do Instagram expirado ou inválido</AlertTitle>
          <AlertDescription className="flex flex-col gap-2 text-sm">
            <p>{instagram.error}</p>
            <p>
              Tokens do Graph API Explorer expiram em ~1 hora. Use o formulário abaixo para gerar um{" "}
              <strong>token de Página</strong> que não expira.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Token de longa duração (Instagram)</CardTitle>
          <CardDescription>
            Gera um token de Página do Facebook vinculado ao @omafit.co — não expira como o token do
            Explorer.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!metaAppConfigured ? (
            <Alert>
              <InfoIcon />
              <AlertTitle>App Meta não configurado no servidor</AlertTitle>
              <AlertDescription className="flex flex-col gap-1 text-sm">
                <span>
                  Adicione no Railway: <code className="text-xs">META_APP_ID</code> e{" "}
                  <code className="text-xs">META_APP_SECRET</code> (em developers.facebook.com →
                  seu app → Settings → Basic).
                </span>
              </AlertDescription>
            </Alert>
          ) : null}

          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              Abra o{" "}
              <a
                href="https://developers.facebook.com/tools/explorer/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                Graph API Explorer
              </a>
            </li>
            <li>
              Permissões: <code className="text-xs">pages_show_list</code>,{" "}
              <code className="text-xs">instagram_basic</code>,{" "}
              <code className="text-xs">instagram_manage_insights</code>
            </li>
            <li>Gere um Access Token e cole abaixo (válido por ~1h — só para esta troca)</li>
            <li>Copie os valores gerados para o Railway e salve</li>
          </ol>

          <form onSubmit={exchangeInstagramToken} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Token curto do Explorer</span>
              <textarea
                required
                rows={3}
                value={shortToken}
                onChange={(e) => setShortToken(e.target.value)}
                placeholder="EAAG..."
                disabled={!metaAppConfigured}
                className="rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              />
            </label>
            <Button
              type="submit"
              disabled={!metaAppConfigured || tokenStatus === "loading"}
              className="w-full sm:w-auto"
            >
              {tokenStatus === "loading" ? "Gerando token de Página…" : "Gerar token de longa duração"}
            </Button>
            {tokenFeedback ? (
              <span className={cn("text-sm", tokenStatus === "error" && "text-destructive")}>
                {tokenFeedback}
              </span>
            ) : null}
          </form>

          {tokenResult?.instagramAccessToken ? (
            <div className="flex flex-col gap-3 rounded-xl border border-accent/30 bg-accent/5 p-4 text-sm">
              <p className="font-medium text-foreground">
                @{tokenResult.instagramUsername} · {tokenResult.pageName}
              </p>
              <p className="text-muted-foreground">{tokenResult.note}</p>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  INSTAGRAM_ACCESS_TOKEN
                </span>
                <textarea
                  readOnly
                  rows={3}
                  value={tokenResult.instagramAccessToken}
                  className="rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  INSTAGRAM_BUSINESS_ACCOUNT_ID
                </span>
                <input
                  readOnly
                  value={tokenResult.instagramBusinessAccountId || ""}
                  className="h-9 rounded-lg border border-input bg-background px-3 font-mono text-xs"
                />
              </label>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {!youtubeApiConfigured || !instagramApiConfigured ? (
        <Alert>
          <InfoIcon />
          <AlertTitle>Métricas opcionais</AlertTitle>
          <AlertDescription className="flex flex-col gap-1 text-sm">
            {!youtubeApiConfigured ? (
              <span>
                YouTube: configure <code className="text-xs">YOUTUBE_API_KEY</code> no Railway.
              </span>
            ) : null}
            {!instagramApiConfigured ? (
              <span>
                Instagram: configure{" "}
                <code className="text-xs">INSTAGRAM_ACCESS_TOKEN</code> e{" "}
                <code className="text-xs">INSTAGRAM_BUSINESS_ACCOUNT_ID</code>.
              </span>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="ring-1 ring-primary/25">
        <CardHeader>
          <div className="flex items-center gap-2">
            <SparklesIcon className="text-primary" />
            <CardTitle>Gerar conteúdo</CardTitle>
          </div>
          <CardDescription>
            Carrossel Instagram 1080×1080 com cores e fontes Omafit — fundo marrom/creme alternado,
            verde apenas nos detalhes. Enviado ao Canva quando configurado.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <form onSubmit={generate} className="grid grid-cols-1 gap-4">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Tema</span>
              <input
                required
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                placeholder="Ex.: Por que try-on AR aumenta conversão"
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Descrição</span>
              <textarea
                required
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Contexto, pontos principais, público-alvo, CTA desejado..."
                className="min-h-[100px] rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-[0.65rem]">
                {canvaConfigured ? "Canva conectado" : "Canva não configurado"}
              </Badge>
              <Badge variant="outline" className="text-[0.65rem]">
                {openaiConfigured ? "Copy com IA" : "Copy com template"}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                disabled={status === "generating"}
                className="w-full sm:w-auto"
              >
                <SparklesIcon data-icon="inline-start" />
                {status === "generating" ? "Gerando carrossel…" : "Gerar carrossel"}
              </Button>
              {feedback ? (
                <span className={cn("text-sm", status === "error" && "text-destructive")}>
                  {feedback}
                </span>
              ) : null}
            </div>
          </form>

          {!canvaConfigured ? (
            <Alert>
              <InfoIcon />
              <AlertTitle>Canva (opcional)</AlertTitle>
              <AlertDescription>
                Para criar o design diretamente no Canva, configure{" "}
                <code className="text-xs">CANVA_ACCESS_TOKEN</code> com scopes{" "}
                <code className="text-xs">asset:write</code> e{" "}
                <code className="text-xs">design:content:write</code>. Os slides ainda são gerados
                para download abaixo.
              </AlertDescription>
            </Alert>
          ) : null}

          {result?.canva?.success && result.canva.editUrl ? (
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <a href={result.canva.editUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLinkIcon data-icon="inline-start" />
                  Abrir no Canva
                </a>
              </Button>
              {result.canva.viewUrl ? (
                <Button variant="outline" asChild>
                  <a href={result.canva.viewUrl} target="_blank" rel="noopener noreferrer">
                    Visualizar
                  </a>
                </Button>
              ) : null}
            </div>
          ) : null}

          {result?.previews?.length ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium">
                  Prévia ({result.slideCount} slides · {result.source === "ai" ? "IA" : "template"})
                </h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    result.previews?.forEach((slide) => {
                      downloadDataUrl(slide.dataUrl, `omafit-slide-${slide.index}.png`);
                    });
                  }}
                >
                  <DownloadIcon data-icon="inline-start" />
                  Baixar todos
                </Button>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {result.previews.map((slide) => (
                  <div
                    key={slide.index}
                    className="overflow-hidden rounded-xl border border-border/70 bg-card/80"
                  >
                    <img
                      src={slide.dataUrl}
                      alt={`Slide ${slide.index}: ${slide.title}`}
                      className="aspect-square w-full object-cover"
                    />
                    <div className="flex items-center justify-between gap-2 p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{slide.title}</p>
                        <p className="text-xs text-muted-foreground">{slide.theme}</p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          downloadDataUrl(slide.dataUrl, `omafit-slide-${slide.index}.png`)
                        }
                      >
                        <DownloadIcon />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Instagram"
          value={`@${instagram?.handle || "omafit.co"}`}
          hint="Perfil oficial"
        />
        <MetricCard label="YouTube" value={`@${youtube?.handle || "omafit-g3d"}`} hint="Canal oficial" />
        <MetricCard
          label="Formato"
          value="1080²"
          hint="Carrossel quadrado Instagram"
        />
        <MetricCard
          label="Identidade"
          value="Omafit"
          hint="Marrom · laranja · creme · verde (detalhes)"
        />
      </div>
    </div>
  );
}
