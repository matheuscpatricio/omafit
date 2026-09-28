# Diagnóstico: Widget Omafit Não Aparece

## Checklist de Verificação

### 1. Verificar Console do Navegador (IMPORTANTE)

Abra uma página de produto na loja e pressione **F12** para abrir o DevTools. Vá na aba **Console** e verifique:

#### Mensagens Esperadas (se tudo estiver OK):
```
🚀 Omafit: Iniciando widget...
🚀 Inicializando Omafit...
🔍 Shop domain detectado: sua-loja.myshopify.com
✅ PublicId válido obtido de widget_keys: wgt_pub_xxx
✅ Configuração do Omafit carregada do banco
📊 Status do widget: { widgetEnabled: true, isActive: true, finalStatus: "✅ HABILITADO" }
✅ Configuração carregada: {...}
✅ Botão encontrado com seletor: ...
✅ Widget inserido após botão de carrinho
✅ Omafit inicializado com sucesso
```

#### Mensagens de Erro Comuns:

**Se aparecer:**
```
⚠️ Shop domain não encontrado
```
**Solução:** Verifique se você está acessando uma página de produto real (não preview/editor)

**Se aparecer:**
```
⚠️ Widget encontrado mas não está ativo. is_active: false
📊 Status do widget: { finalStatus: "❌ DESABILITADO" }
⚠️ Widget Omafit está desabilitado
```
**Solução:** Execute o script `supabase/patches/supabase_reactivate_shop.sql` para reativar a loja

**Se aparecer:**
```
⚠️ Não foi possível buscar configuração do Supabase. Status: 401
```
**Solução:** Verifique se as credenciais do Supabase estão corretas no código do widget

**Se NÃO aparecer NENHUMA mensagem do Omafit:**
**Solução:** O script não está carregando. Verifique os passos abaixo.

---

### 2. Verificar se o Script está Carregando

1. No DevTools, vá na aba **Network**
2. Recarregue a página (Ctrl+R ou Cmd+R)
3. Filtre por "omafit"
4. Procure por `omafit-widget.js`
5. Verifique:
   - ✅ Status: **200** (OK)
   - ❌ Status: **404** (arquivo não encontrado) → Tema não está instalado
   - ❌ Status: **403** (sem permissão) → Problema de permissões

**Se o arquivo não aparecer:**
- Execute: `shopify app deploy` para reinstalar o tema

---

### 3. Verificar Bloco no Editor de Tema

1. Acesse **Online Store > Themes**
2. Clique em **Customize** no tema publicado
3. Vá para uma página de produto
4. Verifique se há um bloco/seção **"Omafit embed"**
5. Se não houver:
   - Clique em **Add block** ou **Add section**
   - Procure por **"Omafit embed"**
   - Adicione o bloco
   - Salve

---

### 4. Verificar Configuração no Banco de Dados

Execute estas queries no Supabase SQL Editor:

#### Verificar widget_keys:
```sql
SELECT shop_domain, is_active, public_id 
FROM widget_keys 
WHERE shop_domain = 'SUA-LOJA.myshopify.com';
```

**Deve retornar:**
- `is_active = true` ✅
- `public_id` não nulo ✅

#### Verificar widget_configurations:
```sql
SELECT shop_domain, widget_enabled, link_text 
FROM widget_configurations 
WHERE shop_domain = 'SUA-LOJA.myshopify.com';
```

**Deve retornar:**
- `widget_enabled = true` ✅ (ou NULL, que é tratado como true)

---

### 5. Problemas Comuns e Soluções

#### Problema: Script carrega mas link não aparece

**Causa possível:** Botão "Adicionar ao carrinho" não encontrado

**Verificar no Console:**
```
⚠️ Omafit: botão "Adicionar ao carrinho" não encontrado
```

**Solução:**
1. Verifique qual seletor o tema usa para o botão de carrinho
2. Pode ser necessário adicionar mais seletores em `addToCartSelectors` no código

#### Problema: Widget aparece mas não funciona

**Verificar:**
- Se o `public_id` está correto
- Se `is_active = true` em `widget_keys`
- Se há erros ao abrir o modal

#### Problema: Nenhuma mensagem aparece no console

**Causa:** Script não está sendo executado

**Soluções:**
1. Verificar se o bloco está adicionado ao tema
2. Verificar se o tema está publicado (não apenas instalado)
3. Reinstalar tema: `shopify app deploy`
4. Limpar cache do navegador (Ctrl+Shift+R)

---

### 6. Comandos Úteis

#### Reinstalar tema:
```bash
shopify app deploy
```

#### Verificar se tema está instalado:
```bash
shopify app info
```

#### Testar localmente:
```bash
shopify app dev
```

---

### 7. Query SQL para Habilitar Widget Rapidamente

```sql
-- Habilitar widget para uma loja específica
UPDATE widget_keys 
SET is_active = true, updated_at = NOW()
WHERE shop_domain = 'SUA-LOJA.myshopify.com';

UPDATE widget_configurations 
SET widget_enabled = true, updated_at = NOW()
WHERE shop_domain = 'SUA-LOJA.myshopify.com';
```

---

### 8. Debug Manual no Console

Se nada funcionar, execute manualmente no Console do navegador:

```javascript
// Verificar se o script está carregado
console.log('Script carregado:', typeof window.openOmafitModal);

// Verificar shop domain
console.log('Shop domain:', window.Shopify?.shop || 'não encontrado');

// Tentar inicializar manualmente
if (typeof initOmafit === 'function') {
  initOmafit();
} else {
  console.error('initOmafit não está disponível');
}

// Verificar elemento root
const root = document.getElementById('omafit-widget-root');
console.log('Root element:', root);
```

---

## Próximos Passos

1. Execute o checklist acima na ordem
2. Anote quais mensagens aparecem no console
3. Se encontrar um problema específico, consulte a seção correspondente
4. Se nada funcionar, execute o script SQL de reativação
