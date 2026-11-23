import { useState } from 'react';
import {
  Banner,
  Text,
  Modal,
  BlockStack,
  Box,
  List,
  Divider,
} from '@shopify/polaris';
import { useAppI18n } from '../contexts/AppI18n';
import { getTutorialDoc } from '../tutorials/content';

/**
 * Banner no topo da página com link que abre o documento de tutorial em um Modal.
 * @param {{ tutorialKey: 'widget' | 'sizeChart' }} props
 */
export default function TutorialDocBanner({ tutorialKey }) {
  const { t, locale } = useAppI18n();
  const [open, setOpen] = useState(false);
  const doc = getTutorialDoc(tutorialKey, locale);

  if (!doc) return null;

  const bannerPrefixKey = `tutorial.${tutorialKey}.bannerBefore`;
  const bannerLinkKey = `tutorial.${tutorialKey}.bannerLink`;

  return (
    <>
      <Banner tone="info">
        <Text as="p" variant="bodyMd">
          {t(bannerPrefixKey)}
          <button
            type="button"
            onClick={() => setOpen(true)}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              margin: 0,
              color: 'var(--p-color-text-link, #005bd3)',
              textDecoration: 'underline',
              cursor: 'pointer',
              font: 'inherit',
            }}
          >
            {t(bannerLinkKey)}
          </button>
          {t('tutorial.bannerAfter')}
        </Text>
      </Banner>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={doc.title}
        size="large"
        primaryAction={{
          content: t('tutorial.close'),
          onAction: () => setOpen(false),
        }}
      >
        <Modal.Section>
          <BlockStack gap="500">
            <Text as="p" variant="bodyMd" tone="subdued">
              {doc.subtitle}
            </Text>

            {doc.sections.map((section, index) => (
              <BlockStack key={`${section.heading}-${index}`} gap="200">
                {index > 0 ? <Divider /> : null}
                <Text as="h3" variant="headingMd">
                  {section.heading}
                </Text>
                {(section.paragraphs || []).map((paragraph, pIndex) => (
                  <Text key={`p-${index}-${pIndex}`} as="p" variant="bodyMd">
                    {paragraph}
                  </Text>
                ))}
                {Array.isArray(section.bullets) && section.bullets.length > 0 ? (
                  <Box paddingInlineStart="200">
                    <List type="bullet">
                      {section.bullets.map((item, bIndex) => (
                        <List.Item key={`b-${index}-${bIndex}`}>{item}</List.Item>
                      ))}
                    </List>
                  </Box>
                ) : null}
                {(section.paragraphsAfter || []).map((paragraph, pIndex) => (
                  <Text key={`pa-${index}-${pIndex}`} as="p" variant="bodyMd">
                    {paragraph}
                  </Text>
                ))}
              </BlockStack>
            ))}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </>
  );
}
