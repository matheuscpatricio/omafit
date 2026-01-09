# Correção: Shop Domain Hardcoded

## Problema Reportado
O nome da loja `arrascaneta-2.myshopify.com` estava aparecendo como `demo-shop.myshopify.com` em alguns lugares.

## Causa
Vários arquivos estavam usando `demo-shop.myshopify.com` como fallback hardcoded quando o `shop` não era encontrado na URL.

## Solução Implementada

### 1. ✅ Função Utilitária `getShopDomain`
Criada função centralizada em `app/utils/getShopDomain.js` que tenta obter o shop domain de várias fontes:

1. **URL Query Params** (`?shop=...`)
2. **localStorage** (salvo quando encontrado na URL)
3. **window.Shopify.shop** (se disponível)
4. **Hostname da URL** (extrai de `*.myshopify.com`)
5. **Search params da URL atual**

**Importante**: A função retorna `null` se não encontrar, ao invés de usar fallback hardcoded.

### 2. ✅ Arquivos Corrigidos

#### `app/routes/app.widget.jsx`
- ✅ Usa `getShopDomain(searchParams)`
- ✅ Logs quando shop domain é detectado ou não encontrado
- ✅ Não carrega configuração se shop domain não for encontrado

#### `app/routes/app.size-chart.jsx`
- ✅ Usa `getShopDomain(searchParams)`
- ✅ Logs quando shop domain é detectado ou não encontrado

#### `app/routes/app._index.jsx`
- ✅ Usa `getShopDomain(searchParams)`
- ✅ Mantém fallback `'demo-shop.myshopify.com'` apenas para desenvolvimento

#### `app/routes/app.billing.jsx`
- ✅ Usa `getShopDomain(searchParams)`
- ✅ Mantém fallback `'demo-shop.myshopify.com'` apenas para desenvolvimento

#### `app/routes/app.usage.jsx`
- ✅ Usa `getShopDomain(searchParams)`
- ✅ Mantém fallback `'demo-shop.myshopify.com'` apenas para desenvolvimento

#### `app/routes/app.analytics.jsx`
- ✅ Usa `getShopDomain(searchParams)`
- ✅ Mantém fallback `'demo-shop.myshopify.com'` apenas para desenvolvimento

#### `app/routes/api.billing.start.jsx`
- ✅ Usa `getShopDomain(searchParams)` via import dinâmico

## Como Funciona

### Fluxo de Detecção
1. **Primeira vez**: Shop vem da URL (`?shop=arrascaneta-2.myshopify.com`)
2. **Salvo no localStorage**: `omafit_shop_domain = 'arrascaneta-2.myshopify.com'`
3. **Próximas vezes**: Se não estiver na URL, busca do localStorage
4. **Fallback**: Se não encontrar em nenhum lugar, retorna `null` e mostra aviso no console

### Persistência
- Shop domain é salvo no `localStorage` sempre que encontrado
- Permanece disponível mesmo ao navegar entre páginas
- Não depende mais de query params em todas as navegações

## Como Testar

### 1. Verificar Console
Abra o Console (F12) e verifique:
```
[Widget] Shop domain detectado: arrascaneta-2.myshopify.com
```

Se aparecer:
```
[Widget] Shop domain não encontrado! Verifique se está acessando pelo Shopify Admin.
```

Significa que o shop não foi encontrado em nenhuma fonte.

### 2. Verificar localStorage
No Console, execute:
```javascript
localStorage.getItem('omafit_shop_domain')
```

Deve retornar: `"arrascaneta-2.myshopify.com"`

### 3. Testar Navegação
1. Abrir `app.widget.jsx` (deve detectar shop)
2. Navegar para outra página
3. Voltar para `app.widget.jsx`
4. **Verificar**: Shop deve ser detectado do localStorage

## Se Ainda Aparecer `demo-shop.myshopify.com`

### Possíveis Causas
1. **Shop não está na URL inicial**: Verificar se está acessando pelo Shopify Admin
2. **localStorage bloqueado**: Verificar se cookies/localStorage estão habilitados
3. **Fallback ainda sendo usado**: Verificar se todos os arquivos foram atualizados

### Solução Manual
Se necessário, pode definir manualmente no Console:
```javascript
localStorage.setItem('omafit_shop_domain', 'arrascaneta-2.myshopify.com');
```

Depois recarregar a página.

## Arquivos Criados/Modificados

1. **`app/utils/getShopDomain.js`** (NOVO)
   - Função utilitária centralizada

2. **`app/routes/app.widget.jsx`**
   - Usa `getShopDomain`
   - Logs de debug

3. **`app/routes/app.size-chart.jsx`**
   - Usa `getShopDomain`
   - Logs de debug

4. **`app/routes/app._index.jsx`**
   - Usa `getShopDomain`

5. **`app/routes/app.billing.jsx`**
   - Usa `getShopDomain`

6. **`app/routes/app.usage.jsx`**
   - Usa `getShopDomain`

7. **`app/routes/app.analytics.jsx`**
   - Usa `getShopDomain`

8. **`app/routes/api.billing.start.jsx`**
   - Usa `getShopDomain` (import dinâmico)

## Próximos Passos

1. **Testar** se shop domain está sendo detectado corretamente
2. **Verificar logs** no console
3. **Confirmar** que `arrascaneta-2.myshopify.com` aparece em todos os lugares
4. Se ainda houver problemas, **verificar** se está acessando pelo Shopify Admin









