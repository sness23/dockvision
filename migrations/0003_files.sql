-- Virtual filesystem entries. Bytes live in S3 under s3_key; this table is metadata.

CREATE TABLE files (
	id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id      INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	path         TEXT        NOT NULL,
	s3_key       TEXT        NOT NULL,
	size_bytes   BIGINT      NOT NULL DEFAULT 0,
	mime         TEXT,
	sha256       TEXT,
	pinned       BOOLEAN     NOT NULL DEFAULT FALSE,
	created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
	expires_at   TIMESTAMPTZ,
	UNIQUE (user_id, path)
);

CREATE INDEX files_user_path_idx ON files (user_id, path);
CREATE INDEX files_expires_idx   ON files (expires_at) WHERE pinned = FALSE;

-- Maintain users.storage_bytes via triggers so we never have to scan all files
-- to compute current usage.

CREATE OR REPLACE FUNCTION files_size_delta() RETURNS TRIGGER AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		UPDATE users SET storage_bytes = storage_bytes + NEW.size_bytes WHERE id = NEW.user_id;
	ELSIF TG_OP = 'DELETE' THEN
		UPDATE users SET storage_bytes = storage_bytes - OLD.size_bytes WHERE id = OLD.user_id;
	ELSIF TG_OP = 'UPDATE' AND NEW.size_bytes <> OLD.size_bytes THEN
		UPDATE users SET storage_bytes = storage_bytes - OLD.size_bytes + NEW.size_bytes
			WHERE id = NEW.user_id;
	END IF;
	RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER files_size_delta_trg
	AFTER INSERT OR UPDATE OR DELETE ON files
	FOR EACH ROW EXECUTE FUNCTION files_size_delta();
