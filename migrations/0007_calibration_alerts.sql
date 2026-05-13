-- Per-tool runtime calibration (auto-updated by the recon worker from p50 of
-- recent successful runs) and a small system_alerts log for reconciliation drift.

CREATE TABLE tool_calibration (
	tool                 TEXT        PRIMARY KEY,
	p50_runtime_sec      INTEGER     NOT NULL,
	sample_count         INTEGER     NOT NULL,
	updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE system_alerts (
	id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
	kind          TEXT        NOT NULL,
	severity      TEXT        NOT NULL CHECK (severity IN ('info', 'warn', 'error')),
	message       TEXT        NOT NULL,
	meta          JSONB,
	acknowledged  BOOLEAN     NOT NULL DEFAULT FALSE,
	created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX system_alerts_unack_idx ON system_alerts (created_at DESC)
	WHERE acknowledged = FALSE;
