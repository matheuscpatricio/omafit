# Supabase (Omafit app)

Este diretório concentra SQL operacional, Edge Functions e notas sobre o schema.
**O estado dos ficheiros neste repo não garante o estado do projeto Supabase em produção.**

## Estrutura

```
supabase/
  functions/     # Edge Functions versionadas neste repo
  migrations/    # Reservado para migrations canónicas ordenadas (ver abaixo)
  patches/       # Scripts manuais ainda úteis (SQL Editor)
  archived/      # Duplicados / supersedidos / diagnóstico antigo
  README.md      # Este ficheiro
```

## migrations/ — canónicas

**Vazio de propósito.**

Não há evidência no repositório de uma cadeia ordenada de migrations já aplicada em produção
(não existe histórico `supabase migration` alinhado a um remote). Por isso **não inventámos**
ordem canónica a partir dos `supabase_*.sql` históricos.

Daqui para a frente:
1. Novas mudanças de schema devem entrar como ficheiros timestampados em `migrations/`
   (ex.: `20260328120000_add_foo.sql`) **depois** de aplicadas (ou com plano de apply claro).
2. Até lá, use `patches/` para scripts manuais no SQL Editor.

## patches/ — operacionais

Scripts movidos da raiz (`supabase_*.sql`, `habilitar_widget.sql`). Incluem:

| Área | Exemplos |
|------|----------|
| Billing / shops | `supabase_billing_shopify_shops.sql`, `supabase_billing_plans_growth_enterprise.sql`, `supabase_update_plans.sql` |
| Widget keys / public_id | `supabase_create_widget_keys_final.sql`, `supabase_auto_create_public_id.sql`, `supabase_add_*_widget_keys*` |
| Widget config | `supabase_migration_widget_config.sql`, `supabase_fix_widget_config_complete.sql`, `supabase_widget_config_embed_cta.sql`, `supabase_add_cta_button_border_radius.sql` |
| Size charts | `supabase_fix_size_charts_*.sql`, `supabase_size_chart_entries.sql`, `supabase_add_collection_*`, `supabase_add_product_handle_to_size_charts.sql`, `supabase_add_gender_scope_to_size_charts.sql` |
| Analytics | `supabase_create_session_analytics.sql`, `supabase_create_order_analytics_omafit.sql`, `supabase_fix_analytics_rls.sql` |
| AR | `supabase_create_ar_eyewear_assets.sql`, `supabase_ar_eyewear_storage_policies.sql`, `supabase_add_ar_*`, `supabase_migrate_ar_rodin_pipeline.sql` |
| Partners | `supabase_partners_dashboard.sql`, `supabase_partners_expenses.sql` |
| Storage | `supabase_storage_rls_policies.sql`, `supabase_storage_self_hosted_results_private.sql` |
| RLS fixes | `supabase_fix_widget_configurations_rls.sql`, `supabase_fix_size_charts_rls.sql`, … |

Trate cada ficheiro como **idempotente o quanto possível**, mas **verifique o ambiente** antes de reexecutar.

## archived/ — históricos / supersedidos

| Ficheiro | Motivo |
|----------|--------|
| `supabase_create_widget_keys.sql` | Versão antiga; preferir `patches/…_final.sql` |
| `supabase_create_widget_keys_simple.sql` | Intermédia; preferir `_final` |
| `supabase_auto_generate_public_id.sql` | Antecessor de `auto_create_public_id` |
| `supabase_fix_rls_policy.sql` | RLS genérica antiga; sucessor: `fix_widget_configurations_rls` |
| `supabase_storage_simple.sql` | Setup mínimo; policies noutros scripts |
| `supabase_check_*.sql` | Diagnóstico pontual |
| `supabase_insert_widget_key_template.sql` | Template; ver inserts em `patches/` |

## Conflitos conhecidos (não resolvidos nesta reorganização)

Documentados apenas — **não “corrigidos” automaticamente**:

1. **`shopify_shops` RLS**  
   - `patches/supabase_fix_analytics_rls.sql` faz `ENABLE ROW LEVEL SECURITY` + SELECT aberto.  
   - `patches/supabase_billing_shopify_shops.sql` inclui `DISABLE ROW LEVEL SECURITY`.  
   → O resultado em produção depende de **qual script correu por último**.

2. **`widget_configurations` / size charts RLS**  
   - Vários scripts com `USING (true)` / `WITH CHECK (true)` para anon+authenticated.  
   - Scripts mais antigos em `archived/` usam nomes de policy diferentes.  
   → Isolamento multi-tenant **não** é garantido por RLS nestes patches; o app filtra por `shop_domain` e usa `SUPABASE_SERVICE_ROLE_KEY` no servidor.

3. **`widget_keys`**  
   - Três “create” (dois archived + `…_final` em patches).  
   - Policies de read público (`is_active = true`) vs evolução de `user_id` / `key` nullable noutros patches.

4. **Analytics**  
   - `create_session_analytics` + `fix_session_analytics_autosync` + `fix_analytics_rls` podem sobrepor colunas/policies.  
   - `order_analytics_omafit` é criado sem RLS no script de create.

## Edge Functions

Ver `functions/` e `docs/supabase/SUPABASE_FUNCTIONS.md`.

## Como aplicar mudanças daqui para a frente

1. Preferir **patch idempotente** com comentário de objetivo + data.  
2. Guardar em `patches/` (ou `migrations/` se passar a haver fluxo canónico).  
3. Aplicar no SQL Editor / CLI do ambiente alvo.  
4. Anotar no PR **qual ambiente** e **se já foi aplicado**.  
5. Não assumir que outro engenheiro consegue “replay” completo da pasta a partir de zero.
