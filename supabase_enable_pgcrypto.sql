-- ============================================================================
-- Corrigir erro: function gen_random_bytes(integer) does not exist
-- ============================================================================
-- Este erro impede INSERT/UPSERT em tabelas que usam funções de geração aleatória
-- (ex.: triggers/funções de public_id). Execute no SQL Editor do Supabase.

-- 1) Habilita extensão necessária para gen_random_uuid / gen_random_bytes
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2) (Opcional) Verificação rápida
SELECT
  gen_random_uuid() AS sample_uuid,
  encode(gen_random_bytes(8), 'hex') AS sample_bytes_hex;

