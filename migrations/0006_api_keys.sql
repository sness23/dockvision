-- Long-lived API keys for the CLI shim (@dockvision/cli) and curl access.

CREATE TABLE api_keys (
	id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id       INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	key_prefix    TEXT        NOT NULL,
	key_hash      TEXT        NOT NULL,
	name          TEXT        NOT NULL,
	scopes        TEXT[]      NOT NULL DEFAULT ARRAY['read'],
	last_used_at  TIMESTAMPTZ,
	created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
	revoked_at    TIMESTAMPTZ
);

CREATE INDEX api_keys_user_idx   ON api_keys (user_id);
CREATE INDEX api_keys_prefix_idx ON api_keys (key_prefix);
