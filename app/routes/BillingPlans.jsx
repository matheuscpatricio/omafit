import {
  Card,
  Text,
  Badge,
  Button,
  BlockStack,
  InlineStack,
} from "@shopify/polaris";
import { useAppI18n } from "../contexts/AppI18n";

export default function BillingPlans({
  currentPlan,
  billingStatus,
  plans,
  onSelectPlan,
  isLoading,
  apiBillingStartPath = "/api/billing/start?redirect=1",
}) {
  const { t } = useAppI18n();
  const hasActivePlan = Boolean((currentPlan || "").trim() || billingStatus === "active");

  const effectivePlans =
    plans && plans.length
      ? plans
      : [
          {
            name: "Basic",
            priceKey: "billing.planBasicPrice",
            imagesIncluded: 100,
            pricePerExtraKey: "billing.planBasicExtra",
            descriptionKey: "billing.planBasicDesc",
          },
          {
            name: "Growth",
            priceKey: "billing.planGrowthPrice",
            imagesIncluded: 500,
            pricePerExtraKey: "billing.planGrowthExtra",
            descriptionKey: "billing.planGrowthDesc",
          },
          {
            name: "Pro",
            priceKey: "billing.planProPrice",
            imagesIncluded: 1000,
            pricePerExtraKey: "billing.planProExtra",
            descriptionKey: "billing.planProDesc",
          },
          {
            name: "Enterprise",
            priceKey: "billing.planEnterprisePrice",
            imagesIncluded: "billing.unlimited",
            pricePerExtraKey: "billing.planEnterpriseExtra",
            descriptionKey: "billing.planEnterpriseDesc",
          },
        ];

  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingLg">
            {t("billing.plansTitle")}
          </Text>
          <Text as="p" tone="subdued">
            {t("billing.plansSubtitle")}
          </Text>
        </BlockStack>
      </Card>

      <BlockStack gap="400">
        {effectivePlans.map((plan) => {
          const planKey = plan.name.toLowerCase();
          const normalizedCurrent = (currentPlan || "").toLowerCase().trim();
          const isCurrent = Boolean(
            normalizedCurrent &&
              (normalizedCurrent === planKey ||
                (planKey === "pro" && normalizedCurrent === "professional"))
          );
          const isEnterprise = planKey === "enterprise";

          return (
            <Card key={plan.name}>
              <BlockStack gap="400">
                <BlockStack gap="200">
                  <InlineStack gap="200">
                    <Text as="h2" variant="headingMd">
                      {plan.name}
                    </Text>
                    {isCurrent && (
                      <Badge tone="success">{t("billing.currentPlanBadge")}</Badge>
                    )}
                  </InlineStack>
                  <Text as="p" tone="subdued">
                    {t(plan.descriptionKey)}
                  </Text>
                  <Text as="p" variant="headingLg">
                    {typeof plan.priceKey === "string"
                      ? t(plan.priceKey)
                      : plan.priceKey}
                  </Text>
                </BlockStack>

                <BlockStack gap="200">
                  <Text as="p">
                    <strong>{t("billing.imagesIncludedLabel")}</strong>{" "}
                    {typeof plan.imagesIncluded === "number"
                      ? plan.imagesIncluded
                      : t(plan.imagesIncluded)}
                  </Text>
                  <Text as="p">
                    <strong>{t("billing.pricePerExtraLabel")}</strong>{" "}
                    {t(plan.pricePerExtraKey)}
                  </Text>
                </BlockStack>

                {isEnterprise ? (
                  <Button
                    variant="primary"
                    url="mailto:contato@omafit.co"
                    external
                  >
                    {t("billing.contactUs")}
                  </Button>
                ) : isCurrent ? (
                  <Button disabled>{t("billing.planActive")}</Button>
                ) : (
                  <form
                    method="post"
                    action={apiBillingStartPath}
                    target="_top"
                    style={{ display: "inline-block" }}
                  >
                    <input type="hidden" name="plan" value={planKey} />
                    <Button variant="primary" submit>
                      {hasActivePlan ? t("billing.switchPlan") : t("billing.subscribePlan")}
                    </Button>
                  </form>
                )}
              </BlockStack>
            </Card>
          );
        })}
      </BlockStack>
    </BlockStack>
  );
}
