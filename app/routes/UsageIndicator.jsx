/**
 * Indicador de Uso de Imagens
 * Mostra quantas imagens foram usadas no mês atual e quantas ainda restam no plano.
 */

import { Card, Text, BlockStack, ProgressBar, Badge, InlineStack } from '@shopify/polaris';
import { useAppI18n } from '../contexts/AppI18n';

export function UsageIndicator({ usage }) {
  const { t } = useAppI18n();
  if (!usage) {
    return null;
  }

  const {
    plan,
    used,
    included,
    remaining,
    percentage,
    withinLimit,
    extraImages = 0,
    pricePerExtra = 0.18,
    isEnterprise = false,
  } = usage;

  const isEnterprisePlan = Boolean(isEnterprise);

  let progressColor = 'success';
  let badgeTone = 'success';
  if (!isEnterprisePlan && percentage >= 90) {
    progressColor = 'info';
    badgeTone = 'info';
  } else if (!isEnterprisePlan && percentage >= 75) {
    progressColor = 'info';
    badgeTone = 'info';
  } else if (!isEnterprisePlan && percentage >= 50) {
    progressColor = 'info';
    badgeTone = 'info';
  }

  const planName = plan && typeof plan === 'string'
    ? plan.charAt(0).toUpperCase() + plan.slice(1)
    : '';
  const isOnDemand = included === 0 && !isEnterprisePlan;
  const billableCount = isEnterprisePlan ? 0 : isOnDemand ? used : extraImages;
  const estimatedCost =
    !isEnterprisePlan && billableCount > 0 && pricePerExtra > 0
      ? (billableCount * pricePerExtra).toFixed(2)
      : null;

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text variant="headingMd" as="h3">
            {t('billing.usageTitle', { plan: planName || '–' })}
          </Text>
          <Badge tone={badgeTone}>
            {isEnterprisePlan
              ? t('billing.usageUnlimitedBadge')
              : isOnDemand
                ? t('billing.usagePayPerUse')
                : t('billing.usagePercentUsed', { percent: percentage.toFixed(1) })}
          </Badge>
        </InlineStack>

        <BlockStack gap="200">
          {!isOnDemand && !isEnterprisePlan && (
            <ProgressBar
              progress={percentage}
              tone={progressColor}
              size="medium"
            />
          )}
          <InlineStack align="space-between">
            <Text variant="bodyMd">
              {isEnterprisePlan
                ? t('billing.usageEnterpriseSessions', { used })
                : isOnDemand
                  ? t('billing.usageImagesUsedOnDemand', { used })
                  : t('billing.usageImagesUsed', { used, included })}
            </Text>
            {!isOnDemand && !isEnterprisePlan && remaining != null && (
              <Text variant="bodyMd" fontWeight="semibold">
                {t('billing.usageRemaining', { remaining })}
              </Text>
            )}
            {isEnterprisePlan && (
              <Text variant="bodyMd" fontWeight="semibold">
                {t('billing.usageRemainingUnlimited')}
              </Text>
            )}
          </InlineStack>
        </BlockStack>

        {estimatedCost != null && (
          <InlineStack align="space-between" blockAlign="center">
            <Text variant="bodyMd" tone="subdued">
              {t('billing.estimatedCostLabel')}
            </Text>
            <Text variant="bodyMd" fontWeight="semibold">
              ${estimatedCost}
            </Text>
          </InlineStack>
        )}

        {extraImages > 0 && !isOnDemand && !isEnterprisePlan && (
          <BlockStack gap="200">
            <Card background="bg-surface-info-subdued">
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="bodyMd" tone="info" fontWeight="semibold">
                    {t('billing.extraImagesTitle')}
                  </Text>
                  <Badge tone="info">
                    {extraImages === 1
                      ? t('billing.extraImagesCount', { count: 1 })
                      : t('billing.extraImagesCountPlural', { count: extraImages })}
                  </Badge>
                </InlineStack>
                <Text variant="bodyMd" tone="subdued">
                  {extraImages === 1
                    ? t('billing.extraImagesDescription', { count: 1, price: (extraImages * pricePerExtra).toFixed(2) })
                    : t('billing.extraImagesDescriptionPlural', { count: extraImages, price: (extraImages * pricePerExtra).toFixed(2) })}
                </Text>
              </BlockStack>
            </Card>
          </BlockStack>
        )}

        {!withinLimit && extraImages === 0 && !isEnterprisePlan && (
          <BlockStack gap="100">
            <Text variant="bodyMd" tone="info" fontWeight="semibold">
              {t('billing.usageOverLimit')}
            </Text>
            <Text variant="bodyMd" tone="subdued">
              {t('billing.usageOverLimitNote')}
            </Text>
          </BlockStack>
        )}

        {withinLimit && !isEnterprisePlan && percentage >= 75 && (
          <BlockStack gap="100">
            <Text variant="bodyMd" tone="warning" fontWeight="semibold">
              {t('billing.usageNearLimit')}
            </Text>
            <Text variant="bodyMd" tone="subdued">
              {t('billing.usageNearLimitNote')}
            </Text>
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}