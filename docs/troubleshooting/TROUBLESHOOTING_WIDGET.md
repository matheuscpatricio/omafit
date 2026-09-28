# Troubleshooting: Widget Omafit Não Aparece na Loja

## Problema 1: Link do Omafit não aparece na loja

**ATUALIZAÇÃO:** O widget agora verifica se está habilitado antes de exibir. Se `widget_enabled = false` ou `is_active = false`, o link não aparecerá.

### Verificações Necessárias

#### 1. Tema Instalado e Ativado
1. Acesse o Shopify Admin
2. Vá em **Online Store > Themes**
3. Verifique se o tema com o app Omafit está **publicado** (não apenas instalado)
4. Se não estiver publicado, clique em **Actions > Publish**

#### 2. Bloco Adicionado às Páginas de Produto
1. Acesse **Online Store > Themes**
2. Clique em **Customize** no tema ativo
3. Vá para uma página de produto
4. Verifique se o bloco **"Omafit embed"** está adicionado
5. Se não estiver:
   - Clique em **Add block** ou **Add section**
   - Procure por **"Omafit embed"**
   - Adicione o bloco
   - Salve as alterações

#### 3. App Habilitado no Tema
1. No editor de tema, vá em **Theme settings** ou **App embeds**
2. Verifique se o app **Omafit** está **habilitado**
3. Se não estiver, habilite e salve

#### 4. Verificar Console do Navegador
1. Abra uma página de produto na loja
2. Pressione **F12** para abrir o DevTools
3. Vá na aba **Console**
4. Procure por mensagens relacionadas ao Omafit:
   - `🚀 Omafit: Iniciando widget...`
   - `🔍 Shop domain detectado: ...`
   - `✅ PublicId válido obtido de widget_keys`
   - `📊 Status do widget: { finalStatus: "✅ HABILITADO" }` ← **IMPORTANTE**
   - `✅ Widget inserido após botão de carrinho`
   - `⚠️ Widget Omafit está desabilitado` ← **Se aparecer isso, execute o script SQL**
   - `⚠️ Widget encontrado mas não está ativo` ← **Se aparecer isso, execute o script SQL**

#### 5. Verificar se o Script está Carregando
1. No DevTools, vá na aba **Network**
2. Recarregue a página
3. Procure por `omafit-widget.js`
4. Verifique se o arquivo está sendo carregado (status 200)
5. Se não estiver:
   - O tema pode não estar instalado corretamente
   - Execute: `shopify app deploy` para reinstalar o tema

### Solução Rápida: Habilitar Widget no Banco

**Se aparecer no console:** `⚠️ Widget Omafit está desabilitado`:

1. Execute o script `supabase/patches/habilitar_widget.sql` no Supabase
2. Substitua `'SUA-LOJA.myshopify.com'` pelo shop domain real
3. Execute o script
4. Recarregue a página da loja (Ctrl+Shift+R)

### Solução: Reinstalar Tema
```bash
# No terminal, execute:
shopify app deploy
```

Isso reinstala o tema e garante que o script está disponível.

---

## Problema 2: Erro "Supabase não configurado" no App

### Causa
As variáveis de ambiente `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` não estão disponíveis no build do app.

### Solução: Configurar Variáveis no Railway

1. **Acesse o Railway Dashboard**
   - Vá para o projeto do app
   - Clique em **Variables** ou **Environment**

2. **Adicione as Variáveis de Ambiente:**
   ```
   VITE_SUPABASE_URL=https://lhkgnirolvbmomeduoaj.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxoa2duaXJvbHZibW9tZWR1b2FqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDc3NjE2NDYsImV4cCI6MjA2MzMzNzY0Nn0.aSBMJMT8TiAqvdO_Z9D_oINLaQrFMZIK5IEQJG6KaOI
   ```

3. **IMPORTANTE: Reconstruir o App**
   - Após adicionar as variáveis, o Railway precisa reconstruir o app
   - Vá em **Deployments**
   - Clique em **Redeploy** ou aguarde o deploy automático
   - As variáveis `VITE_*` são injetadas no **build time**, não no runtime

4. **Verificar se Funcionou**
   - Acesse o app no Shopify Admin
   - Vá em **Widget**
   - Tente fazer upload de um logo
   - Se não aparecer mais o erro, está funcionando

### Alternativa: Usar Variáveis sem VITE_ prefix

Se as variáveis com prefixo `VITE_` não funcionarem, você pode usar:
```
SUPABASE_URL=https://lhkgnirolvbmomeduoaj.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

O código foi atualizado para suportar ambos os formatos.

---

## Verificação Rápida

### Checklist do Widget na Loja
- [ ] Tema está publicado (não apenas instalado)
- [ ] Bloco "Omafit embed" está adicionado nas páginas de produto
- [ ] App está habilitado no tema
- [ ] Script `omafit-widget.js` está carregando (verificar Network tab)
- [ ] Console não mostra erros críticos

### Checklist do App
- [ ] Variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` estão no Railway
- [ ] App foi reconstruído após adicionar variáveis
- [ ] Não aparece mais erro "Supabase não configurado"
- [ ] Upload de logo funciona

---

## Comandos Úteis

### Verificar se o tema está instalado
```bash
shopify app info
```

### Reinstalar tema
```bash
shopify app deploy
```

### Ver logs do app (Railway)
- Acesse Railway Dashboard > Deployments > View Logs

---

## Se Nada Funcionar

1. **Verificar se widget_keys está ativo:**
   - Execute o script `supabase/patches/supabase_reactivate_shop.sql`
   - Verifique se `is_active = true`

2. **Verificar widget_configurations:**
   ```sql
   SELECT * FROM widget_configurations WHERE shop_domain = 'sua-loja.myshopify.com';
   ```
   - Verifique se `widget_enabled = true`

3. **Limpar cache do navegador:**
   - Pressione `Ctrl+Shift+R` (Windows) ou `Cmd+Shift+R` (Mac)
   - Ou limpe o cache completamente

4. **Verificar se o shop_domain está correto:**
   - No console do navegador, verifique qual shop domain está sendo detectado
   - Deve corresponder exatamente ao que está no banco de dados

