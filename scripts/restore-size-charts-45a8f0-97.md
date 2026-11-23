# Restore cirúrgico — `45a8f0-97.myshopify.com`

## Não fazer

**Não** correr PITR / restore in-place no projeto `lhkgnirolvbmomeduoaj` (Omafit produção).
Isso rebobina **toda** a base (billing, AR, outras lojas, etc.) para o instante escolhido.

Wipe das medidas desta loja: `2026-08-02 22:12:40 UTC`.

## Fazer (opção 1 segura)

### 1) Restore para projeto novo

1. Abre [Database → Backups → Restore to a New Project](https://supabase.com/dashboard/project/lhkgnirolvbmomeduoaj/database/backups/restore-to-new-project)
2. Se tiveres **PITR** ativo: escolhe **antes** de `2026-08-02 22:12:00 UTC` (ex. `22:00:00`).
3. Se só tiveres **daily backups**: escolhe o backup diário **mais recente antes** desse wipe (ex. madrugada de 2 Aug ou 1 Aug).
4. Confirma custos e cria o clone. Anota o **project ref** do clone.

### 2) Validar no clone

No SQL Editor do **clone**:

```sql
SELECT count(*) AS total,
  count(*) FILTER (WHERE sizes::text ~ '[0-9]') AS with_digit,
  max(updated_at) AS max_upd
FROM size_charts
WHERE shop_domain = '45a8f0-97.myshopify.com';
```

Esperado: `with_digit` bem maior que ~110 e `max_upd` **antes** de `2026-08-02 22:12`.

### 3) Exportar do clone

```sql
COPY (
  SELECT id, shop_domain, collection_handle, product_handle, gender,
         collection_type, collection_elasticity, gender_scope,
         measurement_refs, sizes, created_at, updated_at
  FROM size_charts
  WHERE shop_domain = '45a8f0-97.myshopify.com'
) TO STDOUT WITH (FORMAT csv, HEADER true);
```

Ou no Table Editor → export CSV/JSON dessa loja.

### 4) Merge em produção (só esta loja)

No SQL Editor de **produção** (`lhkgnirolvbmomeduoaj`), com o dump do clone:

1. Backup rápido do estado atual (opcional):

```sql
CREATE TABLE IF NOT EXISTS size_charts_backup_45a8f0_20260803 AS
SELECT * FROM size_charts
WHERE shop_domain = '45a8f0-97.myshopify.com';
```

2. Upsert das linhas do clone (preferir via script/`psql` ou pedir ao agente para aplicar com o JSON/CSV).
   Chave natural: `(shop_domain, collection_handle, product_handle, gender)`.
   O trigger `trigger_sync_size_chart_entries` atualiza `size_chart_entries`.

3. Verificar:

```sql
SELECT count(*) AS total,
  count(*) FILTER (WHERE sizes::text ~ '[0-9]') AS with_digit
FROM size_charts
WHERE shop_domain = '45a8f0-97.myshopify.com';
```

### 5) Depois

- Apagar o projeto clone (para não pagar compute extra).
- Smoke: widget na loja + guardar uma tabela no admin.
- Garantir `SUPABASE_SERVICE_ROLE_KEY` no Railway e `/api/size-charts` deployado.
- Aplicar `supabase_fix_size_charts_rls_secure.sql` (SELECT anon; writes só service_role).
