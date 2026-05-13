import { pool, query } from './db';

export async function getBalance(userId: number): Promise<number> {
	const rows = await query<{ balance_cents: string }>(
		'SELECT balance_cents FROM users WHERE id = $1',
		[userId]
	);
	return rows.length ? Number(rows[0].balance_cents) : 0;
}

/**
 * Check that the user can afford a job (estimated × 1.2 safety) and reserve nothing —
 * just gate the submit. Returns the current balance in cents.
 */
export async function assertCanAfford(userId: number, estimatedCents: number): Promise<number> {
	const balance = await getBalance(userId);
	if (balance < Math.ceil(estimatedCents * 1.2)) {
		throw new Error(
			`insufficient balance: have ${balance}¢, need ~${Math.ceil(estimatedCents * 1.2)}¢ (estimate + 20% buffer)`
		);
	}
	return balance;
}

/**
 * Atomically debit a user's balance and record a billing_event.
 * Negative `amountCents` means debit; positive means credit.
 */
export async function postBillingEvent(opts: {
	userId: number;
	amountCents: number; // negative = debit
	kind: 'topup' | 'job' | 'storage' | 'refund' | 'adjust';
	jobId?: string;
	stripePaymentIntent?: string;
	description: string;
}): Promise<{ newBalance: number; eventId: string }> {
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		// row-lock the user
		await client.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [opts.userId]);

		const ev = await client.query<{ id: string }>(
			`INSERT INTO billing_events
				(user_id, amount_cents, kind, job_id, stripe_payment_intent, description)
			 VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
			[
				opts.userId,
				opts.amountCents,
				opts.kind,
				opts.jobId ?? null,
				opts.stripePaymentIntent ?? null,
				opts.description
			]
		);

		const upd = await client.query<{ balance_cents: string }>(
			`UPDATE users SET balance_cents = balance_cents + $2
			 WHERE id = $1 RETURNING balance_cents`,
			[opts.userId, opts.amountCents]
		);

		await client.query('COMMIT');
		return { newBalance: Number(upd.rows[0].balance_cents), eventId: ev.rows[0].id };
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}
}

/**
 * Idempotent top-up: skip if we already credited this stripe_payment_intent.
 */
export async function topupIfNew(opts: {
	userId: number;
	amountCents: number;
	stripePaymentIntent: string;
	description: string;
}): Promise<{ applied: boolean; newBalance: number }> {
	const existing = await query<{ id: string }>(
		'SELECT id FROM billing_events WHERE stripe_payment_intent = $1',
		[opts.stripePaymentIntent]
	);
	if (existing.length) {
		const bal = await getBalance(opts.userId);
		return { applied: false, newBalance: bal };
	}
	const { newBalance } = await postBillingEvent({
		userId: opts.userId,
		amountCents: opts.amountCents,
		kind: 'topup',
		stripePaymentIntent: opts.stripePaymentIntent,
		description: opts.description
	});
	return { applied: true, newBalance };
}
