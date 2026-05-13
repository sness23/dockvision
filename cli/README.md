# @dockvision/cli — `dvk`

Command-line client for [dockvision.doi.bio](https://dockvision.doi.bio).
Talks to the same `/api/cmd` endpoint as the in-browser shell, using an API
key instead of a session cookie.

## Install

```bash
# From the dockvision repo (development):
cd cli
npm link

# Once published:
npm install -g @dockvision/cli
```

## Setup

Generate an API key in the web shell at https://dockvision.doi.bio/app:

```
keys create my-laptop
```

Copy the printed `dvk_*_*` value (shown only once) and either:

```bash
export DOCKVISION_API_KEY=dvk_xxxxxxxx_yyyyyyyyyyy...
# or
mkdir -p ~/.dockvision && echo dvk_xxx_yyy > ~/.dockvision/api-key
```

By default `dvk` talks to `https://dockvision.doi.bio`. Override with
`DOCKVISION_URL=http://localhost:3000` for local dev.

## Usage

```bash
dvk whoami
dvk cost
dvk tools

# upload from local disk to virtual path
dvk upload ./protein.pdb /inputs/protein.pdb

# submit a job
dvk run gnina --receptor /inputs/protein.pdb --ligand /inputs/ligand.sdf

# poll
dvk jobs --running
dvk status <job-id>

# fetch outputs
dvk download /u/42/jobs/<jid>/output/poses.sdf > poses.sdf
```

`dvk` exits with code 1 on `error`-typed responses, so it composes safely in
shell scripts. Pipe to `jq`-style tools when needed.

## Scopes

The current keys grant `read + run`. Top-up (`topup`) is intentionally
session-only — Stripe Checkout flow doesn't work from a CLI.
