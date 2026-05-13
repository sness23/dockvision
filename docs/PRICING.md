# DockVision — Pricing

## Model: cost-plus, transparent

Every job shows both the **real GPU cost** charged to us by RunPod and the
**DockVision markup** that funds platform overhead, failure absorption, and
margin.

```
billed_cents = ceil(executionTime_seconds × gpu_rate_cents_per_sec × 1.5)
```

The `1.5×` covers:

- Failed jobs we still pay RunPod for (~5% of runs)
- MSA service compute (amortized across Boltz/Protenix runs)
- S3 egress to user downloads ($0.09/GB)
- Reconciliation / monitoring infra on www0
- Margin

If you want to skip the markup, the platform is AGPL-3.0 —
[self-host](https://github.com/sness23/dockvision). Bring your own RunPod,
Stripe, and S3 — pay providers directly. We sell ergonomics, not access.

## GPU rates (Flex, RunPod, May 2026)

| GPU | VRAM | $/sec (RunPod) | $/sec (you pay) | $/hr (you pay) |
|---|---|---|---|---|
| RTX 4090 | 24 GB | $0.000310 | $0.000465 | $1.67 |
| L40S | 48 GB | $0.000530 | $0.000795 | $2.86 |
| A100 80GB | 80 GB | $0.000760 | $0.001140 | $4.10 |
| H100 80GB | 80 GB | $0.001160 | $0.001740 | $6.27 |
| H200 | 141 GB | $0.001550 | $0.002325 | $8.37 |
| B200 | 180 GB | $0.002400 | $0.003600 | $12.96 |

Rates re-synced weekly from RunPod's pricing endpoint.

## Per-tool typical compute cost

Calibrated against CASP15/16 benchmark data from
`~/data/vaults/casp` — these are real observed costs from prior runs.

| Tool | GPU | Typical runtime | Typical cost (user) |
|---|---|---|---|
| GNINA | RTX 4090 | 1-5 min | $0.03 - $0.14 |
| Boltz-2 | H100 | 2-8 min | $0.21 - $0.84 |
| Protenix | H100 | 3-10 min | $0.31 - $1.05 |

Each tool's landing page shows a live pre-flight estimate based on input
size at submit time.

## Storage

We **also bill for storage**, separately from compute. Most users won't notice
until they accumulate big runs.

- **First 5 GB**: free. Covers most users for their first month or two.
- **Above 5 GB**: **$0.04 per GB-month**, billed daily as
  `(GB - 5) × $0.04 / 30` per day.
- **Cold tier at 60 days**: S3 lifecycle moves objects to S3 Infrequent Access.
  Cold pricing drops to $0.0125/GB-month internally — we pass that through as
  $0.015/GB-month with a 1.2× markup on cold files.
- **Auto-delete at 180 days**: anything older than 180 days and `pinned = false`
  is deleted. `pin <path>` makes a file immune.

A daily `billing_events` row with `kind='storage'` and a brief description
(`"Storage: 12.4 GB · $0.030"`) keeps the ledger auditable.

## Failure billing policy

- **Worker crashes, OOM, network errors**: no charge to user. We eat the RunPod cost.
- **Tool returns failure status**: no charge.
- **User cancels mid-run**: charged for elapsed `executionTime` up to cancel.
- **Job exceeds tool-specific max-runtime cap**: hard-killed, no charge.

We track absorbed cost in `billing_events` with `kind='adjust'` and a negative
"platform absorbed RunPod cost" entry to a system account — keeps the books straight.

## Pre-flight estimate

Before any `run`, the CLI shows:

```
$ run boltz2 --target /inputs/T1313.json
estimated cost: $0.42  (240s typical × $0.00174/s × 1.5)
balance after: $9.58
proceed? [y/N]
```

Pre-flight uses `typical_runtime × gpu_rate × 1.5`. Actual cost is computed
from real `executionTime` and can differ by ±50% in worst case (model
convergence, input size).

## Hard caps

- Submission rejected if `balance_cents < estimated × 1.2` (20% safety buffer).
- Mid-run auto-cancel: cron checks running jobs every 30s; if balance drops
  negative, RunPod cancel sent.
- Max 5 concurrent running jobs per user.
- Max 100 job submits per rolling hour per user.
- Max 100 GB per file upload.

## Top-up

- Minimum top-up: **$10**.
- No free tier in v1.
- Stripe Checkout in test mode initially; switch to live before public launch.
- Balance never expires.

## Refunds

- Reversed on request for documented platform bugs within 30 days.
- Top-ups non-refundable after 30 days of inactivity (state aggregator law in
  some US states + Stripe rules).
- Storage charges incurred on data that became inaccessible due to our error
  are auto-refunded.

## Self-host pricing

The AGPL-3.0 source at `github.com/sness23/dockvision` builds a fully working
instance. Self-hosters pay:

- AWS EC2 + S3 (or equivalent)
- RunPod (per-second GPU)
- Stripe (transaction fees only; no need to use the prepay flow internally)

No DockVision license fee. AGPL requires that if you operate a modified version
as a network service, you publish the modifications. Read the license.

## Why 1.5× and not 2× or 3×

- **Fovus** runs Boltz-1 at $0.10/structure as a public floor.
- **Neurosnap** academic credit ≈ €1.10 = ~$1.20, and a typical Boltz run is
  1-3 credits = ~$1.20-3.60 — that's a ~3-5× markup over raw RunPod.
- **2× to 3×** is the easy-money zone, but it invites a transparent
  competitor.
- **1.5×** undercuts Neurosnap meaningfully while still funding overhead. If
  reconciliation shows we're losing money on failures or MSAs, tune up to 1.6-1.8×
  with a public changelog entry. If we discover a moat (better viewers, better
  CASP integration), we can tune up; if churn says the markup is felt, tune down.

The markup is a config constant. Changes are logged.
