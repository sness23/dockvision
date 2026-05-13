# DockVision

Open-source, CLI-shaped web platform for running modern protein-ligand docking
and co-folding tools (GNINA, Boltz-2, Protenix, and more) on serverless GPUs,
with transparent per-second pricing.

Built for the scientist who already lives in a shell. CASP-aware from day one.

- **Production**: https://dockvision.doi.bio
- **License**: AGPL-3.0-or-later (see [`docs/LICENSES.md`](docs/LICENSES.md))
- **Status**: pre-alpha. Planning phase. See [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Why

Existing platforms (Neurosnap, Tamarind) hide their per-run cost behind credit
systems and bundle "unlimited" storage that isn't actually unlimited. DockVision
shows you the real RunPod cost, marks it up transparently (1.5×), and bills you
for exactly the bytes you store. The base platform is AGPL-3.0 — self-host if
you want to, pay providers directly, no DockVision markup.

The hosted instance at `dockvision.doi.bio` exists for users who want
one-click signup, no infra, and a paid 1.5× ergonomics premium over self-hosting.

## Stack at a glance

| Layer | Choice |
|---|---|
| Frontend | SvelteKit (Svelte 5) + xterm.js + Mol* |
| Auth | Auth.js (SvelteKit) — email + OAuth, sessions in Postgres |
| DB | Postgres on www0 |
| Object store | AWS S3 |
| Billing | Stripe Billing + prepaid balance row |
| Compute | RunPod Serverless Endpoints (one per tool) |
| MSA | Self-hosted MMseqs2 + ColabFold DB on www0 |
| Job queue | pg-boss (Postgres-backed) |
| Deploy | pm2 on EC2 (www0) |

## Docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design + data model
- [`docs/PRICING.md`](docs/PRICING.md) — cost-plus model, storage billing
- [`docs/CLI.md`](docs/CLI.md) — terminal interface grammar
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — MVP build plan
- [`docs/RESEARCH.md`](docs/RESEARCH.md) — competitive landscape (as of 2026-05-12)
- [`docs/LICENSES.md`](docs/LICENSES.md) — AGPL + ML model license compliance

## Local dev

Requires Node 22+ and a Postgres 14+ instance.

```bash
# 1. install
npm install

# 2. configure env
cp .env.example .env
# edit .env: set DATABASE_URL, generate AUTH_SECRET via `openssl rand -base64 32`

# 3. apply migrations
createdb dockvision    # or use your existing instance
npm run migrate

# 4. run
npm run dev            # http://localhost:3000
```

Auth.js works with email magic links once `EMAIL_HOST`/`EMAIL_FROM` are set. Google/GitHub
OAuth load conditionally on `AUTH_GOOGLE_ID` / `AUTH_GITHUB_ID` being present.

## Deploy (www0)

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#system-layout) for the pm2 + nginx layout.
Process map: `dockvision-web` (SvelteKit), `dockvision-worker` (pg-boss), `dockvision-recon`
(reconciliation cron), `dockvision-msa` (MMseqs2). Config in [`ecosystem.config.cjs`](ecosystem.config.cjs).
TLS via [`nginx.conf.example`](nginx.conf.example) + Let's Encrypt.
