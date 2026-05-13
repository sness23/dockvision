# DockVision — License compliance

This is the live tracker for what we can legally offer paid vs free vs not at
all. Every tool must be re-checked before adding to the catalog.

## DockVision platform

- **Source code**: AGPL-3.0-or-later
- **Repo**: `github.com/sness23/dockvision` (pending public push)
- **Headline implication**: anyone running a modified DockVision over a network
  must publish their modifications under AGPL-3.0. This is intentional —
  it lets us release the platform openly without giving competitors a closed
  fork as a moat.

`LICENSE` file (AGPL-3.0 full text) gets added to the repo root before public push.

## ML model licenses (as of 2026-05-12)

### GNINA

- **License**: Apache 2.0 (github.com/gnina/gnina)
- **Commercial use**: yes
- **Status for DockVision**: shippable in v1
- **Notes**: weights distributed with the binary; no separate weight license.

### Boltz-2

- **License**: needs explicit re-check on upstream `chaidiscovery/boltz` LICENSE
  before v1 launch.
- **Commercial use**: pending verification.
- **Status for DockVision**: planned for v1 — **DO NOT LAUNCH** without
  reviewer sign-off in `licenses/boltz2.md`.
- **Notes**: Boltz-1 was MIT; Boltz-2 weights distribution terms must be
  explicitly confirmed.

### Protenix

- **License**: Apache 2.0 (github.com/bytedance/Protenix)
- **Commercial use**: yes
- **Status for DockVision**: shippable in v1
- **Notes**: confirm weight license matches code license at integration time.

### Chai-1

- **License**: needs review
- **Commercial use**: unknown
- **Status for DockVision**: v2+ only, after license review
- **Notes**: Chai Discovery hosts its own free playground; competitive risk in
  addition to license risk.

### DynamicBind

- **License**: research / non-commercial (per upstream README at time of CASP16 use)
- **Commercial use**: NO without commercial license from authors
- **Status for DockVision**: NOT shippable as paid service
- **Notes**: even self-hosted commercial use would violate. Defer to v2+
  contingent on direct agreement with authors or license change.

### AlphaFold3

- **License**: Google DeepMind Output Terms restrict commercial use
- **Status for DockVision**: NOT shippable
- **Notes**: never plan around this. ESMFold (MIT), Boltz, Protenix, Chai are
  the open replacements.

### IntelliFold

- **License**: needs review
- **Status for DockVision**: deferred

## Process

1. Before adding any tool to the catalog, file a `licenses/<tool>.md` with:
   - Upstream repo + commit hash of LICENSE file reviewed
   - Verbatim license text relevant to redistribution + commercial use
   - Sign-off date and reviewer
2. Re-check quarterly. Tool licenses do change (notably DynamicBind, Chai).
3. CI job: nightly fetch of each tool's LICENSE from upstream; diff vs cached
   copy; alert on change.

## User-uploaded inputs

- Users retain ownership of their inputs and outputs.
- Terms of Service grant DockVision a limited license to store, process, and
  display them solely to provide the service.
- DockVision does not train models on user data.
- Users may delete any input/output at any time; S3 backups (if any) purged
  within 30 days.

## CASP data licensing

The canonical inputs derived from predictioncenter.org are **academic-use only**.
If DockVision pre-populates CASP target inputs as a convenience:

- Display the source attribution: "predictioncenter.org, UC Davis, NIH/NIGMS-funded"
- Restrict access to verified academic accounts
- Document in `licenses/casp-data.md`
