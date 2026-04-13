import {
  Card,
  Text,
  Badge,
  Button,
  BlockStack,
  InlineStack,
} from "@shopify/polaris";
import { useAppI18n } from "../contexts/AppI18n";

function noop() {}

export default function BillingPlans({
  currentPlan,
  billingStatus,
  plans,
  onSelectPlan = noop,
  isLoading,
  billingFormUrl = "",
  buildBillingStartGetUrl,
}) {
  const { t } = useAppI18n();
  const hasActivePlan = Boolean((currentPlan || "").trim() || billingStatus === "active");

  const effectivePlans =
    plans && plans.length
      ? plans
      : [
          {
            planKey: "ondemand",
            name: "On-demand",
            priceKey: "billing.planOndemandPrice",
            imagesIncluded: 50,
            pricePerExtraKey: "billing.planOndemandExtra",
            descriptionKey: "billing.planOndemandDesc",
          },
          {
            planKey: "growth",
            name: "Growth",
            priceKey: "billing.planGrowthPrice",
            imagesIncluded: 700,
            pricePerExtraKey: "billing.planGrowthExtra",
            descriptionKey: "billing.planGrowthDesc",
          },
          {
            planKey: "pro",
            name: "Pro",
            priceKey: "billing.planProPrice",
            imagesIncluded: 3000,
            pricePerExtraKey: "billing.planProExtra",
            descriptionKey: "billing.planProDesc",
          },
          {
            planKey: "enterprise",
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
          const planKey = plan.planKey || (plan.name.toLowerCase().includes("demand") ? "ondemand" : "pro");
          const normalizedCurrent = (currentPlan || "").toLowerCase().trim().replace(/-/g, "");
          const isCurrent = Boolean(
            normalizedCurrent &&
              (normalizedCurrent === planKey ||
                (planKey === "pro" && (normalizedCurrent === "professional" || normalizedCurrent === "pro"))),
          );
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
                      : t(String(plan.imagesIncluded))}
                  </Text>
                  <Text as="p">
                    <strong>{t("billing.pricePerExtraLabel")}</strong>{" "}
                    {t(plan.pricePerExtraKey)}
                  </Text>
                </BlockStack>

                {isCurrent ? (
                  <Button disabled>{t("billing.planActive")}</Button>
                ) : (
                  <Button
                    variant="primary"
                    loading={isLoading}
                    onClick={() => onSelectPlan(planKey)}
                  >
                    {hasActivePlan ? t("billing.switchPlan") : t("billing.subscribePlan")}
                  </Button>
                )}
              </BlockStack>
            </Card>
          );
        })}
      </BlockStack>
    </BlockStack>
  );
}
