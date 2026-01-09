# Solução Rápida: Widget Não Aparece

## Passo 1: Verificar Console (5 minutos)

1. Abra uma página de produto na loja
2. Pressione **F12** → aba **Console**
3. Procure por estas mensagens:

### ✅ Se aparecer isso, está OK:
```
🚀 Omafit: Iniciando widget...
🔍 Shop domain detectado: sua-loja.myshopify.com
📊 Status do widget: { finalStatus: "✅ HABILITADO" }
✅ Widget inserido após botão de carrinho
```

### ❌ Se aparecer isso, execute o Passo 2:
```
⚠️ Widget Omafit está desabilitado
📊 Status do widget: { finalStatus: "❌ DESABILITADO" }
```

### ❌ Se NÃO aparecer NENHUMA mensagem:
- Execute o Passo 3 (reinstalar tema)

---

## Passo 2: Habilitar Widget no Banco (2 minutos)

Execute este SQL no Supabase (substitua o shop_domain):

```sql
-- Habilitar widget
UPDATE widget_keys 
SET is_active = true, updated_at = NOW()
WHERE shop_domain = 'SUA-LOJA.myshopify.com';

UPDATE widget_configurations 
SET widget_enabled = true, updated_at = NOW()
WHERE shop_domain = 'SUA-LOJA.myshopify.com';

-- Verificar
SELECT shop_domain, is_active FROM widget_keys WHERE shop_domain = 'SUA-LOJA.myshopify.com';
SELECT shop_domain, widget_enabled FROM widget_configurations WHERE shop_domain = 'SUA-LOJA.myshopify.com';
```

Depois, recarregue a página da loja (Ctrl+Shift+R).

---

## Passo 3: Reinstalar Tema (se necessário)

```bash
shopify app deploy
```

---

## Passo 4: Verificar Bloco no Tema

1. **Online Store > Themes > Customize**
2. Vá para uma página de produto
3. Verifique se há bloco **"Omafit embed"**
4. Se não houver, adicione: **Add block → "Omafit embed"**
5. Salve

---

## Se Nada Funcionar

1. Execute o script completo `habilitar_widget.sql`
2. Verifique se o tema está **publicado** (não apenas instalado)
3. Limpe cache do navegador completamente
4. Verifique se está em uma página de produto real (não preview)
