# DockVision — Roadmap

## Phase 0 — Scaffolding (week 0)

- [ ] SvelteKit project with TypeScript, ESLint, Vitest
- [ ] Postgres set up on www0 (or RDS if we decide that early)
- [ ] Auth.js with email magic link + Google OAuth working
- [ ] Postgres schema migrations (see [`ARCHITECTURE.md`](ARCHITECTURE.md))
- [ ] S3 bucket `dockvision-prod` + IAM policy (per-prefix scoping)
- [ ] RunPod account + API key in `/etc/dockvision/env`
- [ ] Stripe account in test mode + Customer Portal configured
- [ ] DNS: `dockvision.doi.bio` → www0; nginx + Let's Encrypt
- [ ] pm2 ecosystem file with the 4 processes: web, worker, recon, msa
- [ ] Repo public on GitHub under AGPL-3.0
- [ ] CI: lint, typecheck, unit tests on PRs

**Deliverable**: empty SvelteKit app live at `dockvision.doi.bio`; signup →
login → empty `/app` works.

## Phase 1 — GNINA end-to-end (week 1)

- [ ] xterm.js CLI shell at `/app`
- [ ] CLI commands: `whoami`, `cost`, `tools`, `tool gnina`, `topup`
- [ ] Stripe Checkout for prepay → balance increments via webhook
- [ ] S3 upload flow: `upload <file>`, presigned PUT from browser
- [ ] FS commands: `ls`, `cat`, `cd`, `pwd`, `du`, `pin`, `unpin`, `rm`, `mv`, `cp`
- [ ] GNINA Docker image + RunPod endpoint configured
- [ ] Handler returns `{output_s3_keys, cost_seconds, gpu, error}`
- [ ] pg-boss job worker: submit → poll RunPod → debit balance → S3 outputs
- [ ] Pre-flight estimate displayed before submit
- [ ] Hard balance cap at submit (`balance >= estimated × 1.2`)
- [ ] Job commands: `jobs`, `status`, `cancel`, `log`
- [ ] WebSocket balance ticker + job status updates

**Deliverable**: a paying user can run GNINA on real CASP inputs, pay real
money, get real outputs.

## Phase 2 — Boltz + Protenix (week 2)

- [ ] MSA service: pm2 process for MMseqs2 + ColabFold DB on EBS volume on www0
- [ ] S3-backed MSA cache by sequence sha256
- [ ] Boltz-2 Docker image (weights on RunPod network volume)
- [ ] Protenix Docker image (weights baked, ~5 GB)
- [ ] Adapters for both tools, ported from `~/data/vaults/casp/inputs/adapters/`
- [ ] `run boltz2`, `run protenix` end-to-end
- [ ] Per-tool pre-flight estimate calibration cron (recompute from p50 of
      last 100 successful runs)

**Deliverable**: catalog of three tools, all billed correctly, MSA caching
working with measurable hit rate.

## Phase 3 — Viewer + polish + CLI shim (week 3)

- [ ] Mol* viewer integration (`view <file.cif>`) — port from `casp-viewer/`
- [ ] Wizard mode (`wizard <tool>`) — form fallback
- [ ] Tab-completion in xterm (commands + path-completion via API)
- [ ] API key issuance (`keys create`, `keys revoke`)
- [ ] Public CLI shim: `npm install -g @dockvision/cli` — `dvk` binary
- [ ] Reconciliation worker (pm2 process)
- [ ] Daily storage debit cron
- [ ] Marketing landing at `/` with pricing
- [ ] Public docs site (this directory rendered with mdsvex)

**Deliverable**: production-feeling product. Reproduces a user's CASP run
end-to-end. `dvk` works from a laptop.

## Phase 4 — Soft launch (week 4)

- [ ] Invite ~5 CASP-affiliated scientists for feedback
- [ ] Monitor reconciliation drift; tune the 1.5× markup if needed
- [ ] Status page: `dockvision.doi.bio/status` (queue depth, recent failures)
- [ ] Announce on r/MachineLearning, Mastodon biotech, BioStars
- [ ] CASP17 timing alignment: ship before CASP17 ligand round

**Deliverable**: external users running real workloads. First $100 of revenue.

## Out of scope (v2+)

- Teams / orgs / shared workspaces
- Public REST API (just internal API + the `@dockvision/cli` shim)
- DynamicBind (license review)
- Chai-1 (license review; Chai's free playground is competitive pressure)
- AlphaFold3 (Google license blocker — likely permanent)
- IntelliFold
- Leaderboards / sharing
- Pose refinement (`meta_pose`, etc.)
- MD trajectories
- Free tier
- Native mobile apps
- Multi-region S3

## Risks tracked

| Risk | Likelihood | Mitigation |
|---|---|---|
| RunPod GPU shortage at peak | High | Vast.ai fallback wired in worker; queue depth alerts |
| Cold start > 2 min on Boltz | High | Network volume w/ baked weights; 1 Active worker if traffic warrants |
| Stripe chargeback on $10 prepay | Medium | Require email verification; flag suspicious top-ups |
| Tool license changes mid-flight | Medium | Nightly CI checks upstream LICENSE files; alert on diff |
| Reconciliation drift > $1/day | Medium | Page on drift; freeze submits until reconciled |
| User uploads malware as "input" | Low | ClamAV on every S3 upload; strict file-type allowlist |
| OOM on user-provided huge ligand | Medium | Per-tool input size caps enforced at submit time |
| www0 EC2 dies | Medium | Daily Postgres backup to S3; runbook for cold restore |
| MSA index corruption | Low | Quarterly re-download of ColabFold DB; checksums |
| S3 egress bill spike from public sharing | Medium | No public sharing in v1; rate-limit downloads per user |
