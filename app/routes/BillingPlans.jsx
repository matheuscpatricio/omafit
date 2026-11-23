import {
  Card,
  Text,
  Badge,
  Button,
  BlockStack,
  InlineStack,
  List,
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
            planKey: "growth",
            name: "Growth",
            priceKey: "billing.planGrowthPrice",
            imagesIncluded: 1000,
            pricePerExtraKey: "billing.planGrowthExtra",
            descriptionKey: "billing.planGrowthDesc",
            featureKeys: [
              "billing.planGrowthFeature1",
              "billing.planGrowthFeature2",
              "billing.planGrowthFeature3",
              "billing.planGrowthFeature4",
              "billing.planGrowthFeature5",
            ],
          },
          {
            planKey: "pro",
            name: "Pro",
            priceKey: "billing.planProPrice",
            imagesIncluded: 5000,
            pricePerExtraKey: "billing.planProExtra",
            descriptionKey: "billing.planProDesc",
            featureKeys: [
              "billing.planProFeature1",
              "billing.planProFeature2",
              "billing.planProFeature3",
              "billing.planProFeature4",
              "billing.planProFeature5",
            ],
          },
          {
            planKey: "scale",
            name: "Scale",
            priceKey: "billing.planScalePrice",
            imagesIncluded: 15000,
            pricePerExtraKey: "billing.planScaleExtra",
            descriptionKey: "billing.planScaleDesc",
            featureKeys: [
              "billing.planScaleFeature1",
              "billing.planScaleFeature2",
              "billing.planScaleFeature3",
              "billing.planScaleFeature4",
              "billing.planScaleFeature5",
            ],
          },
          {
            planKey: "enterprise",
            name: "Enterprise",
            priceKey: "billing.planEnterprisePrice",
            imagesIncluded: "billing.unlimited",
            pricePerExtraKey: "billing.planEnterpriseExtra",
            descriptionKey: "billing.planEnterpriseDesc",
            featureKeys: [
              "billing.planEnterpriseFeature1",
              "billing.planEnterpriseFeature2",
              "billing.planEnterpriseFeature3",
              "billing.planEnterpriseFeature4",
              "billing.planEnterpriseFeature5",
            ],
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
          const planKey = plan.planKey || String(plan.name || "").toLowerCase();
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
                      ? plan.imagesIncluded.toLocaleString()
                      : t(String(plan.imagesIncluded))}
                  </Text>
                  <Text as="p">
                    <strong>{t("billing.pricePerExtraLabel")}</strong>{" "}
                    {t(plan.pricePerExtraKey)}
                  </Text>
                </BlockStack>

                {Array.isArray(plan.featureKeys) && plan.featureKeys.length > 0 && (
                  <List type="bullet">
                    {plan.featureKeys.map((key) => (
                      <List.Item key={key}>{t(key)}</List.Item>
                    ))}
                  </List>
                )}

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
