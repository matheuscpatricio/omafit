/**
 * Indicador de Uso de Imagens
 *
 * Mostra quantas imagens foram usadas no mês atual
 * e quantas ainda restam no plano
 */

import { Card, Text, BlockStack, ProgressBar, Badge, InlineStack } from '@shopify/polaris';

export function UsageIndicator({ usage }) {
  if (!usage) {
    return null;
  }

  const { plan, used, included, remaining, percentage, withinLimit } = usage;

  // Determinar cor baseado na porcentagem
  let progressColor = 'success';
  let badgeTone = 'success';

  if (percentage >= 90) {
    progressColor = 'critical';
    badgeTone = 'critical';
  } else if (percentage >= 75) {
    progressColor = 'warning';
    badgeTone = 'warning';
  } else if (percentage >= 50) {
    progressColor = 'attention';
    badgeTone = 'attention';
  }

  // Formatar nome do plano de forma segura
  const planName = plan && typeof plan === 'string' 
    ? plan.charAt(0).toUpperCase() + plan.slice(1)
    : 'Atual';

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text variant="headingMd" as="h3">
            Uso de Imagens - Plano {planName}
          </Text>
          <Badge tone={badgeTone}>
            {percentage.toFixed(1)}% usado
          </Badge>
        </InlineStack>

        <BlockStack gap="200">
          <ProgressBar
            progress={percentage}
            tone={progressColor}
            size="medium"
          />

          <InlineStack align="space-between">
            <Text variant="bodyMd">
              {used} de {included} imagens usadas
            </Text>
            <Text variant="bodyMd" fontWeight="semibold">
              {remaining} restantes
            </Text>
          </InlineStack>
        </BlockStack>

        {!withinLimit && (
          <BlockStack gap="100">
            <Text variant="bodyMd" tone="critical" fontWeight="semibold">
              ⚠️ Você ultrapassou o limite incluído
            </Text>
            <Text variant="bodyMd" tone="subdued">
              Imagens adicionais serão cobradas automaticamente de acordo com seu plano.
            </Text>
          </BlockStack>
        )}

        {withinLimit && percentage >= 75 && (
          <BlockStack gap="100">
            <Text variant="bodyMd" tone="warning" fontWeight="semibold">
              💡 Você está próximo do limite
            </Text>
            <Text variant="bodyMd" tone="subdued">
              Considere fazer upgrade do seu plano se precisar de mais imagens.
            </Text>
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}