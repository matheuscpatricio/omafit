# Atualizar URL do App Shopify

## Problema

O erro "se recusou a se conectar" geralmente acontece quando a URL do app no Shopify não corresponde à URL real do servidor.

## Solução

### 1. Atualizar shopify.app.toml

A URL foi atualizada para:
```toml
application_url = "https://occurring-wines-pest-compiler.trycloudflare.com"
```

### 2. Atualizar no Dashboard do Shopify

Você também precisa atualizar a URL no Partner Dashboard:

1. Acesse: https://partners.shopify.com
2. Vá em **Apps** → Selecione seu app **Omafit**
3. Vá em **App setup**
4. Em **App URL**, atualize para: `https://occurring-wines-pest-compiler.trycloudflare.com`
5. Clique em **Save**

### 3. Verificar variável de ambiente

Certifique-se de que o arquivo `.env` (ou variáveis de ambiente do servidor) tem:
```
SHOPIFY_APP_URL=https://occurring-wines-pest-compiler.trycloudflare.com
```

### 4. Reiniciar o servidor (se necessário)

Se você atualizou a URL enquanto o servidor estava rodando:
```bash
# Pare o servidor (Ctrl+C)
# Reinicie
npm run dev
```

## Verificação

Após atualizar:
1. ✅ URL no `shopify.app.toml` está correta
2. ✅ URL no Partner Dashboard está atualizada
3. ✅ Variável `SHOPIFY_APP_URL` está configurada
4. ✅ Servidor está rodando e acessível

## Nota Importante

Os túneis Cloudflare gratuitos mudam de URL quando:
- O servidor é reiniciado
- A conexão é perdida
- O túnel expira

Se a URL mudar novamente, você precisará atualizar novamente em ambos os lugares.







