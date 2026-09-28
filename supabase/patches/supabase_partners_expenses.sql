-- Despesas manuais do Partners Dashboard (aba Financeiro)
-- Execute no SQL Editor do Supabase.

CREATE TABLE IF NOT EXISTS partners_expenses (
  id BIGSERIAL PRIMARY KEY,
  description TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  category TEXT NOT NULL DEFAULT 'outros',
  expense_month TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partners_expenses_month
  ON partners_expenses (expense_month DESC);

CREATE INDEX IF NOT EXISTS idx_partners_expenses_category
  ON partners_expenses (category);

ALTER TABLE partners_expenses DISABLE ROW LEVEL SECURITY;
