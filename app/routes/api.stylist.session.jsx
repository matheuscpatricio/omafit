import { stylistDeps } from "../stylist/deps.server";
import { handleCreateSession, handleGetEntitlements } from "../stylist/handlers.server";

export const action = ({ request }) => handleCreateSession(request, stylistDeps);

export const loader = ({ request }) => handleGetEntitlements(request, stylistDeps);
