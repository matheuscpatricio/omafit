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
                ) : (() => {
                  const startUrl = buildBillingStartGetUrl?.(planKey);
                  const buttonLabel = hasActivePlan ? t("billing.switchPlan") : t("billing.subscribePlan");
                  if (startUrl) {
                    return (
                      <a
                        href={startUrl}
                        target="_top"
                        rel="noopener noreferrer"
                        style={{
                          display: "inline-block",
                          appearance: "none",
                          background: "var(--p-color-bg-fill-brand, #008060)",
                          color: "var(--p-color-text-on-fill, #fff)",
                          border: "none",
                          borderRadius: "var(--p-border-radius-200, 8px)",
                          padding: "10px 20px",
                          fontSize: "14px",
                          fontWeight: 600,
                          cursor: "pointer",
                          textDecoration: "none",
                          textAlign: "center",
                        }}
                        onClick={(e) => {
                          // Log para debug
                          console.log("[BillingPlans] Clicked plan button:", { planKey, startUrl });
                          // Se target="_top" não funcionar, força via JavaScript
                          if (typeof window !== "undefined" && window.top && window.top !== window.self) {
                            e.preventDefault();
                            console.log("[BillingPlans] Forcing top navigation to:", startUrl);
                            window.top.location.href = startUrl;
                          }
                        }}
                      >
                        {buttonLabel}
                      </a>
                    );
                  }
                  return (
                    <Button
                      variant="primary"
                      loading={isLoading}
                      onClick={() => onSelectPlan(planKey)}
                    >
                      {buttonLabel}
                    </Button>
                  );
                })()}
              </BlockStack>
            </Card>
          );
        })}
      </BlockStack>
    </BlockStack>
  );
}
