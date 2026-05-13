-- App-level extensions to the Auth.js users table.
-- balance_cents and storage_bytes are the source of truth for billing.

ALTER TABLE users
	ADD COLUMN balance_cents  BIGINT      NOT NULL DEFAULT 0,
	ADD COLUMN storage_bytes  BIGINT      NOT NULL DEFAULT 0,
	ADD COLUMN is_academic    BOOLEAN     NOT NULL DEFAULT FALSE,
	ADD COLUMN created_at     TIMESTAMPTZ NOT NULL DEFAULT now();
