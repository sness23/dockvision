-- Symlink-style file rows + job tags, powering the /results/<tag>/<tool>/ namespace.
--
-- A "link" row (links_to IS NOT NULL) points at another file's bytes: it shares
-- the target's s3_key so reads work without a join, but it does NOT count toward
-- the owner's storage_bytes (the underlying job-output file already does).

ALTER TABLE files ADD COLUMN links_to UUID REFERENCES files(id) ON DELETE CASCADE;
ALTER TABLE jobs  ADD COLUMN tag TEXT;

CREATE INDEX files_links_to_idx ON files (links_to) WHERE links_to IS NOT NULL;
CREATE INDEX jobs_tag_idx ON jobs (tag, tool, completed_at DESC) WHERE tag IS NOT NULL;

-- Storage accounting must ignore link rows (they're free aliases).
CREATE OR REPLACE FUNCTION files_size_delta() RETURNS TRIGGER AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW.links_to IS NULL THEN
			UPDATE users SET storage_bytes = storage_bytes + NEW.size_bytes WHERE id = NEW.user_id;
		END IF;
	ELSIF TG_OP = 'DELETE' THEN
		IF OLD.links_to IS NULL THEN
			UPDATE users SET storage_bytes = storage_bytes - OLD.size_bytes WHERE id = OLD.user_id;
		END IF;
	ELSIF TG_OP = 'UPDATE' AND NEW.size_bytes <> OLD.size_bytes THEN
		IF NEW.links_to IS NULL THEN
			UPDATE users SET storage_bytes = storage_bytes - OLD.size_bytes + NEW.size_bytes
				WHERE id = NEW.user_id;
		END IF;
	END IF;
	RETURN NULL;
END;
$$ LANGUAGE plpgsql;
