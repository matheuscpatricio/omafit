# Diagnóstico Completo: Widget Não Aparece

## 🔍 Checklist Passo a Passo

### Passo 1: Verificar Console do Navegador (CRÍTICO)

1. **Abra uma página de produto na loja**
2. **Pressione F12** → aba **Console**
3. **Procure por mensagens do Omafit**

#### ✅ Mensagens Esperadas (Tudo OK):
```
🚀 Omafit: Iniciando widget...
🚀 Inicializando Omafit...
🔍 Shop domain detectado: sua-loja.myshopify.com
✅ PublicId válido obtido de widget_keys: wgt_pub_xxx
✅ Configuração do Omafit carregada do banco
📊 Status do widget: { finalStatus: "✅ HABILITADO" }
✅ Botão encontrado com seletor: button[name="add"]
✅ Widget inserido após botão de carrinho
✅ Omafit inicializado com sucesso
```

#### ❌ Mensagens de Problema:

**Se aparecer:**
```
⚠️ Widget Omafit está desabilitado
📊 Status do widget: { finalStatus: "❌ DESABILITADO" }
```
**Solução:** Execute o script `habilitar_widget.sql` no Supabase

**Se aparecer:**
```
⚠️ Shop domain não encontrado
```
**Solução:** Verifique se está em uma página de produto real (não preview)

**Se aparecer:**
```
❌ Falha ao carregar configuração do Omafit
```
**Solução:** Verifique credenciais do Supabase no código do widget

**Se NÃO aparecer NENHUMA mensagem do Omafit:**
**Solução:** O script não está carregando → Ver Passo 2

---

### Passo 2: Verificar se Script Está Carregando

1. No **DevTools**, vá na aba **Network**
2. Recarregue a página (Ctrl+R ou Cmd+R)
3. Filtre por **"omafit"** ou procure por **`omafit-widget.js`**
4. Verifique:
   - ✅ Status: **200** → Script está carregando
   - ❌ Status: **404** → Script não encontrado (tema não instalado)
   - ❌ Status: **403** → Problema de permissões

**Se status 404:**
```bash
# Reinstalar tema
shopify app deploy
```

---

### Passo 3: Verificar Bloco no Editor de Tema

1. Acesse **Online Store > Themes**
2. Clique em **Customize** no tema publicado
3. Vá para uma **página de produto**
4. Verifique se há bloco **"Omafit embed"**

**Se não houver:**
1. Clique em **Add block** ou **Add section**
2. Procure por **"Omafit embed"**
3. Adicione o bloco
4. **Salve** (CTRL+S ou CMD+S)
5. **Publicar** o tema se necessário

**Verificar também:**
- O bloco está **habilitado** (não desativado)
- O bloco está na **página de produto** (não em outras páginas)

---

### Passo 4: Verificar Configuração no Banco

Execute no **Supabase SQL Editor**:

```sql
-- Verificar widget_keys
SELECT shop_domain, is_active, public_id 
FROM widget_keys 
WHERE shop_domain = 'SUA-LOJA.myshopify.com';

-- Verificar widget_configurations
SELECT shop_domain, widget_enabled, link_text 
FROM widget_configurations 
WHERE shop_domain = 'SUA-LOJA.myshopify.com';
```

**Deve retornar:**
- `is_active = true` ✅
- `widget_enabled = true` ✅ (ou NULL, que é tratado como true)
- `public_id` não nulo ✅

**Se não retornar nada ou estiver false:**
```sql
-- Execute o script habilitar_widget.sql
```

---

### Passo 5: Teste Manual no Console

Execute este código no **Console do navegador** (F12):

```javascript
// 1. Verificar se script está carregado
console.log('Script carregado:', typeof window.openOmafitModal !== 'undefined');

// 2. Verificar elemento root
const root = document.getElementById('omafit-widget-root');
console.log('Root element:', root);
console.log('Shop domain (root):', root?.dataset?.shopDomain);

// 3. Verificar shop domain do Shopify
console.log('Shop domain (Shopify):', window.Shopify?.shop);

// 4. Tentar inicializar manualmente
if (typeof initOmafit === 'function') {
  console.log('Tentando inicializar manualmente...');
  initOmafit().then(() => {
    console.log('Inicialização concluída');
  }).catch(err => {
    console.error('Erro ao inicializar:', err);
  });
} else {
  console.error('initOmafit não está disponível');
}

// 5. Verificar se link já existe
const existingLink = document.querySelector('.omafit-try-on-link');
console.log('Link já existe:', !!existingLink);
if (existingLink) {
  console.log('Link encontrado:', existingLink);
}
```

---

### Passo 6: Verificar Problemas Comuns

#### Problema: Botão "Adicionar ao carrinho" não encontrado

**Verificar no Console:**
```
⚠️ Omafit: botão "Adicionar ao carrinho" não encontrado
```

**Solução:**
1. Verifique qual seletor o tema usa para o botão
2. O widget tenta vários seletores automaticamente
3. Se nenhum funcionar, pode ser necessário adicionar um seletor customizado

#### Problema: Widget aparece mas não funciona

**Verificar:**
- Se o `public_id` está correto
- Se há erros ao clicar no link
- Se o modal abre corretamente

#### Problema: Script carrega mas widget não aparece

**Verificar:**
- Se `widget_enabled = true` em `widget_configurations`
- Se `is_active = true` em `widget_keys`
- Se o shop domain está correto

---

### Passo 7: Solução Rápida (Se Nada Funcionar)

1. **Execute o script SQL:**
   ```sql
   -- Usar habilitar_widget.sql (substituir shop_domain)
   ```

2. **Reinstalar tema:**
   ```bash
   shopify app deploy
   ```

3. **Limpar cache completamente:**
   - Pressione **Ctrl+Shift+R** (Windows/Linux)
   - Pressione **Cmd+Shift+R** (Mac)
   - Ou limpar cache do navegador completamente

4. **Verificar se tema está publicado:**
   - Online Store > Themes
   - Certifique-se que o tema com o bloco está **published**

5. **Testar em modo anônimo/incógnito:**
   - Abra uma janela anônima
   - Acesse a página de produto
   - Verifique se o widget aparece

---

## 📋 Checklist Rápido

- [ ] Console mostra mensagens do Omafit
- [ ] Script `omafit-widget.js` carrega (status 200)
- [ ] Bloco "Omafit embed" está no tema
- [ ] Bloco está habilitado e salvo
- [ ] Tema está publicado
- [ ] `is_active = true` em `widget_keys`
- [ ] `widget_enabled = true` em `widget_configurations`
- [ ] Shop domain está correto
- [ ] Página de produto real (não preview)
- [ ] Cache limpo

---

## 🔧 Comandos Úteis

### Reinstalar tema:
```bash
shopify app deploy
```

### Verificar tema instalado:
```bash
shopify app info
```

### Ver logs em desenvolvimento:
```bash
shopify app dev
```

---

## 💡 Dica Final

**99% dos problemas são causados por:**
1. Bloco não adicionado ao tema
2. Tema não publicado
3. `is_active = false` ou `widget_enabled = false` no banco

**Comece verificando esses 3 pontos primeiro!**
