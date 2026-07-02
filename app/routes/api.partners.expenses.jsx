import { requirePartnersAuth } from "../partners-auth.server";
import {
  createPartnersExpense,
  deletePartnersExpense,
  fetchPartnersExpenses,
} from "../partners-expenses.server";

export async function loader({ request }) {
  await requirePartnersAuth(request);
  const result = await fetchPartnersExpenses();
  return Response.json(result);
}

export async function action({ request }) {
  await requirePartnersAuth(request);

  if (request.method === "DELETE") {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const result = await deletePartnersExpense(id);
    if (!result.success) {
      return Response.json(result, { status: 400 });
    }
    return Response.json(result);
  }

  if (request.method !== "POST") {
    return Response.json({ success: false, error: "method_not_allowed" }, { status: 405 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const result = await createPartnersExpense(body);
    if (!result.success) {
      const status = result.error === "table_not_found" ? 503 : 400;
      return Response.json(result, { status });
    }
    return Response.json(result);
  } catch (err) {
    console.error("[api.partners.expenses]", err);
    return Response.json(
      { success: false, error: err?.message || "create_failed" },
      { status: 500 },
    );
  }
}
