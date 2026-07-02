import { redirect, useActionData, useLoaderData } from "react-router";
import {
  commitSession,
  createPartnersAuthSession,
  destroySession,
  getPartnersSession,
  isPartnersAuthConfigured,
  verifyPartnersPassword,
} from "../partners-auth.server";
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
import { AlertTriangleIcon } from "lucide-react";

export const loader = async ({ request }) => {
  const session = await getPartnersSession(request);
  if (session.get("authenticated") === true) {
    const url = new URL(request.url);
    const redirectTo = url.searchParams.get("redirectTo") || "/partners";
    throw redirect(redirectTo);
  }
  return { authConfigured: isPartnersAuthConfigured() };
};

export const action = async ({ request }) => {
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "logout") {
    const session = await getPartnersSession(request);
    return redirect("/partners/login", {
      headers: { "Set-Cookie": await destroySession(session) },
    });
  }

  if (!isPartnersAuthConfigured()) {
    return { error: "PARTNERS_DASHBOARD_SECRET não configurado no servidor." };
  }

  const password = String(form.get("password") || "");
  const valid = await verifyPartnersPassword(password);
  if (!valid) {
    return { error: "Senha incorreta." };
  }

  const session = await createPartnersAuthSession();
  const url = new URL(request.url);
  const redirectTo = url.searchParams.get("redirectTo") || "/partners";

  return redirect(redirectTo, {
    headers: { "Set-Cookie": await commitSession(session) },
  });
};

export default function PartnersLoginPage() {
  const { authConfigured } = useLoaderData();
  const actionData = useActionData();

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-8 sm:px-5 sm:py-12">
      <Card className="w-full max-w-md ring-1 ring-primary/20">
        <CardHeader className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="omafit-partners-wordmark text-xl">Omafit</span>
            <Badge variant="outline">Partners</Badge>
          </div>
          <CardTitle className="text-2xl font-normal italic text-primary">
            Acesso interno
          </CardTitle>
          <CardDescription>Dashboard Shopify &amp; Nuvemshop</CardDescription>
        </CardHeader>
        <CardContent>
          {!authConfigured ? (
            <Alert variant="destructive">
              <AlertTriangleIcon />
              <AlertTitle>Configuração pendente</AlertTitle>
              <AlertDescription>
                Defina <code className="text-xs">PARTNERS_DASHBOARD_SECRET</code> no Railway.
              </AlertDescription>
            </Alert>
          ) : (
            <form method="post" className="flex flex-col gap-4">
              <label className="flex flex-col gap-2 text-sm" htmlFor="password">
                <span className="font-medium text-foreground">Senha de acesso</span>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none ring-ring focus-visible:ring-2"
                />
              </label>
              {actionData?.error ? (
                <p className="text-sm text-destructive">{actionData.error}</p>
              ) : null}
              <Button type="submit" className="w-full">
                Entrar
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
