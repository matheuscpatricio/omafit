# Correção: Dados Não Persistem Entre Páginas

## Problema Reportado
Os dados salvos em `app.widget.jsx` e `app.size-chart.jsx` desaparecem quando:
- Navega para outra página
- Fica algum tempo sem entrar no app

## Causas Identificadas

### 1. UPSERT Não Funcionando Corretamente
- O método POST com `Prefer: resolution=merge-duplicates` só funciona se houver constraint única
- Quando `configId` existe, deveria usar PATCH ao invés de POST
- Não estava recarregando os dados após salvar

### 2. shop_domain Não Codificado
- `shop_domain` pode conter caracteres especiais que precisam ser codificados
- Falta de `encodeURIComponent` nas queries

### 3. Falta de Logs
- Difícil debugar sem logs mostrando o que está acontecendo

## Correções Implementadas

### 1. ✅ Melhorias em `app.widget.jsx`

#### Salvamento Inteligente
- **Se `configId` existe**: Usa PATCH para atualizar registro existente
- **Se `configId` não existe**: Usa POST com UPSERT
- **Após salvar**: Recarrega configuração para garantir que `configId` está salvo

#### Logs Detalhados
```javascript
console.log('[Widget] Salvando configuração para shop_domain:', shopDomain);
console.log('[Widget] ConfigId atual:', configId);
console.log('[Widget] Resposta do salvamento:', response.status);
```

#### Codificação de URL
```javascript
// Antes
`?shop_domain=eq.${shopDomain}`

// Depois
`?shop_domain=eq.${encodeURIComponent(shopDomain)}`
```

#### Recarregamento Automático
- Após salvar com sucesso, recarrega a configuração
- Garante que `configId` está sempre atualizado

### 2. ✅ Melhorias em `app.size-chart.jsx`

#### Processo de Salvamento
1. **Deleta** todas as tabelas antigas do `shop_domain`
2. **Insere** novas tabelas habilitadas
3. **Recarrega** após salvar para garantir dados atualizados

#### Logs Detalhados
```javascript
console.log('[SizeChart] Salvando tabelas para shop_domain:', shopDomain);
console.log('[SizeChart] Tabelas para salvar:', chartsToSave.length);
console.log('[SizeChart] Tabelas salvas com sucesso');
```

#### Codificação de URL
- Adicionado `encodeURIComponent` em todas as queries

### 3. ✅ Dependências do useEffect
- Adicionado `shopDomain` como dependência do `useEffect`
- Garante que dados são recarregados se `shopDomain` mudar

## Como Verificar se Está Funcionando

### 1. Abrir Console (F12)
Você deve ver logs como:
```
[Widget] Componente montado, shop_domain: sua-loja.myshopify.com
[Widget] Carregando configuração para shop_domain: sua-loja.myshopify.com
[Widget] Salvando configuração para shop_domain: sua-loja.myshopify.com
[Widget] ConfigId atual: abc123...
[Widget] Resposta do salvamento: 200
[Widget] ConfigId salvo: abc123...
```

### 2. Testar Persistência
1. Salvar configuração em `app.widget.jsx`
2. Navegar para outra página (ex: Dashboard)
3. Voltar para `app.widget.jsx`
4. **Verificar**: Dados devem estar lá

### 3. Verificar no Supabase
1. Abrir Supabase Dashboard
2. Ir para tabela `widget_configurations`
3. Verificar se existe registro com `shop_domain` correto
4. Verificar se `link_text`, `store_logo`, `primary_color` estão salvos

## Possíveis Problemas Restantes

### 1. Constraint Única Não Existe
Se ainda não funcionar, execute no Supabase:
```sql
-- Verificar se constraint existe
SELECT 
    conname AS constraint_name,
    contype AS constraint_type
FROM pg_constraint
WHERE conrelid = 'widget_configurations'::regclass
AND contype = 'u'
AND conname LIKE '%shop_domain%';

-- Se não existir, criar:
ALTER TABLE widget_configurations
ADD CONSTRAINT widget_configurations_shop_domain_unique 
UNIQUE (shop_domain);
```

### 2. RLS Bloqueando Escrita
Verificar políticas RLS:
```sql
-- Ver políticas existentes
SELECT * FROM pg_policies 
WHERE tablename = 'widget_configurations';

-- Se necessário, criar política permissiva
DROP POLICY IF EXISTS "Allow public read/write on widget_configurations" ON widget_configurations;
CREATE POLICY "Allow public read/write on widget_configurations"
ON widget_configurations
FOR ALL
USING (true)
WITH CHECK (true);
```

### 3. shop_domain Mudando Entre Páginas
Verificar se `shop` está sendo passado corretamente nas URLs:
- Links de navegação devem incluir `?shop=${shopDomain}`
- Verificar `app.jsx` para ver como links são construídos

## Próximos Passos

1. **Testar salvamento** em `app.widget.jsx`
2. **Navegar para outra página** e voltar
3. **Verificar logs** no console
4. **Verificar no Supabase** se dados estão salvos
5. Se ainda não funcionar, **executar scripts SQL** acima

## Arquivos Modificados

1. `app/routes/app.widget.jsx`
   - Salvamento inteligente (PATCH vs POST)
   - Logs detalhados
   - Codificação de URL
   - Recarregamento automático

2. `app/routes/app.size-chart.jsx`
   - Processo de salvamento melhorado
   - Logs detalhados
   - Codificação de URL
   - Recarregamento automático










