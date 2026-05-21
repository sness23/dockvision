# DockVision — Competitive Research

Synthesized 2026-05-12. Sources at bottom.

## Closest competitors

### Neurosnap (neurosnap.ai)

Pricing (annual, EUR):

| Plan              | Price/yr      | Credits     | Parallel jobs |
| ----------------- | ------------- | ----------- | ------------- |
| Free              | €0            | 1 credit    | 2             |
| Academic Budget   | €93.50        | 84          | 7             |
| Academic Standard | €185.90       | 168         | 14            |
| Academic          | €280.50       | 300         | 30            |
| Professional      | €880          | 720         | 60            |
| Enterprise A/B/C  | €5,500-10,956 | 1,200-4,000 | 5-10 seats    |

Implied credit cost ≈ **€1.10-1.22 per credit** at academic tier. Credits do not
expire. Each job shows "Estimated Credits" before launch.

**Tool catalog**: Boltz-1, Chai-1, Protenix, AlphaFold2, RoseTTAFold2,
DiffDock-L, GNINA, DynamicBind, FlowDock, ProteinMPNN, RFdiffusion2, GROMACS.

**Strengths**: broad tool catalog, no-card free tier for academics,
built-in 3D viewer, persistent credits.

**Weaknesses**: opaque per-run cost until login; Euro pricing confuses US
users; "unlimited storage" is soft-quota'd in practice.

### Tamarind Bio (tamarind.bio)

Pricing hidden behind "Contact us". YC-backed, $13.6M Series A. Tools:
AlphaFold, Chai-1, RFdiffusion, MPNN, GROMACS, Smina, EquiDock, GNINA,
RFantibody.

**Sentiment**: free tier perceived as demo-only; reviewers cite "tens of
thousands/year" for real use. Strong on antibody/binder tooling. Generally
reads as enterprise-focused.

### Fovus

Runs Boltz-1 at **$0.10/structure** (21 min, includes complex cases). Public
price floor for Boltz-class workloads. Not a full bio-SaaS — general compute
that happens to host Boltz.

### Others reviewed

- **NVIDIA BioNeMo** — NIM microservices, opaque enterprise pricing.
- **Lightning AI** — general-purpose; ~$49/mo + $5-15/hr credits.
- **Chai Discovery (hosted)** — own free playground with rate limits. No marketplace.
- **Helixon / OpenADMET / Inductive Bio** — adjacent, not direct competitors.

## Pricing benchmarks for our tools

Inferred from Neurosnap credit cost and observed runtimes:

| Tool        | Typical runtime (H100) | Suggested user price | Notes                                       |
| ----------- | ---------------------- | -------------------- | ------------------------------------------- |
| Boltz-2     | 2-8 min                | $0.20 - $0.80        | Fovus floor = $0.10                         |
| Protenix    | 3-10 min               | $0.40 - $1.20        |                                             |
| Chai-1      | 2-6 min                | $0.20 - $0.70        | Chai's own playground is free, rate-limited |
| DynamicBind | 5-20 min               | $0.80 - $2.50        | License blocker for commercial              |
| GNINA       | 1-5 min (4090 OK)      | $0.05 - $0.30        |                                             |

At our 1.5× cost-plus markup on RunPod Flex:

- GNINA 3-min on RTX 4090: `$1.10/hr × 0.05 hr × 1.5 = $0.083`
- Boltz-2 5-min on H100: `$4.18/hr × 0.083 hr × 1.5 = $0.52`
- Protenix 6-min on H100: `$4.18/hr × 0.1 hr × 1.5 = $0.63`

Competitive with Fovus on Boltz; undercuts Neurosnap on transparency.

## RunPod product taxonomy (May 2026)

Three distinct products:

1. **Serverless Endpoints** (mature) — Docker + handler, billed per-second.
   **What we use.**
2. **Hub** — open-source model marketplace; beta. Not for custom docking.
3. **Flash** (GA Apr 30 2026) — Pure-Python `@Endpoint` decorator, no Docker.
   Limit: can't install conda-heavy stacks (OpenMM, RDKit). **Wrong fit for
   our tools.**

Flex pricing (May 2026):

| GPU              | Flex $/sec | Active $/sec | $/hr Flex |
| ---------------- | ---------- | ------------ | --------- |
| B200 (180 GB)    | $0.00240   | $0.00190     | $8.64     |
| H200 (141 GB)    | $0.00155   | $0.00124     | $5.58     |
| H100 (80 GB)     | $0.00116   | $0.00093     | $4.18     |
| A100 (80 GB)     | $0.00076   | $0.00060     | $2.72     |
| L40S (48 GB)     | $0.00053   | $0.00037     | $1.90     |
| RTX 4090 (24 GB) | $0.00031   | $0.00021     | $1.10     |

Network volume: $0.07/GB-mo (<1TB), $0.05 (>1TB), $0.14 (high-perf). No egress.

**Cold starts**: marketing claims sub-200ms for 48% of starts. Reality with
30+GB images + 5-50GB weights: **30-60s typical, 1-2min worst case**.

**SDK / cost capture**: `runpod.Endpoint(id).run(...)` returns
`{id, status, delayTime, executionTime, output}`. Billed = `executionTime` on
Flex (queue time free). Multiply by GPU rate for exact cost.

**Limits**: `/runsync` max payload **20 MB**. Async output retained 30 min.
Default max job time 600s, configurable to 7 days. Default 3 max workers per
endpoint (request increase).

**Output > 20 MB**: configure S3 upload — response becomes
`{"type":"s3_url","data":"..."}`. We use our own S3 bucket (`dockvision-prod`);
RunPod doesn't provide artifact storage.

## Alternative compute (briefly)

- **Modal** — best DX, Python-native, ~$3.95/hr H100, 2-4s cold starts.
  Pricier, can't BYO datacenter. Real contender for v2.
- **Replicate** — $5.49/hr H100, great for public demos, weak for custom pipelines.
- **Beam** — ~$3.50/hr H100, Modal-like, smaller.
- **Lambda Cloud** — VM-style only, no scale-to-zero. Skip.

RunPod wins on per-second price and exact billed-seconds in response. Modal
is a plausible v2 alternative if cold-start UX becomes a complaint.

## CLI-style UI prior art

**Nobody in bio-SaaS does this.** All competitors use forms/wizards. Closest
precedent: Warp, Modal CLI, fly.io, replit shell. CASP audience is heavily
Linux/bash-fluent — a CLI-style web UI is a real differentiator.

**Risk**: alienates wet-lab scientists. **Mitigation**: `wizard <tool>` drops
into form mode.

## Auth/payment stack consensus (2026)

- **Stripe Billing** with metered events. 2026 AI-usage SKUs are the right primitive.
- **Auth.js** (formerly NextAuth) for SvelteKit — self-hosted, OSS, fits AGPL ethos.
  Clerk is the SaaS alternative if Auth.js becomes painful.
- **Postgres** for users/jobs/billing metadata. Trigger-maintained
  `storage_bytes` denorm.
- **AWS S3** for artifacts (co-located with www0 in us-east-1; free intra-region
  transfer; $0.09/GB egress to internet).

## Sources

- Neurosnap pricing: graphstats.net/neurosnap-pricing; neurosnap.ai/services
- Tamarind pricing: tamarind.bio/pricing
- Fovus Boltz price: fovus.co/2025/03/03/achieving-cost-efficient-boltz-1-simulations
- RunPod docs: docs.runpod.io/serverless/pricing; runpod.io/pricing
- RunPod Flash launch: runpod.io/blog/flash-is-ga
- FlashBoot: runpod.io/blog/introducing-flashboot-serverless-cold-start
- Serverless GPU comparison: introl.com/blog/serverless-gpu-platforms-runpod-modal-beam-comparison-guide-2025
- BioStars Neurosnap vs Tamarind: biostars.org/p/9597524/
- Protein folding SaaS pricing: getmonetizely.com/articles/what-is-protein-folding-saas-and-how-to-navigate-biological-structure-prediction-pricing
- Boolean Biotech (AF3, Boltz, Chai-1 overview): blog.booleanbiotech.com/alphafold3-boltz-chai1
