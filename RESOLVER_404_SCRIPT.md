# Resolver: Script 404 (Script Não Encontrado)

## 🔍 Problema Identificado

O arquivo `omafit-widget.js` está retornando **404**, o que significa que:
- ✅ O arquivo existe no código local
- ❌ O arquivo NÃO está no tema publicado
- ❌ O tema extension não foi deployado corretamente

## ✅ Solução: Reinstalar Tema Extension

### Opção 1: Usando CLI (Recomendado)

```bash
# 1. Verificar se está no diretório correto
cd /caminho/para/omafit

# 2. Verificar extensões instaladas
shopify app info

# 3. Fazer deploy da extensão do tema
shopify app deploy

# Ou especificamente para tema extension:
shopify app generate extension --template=theme
# (Não execute isso, é só para referência)
```

### Opção 2: Via Shopify Partners (Alternativa)

1. Acesse **Shopify Partners** → Seu App
2. Vá para **Extensions**
3. Encontre **omafit-theme**
4. Clique em **Reinstall** ou **Update**

### Opção 3: Verificar se Tema Está Conectado

```bash
# Verificar extensões instaladas
shopify app info

# Verificar especificamente o tema extension
shopify app list extensions
```

## 🔧 Passo a Passo Completo

### 1. Verificar Estrutura Local (Confirmar que arquivo existe)

```bash
# Verificar se arquivo existe
ls extensions/omafit-theme/assets/omafit-widget.js

# Deve retornar o arquivo
```

### 2. Limpar Build Anterior (Opcional mas recomendado)

```bash
# Remover node_modules e reinstalar (se necessário)
rm -rf node_modules
npm install

# Ou apenas limpar cache
rm -rf .shopify
```

### 3. Fazer Deploy do Tema

```bash
# Deploy completo do app
shopify app deploy

# Isso deve incluir todas as extensões, incluindo o tema
```

### 4. Verificar Deploy

Após o deploy, verifique:

1. **No Shopify Admin:**
   - Online Store > Themes
   - Verifique se há notificação de atualização do tema

2. **No Console do Navegador:**
   - Abra página de produto
   - F12 → Network
   - Recarregue (Ctrl+R)
   - Procure por `omafit-widget.js`
   - Deve retornar **200** (não mais 404)

### 5. Verificar se Bloco Está Ativo

1. Online Store > Themes > Customize
2. Página de produto
3. Verifique se bloco "Omafit embed" está lá
4. Se não estiver, adicione e **SALVE**

## 🚨 Se Ainda Der 404 Após Deploy

### Verificar 1: Arquivo está sendo incluído no build?

```bash
# Verificar estrutura do build (se houver)
ls -la extensions/omafit-theme/assets/

# Verificar se arquivo não está muito grande (> 1MB pode causar problemas)
du -h extensions/omafit-theme/assets/omafit-widget.js
```

### Verificar 2: Tema Extension está registrado?

Execute e me mostre o resultado:
```bash
shopify app info
```

### Verificar 3: Tentar criar tema extension do zero (Último recurso)

Se nada funcionar, pode ser necessário recriar o tema extension:

1. **Backup do arquivo atual:**
   ```bash
   cp extensions/omafit-theme/assets/omafit-widget.js omafit-widget.js.backup
   ```

2. **Remover tema extension antigo:**
   - No Shopify Partners, remova o tema extension
   - Ou via CLI: `shopify app generate extension --template=theme` (cria novo)

3. **Recriar tema extension:**
   - Copie arquivos de volta
   - Faça deploy novamente

## 💡 Dica Pro

**O erro 404 geralmente acontece quando:**
1. ✅ Tema extension foi criado mas não foi deployado
2. ✅ Deploy foi feito mas arquivo não foi incluído
3. ✅ Tema extension foi desinstalado/reinstalado mas arquivo não foi incluído

**Solução mais comum:**
- Executar `shopify app deploy` resolve 90% dos casos

## ✅ Após Resolver 404

Quando o script carregar corretamente (status 200), você deve ver no console:

```
✅ Script omafit-widget.js carregado e executando...
🚀 Omafit: Iniciando widget...
🔍 Shop domain detectado: sua-loja.myshopify.com
...
```

Se aparecer essas mensagens, o script está funcionando! 🎉
