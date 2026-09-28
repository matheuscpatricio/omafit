# Teste: Script Não Está Carregando

## Problema
Se o bloco está ativo e widget habilitado, mas **não aparece nada no console**, significa que o script `omafit-widget.js` **não está sendo carregado ou executado**.

## ✅ Correções Aplicadas

1. **Removido `async` do script** - Pode estar causando problemas de timing
2. **Adicionado log imediato** - Agora o primeiro log aparece assim que o script carrega

## 🔍 Como Verificar Agora

### Passo 1: Verificar se Script Está Carregando (CRÍTICO)

1. Abra uma página de produto na loja
2. F12 → aba **Network**
3. Recarregue a página (Ctrl+R)
4. Filtre por **"omafit"** ou procure por **`omafit-widget.js`**

**Verificar:**
- ✅ Status: **200** → Script está sendo carregado
- ❌ Status: **404** → Script não encontrado (problema no tema)
- ❌ Status: **403** → Problema de permissões

**Se status 404:**
- O tema precisa ser reinstalado
- Execute: `shopify app deploy`

### Passo 2: Verificar Console (Após Correção)

Após fazer o deploy, você deve ver **IMEDIATAMENTE** no console:
```
✅ Script omafit-widget.js carregado e executando...
🚀 Omafit: Iniciando widget...
```

**Se aparecer:**
- ✅ O script está funcionando
- Continue acompanhando os logs

**Se NÃO aparecer:**
- ❌ O script não está sendo carregado
- Verifique aba Network (Passo 1)
- Reinstale o tema: `shopify app deploy`

### Passo 3: Verificar HTML da Página

1. F12 → aba **Elements** (ou **Elements**)
2. Ctrl+F → procure por **`omafit-widget`**

**Deve encontrar:**
```html
<div id="omafit-widget-root" data-shop-domain="..."></div>
<script src="...omafit-widget.js"></script>
```

**Se não encontrar:**
- O bloco não está sendo renderizado
- Verifique se o bloco está salvo no tema

### Passo 4: Teste Manual no Console

Execute no Console (F12):

```javascript
// 1. Verificar se elemento root existe
const root = document.getElementById('omafit-widget-root');
console.log('Root element:', root ? '✅ EXISTE' : '❌ NÃO EXISTE');
if (root) {
  console.log('Shop domain (root):', root.dataset.shopDomain);
}

// 2. Verificar se script foi carregado (verificar se funções existem)
console.log('openOmafitModal:', typeof window.openOmafitModal !== 'undefined' ? '✅' : '❌');

// 3. Tentar carregar script manualmente (se não carregou)
if (!document.querySelector('script[src*="omafit-widget.js"]')) {
  console.error('❌ Script omafit-widget.js não encontrado no HTML!');
} else {
  console.log('✅ Script tag encontrada no HTML');
  const scriptTag = document.querySelector('script[src*="omafit-widget.js"]');
  console.log('Script src:', scriptTag.src);
}
```

## 🚨 Se Script Não Está Carregando

### Causa 1: Tema Não Foi Publicado/Deployado

**Solução:**
```bash
# Reinstalar tema
shopify app deploy
```

### Causa 2: Bloco Não Está Salvo

**Solução:**
1. Online Store > Themes > Customize
2. Vá para página de produto
3. Verifique se bloco "Omafit embed" está lá
4. **SALVE** (CTRL+S ou CMD+S)
5. **Publique** o tema se necessário

### Causa 3: Tema Personalizado Não Tem o Bloco

**Solução:**
1. Certifique-se que está editando o **tema publicado**
2. Se o tema é customizado, pode precisar adicionar manualmente
3. Ou usar o tema padrão para testar

### Causa 4: Cache do Navegador

**Solução:**
1. Pressione **Ctrl+Shift+R** (Windows/Linux) ou **Cmd+Shift+R** (Mac)
2. Ou limpe cache completamente
3. Ou teste em modo anônimo/incógnito

## ✅ Próximos Passos

1. **Faça o deploy das alterações:**
   ```bash
   shopify app deploy
   ```

2. **Verifique Network tab:**
   - Procure por `omafit-widget.js`
   - Status deve ser **200**

3. **Verifique Console:**
   - Deve aparecer: `✅ Script omafit-widget.js carregado e executando...`

4. **Me diga o resultado:**
   - O que aparece no Network tab?
   - O que aparece no Console?
