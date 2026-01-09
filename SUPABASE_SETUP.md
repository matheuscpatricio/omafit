# Configuração das Tabelas no Supabase

## Tabela: widget_configurations

Execute este SQL no Supabase SQL Editor:

```sql
CREATE TABLE IF NOT EXISTS widget_configurations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_domain TEXT UNIQUE NOT NULL,
  link_text TEXT DEFAULT 'Experimentar virtualmente',
  store_logo TEXT,
  primary_color TEXT DEFAULT '#810707',
  widget_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Criar índice para busca rápida
CREATE INDEX IF NOT EXISTS idx_widget_configurations_shop_domain 
ON widget_configurations(shop_domain);

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_widget_configurations_updated_at
BEFORE UPDATE ON widget_configurations
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
```

## Tabela: size_charts

**Execute o script completo:** `supabase_fix_size_charts_complete.sql`

Ou execute este SQL básico no Supabase SQL Editor:

```sql
CREATE TABLE IF NOT EXISTS size_charts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_domain TEXT NOT NULL,
  gender TEXT NOT NULL CHECK (gender IN ('male', 'female', 'unisex')),
  sizes JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(shop_domain, gender)
);

-- Criar índice para busca rápida
CREATE INDEX IF NOT EXISTS idx_size_charts_shop_domain 
ON size_charts(shop_domain);

-- Trigger para atualizar updated_at automaticamente
CREATE TRIGGER update_size_charts_updated_at
BEFORE UPDATE ON size_charts
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
```

## Habilitar RLS (Row Level Security)

Execute este SQL para habilitar acesso público (ou configure RLS adequadamente):

```sql
-- Para widget_configurations
ALTER TABLE widget_configurations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read/write on widget_configurations"
ON widget_configurations
FOR ALL
USING (true)
WITH CHECK (true);

-- Para size_charts
ALTER TABLE size_charts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read/write on size_charts"
ON size_charts
FOR ALL
USING (true)
WITH CHECK (true);
```

## Migração: Adicionar Colunas Faltantes

Se a tabela `widget_configurations` já existe mas está faltando colunas, execute este SQL:

```sql
-- Adicionar colunas que podem estar faltando
ALTER TABLE widget_configurations 
ADD COLUMN IF NOT EXISTS link_text TEXT DEFAULT 'Experimentar virtualmente';

ALTER TABLE widget_configurations 
ADD COLUMN IF NOT EXISTS store_logo TEXT;

ALTER TABLE widget_configurations 
ADD COLUMN IF NOT EXISTS primary_color TEXT DEFAULT '#810707';

ALTER TABLE widget_configurations 
ADD COLUMN IF NOT EXISTS widget_enabled BOOLEAN DEFAULT true;

ALTER TABLE widget_configurations 
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

ALTER TABLE widget_configurations 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Se a tabela não tiver constraint UNIQUE em shop_domain
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'widget_configurations_shop_domain_key'
  ) THEN
    ALTER TABLE widget_configurations 
    ADD CONSTRAINT widget_configurations_shop_domain_key UNIQUE (shop_domain);
  END IF;
END $$;
```

## Estrutura do JSON sizes (size_charts)

O campo `sizes` é um array JSON com a seguinte estrutura:

```json
[
  {
    "size": "P",
    "peito": "88",
    "cintura": "70",
    "quadril": "92",
    "altura": "160",
    "peso": "55"
  },
  {
    "size": "M",
    "peito": "92",
    "cintura": "74",
    "quadril": "96",
    "altura": "165",
    "peso": "60"
  }
]
```

