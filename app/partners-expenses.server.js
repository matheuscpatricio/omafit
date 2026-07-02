import { parseSupabaseList, supabaseFetch } from "./supabase-rest.server.js";

const EXPENSE_CATEGORIES = ["infra", "marketing", "ferramentas", "pessoal", "outros"];

function currentMonthKey() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function normalizeExpenseRow(row) {
  return {
    id: row.id,
    description: row.description,
    amount: Number(row.amount) || 0,
    currency: row.currency || "USD",
    category: row.category || "outros",
    expenseMonth: row.expense_month,
    notes: row.notes || null,
    createdAt: row.created_at,
  };
}

function isTableMissingError(body) {
  const text = String(body || "").toLowerCase();
  return (
    text.includes("partners_expenses") &&
    (text.includes("does not exist") || text.includes("could not find"))
  );
}

export async function fetchPartnersExpenses() {
  const response = await supabaseFetch(
    "/rest/v1/partners_expenses?select=id,description,amount,currency,category,expense_month,notes,created_at&order=expense_month.desc,created_at.desc",
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    if (response.status === 404 || isTableMissingError(body)) {
      return { expenses: [], tableExists: false, error: "table_not_found" };
    }
    return { expenses: [], tableExists: true, error: body || `HTTP ${response.status}` };
  }

  const { data } = await parseSupabaseList(response);
  return {
    expenses: data.map(normalizeExpenseRow),
    tableExists: true,
    error: null,
  };
}

export function aggregateExpenses(expenses, monthKey = currentMonthKey()) {
  let expensesMonth = 0;
  let expensesTotal = 0;
  const byCategory = {};

  for (const row of expenses) {
    expensesTotal += row.amount;
    byCategory[row.category] = (byCategory[row.category] || 0) + row.amount;
    if (row.expenseMonth === monthKey) {
      expensesMonth += row.amount;
    }
  }

  return {
    expensesMonth,
    expensesTotal,
    byCategory,
    currentMonth: monthKey,
  };
}

export async function createPartnersExpense(payload) {
  const description = String(payload.description || "").trim();
  const amount = Number(payload.amount);
  const currency = String(payload.currency || "USD").trim().toUpperCase() || "USD";
  const category = String(payload.category || "outros").trim().toLowerCase();
  const expenseMonth = String(payload.expenseMonth || payload.expense_month || currentMonthKey()).trim();
  const notes = String(payload.notes || "").trim() || null;

  if (!description) {
    return { success: false, error: "description_required" };
  }
  if (!Number.isFinite(amount) || amount < 0) {
    return { success: false, error: "invalid_amount" };
  }
  if (!/^\d{4}-\d{2}$/.test(expenseMonth)) {
    return { success: false, error: "invalid_month" };
  }
  if (!EXPENSE_CATEGORIES.includes(category)) {
    return { success: false, error: "invalid_category" };
  }

  const response = await supabaseFetch("/rest/v1/partners_expenses", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      description,
      amount,
      currency,
      category,
      expense_month: expenseMonth,
      notes,
      updated_at: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    if (isTableMissingError(body)) {
      return { success: false, error: "table_not_found" };
    }
    return { success: false, error: body || `HTTP ${response.status}` };
  }

  const rows = await response.json().catch(() => []);
  const row = Array.isArray(rows) ? rows[0] : rows;
  return { success: true, expense: normalizeExpenseRow(row) };
}

export async function deletePartnersExpense(id) {
  const expenseId = Number(id);
  if (!Number.isFinite(expenseId) || expenseId <= 0) {
    return { success: false, error: "invalid_id" };
  }

  const response = await supabaseFetch(
    `/rest/v1/partners_expenses?id=eq.${expenseId}`,
    { method: "DELETE" },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { success: false, error: body || `HTTP ${response.status}` };
  }

  return { success: true };
}

export { EXPENSE_CATEGORIES, currentMonthKey };
