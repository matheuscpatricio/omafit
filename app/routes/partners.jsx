import { Outlet } from "react-router";
import {
  isPartnersAuthConfigured,
  requirePartnersAuth,
} from "../partners-auth.server";
import "../app.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  if (url.pathname === "/partners/login") {
    return { authConfigured: isPartnersAuthConfigured() };
  }
  await requirePartnersAuth(request);
  return { authConfigured: true };
};

export default function PartnersLayout() {
  return (
    <div className="omafit-partners-shell">
      <Outlet />
    </div>
  );
}
