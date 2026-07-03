import { useLoaderData, useRevalidator } from "react-router";
import { requirePartnersAuth } from "../partners-auth.server";
import { fetchPartnersDashboardStats } from "../partners-dashboard.server";
import { isShopifyPartnersApiConfigured } from "../shopify-partners-api.server";
import { getZohoMailDeliveryMode, isZohoMailConfigured } from "../zoho-mail.server";
import { getCarouselGeneratorStatus } from "../partners-carousel.server";
import {
  isInstagramApiConfigured,
  isYoutubeApiConfigured,
} from "../partners-social.server";
import { isMetaAppConfigured } from "../meta-instagram.server";
import { PartnersDashboard } from "../components/partners/PartnersDashboard";

export const loader = async ({ request }) => {
  await requirePartnersAuth(request);
  const stats = await fetchPartnersDashboardStats();
  const carouselStatus = getCarouselGeneratorStatus();
  return {
    stats,
    partnersApiConfigured: isShopifyPartnersApiConfigured(),
    zohoMailConfigured: isZohoMailConfigured(),
    zohoMailMode: getZohoMailDeliveryMode(),
    canvaConfigured: isCanvaConfigured(),
    openaiConfigured: carouselStatus.openaiConfigured,
    youtubeApiConfigured: isYoutubeApiConfigured(),
    instagramApiConfigured: isInstagramApiConfigured(),
    metaAppConfigured: isMetaAppConfigured(),
  };
};

export default function PartnersDashboardPage() {
  const data = useLoaderData();
  const revalidator = useRevalidator();
  return <PartnersDashboard {...data} onRefresh={() => revalidator.revalidate()} />;
}
