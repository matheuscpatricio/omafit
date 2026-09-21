# System Architecture

This document describes Omafit's production architecture at a high level. Proprietary implementation details, credentials and private infrastructure are intentionally excluded.

## System flow

```text
Shopify Storefront / Admin
          │
          ▼
   Omafit Application
   ├── Merchant dashboard
   ├── Product & store configuration
   ├── Sizing engine
   ├── Analytics
   └── AI orchestration
          │
          ├──────────────► PostgreSQL / Supabase
          │
          ├──────────────► LLM / product-context workflows
          │
          └──────────────► Async Try-On Pipeline
                              │
                              ▼
                         AWS EC2 GPU
                              │
                              ▼
                            Result
```

## Design principles

### Separate deterministic logic from generative AI

Sizing is handled by a deterministic recommendation engine rather than an LLM. The system combines body measurements, BMI adjustments, fit preferences, garment-specific weighting, fabric elasticity, asymmetric penalties and confidence scoring.

Generative AI is used where probabilistic output is useful: virtual try-on and conversational product discovery.

### Decouple inference from the application layer

Virtual try-on runs asynchronously. The application creates and tracks jobs while GPU inference executes independently, keeping long-running inference outside the request/response path.

### Ground recommendations in merchant data

Product data is retrieved and filtered before it is injected into the conversational AI context. This constrains recommendations to products available in the merchant catalog.

### Keep commerce infrastructure isolated

Shopify authentication, billing, webhooks and catalog synchronization are treated as infrastructure concerns separate from AI inference.

## Production scale

- 20+ e-commerce stores
- ~900 catalog products
- ~30K virtual try-ons/month
