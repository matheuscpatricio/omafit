# Shopify Integration

Omafit's Shopify integration connects merchant commerce data with the application and AI workflows.

## Integration surface

- Shopify Admin API
- Shopify Storefront API
- OAuth authentication
- managed billing
- webhooks
- product synchronization
- merchant configuration
- customer-facing storefront workflows

## High-level flow

```text
Shopify Admin
     │
     ├── OAuth / installation
     ├── catalog synchronization
     ├── billing
     └── webhooks
     │
     ▼
Omafit Application
     │
     ├── merchant configuration
     ├── product data
     ├── sizing
     └── AI orchestration
     │
     ▼
Shopify Storefront
     │
     └── customer-facing Omafit experience
```

## Product-data grounding

Catalog data is synchronized into the application so AI-assisted product discovery can operate against real merchant inventory rather than unconstrained model knowledge.

This same commerce layer supplies product context to virtual try-on and sizing workflows.

## Scale

The production integration supports **20+ merchants** and approximately **900 catalog products**.
