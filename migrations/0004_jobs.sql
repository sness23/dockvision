-- Docking jobs. Submitted, dispatched to RunPod, billed on completion.

CREATE TABLE jobs (
	id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id                INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	tool                   TEXT        NOT NULL,
	tool_version           TEXT,
	args                   JSONB       NOT NULL,
	gpu_class              TEXT        NOT NULL,
	runpod_endpoint_id     TEXT,
	runpod_job_id          TEXT,
	status                 TEXT        NOT NULL CHECK (status IN
		('queued', 'running', 'completed', 'failed', 'cancelled', 'rejected')),
	estimated_cost_cents   BIGINT      NOT NULL,
	actual_cost_cents      BIGINT,
	execution_time_ms      BIGINT,
	output_dir             TEXT,
	error                  TEXT,
	idempotency_key        TEXT,
	created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
	started_at             TIMESTAMPTZ,
	completed_at           TIMESTAMPTZ,
	UNIQUE (user_id, idempotency_key)
);

CREATE INDEX jobs_user_created_idx ON jobs (user_id, created_at DESC);
CREATE INDEX jobs_status_idx       ON jobs (status) WHERE status IN ('queued', 'running');
