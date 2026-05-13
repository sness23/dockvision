# DockVision MSA service

Tiny self-hosted MMseqs2 wrapper for Boltz / Protenix MSAs, with S3-backed
cache keyed by `sha256(normalized_sequence)`. Currently optional — Boltz uses
ColabFold public servers via `--use_msa_server` and Protenix uses its own
`protenix prep` server. This service is wired up so we can flip to self-hosted
when public-server rate limits start to bite.

## API

```
POST /msa  { "sequence": "MKTL..." }
→ 200  { "a3m_url": "<presigned-S3-GET-url>", "cache_hit": true, "hash": "..." }
→ 503  { "error": "mmseqs not found ..." }
```

```
GET /healthz
→ 200  { "ok": true, "db_present": true }
```

The service binds to `127.0.0.1:4000` by default (internal-only — never expose
to the internet).

## Bringing up the DB on www0

1. Install MMseqs2:
   ```bash
   apt-get install mmseqs2          # ubuntu 22.04+
   # or build from source: https://github.com/soedinglab/MMseqs2
   ```

2. Provision a >1 TB EBS volume mounted at `/srv/dockvision-msa/db`.

3. Download a ColabFold-style DB. The smallest useful set is **UniRef30**
   (~340 GB unpacked):
   ```bash
   cd /srv/dockvision-msa/db
   wget https://wwwuser.gwdg.de/~compbiol/colabfold/uniref30_2302.tar.gz
   tar xzf uniref30_2302.tar.gz
   mmseqs createindex uniref30 tmp --threads 16
   ```
   ColabFold's setup script (see [ColabFold's GitHub](https://github.com/sokrypton/ColabFold))
   downloads this plus `bfd_metaclust_clu_complete_id30` and a PDB MMseqs DB if
   you want full coverage — budget ~700 GB.

4. Confirm:
   ```bash
   curl -s http://127.0.0.1:4000/healthz
   # → {"ok":true,"db_present":true}
   ```

5. Smoke test:
   ```bash
   curl -s -X POST http://127.0.0.1:4000/msa \
     -H 'content-type: application/json' \
     -d '{"sequence":"MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRVGDGTQDNLSGAEKAVQVKVKALPDAQFEVVHSLAKWKRQTLGQHDFSAGEGLYTHMKALRPDEDRLSPLHSVYVDQWDWERVMGDGERQFSTLKSTVEAIWAGIKATEAAVSEEFGLAPFLPDQIHFVHSQELLSRYPDLDAKGRERAIAKDLGAVFLVGVGGKLSDGHRHDVRAPDYDDWSTPSELGHAGLNGDILVWNPVLEDAFELSSMGIRVDADTLKHQLALTGDEDRLELEWHQALLRGEMPQTIGGGIGQSRLTMLLLQLPHIGQVQAGVWPAAVRESVPSLL"}'
   ```

## Wiring into handlers (Phase 2.1)

When ready to switch off ColabFold public:

- **Boltz**: drop `--use_msa_server` and pre-fetch the A3M for each chain.
  Pass A3M URLs into the Boltz YAML (`msa:` block per chain).
- **Protenix**: bypass `protenix prep` and supply prepped JSONs with the
  A3M paths inlined.

Both require handler changes; track in
[`docs/ROADMAP.md`](../../docs/ROADMAP.md).

## Cost notes

DB storage: ~$25–35/mo for a 700 GB `gp3` EBS volume (us-east-1).
The S3 cache itself is tiny — A3M files are 100KB–10MB each. Cache hits cost a
single S3 HEAD + a presigned GET (effectively free). Cache misses pay 1× the
mmseqs CPU time (typically 30–90 s for proteins under 500 residues).

Folded into the per-job 1.5× markup; not separately billed.
