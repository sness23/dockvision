# DockVision — CLI Grammar

The primary interface is an in-browser terminal (xterm.js) wired to a
restricted shell-like grammar. No `bash`, no `eval`, no pipes-to-shell —
every command is parsed by [clipanion](https://mael.dev/clipanion) and
dispatched to a typed handler.

## Design rules

- Every command terminates. No long-running interactive shells (no `vim`).
- Every command is idempotent or explicit about side effects.
- Every path is resolved against the user's root `/u/<user_id>/`. Paths
  escaping that root are rejected.
- Tab-completion on commands, paths, and tool arguments.
- Server-rendered output — no client-side state for files/jobs.

## Command surface (v1)

### Filesystem

| Command | Description |
|---|---|
| `ls [path]` | List files at path. Defaults to cwd. |
| `cd <path>` | Change cwd (session-local — stored in client state, sent with each request). |
| `pwd` | Print cwd. |
| `cat <file>` | Print file to terminal (text only; binary errors with a hint to use `download` or `view`). |
| `view <file>` | Open in Mol* viewer (CIF, PDB, SDF). |
| `du [path]` | Show storage usage. |
| `rm <path>` | Delete file. Confirms if > 100 MB. |
| `pin <path>` | Mark file immune from 180-day auto-expiry. |
| `unpin <path>` | Reverse. |
| `upload <local-file>` | Upload from local disk (triggers browser file picker; uses presigned S3 PUT). |
| `download <path>` | Download to local disk (presigned S3 GET). |
| `mv <src> <dst>` | Rename / move within user FS. |
| `cp <src> <dst>` | Copy within user FS (S3 server-side copy). |
| `find <path> [filters]` | Limited find: `--name`, `--mtime`, `--size`. No `-exec`. |

### Jobs

| Command | Description |
|---|---|
| `run <tool> [args]` | Submit a docking job. Pre-flight estimate shown; confirm with `y`. |
| `jobs [--running\|--all]` | List your jobs. |
| `status <job_id>` | Detailed job status + cost so far. |
| `cancel <job_id>` | Cancel a running job (RunPod cancel signal). |
| `log <job_id>` | Stream worker stdout/stderr (WebSocket). |
| `top` | Live view of running jobs (auto-refresh every 5s). |
| `history [--limit N]` | Recent job log. |

### Billing

| Command | Description |
|---|---|
| `cost` | Show current balance + month-to-date spend (compute + storage). |
| `topup [amount]` | Open Stripe Checkout for prepay (minimum $10). |
| `bill [--from DATE]` | Itemized billing events. |

### Tools

| Command | Description |
|---|---|
| `tools` | List available tools + per-tool typical costs. |
| `tool <name>` | Show tool details, args, license, pre-flight typical. |
| `wizard <tool>` | Form-based fallback for users uncomfortable with CLI. |

### Account

| Command | Description |
|---|---|
| `whoami` | Print user info, balance, storage usage. |
| `keys` | List/create/revoke API keys. |
| `help [cmd]` | Help. |
| `clear` | Clear terminal. |
| `exit` | Sign out. |

## Tool argument schemas

Each tool has a fixed argument schema validated by zod. Examples:

```bash
run gnina \
  --receptor /inputs/protein.pdb \
  --ligand   /inputs/ligand.sdf \
  --autobox  /inputs/reference.sdf \
  [--exhaustiveness 8] \
  [--num-modes 9]

run boltz2 \
  --target /inputs/target.json \
  [--use-msa-server] \
  [--samples 5] \
  [--seed 42]

run protenix \
  --target /inputs/target.json \
  [--samples 25] \
  [--use-msa true]
```

Where `target.json` follows the canonical CASP schema from
`~/data/vaults/casp/inputs/`. Server-side adapters reuse the
`to_protenix_json.py`, `to_chai_fasta.py`, and `to_dynamicbind.py` modules
from the CASP vault.

## Parser stack

- **Tokenizer**: clipanion (POSIX-ish argv, supports `"quoted strings"` and `--flag=value`).
- **Validator**: zod schemas per command. Schemas defined alongside handlers in
  `src/lib/cli/<cmd>.ts`.
- **Dispatcher**: `src/lib/cli/index.ts` — single entry, switches on command name.
- **Error mode**: never leak stack traces. Always return a one-line error to
  the terminal with a `help <cmd>` hint when appropriate.

## Wizard fallback

For users uncomfortable with CLI, `wizard <tool>` opens a form modal. The form
output is rendered back into the equivalent CLI command and submitted via the
normal `/api/cmd` path. There's only ever one path to job submission — the
form is a UI on top of the CLI, not parallel infrastructure.

## API key access (CLI from your laptop)

```bash
npm install -g @dockvision/cli   # ships in Phase 3

dvk login                        # opens dockvision.doi.bio/cli/auth in browser
dvk ls /inputs
dvk upload protein.pdb /inputs/
dvk run gnina --receptor /inputs/protein.pdb --ligand /inputs/ligand.sdf
dvk status <job_id>
```

`@dockvision/cli` is the same grammar, talking to `/api/cmd` with a bearer
token from `keys`. Available in Phase 3.

## Future (not v1)

- Pipes within DockVision-managed commands: `jobs --running | head 5`
- Aliases / saved commands (`alias myrun = run boltz2 --samples 10`)
- Shareable command links (one-click reproduce someone's run; opt-in per file)
- Scripting: `dvk script run.sh` over the API for batch submissions
