# DockVision — Architecture

## Goals

- Run modern protein-ligand docking and co-folding tools (GNINA, Boltz-2,
  Protenix; Chai-1 + DynamicBind later) on serverless GPUs.
- Transparent cost-plus pricing — users see real GPU seconds + storage GB and
  the markup.
- CLI-shaped UI for the shell-fluent scientist; wizard mode as fallback.
- Filesystem metaphor for inputs/jobs/outputs — `ls`, `cat`, `cd`, `du` all work.
- Reproducible: pinned tool versions, deterministic seeds where the tool supports them.
- AGPL-3.0 base platform; self-hostable end-to-end (no SaaS lock-in beyond
  Stripe and RunPod themselves).

## Non-goals (v1)

- Teams / orgs / shared workspaces
- Public REST API for third-party integrators (internal API only)
- Sharing / leaderboards / social
- Wet-lab integrations
- MD trajectories (just docking poses)
- Free tier (minimum $10 prepay)

## Stack

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | SvelteKit (Svelte 5) | Reuses `casp-viewer` pose components; smaller bundle than React; matches lean aesthetic |
| Terminal | xterm.js + clipanion parser | Real shell-like UX, real argv parsing (not regex string-splitting) |
| Pose viewer | Mol* | Industry standard, already in `casp-viewer` |
| Auth | Auth.js (SvelteKit) | Self-hosted, OSS, sessions in Postgres. Email + Google + GitHub + ORCID. |
| DB | Postgres on www0 | Single managed instance, RLS-style isolation in app layer |
| Object store | AWS S3 | Same cloud as www0 (free intra-region transfer); standard tooling |
| Billing | Stripe Billing | Prepaid balance via Checkout; webhook on top-up |
| Compute | RunPod Serverless Endpoints (Docker) | Cheapest per-second GPU; exact `executionTime` in response |
| MSA service | Self-hosted MMseqs2 + ColabFold DB on www0 | Required for Boltz/Protenix; public ColabFold servers won't scale |
| Job queue | pg-boss (Postgres-backed) | Don't trust RunPod's queue alone; need our own retries + idempotency |
| Reconciliation | Node cron worker (pm2 process) | Polls RunPod billing API; alerts on drift |
| Deploy | pm2 on EC2 (www0) | Matches existing convention; supervisord/systemd-equivalent |
| TLS / proxy | nginx on www0 with Let's Encrypt | Standard |

## System layout

All processes run on **www0** (EC2) under pm2:

```
www0 (EC2)
├── nginx                            :443 → SvelteKit  (dockvision.doi.bio)
├── pm2: dockvision-web              SvelteKit SSR + API routes
├── pm2: dockvision-worker           pg-boss job worker, talks to RunPod
├── pm2: dockvision-recon            cron reconciliation + storage debit
├── pm2: dockvision-msa              MMseqs2 server (CPU)
├── postgres (local)                 users, jobs, billing_events, files
└── /var/lib/dockvision/             pg-boss state, MMseqs2 indexes, tmp

External:
├── AWS S3                           dockvision-prod bucket (us-east-1)
├── RunPod                           3 endpoints: gnina, boltz2, protenix
├── Stripe                           Billing + Checkout
└── Clerk                            (optional — Auth.js is the default)
```

## Components

### 1. Frontend (SvelteKit)

Routes:

- `/` — marketing landing, pricing, "try the demo"
- `/signup`, `/login`, `/logout` — Auth.js
- `/app` — the CLI shell (auth required)
- `/billing` — Stripe Customer Portal embed + prepay button
- `/docs` — public docs (this directory rendered with mdsvex)

The CLI shell at `/app`: xterm.js wired to a single command dispatcher. All
commands hit `/api/cmd` and return either plain text or a structured response
(`{type: 'mol-view', file: '...'}` triggers a Mol* modal). WebSocket at `/ws`
streams balance, job status, and a 10-second cost ticker for running jobs.

### 2. Auth (Auth.js)

- Providers: email magic link, Google, GitHub, ORCID.
- Sessions persisted in Postgres (`auth_sessions`, `auth_accounts` per Auth.js schema).
- On first login: insert into `users`.
- API keys: each user can mint long-lived `dvk_*` tokens for CLI/curl access
  from a laptop. Stored argon2-hashed.

### 3. Data model (Postgres)

```sql
-- application user (1:1 with Auth.js user)
users (
  id              uuid primary key,
  auth_user_id    text unique,                   -- Auth.js user.id
  email           text not null,
  balance_cents   bigint not null default 0,     -- single source of truth
  storage_bytes   bigint not null default 0,     -- denormalized; trigger-maintained
  is_academic     boolean not null default false,
  created_at      timestamptz not null default now()
);

-- virtual filesystem entries (real bytes in S3)
files (
  id              uuid primary key,
  user_id         uuid not null references users(id) on delete cascade,
  path            text not null,                 -- "/inputs/protein.pdb"
  s3_key          text not null,                 -- "u/<uid>/inputs/protein.pdb"
  size_bytes      bigint not null,
  mime            text,
  sha256          text,
  pinned          boolean not null default false,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz,                   -- now() + 180 days unless pinned
  unique (user_id, path)
);
create index on files (user_id, expires_at) where pinned = false;

-- every docking run
jobs (
  id                     uuid primary key,
  user_id                uuid not null references users(id) on delete cascade,
  tool                   text not null,         -- 'gnina' | 'boltz2' | 'protenix'
  tool_version           text,
  args                   jsonb not null,
  gpu_class              text not null,         -- 'rtx4090' | 'h100' | ...
  runpod_endpoint_id     text,
  runpod_job_id          text,
  status                 text not null,         -- queued|running|completed|failed|cancelled
  estimated_cost_cents   bigint not null,
  actual_cost_cents      bigint,                -- null until completed
  execution_time_ms      bigint,
  output_dir             text,                  -- '/jobs/<id>/'
  error                  text,
  idempotency_key        text,
  created_at             timestamptz not null default now(),
  started_at             timestamptz,
  completed_at           timestamptz,
  unique (user_id, idempotency_key)
);
create index on jobs (status) where status in ('queued', 'running');

-- every debit/credit on a user's balance
billing_events (
  id                       uuid primary key,
  user_id                  uuid not null references users(id),
  amount_cents             bigint not null,     -- negative = debit
  kind                     text not null,       -- 'topup'|'job'|'storage'|'refund'|'adjust'
  job_id                   uuid references jobs(id),
  stripe_payment_intent    text,
  description              text not null,
  created_at               timestamptz not null default now()
);
create index on billing_events (user_id, created_at desc);

api_keys (
  id              uuid primary key,
  user_id         uuid not null references users(id) on delete cascade,
  key_prefix      text not null,                -- 'dvk_a3b...' (display)
  key_hash        text not null,                -- argon2(full_key)
  name            text not null,
  scopes          text[] not null,              -- ['read', 'run']
  last_used_at    timestamptz,
  revoked_at      timestamptz
);
```

Path isolation enforced at the **app layer**, not RLS — Postgres runs as a
trusted single role. Every query for files/jobs/billing filters by
`user_id = $current_user` and rejects requests where the resolved path doesn't
start with `/u/<user_id>/`.

### 4. Billing (Stripe + balance row)

**Top-up** flow:

1. User runs `topup 20` → Stripe Checkout session created.
2. Checkout completes → Stripe webhook hits `/api/stripe/webhook`.
3. Atomic transaction:
   ```sql
   INSERT INTO billing_events (user_id, amount_cents, kind, stripe_payment_intent, description)
     VALUES ($1, $2, 'topup', $3, 'Stripe top-up');
   UPDATE users SET balance_cents = balance_cents + $2 WHERE id = $1;
   ```
4. WebSocket pushes new balance to the user's xterm.

**Job debit** flow (in the worker on job completion):

1. Pull `executionTime` from RunPod job response.
2. `actual_cost_cents = ceil(executionTime_seconds × gpu_rate_cents_per_sec × 1.5)`
3. Atomic transaction:
   ```sql
   UPDATE jobs SET status='completed', actual_cost_cents=$1, execution_time_ms=$2,
     completed_at=now() WHERE id=$3;
   INSERT INTO billing_events (...) VALUES (..., -$1, 'job', $3, ...);
   UPDATE users SET balance_cents = balance_cents - $1 WHERE id = $user;
   ```

**Storage charge** (daily cron):

- Compute current `storage_bytes` per user from `sum(files.size_bytes)`.
- Above 5 GB free tier: debit `(storage_bytes - 5_GB) / 1e9 × 4_cents / 30` for one day.
- Single `billing_events` row per user per day with `kind='storage'`.

**Hard cap at submit time**:

```sql
BEGIN;
SELECT balance_cents FROM users WHERE id=$1 FOR UPDATE;
-- in app: if balance < estimated * 1.2 → reject
INSERT INTO jobs (...);
COMMIT;
```

**Auto-cancel** (mid-run): the worker cron polls `running` jobs every 30s;
if `users.balance_cents < 0`, send RunPod cancel and mark the job `cancelled`.

### 5. Compute (RunPod Serverless)

One endpoint per tool, each pinned to the right GPU class:

| Tool | GPU | $/sec (RunPod Flex) | Typical runtime |
|---|---|---|---|
| gnina | RTX 4090 (24 GB) | $0.000310 | 1-5 min |
| boltz2 | H100 (80 GB) | $0.00116 | 2-8 min |
| protenix | H100 (80 GB) | $0.00116 | 3-10 min |

**Handler contract** — every worker handler must return:

```json
{
  "output_s3_keys": ["jobs/<id>/output/pose_1.sdf", "..."],
  "cost_seconds": 234.5,
  "gpu": "h100",
  "tool_version": "boltz2-2.1.0",
  "seed": 42,
  "error": null
}
```

`cost_seconds` is the handler's own wall-clock measurement, used as a sanity
check against RunPod's reported `executionTime`. If they diverge by >10%, log
a warning and trust RunPod (since that's what gets billed).

**Pre-flight estimate**: each tool ships with a `typical_runtime_seconds`
constant. Estimate = `typical × gpu_rate × 1.5`. Recalibrated weekly from
observed p50 runtimes.

**Cold start strategy**:

- GNINA: small image (~3 GB), no weights baking needed.
- Protenix: weights ~5 GB, bake into the Docker image.
- Boltz-2: weights ~15 GB, mount via RunPod **network volume** at
  `/runpod-volume/`. Single network volume per tool, replicated to each datacenter
  the endpoint runs in.
- Keep 0 Active workers until traffic justifies paying for warmth.

**Max job time**: 1 hour default per endpoint; tool-specific overrides via
`config/tools/<tool>.json`.

### 6. Storage (AWS S3)

- Bucket: `s3://dockvision-prod/` in `us-east-1` (co-located with www0).
- Layout: `s3://dockvision-prod/u/<user_id>/...`
- All large artifacts live in S3. Postgres only holds metadata + paths.
- **Upload**: presigned PUT — browser → S3 directly (no www0 bandwidth).
- **Download**: presigned GET (1-hour TTL), generated on `cat`/`download`.
- **Storage metering**: a Postgres trigger on `files` maintains
  `users.storage_bytes`. Daily cron debits the storage charge.
- **Expiry**: S3 lifecycle rule deletes objects with `tag:expires=<date>`
  past TTL. A nightly job tags newly-expired files and prunes the `files` row.
- **Egress**: www0 → S3 → user-internet. S3 → internet egress = $0.09/GB
  (first 10 TB/mo). Folded into the 1.5× markup for now; if download traffic
  becomes a margin problem, add an explicit `$0.05/GB download fee` later.

### 7. MSA service

Required for Boltz-2 and Protenix (GNINA does not use MSAs).

- Single pm2 process on www0: MMseqs2 server with the ColabFold-style DB on an
  EBS volume (~700 GB).
- API: `POST /msa { sequence }` → `{ a3m_url, cache_hit }`.
- Cache: keyed by sha256 of canonical sequence. A3M files stored in
  `s3://dockvision-prod/msa-cache/<sha256>.a3m`.
- Workers fetch A3Ms directly from S3 on cache hit; re-hit MMseqs2 only on miss.
- MSA cost amortized into the per-job 1.5× markup; not separately billed.

### 8. Reconciliation worker

pm2 process, runs every 15 min:

1. List all jobs `completed` or `failed` in the last 24h.
2. Pull RunPod billing/usage API for the same window.
3. Compare RunPod total cost vs `sum(actual_cost_cents / 1.5)` ± 5%.
4. If drift > $0.50: alert (email + a `system_alerts` row); freeze new submits
   until acked.

Same process runs daily at 00:05 UTC to debit storage.

### 9. Job lifecycle

```
       submit
         │
         ▼
   ┌──────────┐   balance check    ┌──────────┐
   │  queued  │ ─────────────────► │ rejected │
   └──────────┘   (insufficient)    └──────────┘
         │
         │ pg-boss picks up
         ▼
   ┌──────────┐
   │ running  │ ─── RunPod error ─► failed     (no charge)
   └──────────┘
         │
         │ handler returns
         ▼
   ┌──────────┐   balance < 0       ┌────────────┐
   │completed │ ─── (mid-run) ────► │ cancelled  │
   └──────────┘                     └────────────┘
```

### 10. CLI dispatcher

Single API route: `POST /api/cmd { line: string, cwd: string }`.

Server tokenizes with clipanion, validates with zod schemas, dispatches to
`src/lib/cli/<cmd>.ts`. Each handler returns:

```ts
type CmdResponse =
  | { type: 'text', body: string }
  | { type: 'table', headers: string[], rows: string[][] }
  | { type: 'mol-view', file: string }
  | { type: 'error', message: string };
```

xterm renders text/table/error inline; `mol-view` triggers a Mol* modal.

## Filesystem layout (virtual)

```
/u/<user>/
├── inputs/                          # user-uploaded inputs
│   ├── protein.pdb
│   ├── ligand.sdf
│   └── target.json
├── jobs/<job_id>/
│   ├── meta.json                    # synthetic: tool, args, gpu, cost, timing
│   ├── input/                       # snapshot of inputs at submit-time
│   ├── output/                      # CIFs, SDFs, scores
│   └── log                          # worker stdout/stderr
└── pinned/                          # references to files immune from auto-expiry
```

- All paths in `files.path`. Real bytes in S3 under `s3_key`.
- `ls /u/<me>/jobs/` is a Postgres query, not an S3 list.
- `cat /u/<me>/jobs/abc/meta.json` reads `jobs` row, returns synthetic JSON.

## Security

- **Path isolation**: every CLI command resolves `~` and relative paths
  against `/u/<auth.uid>`. Hard-reject any path that doesn't start with that
  prefix. Enforced in `src/lib/fs/resolve.ts` — single chokepoint.
- **Restricted CLI surface**: no `eval`, no `bash`, no pipes-to-shell. The CLI
  is a finite grammar — see [`CLI.md`](CLI.md).
- **Worker isolation**: each RunPod handler receives only `{input_urls,
  output_prefix, args}`. No user identity passed. Outputs uploaded via per-job
  presigned PUTs scoped to `s3://dockvision-prod/u/<uid>/jobs/<jid>/output/*`.
- **Rate limits**: 5 concurrent jobs/user; 100 submits/hour/user; 100 GB/file upload.
- **Input scanning**: ClamAV scan on every upload before marking the `files`
  row valid.
- **Secrets**: RunPod API key, Stripe secret, Auth.js secret in
  `/etc/dockvision/env` (root-owned, 600). Never in repo.
- **TLS**: nginx + Let's Encrypt, HSTS, CSP. Mol* CDN allowlisted.

## Open questions

- Whether to keep Auth.js or swap in Clerk if Auth.js OAuth flows get painful
  (decision deadline: end of Phase 1).
- Whether to put Postgres on RDS instead of local for backup/PITR convenience.
- Mol* — host the assets ourselves vs CDN.
- Direct ORCID auth priority (high for academic adoption).
- Whether to publish the GitHub repo immediately (public from day 1) or after
  Phase 1 stabilizes.
