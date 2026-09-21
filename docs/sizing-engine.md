# Deterministic Sizing Engine

## Why deterministic?

Sizing is a constrained recommendation problem. Predictability and explainability mattered more than generative flexibility, so I deliberately did **not** use an LLM for the core recommendation.

## Inputs

The engine combines:

- body measurements
- BMI adjustments
- body-profile calibration
- customer fit preference
- garment-specific measurement weighting
- fabric elasticity tolerance

## Recommendation logic

At a high level:

```text
Body measurements
      │
      ▼
Profile / BMI calibration
      │
      ▼
Garment-specific measurements
      │
      ├── fit preference
      ├── elasticity tolerance
      └── category weighting
      │
      ▼
Asymmetric penalty scoring
      │
      ▼
Candidate size ranking
      │
      ▼
Confidence score
```

The penalty model is asymmetric because recommending an overly tight garment can be more costly than recommending a slightly looser one. Confidence incorporates the quality of the winning score and its separation from competing sizes.

## Result

The current system has measured **95% recommendation accuracy**.

This component is intentionally documented at the architectural level; proprietary coefficients and production calibration data are not public.
