# Checklist: Billing (seleção de plano) funcionando

Use este checklist para garantir que **Shopify**, **Supabase** e **variáveis de ambiente** estão corretos.

---

## 1. Shopify (Partner Dashboard e app)

- [ ] **App URL**  
  No Partner Dashboard → App → URLs, a **App URL** deve ser exatamente a URL pública do app (ex: `https://seu-app.up.railway.app`), **sem barra no final**.

- [ ] **Redirect URLs**  
  Inclua na lista de redirect URLs permitidas:
  - `https://SEU_DOMINIO/billing/confirm`
  - `https://SEU_DOMINIO/auth/exit-iframe`  
  (substitua SEU_DOMINIO pela URL do app)

- [ ] **Billing**  
  O app deve ter permissão para criar cobranças (App Billing / Recurring). Isso costuma vir dos scopes e da configuração do app na Shopify.

- [ ] **Variável no servidor**  
  No Railway (ou onde o app roda):  
  `SHOPIFY_APP_URL` = mesma URL do app (ex: `https://seu-app.up.railway.app`), **sem barra no final**.  
  Se estiver vazia, o redirect para `/auth/exit-iframe` e para `/billing/confirm` pode quebrar.

---

## 2. Supabase

- [ ] **Tabela `shopify_shops`**  
  Execute o script em **`supabase_billing_shopify_shops.sql`** no SQL Editor do Supabase (uma vez).  
  Isso cria/ajusta a tabela e as colunas: `plan`, `billing_status`, `images_included`, `price_per_extra_image`, etc.

- [ ] **Gravação do plano (sync)**  
  O servidor atualiza essa tabela ao:
  - abrir o app,
  - voltar da página de confirmação da Shopify (`/billing/confirm`),
  - e ao carregar a página de billing (chamada a `/api/billing/sync`).  

  Para o sync **sempre** conseguir gravar (mesmo com RLS ativo):
  - Defina no **servidor** (Railway): `SUPABASE_SERVICE_ROLE_KEY` = chave **service_role** do projeto (Settings → API no Supabase).  
  - **Nunca** use essa chave no front-end.

  Se não quiser usar a service role, desative RLS na tabela `shopify_shops` ou crie políticas que permitam INSERT/UPDATE para o papel `anon` (o script SQL comenta essa opção).

- [ ] **Leitura no front**  
  A página de billing lê de `shopify_shops` com a chave **anon** (via `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`).  
  RLS deve permitir **SELECT** para anon nessa tabela (ou RLS desativado).

---

## 3. Fluxo no app (o que o código faz)

1. O merchant clica em **Assinar** ou **Mudar plano** na página **Billing**.
2. O formulário faz um **GET** para **`/app/billing/start?plan=basic|growth|pro&shop=...&host=...&embedded=1`** com **target="_top"** (navegação no topo da janela, saindo do iframe).
3. O **loader** da rota `app.billing.start`:
   - autentica com a sessão (cookie ou `id_token` na URL),
   - chama a API da Shopify para criar a assinatura,
   - devolve **302** para **`/auth/exit-iframe?exitIframe=CONFIRMATION_URL&shop=...&host=...`**.
4. A página **`/auth/exit-iframe`** (tratada pelo framework Shopify) redireciona o **topo** da janela para a URL de confirmação da Shopify.
5. O merchant aprova na Shopify; a Shopify redireciona para **`/billing/confirm?shop=...`**.
6. A rota **`billing.confirm`** sincroniza o plano com o Supabase e redireciona para **`/app?shop=...&billing_refresh=1`**.

Se “nada acontece” ao clicar:
- Confira a **aba Rede** (F12): ao clicar, deve aparecer uma requisição para **`/app/billing/start?plan=...`**.  
  - Se não aparecer: o formulário não está submetendo (ou a URL está errada).  
  - Se aparecer **302** e depois **/auth/exit-iframe**: o fluxo está certo; se o topo não for para a Shopify, pode ser bloqueio do navegador ou do Admin.  
  - Se aparecer **401/302 para login**: sessão inválida ou `id_token`/cookie faltando na URL.

---

## 4. Resumo de variáveis (servidor)

| Variável | Obrigatória | Uso |
|----------|-------------|-----|
| `SHOPIFY_APP_URL` | Sim | URL pública do app (sem barra). Redirects de billing e auth. |
| `SUPABASE_SERVICE_ROLE_KEY` | Recomendado | Sync de plano para `shopify_shops` (ignora RLS). |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Sim (já usadas) | Leitura no front e sync quando não há service role. |

Depois de conferir tudo acima, teste de novo o fluxo de **Assinar** / **Mudar plano** na página de Billing.
