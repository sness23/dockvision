#!/usr/bin/env node
// DockVision reconciliation worker.
//
// pm2 cron_restart fires this every 15 minutes. Each invocation:
//
//   1. Calibration — recompute p50 typical runtime per tool from the last
//      100 successful jobs; upsert tool_calibration.
//   2. Storage debit — once per UTC day at the first 00:00-00:30 invocation,
//      debit each user for (storage_bytes - free_tier_bytes) / 30 × $/GB-mo.
//   3. Reconciliation — log day's compute + storage spend totals; alert if
//      any user's actual_cost_cents diverges from their executionTime × rate
//      by more than 5%.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv() {
	const envPath = path.resolve(__dirname, '..', '.env');
	if (!fs.existsSync(envPath)) return;
	for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
		if (!m) continue;
		const [, k, v] = m;
		if (!process.env[k]) process.env[k] = v.replace(/^["']|["']$/g, '');
	}
}
loadEnv();

const DB = process.env.DATABASE_URL;
if (!DB) throw new Error('DATABASE_URL not set');
const MARKUP = Number(process.env.MARKUP_MULTIPLIER ?? '1.5');
const FREE_GB = Number(process.env.STORAGE_FREE_GB ?? '5');
const STORAGE_CENTS_PER_GB_MONTH = Number(process.env.STORAGE_PRICE_CENTS_PER_GB_MONTH ?? '4');

const gpuRates = JSON.parse(
	fs.readFileSync(path.resolve(__dirname, '..', 'config', 'gpu-rates.json'), 'utf8')
);

const pool = new pg.Pool({ connectionString: DB });

async function calibrate() {
	const tools = await pool.query(`
		SELECT tool, COUNT(*) AS n,
		       percentile_cont(0.5) WITHIN GROUP (ORDER BY execution_time_ms) AS p50_ms
		FROM jobs
		WHERE status = 'completed' AND execution_time_ms IS NOT NULL
		  AND created_at > now() - interval '30 days'
		GROUP BY tool
		HAVING COUNT(*) >= 5
	`);
	for (const row of tools.rows) {
		const p50_sec = Math.ceil(Number(row.p50_ms) / 1000);
		await pool.query(
			`INSERT INTO tool_calibration (tool, p50_runtime_sec, sample_count, updated_at)
			 VALUES ($1, $2, $3, now())
			 ON CONFLICT (tool) DO UPDATE
			   SET p50_runtime_sec = EXCLUDED.p50_runtime_sec,
			       sample_count    = EXCLUDED.sample_count,
			       updated_at      = now()`,
			[row.tool, p50_sec, Number(row.n)]
		);
		console.log(`[recon] calibrated ${row.tool}: p50=${p50_sec}s over ${row.n} runs`);
	}
}

async function debitStorage() {
	// Run only in the first invocation between 00:00 and 00:30 UTC.
	const now = new Date();
	if (now.getUTCHours() !== 0 || now.getUTCMinutes() >= 30) return;

	// Guard against double-debits on the same UTC day.
	const today = now.toISOString().slice(0, 10);
	const already = await pool.query(
		`SELECT 1 FROM billing_events
		 WHERE kind = 'storage' AND created_at::date = $1::date
		 LIMIT 1`,
		[today]
	);
	if (already.rowCount && already.rowCount > 0) return;

	const users = await pool.query(
		`SELECT id, storage_bytes FROM users
		 WHERE storage_bytes > $1`,
		[Math.ceil(FREE_GB * 1e9)]
	);
	let debited = 0;
	for (const u of users.rows) {
		const billable_gb = Math.max(0, Number(u.storage_bytes) / 1e9 - FREE_GB);
		const cents = Math.ceil((billable_gb * STORAGE_CENTS_PER_GB_MONTH) / 30);
		if (cents <= 0) continue;
		const client = await pool.connect();
		try {
			await client.query('BEGIN');
			await client.query('SELECT 1 FROM users WHERE id=$1 FOR UPDATE', [u.id]);
			await client.query(
				`INSERT INTO billing_events (user_id, amount_cents, kind, description)
				 VALUES ($1, $2, 'storage', $3)`,
				[u.id, -cents, `Storage: ${billable_gb.toFixed(2)} GB · ${cents}¢`]
			);
			await client.query('UPDATE users SET balance_cents = balance_cents - $2 WHERE id = $1', [
				u.id,
				cents
			]);
			await client.query('COMMIT');
			debited++;
		} catch (e) {
			await client.query('ROLLBACK');
			console.error(`[recon] storage debit failed for user ${u.id}:`, e);
		} finally {
			client.release();
		}
	}
	console.log(`[recon] daily storage debit applied to ${debited} users`);
}

async function reconcileDay() {
	// Sum cost_seconds × rate for the last 24h, compare against billed_cents/markup.
	const rows = await pool.query(
		`SELECT j.tool, j.gpu_class,
		        SUM(j.execution_time_ms) AS total_ms,
		        SUM(j.actual_cost_cents) AS total_billed_cents,
		        COUNT(*) AS n
		 FROM jobs j
		 WHERE j.status = 'completed'
		   AND j.completed_at > now() - interval '24 hours'
		 GROUP BY j.tool, j.gpu_class`
	);

	for (const r of rows.rows) {
		const totalMs = Number(r.total_ms || 0);
		const billed = Number(r.total_billed_cents || 0);
		const rate = gpuRates[r.gpu_class];
		if (!rate) continue;
		const expectedRaw = (totalMs / 1000) * rate.cents_per_sec;
		const expectedBilled = expectedRaw * MARKUP;
		const drift = billed - expectedBilled;
		const driftPct = expectedBilled > 0 ? Math.abs(drift) / expectedBilled : 0;
		console.log(
			`[recon] ${r.tool}/${r.gpu_class}: ${r.n} jobs, ${(totalMs / 1000).toFixed(1)}s, ` +
				`billed=${billed.toFixed(0)}¢ expected=${expectedBilled.toFixed(0)}¢ drift=${(driftPct * 100).toFixed(1)}%`
		);
		if (driftPct > 0.05 && Math.abs(drift) > 50) {
			await pool.query(
				`INSERT INTO system_alerts (kind, severity, message, meta)
				 VALUES ('reconciliation_drift', 'warn', $1, $2)`,
				[
					`${r.tool}/${r.gpu_class}: drift ${driftPct.toFixed(2)} (${Math.abs(drift).toFixed(0)}¢)`,
					JSON.stringify({
						tool: r.tool,
						gpu: r.gpu_class,
						billed_cents: billed,
						expected_cents: expectedBilled,
						drift_pct: driftPct
					})
				]
			);
		}
	}
}

async function main() {
	console.log(`[recon] starting at ${new Date().toISOString()}`);
	try {
		await calibrate();
	} catch (e) {
		console.error('[recon] calibrate failed:', e);
	}
	try {
		await debitStorage();
	} catch (e) {
		console.error('[recon] storage debit failed:', e);
	}
	try {
		await reconcileDay();
	} catch (e) {
		console.error('[recon] reconcile failed:', e);
	}
	await pool.end();
	console.log('[recon] done');
}

main().catch((e) => {
	console.error('[recon] fatal:', e);
	process.exit(1);
});
