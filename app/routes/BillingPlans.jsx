import {
  Card,
  Text,
  Badge,
  Button,
  BlockStack,
  InlineStack,
} from "@shopify/polaris";

export default function BillingPlans({
  currentPlan,
  plans,
  onSelectPlan,
  isLoading,
}) {
  const effectivePlans =
    plans && plans.length
      ? plans
      : [
          {
            name: "Basic",
            price: "$25/mês",
            imagesIncluded: 100,
            pricePerExtra: "$0,18/imagem",
            description: "Ideal para lojas que estão começando com provador virtual.",
          },
          {
            name: "Growth",
            price: "$100/mês",
            imagesIncluded: 500,
            pricePerExtra: "$0,16/imagem",
            description: "Para marcas que estão em processo de crescimento.",
          },
          {
            name: "Pro",
            price: "$180/mês",
            imagesIncluded: 1000,
            pricePerExtra: "$0,14/imagem",
            description: "Para lojas com volume maior de imagens geradas.",
          },
          {
            name: "Enterprise",
            price: "Sob consulta",
            imagesIncluded: "Ilimitado*",
            pricePerExtra: "A combinar",
            description: "Planos customizados para grandes marcas.",
          },
        ];

  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingLg">
            Planos Omafit
          </Text>
          <Text as="p" tone="subdued">
            Escolha o plano ideal para sua loja. A cobrança é feita via Shopify.
          </Text>
        </BlockStack>
      </Card>

      <BlockStack gap="400">
        {effectivePlans.map((plan) => {
          const isCurrent =
            currentPlan && currentPlan === plan.name.toLowerCase();
          const isEnterprise = plan.name.toLowerCase() === "enterprise";

          return (
            <Card key={plan.name}>
              <BlockStack gap="400">
                <BlockStack gap="200">
                  <InlineStack gap="200">
                    <Text as="h2" variant="headingMd">
                      {plan.name}
                    </Text>
                    {isCurrent && <Badge tone="success">Plano atual</Badge>}
                  </InlineStack>
                  <Text as="p" tone="subdued">
                    {plan.description}
                  </Text>
                  <Text as="p" variant="headingLg">
                    {plan.price}
                  </Text>
                </BlockStack>

                <BlockStack gap="200">
                  <Text as="p">
                    <strong>Imagens incluídas:</strong> {plan.imagesIncluded}
                  </Text>
                  <Text as="p">
                    <strong>Imagem adicional:</strong> {plan.pricePerExtra}
                  </Text>
                </BlockStack>

                {isEnterprise ? (
                  <Button
                    variant="primary"
                    url="mailto:contato@omafit.co"
                    external
                  >
                    Fale com a gente
                  </Button>
                ) : isCurrent ? (
                  <Button
                    disabled={true}
                  >
                    Plano ativo
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    disabled={isLoading}
                    loading={isLoading}
                    onClick={() =>
                      onSelectPlan && onSelectPlan(plan.name.toLowerCase())
                    }
                  >
                    Assinar este plano
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
