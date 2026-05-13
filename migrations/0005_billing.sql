-- Every debit/credit on a user's balance. Append-only ledger.

CREATE TABLE billing_events (
	id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id                  INTEGER     NOT NULL REFERENCES users(id),
	amount_cents             BIGINT      NOT NULL,
	kind                     TEXT        NOT NULL CHECK (kind IN
		('topup', 'job', 'storage', 'refund', 'adjust')),
	job_id                   UUID        REFERENCES jobs(id),
	stripe_payment_intent    TEXT,
	description              TEXT        NOT NULL,
	created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX billing_user_created_idx ON billing_events (user_id, created_at DESC);
CREATE INDEX billing_stripe_idx       ON billing_events (stripe_payment_intent)
	WHERE stripe_payment_intent IS NOT NULL;
