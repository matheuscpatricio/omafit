# Diagnóstico: Logo Não Está Sendo Salvo

## 🔍 Verificações Após Fazer Upload

Após fazer upload de um logo, abra o **Console do navegador (F12)** e verifique as seguintes mensagens:

### 1. Upload do Arquivo

Deve aparecer:
```
[Widget] Fazendo upload do logo no Supabase Storage: Video banner/widget-logos/...
[Widget] Resposta do upload: { status: 200, ok: true, ... }
[Widget] ✅ Logo enviado com sucesso!
```

**Se status for diferente de 200:**
- ❌ Upload falhou
- Verifique políticas RLS do Storage
- Verifique se bucket está público

### 2. URL Pública Gerada

Deve aparecer:
```
[Widget] URL pública gerada: https://...supabase.co/storage/v1/object/public/Video%20banner/widget-logos/...
[Widget] Teste de acesso à URL: 200 ✅ Acessível
```

**Se URL não estiver acessível:**
- Verifique se o arquivo realmente foi criado no Storage
- Verifique se o bucket está público
- Verifique se a URL está correta

### 3. Salvamento no Banco

Deve aparecer:
```
[Widget] Salvando URL no banco de dados...
[Widget] Payload a ser enviado: { shop_domain: '...', store_logo: 'https://...', ... }
[Widget] ✅ Resposta do salvamento recebida: { status: 200, ok: true, ... }
[Widget] ✅ URL salva no banco com sucesso!
```

**Se status for diferente de 200:**
- ❌ Salvamento no banco falhou
- Verifique se `widget_configurations` existe
- Verifique políticas RLS da tabela
- Verifique se `shop_domain` está correto

## 🚨 Problemas Comuns

### Problema 1: Upload funciona mas URL não salva

**Sintomas:**
- Status 200 no upload
- URL pública gerada corretamente
- Erro no salvamento no banco

**Solução:**
1. Verifique se a tabela `widget_configurations` existe
2. Verifique se tem políticas RLS que permitem INSERT/UPDATE
3. Verifique o `shop_domain` no payload

### Problema 2: Upload funciona mas logo não aparece

**Sintomas:**
- Upload OK
- Salvamento OK
- Logo não aparece na tela

**Solução:**
1. Recarregue a página (Ctrl+R)
2. Verifique se a URL está salva no banco:
   ```sql
   SELECT shop_domain, store_logo 
   FROM widget_configurations 
   WHERE shop_domain = 'SUA-LOJA.myshopify.com';
   ```
3. Verifique se a URL está acessível (abra no navegador)

### Problema 3: Nada aparece no console

**Solução:**
1. Verifique se há erros JavaScript (aba Console)
2. Verifique se o upload está sendo executado (colocar breakpoint)
3. Limpe cache do navegador

## ✅ Teste Manual

Execute no Console (F12) após fazer upload:

```javascript
// Verificar se estado local foi atualizado
console.log('Estado local:', window.React?.state); // Não funciona diretamente, mas pode tentar

// Verificar se URL foi salva no banco
fetch('https://lhkgnirolvbmomeduoaj.supabase.co/rest/v1/widget_configurations?shop_domain=eq.SUA-LOJA.myshopify.com&select=store_logo', {
  headers: {
    'apikey': 'SUA_ANON_KEY',
    'Authorization': 'Bearer SUA_ANON_KEY'
  }
})
.then(r => r.json())
.then(data => {
  console.log('URL no banco:', data[0]?.store_logo || 'NÃO ENCONTRADA');
});
```

## 📋 Checklist

Após fazer upload, verifique:

- [ ] Upload retornou status 200
- [ ] URL pública foi gerada
- [ ] URL é acessível (teste HEAD retornou 200)
- [ ] Payload foi enviado com `store_logo` preenchido
- [ ] Salvamento retornou status 200
- [ ] URL está salva no banco de dados
- [ ] Logo aparece na interface após recarregar

## 🔧 Se Nada Funcionar

1. **Verifique o banco diretamente:**
   ```sql
   SELECT * FROM widget_configurations 
   WHERE shop_domain = 'SUA-LOJA.myshopify.com';
   ```

2. **Verifique se o arquivo está no Storage:**
   - Supabase Dashboard → Storage → Video banner → widget-logos
   - Verifique se o arquivo aparece lá

3. **Teste upload manual:**
   - Tente fazer upload de um arquivo menor
   - Verifique se o tipo de arquivo está correto
   - Verifique se não excede 2MB

## 💡 Dica

**Com os logs adicionados, você pode ver exatamente onde o processo está falhando.** 

Faça upload novamente e me diga:
1. O que aparece no console (copie as mensagens)
2. Se a URL é acessível (teste no navegador)
3. Se a URL está no banco de dados

Com essas informações, posso identificar exatamente o problema!
