# Solução Definitiva: Widget Não Aparece

## 🎯 Problemas Mais Comuns (99% dos casos)

### 1. Bloco Não Está no Tema (Mais Comum)

**Como verificar:**
1. Online Store > Themes > Customize
2. Vá para uma página de produto
3. Procure por bloco "Omafit embed"

**Se não encontrar:**
1. Clique em **Add block** ou **Add section**
2. Procure por **"Omafit embed"**
3. Adicione o bloco
4. **SALVE** (CTRL+S ou CMD+S) ← **IMPORTANTE!**
5. **Publique** o tema se necessário

**✅ Teste:**
- Abra uma página de produto na loja (não preview)
- Pressione F12 → Console
- Procure por: `🚀 Omafit: Iniciando widget...`

---

### 2. Widget Está Desabilitado no Banco (Muito Comum)

**Como verificar:**
Execute no Supabase SQL Editor:
```sql
SELECT shop_domain, is_active FROM widget_keys 
WHERE shop_domain = 'SUA-LOJA.myshopify.com';

SELECT shop_domain, widget_enabled FROM widget_configurations 
WHERE shop_domain = 'SUA-LOJA.myshopify.com';
```

**Se retornar `is_active = false` ou `widget_enabled = false`:**

Execute o script `habilitar_widget.sql` (substitua o shop_domain):
```sql
UPDATE widget_keys 
SET is_active = true, updated_at = NOW()
WHERE shop_domain = 'SUA-LOJA.myshopify.com';

UPDATE widget_configurations 
SET widget_enabled = true, updated_at = NOW()
WHERE shop_domain = 'SUA-LOJA.myshopify.com';
```

**✅ Teste:**
- Recarregue a página da loja (Ctrl+Shift+R)
- Console deve mostrar: `📊 Status do widget: { finalStatus: "✅ HABILITADO" }`

---

### 3. Tema Não Está Publicado

**Como verificar:**
1. Online Store > Themes
2. Veja qual tema está marcado como **"Published"**

**Se o tema com o bloco não está publicado:**
1. Clique nos 3 pontos (...) no tema com o bloco
2. Clique em **Publish**

**✅ Teste:**
- O tema publicado deve ter o bloco "Omafit embed"

---

### 4. Script Não Está Carregando

**Como verificar:**
1. Abra página de produto na loja
2. F12 → aba **Network**
3. Filtre por **"omafit"**
4. Procure por `omafit-widget.js`

**Se status 404:**
```bash
# Reinstalar tema
shopify app deploy
```

**✅ Teste:**
- Status deve ser **200**
- Arquivo `omafit-widget.js` deve aparecer

---

## 🔍 Diagnóstico Rápido no Console

**Abra uma página de produto e execute no Console (F12):**

```javascript
// 1. Verificar se script carregou
console.log('Script:', typeof window.openOmafitModal !== 'undefined' ? '✅' : '❌');

// 2. Verificar elemento root
const root = document.getElementById('omafit-widget-root');
console.log('Root:', root ? '✅' : '❌');
if (root) console.log('Shop domain:', root.dataset.shopDomain);

// 3. Verificar se link existe
const link = document.querySelector('.omafit-try-on-link');
console.log('Link:', link ? '✅' : '❌');

// 4. Verificar shop domain
console.log('Shop domain (Shopify):', window.Shopify?.shop);
```

**Interpretação:**
- **Script ❌**: Bloco não está no tema ou tema não instalado
- **Root ❌**: Bloco não está no tema
- **Link ❌**: Widget não foi inserido (pode estar desabilitado)
- **Shop domain ❌**: Pode causar problemas na busca de configuração

---

## ✅ Solução Passo a Passo (Tente nesta ordem)

### Passo 1: Verificar Bloco no Tema (2 minutos)
1. Online Store > Themes > Customize
2. Página de produto → Adicione bloco "Omafit embed" se não houver
3. **SALVE**

### Passo 2: Habilitar Widget no Banco (1 minuto)
1. Abra Supabase SQL Editor
2. Execute `habilitar_widget.sql` (substitua shop_domain)
3. Verifique resultado

### Passo 3: Verificar Tema Publicado (30 segundos)
1. Online Store > Themes
2. Certifique-se que tema com bloco está **Published**

### Passo 4: Limpar Cache (30 segundos)
1. Pressione **Ctrl+Shift+R** (Windows/Linux) ou **Cmd+Shift+R** (Mac)
2. Ou limpe cache do navegador completamente

### Passo 5: Testar (1 minuto)
1. Abra página de produto na loja (não preview)
2. F12 → Console
3. Procure por mensagens do Omafit
4. Verifique se link aparece na página

---

## 🚨 Se Ainda Não Funcionar

### Execute o Script de Diagnóstico Completo

Cole este código no **Console do navegador** (F12):

```javascript
// Copie todo o conteúdo do arquivo teste_widget_console.js e cole aqui
```

Ou execute diretamente:
```javascript
// Verificar tudo
console.log('=== DIAGNÓSTICO ===');
console.log('Script:', typeof window.openOmafitModal !== 'undefined' ? '✅' : '❌');
console.log('Root:', document.getElementById('omafit-widget-root') ? '✅' : '❌');
console.log('Link:', document.querySelector('.omafit-try-on-link') ? '✅' : '❌');
console.log('Shop domain:', window.Shopify?.shop || 'NÃO ENCONTRADO');
console.log('Botão carrinho:', document.querySelector('button[name="add"]') ? '✅' : '❌');

// Tentar inicializar manualmente
if (typeof initOmafit === 'function') {
  console.log('Tentando inicializar...');
  initOmafit();
}
```

---

## 📋 Checklist Final

Antes de pedir ajuda, verifique:

- [ ] Bloco "Omafit embed" está no tema
- [ ] Tema está publicado
- [ ] Bloco está salvo no tema
- [ ] `is_active = true` em `widget_keys`
- [ ] `widget_enabled = true` em `widget_configurations`
- [ ] Script `omafit-widget.js` carrega (status 200)
- [ ] Console mostra mensagens do Omafit
- [ ] Página de produto real (não preview)
- [ ] Cache limpo

**Se todos estiverem ✅ mas widget não aparece:**
- Verifique console para erros específicos
- Verifique se há erros de CORS ou credenciais
- Verifique se shop domain está correto no banco

---

## 💡 Dica Pro

**O problema mais comum é:**
1. Bloco não foi salvo no tema (esqueceu de clicar em "Save")
2. Widget está desabilitado no banco (`is_active = false`)

**Comece por esses 2 pontos!**
