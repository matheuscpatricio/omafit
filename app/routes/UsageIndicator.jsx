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

  const { plan, used, included, remaining, percentage, withinLimit, extraImages = 0, pricePerExtra = 0.18 } = usage;

  let progressColor = 'success';
  let badgeTone = 'success';
  if (percentage >= 90) {
    progressColor = 'attention';
    badgeTone = 'info';
  } else if (percentage >= 75) {
    progressColor = 'warning';
    badgeTone = 'info';
  } else if (percentage >= 50) {
    progressColor = 'attention';
    badgeTone = 'attention';
  }

  const planName = plan && typeof plan === 'string'
    ? plan.charAt(0).toUpperCase() + plan.slice(1)
    : '';
  const isOnDemand = included === 0;
  const billableCount = isOnDemand ? used : extraImages;
  const estimatedCost = billableCount > 0 ? (billableCount * pricePerExtra).toFixed(2) : null;

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text variant="headingMd" as="h3">
            {t('billing.usageTitle', { plan: planName || '–' })}
          </Text>
          <Badge tone={badgeTone}>
            {isOnDemand ? t('billing.usagePayPerUse') : t('billing.usagePercentUsed', { percent: percentage.toFixed(1) })}
          </Badge>
        </InlineStack>

        <BlockStack gap="200">
          {!isOnDemand && (
            <ProgressBar
              progress={percentage}
              tone={progressColor}
              size="medium"
            />
          )}
          <InlineStack align="space-between">
            <Text variant="bodyMd">
              {isOnDemand ? t('billing.usageImagesUsedOnDemand', { used }) : t('billing.usageImagesUsed', { used, included })}
            </Text>
            {!isOnDemand && (
              <Text variant="bodyMd" fontWeight="semibold">
                {t('billing.usageRemaining', { remaining })}
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

        {extraImages > 0 && !isOnDemand && (
          <BlockStack gap="200">
            <Card background="bg-surface-info-subdued">
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="bodyMd" tone="info" fontWeight="semibold">
                    {t('billing.extraImagesTitle')}
                  </Text>
                  <Badge tone="info">
                    {t('billing.extraImagesCount', { 
                      count: extraImages,
                      plural: extraImages > 1 ? 's' : ''
                    })}
                  </Badge>
                </InlineStack>
                <Text variant="bodyMd" tone="subdued">
                  {t('billing.extraImagesDescription', { 
                    count: extraImages,
                    plural: extraImages > 1 ? 's' : '',
                    price: (extraImages * pricePerExtra).toFixed(2) 
                  })}
                </Text>
              </BlockStack>
            </Card>
          </BlockStack>
        )}

        {!withinLimit && extraImages === 0 && (
          <BlockStack gap="100">
            <Text variant="bodyMd" tone="info" fontWeight="semibold">
              ⚠️ {t('billing.usageOverLimit')}
            </Text>
            <Text variant="bodyMd" tone="subdued">
              {t('billing.usageOverLimitNote')}
            </Text>
          </BlockStack>
        )}

        {withinLimit && percentage >= 75 && (
          <BlockStack gap="100">
            <Text variant="bodyMd" tone="warning" fontWeight="semibold">
              💡 {t('billing.usageNearLimit')}
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