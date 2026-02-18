-- ============================================================================
-- Compatibilidade imediata para erro:
-- "function gen_random_bytes(integer) does not exist"
-- ============================================================================
-- Execute este script no SQL Editor do Supabase.
-- Ele cria um fallback em public.gen_random_bytes(integer) quando a função
-- não existe no search_path atual.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'gen_random_bytes'
      AND pg_get_function_identity_arguments(p.oid) = 'integer'
      AND n.nspname = 'public'
  ) THEN
    EXECUTE $fn$
      CREATE FUNCTION public.gen_random_bytes(length integer)
      RETURNS bytea
      LANGUAGE plpgsql
      AS $body$
      DECLARE
        out_bytes bytea := ''::bytea;
        chunk_hex text;
      BEGIN
        IF length IS NULL OR length < 0 THEN
          RAISE EXCEPTION 'length must be a non-negative integer';
        END IF;

        WHILE octet_length(out_bytes) < length LOOP
          -- 16 bytes por iteração via md5 -> decode(hex)
          chunk_hex := md5(random()::text || clock_timestamp()::text || txid_current()::text);
          out_bytes := out_bytes || decode(chunk_hex, 'hex');
        END LOOP;

        RETURN substring(out_bytes FROM 1 FOR length);
      END;
      $body$;
    $fn$;
  END IF;
END $$;

-- Verificação rápida
SELECT
  octet_length(public.gen_random_bytes(8)) AS bytes_len,
  encode(public.gen_random_bytes(8), 'hex') AS bytes_hex_sample;

