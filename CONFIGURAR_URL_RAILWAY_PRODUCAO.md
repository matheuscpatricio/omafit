# Configurar URL da Railway para Produção

## 🎯 Problema

O widget só aparece após `shopify app deploy`, mas quando faz deploy, o Shopify Partners cria uma versão que procura túnel Cloudflare ao invés da URL da Railway.

## ✅ Solução

### Passo 1: Verificar shopify.app.toml

O arquivo `shopify.app.toml` já está configurado com a URL da Railway:
```toml
application_url = "https://omafit-production.up.railway.app/"
```

**Importante:** Certifique-se que o arquivo está salvo (Ctrl+S ou Cmd+S).

### Passo 2: Verificar no Shopify Partners Dashboard

1. Acesse **Shopify Partners Dashboard**
2. Vá para **Apps** → **Omafit**
3. Clique em **App Setup** ou **Settings**
4. Verifique a seção **App URLs** ou **App URL**

**Deve estar configurado como:**
- **App URL**: `https://omafit-production.up.railway.app/`
- **Allowed redirection URL(s)**: Deve incluir `https://omafit-production.up.railway.app/auth/callback`

**Se estiver com URL do Cloudflare:**
1. Atualize para: `https://omafit-production.up.railway.app/`
2. Clique em **Save**

### Passo 3: Atualizar via CLI (Forçar Atualização)

Execute no terminal:

```bash
# 1. Verificar configuração atual
shopify app info

# 2. Fazer deploy forçando a URL da Railway
shopify app deploy --reset

# Ou atualizar apenas a URL
shopify app config push
```

### Passo 4: Verificar Variáveis de Ambiente no Railway

No **Railway Dashboard**, verifique se a variável `SHOPIFY_APP_URL` está configurada:

1. Acesse Railway Dashboard
2. Seu projeto → **Variables**
3. Verifique se existe:
   ```
   SHOPIFY_APP_URL=https://omafit-production.up.railway.app
   ```
4. Se não existir, adicione

### Passo 5: Verificar Redirecionamento de Auth

No **Shopify Partners Dashboard**, em **App URLs** → **Allowed redirection URL(s)**, deve incluir:

```
https://omafit-production.up.railway.app/auth/callback
```

## 🔧 Correções Aplicadas

### 1. Desabilitar Auto-Update de URLs

O `shopify.app.toml` agora tem:
```toml
automatically_update_urls_on_dev = false
```

Isso evita que o CLI atualize automaticamente para túnel Cloudflare.

### 2. Garantir URL Correta

O arquivo está configurado com a URL da Railway:
```toml
application_url = "https://omafit-production.up.railway.app/"
```

## 📝 Sobre o Widget Aparecer Apenas Após Deploy

**Isso é normal!** Tema extensions precisam ser deployados para aparecer na loja:

1. ✅ **Desenvolvimento local (`shopify app dev`)**: Cria túnel Cloudflare temporário (só para testar localmente)
2. ✅ **Deploy (`shopify app deploy`)**: Faz deploy do tema extension para a loja (produção)

**O widget sempre precisa de deploy para aparecer na loja do lojista.**

## 🚨 Se Ainda Aparecer URL do Cloudflare

### Verificar 1: Shopify Partners Dashboard

A URL no Dashboard pode estar diferente. Atualize manualmente:
- **App URL**: `https://omafit-production.up.railway.app/`
- **Redirection URLs**: `https://omafit-production.up.railway.app/auth/callback`

### Verificar 2: Executar Comando de Reset

```bash
# Fazer deploy completo resetando configurações
shopify app deploy --reset
```

### Verificar 3: Verificar Variáveis no Railway

Certifique-se que `SHOPIFY_APP_URL` está configurada no Railway com a URL correta.

## ✅ Checklist Final

- [ ] `shopify.app.toml` tem `application_url = "https://omafit-production.up.railway.app/"`
- [ ] `automatically_update_urls_on_dev = false` no `shopify.app.toml`
- [ ] Shopify Partners Dashboard → App URL = Railway URL
- [ ] Railway → Variável `SHOPIFY_APP_URL` = Railway URL
- [ ] Shopify Partners → Redirection URLs inclui `/auth/callback`
- [ ] Fez `shopify app deploy` após atualizações

## 💡 Nota Importante

**Desenvolvimento vs Produção:**
- `shopify app dev` → Usa túnel Cloudflare (temporário, só para desenvolvimento local)
- `shopify app deploy` → Deploy para produção (deve usar Railway URL)

Ambos são necessários, mas para produção sempre use `deploy` com a URL da Railway configurada.
