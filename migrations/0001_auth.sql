-- Auth.js (pg-adapter) standard schema + our migration bookkeeping.
-- Source: https://authjs.dev/getting-started/adapters/pg
-- Column names are quoted-camelCase because that's what @auth/pg-adapter queries.

CREATE TABLE IF NOT EXISTS schema_migrations (
	id          INTEGER PRIMARY KEY,
	name        TEXT NOT NULL,
	applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE verification_token (
	identifier  TEXT NOT NULL,
	expires     TIMESTAMPTZ NOT NULL,
	token       TEXT NOT NULL,
	PRIMARY KEY (identifier, token)
);

CREATE TABLE users (
	id              SERIAL PRIMARY KEY,
	name            VARCHAR(255),
	email           VARCHAR(255) UNIQUE,
	"emailVerified" TIMESTAMPTZ,
	image           TEXT
);

CREATE TABLE accounts (
	id                   SERIAL PRIMARY KEY,
	"userId"             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	type                 VARCHAR(255) NOT NULL,
	provider             VARCHAR(255) NOT NULL,
	"providerAccountId"  VARCHAR(255) NOT NULL,
	refresh_token        TEXT,
	access_token         TEXT,
	expires_at           BIGINT,
	id_token             TEXT,
	scope                TEXT,
	session_state        TEXT,
	token_type           TEXT,
	UNIQUE (provider, "providerAccountId")
);

CREATE TABLE sessions (
	id              SERIAL PRIMARY KEY,
	"userId"        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	expires         TIMESTAMPTZ NOT NULL,
	"sessionToken"  VARCHAR(255) NOT NULL UNIQUE
);

CREATE INDEX ON accounts ("userId");
CREATE INDEX ON sessions ("userId");
