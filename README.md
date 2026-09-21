# Omafit

**AI infrastructure and full-stack SaaS for fashion e-commerce.**

Omafit helps fashion stores improve product discovery, sizing and purchase confidence through AI virtual try-on, personalized size recommendations and context-aware shopping assistance.

> This repository represents the Shopify application layer of Omafit. Some production infrastructure and proprietary AI components are intentionally not public.

## Production impact

- **20+ e-commerce stores** and ~900 catalog products
- **~30,000 virtual try-ons/month**
- **87% lower inference cost** compared with third-party API inference ($0.075 → $0.0095 per generation)
- **36% lower generation latency** (25s → 16s)
- **95% sizing recommendation accuracy**
- Participating merchants reported an average **46% reduction in returns** and **39% increase in conversion** after two months

## Engineering highlights

### AI inference

The virtual try-on workflow uses an asynchronous inference architecture with self-hosted GPU infrastructure on AWS EC2. The production flow handles job creation, polling and failure states while keeping the application layer decoupled from inference execution.

Moving the primary workload to self-hosted inference reduced marginal generation cost by 87% and latency by 36% compared with the evaluated third-party API path.

### Sizing engine

Omafit includes a deterministic recommendation engine that combines:

- body measurements and BMI adjustments
- body-profile calibration
- customer fit preference
- garment-specific measurement weighting
- fabric elasticity tolerance
- asymmetric penalties for overly tight recommendations
- confidence scoring

The system currently achieves a measured **95% recommendation accuracy rate**.

### Context-aware AI shopping

The conversational shopping layer retrieves matching catalog data before injecting product context into the LLM. This constrains recommendations to real store inventory and reduces unnecessary context while supporting product discovery and styling workflows.

### Shopify integration

The application integrates with Shopify across:

- Admin API and Storefront API
- OAuth authentication
- managed billing
- webhook processing
- product synchronization
- merchant configuration
- customer-facing storefront workflows

## Architecture

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
```

## Engineering documentation

- [System architecture](docs/architecture.md)
- [Virtual try-on inference pipeline](docs/inference-pipeline.md)
- [Deterministic sizing engine](docs/sizing-engine.md)
- [Shopify integration](docs/shopify-integration.md)

These notes document the engineering decisions and architecture behind the production system without exposing proprietary implementation details.

## Core stack

**Frontend:** React, TypeScript, JavaScript  
**Backend:** Node.js, Python, REST APIs  
**Data:** PostgreSQL, Supabase  
**AI:** Computer Vision, LLM integrations, agentic workflows  
**Cloud:** AWS EC2, Railway, Netlify  
**Commerce:** Shopify Admin API, Storefront API, OAuth, Billing, Webhooks

## About the engineering work

Omafit was built from 0→1 with end-to-end ownership across product architecture, frontend, backend, data modeling, AI integration, Shopify infrastructure, cloud deployment and production iteration.

The engineering focus has been less about adding isolated AI features and more about making AI workflows economically viable and reliable enough to operate inside real e-commerce stores.

## Links

- Product: https://omafit.co
- LinkedIn: https://www.linkedin.com/in/matheuscpatricio
- GitHub: https://github.com/matheuscpatricio

---

Built by **Matheus Patrício** — Founding Engineer / AI Product & Full-Stack Engineer.