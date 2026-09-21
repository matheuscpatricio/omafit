# Virtual Try-On Inference Pipeline

## Problem

Third-party inference provided a fast path to validating virtual try-on, but the evaluated production path cost approximately **$0.075 per generation** with approximately **25 seconds** of generation latency.

At production volume, both marginal cost and latency became important product constraints.

## Decision

I moved the primary workload to a self-hosted asynchronous inference pipeline on **AWS EC2 GPU infrastructure**.

```text
Client
  │
  ▼
Application API
  │
  ├── create job
  │
  ▼
Async inference job
  │
  ▼
AWS EC2 GPU worker
  │
  ├── inference
  ├── result persistence
  └── failure state
  │
  ▼
Application
  │
  ▼
Client result
```

The application layer remains decoupled from inference execution so long-running GPU work does not block the normal request path.

## Result

| Metric | Third-party path | Self-hosted path | Change |
| --- | ---: | ---: | ---: |
| Cost / generation | ~$0.075 | ~$0.0095 | **-87%** |
| Generation latency | ~25s | ~16s | **-36%** |

The system currently supports approximately **30K virtual try-ons/month**.

## Trade-offs

Self-hosting reduced marginal cost and latency but introduced infrastructure ownership: GPU capacity, job lifecycle, failure handling and deployment now had to be managed as part of the product.

That trade-off was justified once inference volume made per-generation API pricing materially more expensive.
