import { createCookieSessionStorage, redirect } from "react-router";

const PARTNERS_SECRET = String(process.env.PARTNERS_DASHBOARD_SECRET || "").trim();

const { getSession, commitSession, destroySession } = createCookieSessionStorage({
  cookie: {
    name: "__omafit_partners",
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
    sameSite: "lax",
    secrets: PARTNERS_SECRET ? [PARTNERS_SECRET] : ["omafit-partners-dev-insecure"],
    secure: process.env.NODE_ENV === "production",
  },
});

export function isPartnersAuthConfigured() {
  return Boolean(PARTNERS_SECRET);
}

export async function getPartnersSession(request) {
  return getSession(request.headers.get("Cookie"));
}

export async function requirePartnersAuth(request) {
  if (!isPartnersAuthConfigured()) {
    throw new Response("Partners dashboard not configured (set PARTNERS_DASHBOARD_SECRET)", {
      status: 503,
    });
  }

  const session = await getPartnersSession(request);
  if (session.get("authenticated") !== true) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/partners/login")) {
      throw redirect(`/partners/login?redirectTo=${encodeURIComponent(url.pathname)}`);
    }
  }
  return session;
}

export async function verifyPartnersPassword(password) {
  if (!PARTNERS_SECRET) return false;
  return String(password || "").trim() === PARTNERS_SECRET;
}

export async function createPartnersAuthSession() {
  const session = await getSession();
  session.set("authenticated", true);
  return session;
}

export { commitSession, destroySession, getSession };
