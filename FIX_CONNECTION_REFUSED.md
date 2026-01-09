# Correção: "Se recusou a se conectar" no Shopify

## Problema

Ao tentar acessar o app no Shopify, aparece o erro:
```
occurring-wines-pest-compiler.trycloudflare.com se recusou a se conectar.
```

## Causas Possíveis

1. **Servidor não está rodando** - O servidor de desenvolvimento precisa estar ativo
2. **URL do Cloudflare Tunnel mudou** - Os túneis gratuitos mudam de URL
3. **URL não está atualizada** - O `shopify.app.toml` pode ter URL antiga

## Solução

### 1. Verificar se o servidor está rodando

Execute no terminal:
```bash
npm run dev
```

O comando `shopify app dev` deve:
- Iniciar o servidor React Router
- Criar um túnel Cloudflare
- Mostrar a nova URL do túnel

**Exemplo de saída:**
```
✓ Tunnel running at https://nova-url.trycloudflare.com
```

### 2. Atualizar a URL no Shopify

Quando o servidor iniciar, você verá uma nova URL do Cloudflare. Você precisa:

**Opção A: Atualizar automaticamente (recomendado)**

O `shopify.app.toml` tem a opção:
```toml
[build]
automatically_update_urls_on_dev = true
```

Isso deve atualizar automaticamente, mas se não funcionar:

**Opção B: Atualizar manualmente**

1. Copie a nova URL do terminal (ex: `https://nova-url.trycloudflare.com`)
2. Atualize o arquivo `shopify.app.toml`:
   ```toml
   application_url = "https://nova-url.trycloudflare.com"
   ```
3. Ou atualize via Shopify CLI:
   ```bash
   shopify app config link
   ```

### 3. Verificar variáveis de ambiente

Certifique-se de que o arquivo `.env` existe e tem as variáveis corretas:
```
VITE_SUPABASE_URL=https://lhkgnirolvbmomeduoaj.supabase.co
VITE_SUPABASE_ANON_KEY=sua_chave_aqui
SHOPIFY_APP_URL=https://nova-url.trycloudflare.com
```

### 4. Reiniciar o servidor

Após atualizar a URL:
1. Pare o servidor (Ctrl+C)
2. Execute novamente: `npm run dev`
3. Aguarde o túnel ser criado
4. Copie a nova URL e atualize no Shopify

## Verificação Rápida

1. ✅ Servidor rodando? → `npm run dev` deve estar ativo
2. ✅ URL atualizada? → Verificar `shopify.app.toml`
3. ✅ Túnel ativo? → Verificar se a URL do Cloudflare está acessível no navegador
4. ✅ Variáveis de ambiente? → Verificar `.env`

## Troubleshooting

### Erro: "Tunnel não conecta"

**Solução:**
- Verifique sua conexão com a internet
- Tente reiniciar o servidor
- O Cloudflare Tunnel pode estar temporariamente indisponível

### Erro: "URL não atualiza automaticamente"

**Solução:**
- Atualize manualmente o `shopify.app.toml`
- Ou use: `shopify app config link`

### Erro: "Servidor inicia mas app não carrega"

**Solução:**
- Verifique se todas as variáveis de ambiente estão configuradas
- Verifique os logs do servidor para erros
- Verifique se o banco de dados está acessível

## Comandos Úteis

```bash
# Iniciar servidor de desenvolvimento
npm run dev

# Verificar configuração do app
shopify app config show

# Atualizar URL do app
shopify app config link

# Ver logs do servidor
# (os logs aparecem no terminal onde o servidor está rodando)
```

## Resumo

1. ✅ Execute `npm run dev` para iniciar o servidor
2. ✅ Copie a URL do Cloudflare Tunnel que aparecer
3. ✅ Atualize `shopify.app.toml` com a nova URL
4. ✅ Acesse o app no Shopify Admin

O erro "se recusou a se conectar" geralmente significa que o servidor não está rodando ou a URL está incorreta.








