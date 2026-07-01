import { requirePartnersAuth } from "../partners-auth.server";
import { fetchPartnersDashboardStats } from "../partners-dashboard.server";

export const loader = async ({ request }) => {
  await requirePartnersAuth(request);
  const stats = await fetchPartnersDashboardStats();
  return Response.json(stats);
};
