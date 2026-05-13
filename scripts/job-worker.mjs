#!/usr/bin/env node
// Standalone job worker. Subscribes to pg-boss queue 'docking-jobs', dispatches
// to RunPod, polls for completion, uploads outputs to S3, and debits the user's
// balance. Runs as its own pm2 process.
//
//   node scripts/job-worker.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import PgBoss from 'pg-boss';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- env ----------
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
const RUNPOD_KEY = process.env.RUNPOD_API_KEY;
const S3_BUCKET = process.env.S3_BUCKET || 'dockvision-prod';
const POLL_INTERVAL_MS = 5000;

const gpuRates = JSON.parse(
	fs.readFileSync(path.resolve(__dirname, '..', 'config', 'gpu-rates.json'), 'utf8')
);

const s3 = new S3Client({
	region: process.env.AWS_REGION || 'us-east-1',
	credentials:
		process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
			? {
					accessKeyId: process.env.AWS_ACCESS_KEY_ID,
					secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
				}
			: undefined
});

const pool = new pg.Pool({ connectionString: DB });

// ---------- helpers ----------
async function runpod(method, endpointId, path, body) {
	const res = await fetch(`https://api.runpod.ai/v2/${endpointId}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${RUNPOD_KEY}`,
			'Content-Type': 'application/json'
		},
		body: body ? JSON.stringify(body) : undefined
	});
	if (!res.ok) throw new Error(`runpod ${method} ${path}: ${res.status} ${await res.text()}`);
	return res.json();
}

function billCents(executionTimeMs, gpu) {
	const rate = gpuRates[gpu];
	if (!rate) throw new Error(`unknown gpu: ${gpu}`);
	return Math.ceil((executionTimeMs / 1000) * rate.cents_per_sec * MARKUP);
}

async function uploadOutput(client, jobId, userId, file) {
	// file: { filename, content_b64, mime }
	const data = Buffer.from(file.content_b64, 'base64');
	const path = `/u/${userId}/jobs/${jobId}/output/${file.filename}`;
	const s3Key = `u/${userId}/jobs/${jobId}/output/${file.filename}`;
	await s3.send(
		new PutObjectCommand({
			Bucket: S3_BUCKET,
			Key: s3Key,
			Body: data,
			ContentType: file.mime || 'application/octet-stream'
		})
	);
	const expires = new Date();
	expires.setDate(expires.getDate() + 180);
	await client.query(
		`INSERT INTO files (user_id, path, s3_key, size_bytes, mime, expires_at)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (user_id, path) DO UPDATE
		   SET s3_key=EXCLUDED.s3_key, size_bytes=EXCLUDED.size_bytes,
		       mime=EXCLUDED.mime, expires_at=EXCLUDED.expires_at`,
		[userId, path, s3Key, data.length, file.mime || 'application/octet-stream', expires]
	);
}

async function debit(client, userId, amountCents, jobId, description) {
	await client.query('SELECT 1 FROM users WHERE id=$1 FOR UPDATE', [userId]);
	await client.query(
		`INSERT INTO billing_events (user_id, amount_cents, kind, job_id, description)
		 VALUES ($1, $2, 'job', $3, $4)`,
		[userId, -amountCents, jobId, description]
	);
	await client.query('UPDATE users SET balance_cents = balance_cents + $2 WHERE id = $1', [
		userId,
		-amountCents
	]);
}

// ---------- handler ----------
async function handle(job) {
	const payload = job.data;
	const { jobId, userId, tool, endpointId, input, maxRuntimeSec } = payload;
	console.log(`[worker] ${jobId} → ${tool} on endpoint ${endpointId}`);

	// 1. submit to RunPod
	let submitted;
	try {
		submitted = await runpod('POST', endpointId, '/run', { input });
	} catch (e) {
		await pool.query(
			`UPDATE jobs SET status='failed', error=$2, completed_at=now() WHERE id=$1`,
			[jobId, `runpod submit failed: ${e.message}`]
		);
		throw e;
	}
	const runpodJobId = submitted.id;
	await pool.query(
		`UPDATE jobs SET runpod_job_id=$2, status='running', started_at=now() WHERE id=$1`,
		[jobId, runpodJobId]
	);

	// 2. poll
	const deadline = Date.now() + (maxRuntimeSec + 60) * 1000;
	let last = null;
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
		last = await runpod('GET', endpointId, `/status/${runpodJobId}`);
		if (['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'].includes(last.status)) break;
		// Check if user cancelled or balance went negative
		const r = await pool.query('SELECT status FROM jobs WHERE id=$1', [jobId]);
		if (r.rows[0]?.status === 'cancelled') {
			try {
				await runpod('POST', endpointId, `/cancel/${runpodJobId}`);
			} catch {}
			return;
		}
		const bal = await pool.query('SELECT balance_cents FROM users WHERE id=$1', [userId]);
		if (Number(bal.rows[0]?.balance_cents) < 0) {
			try {
				await runpod('POST', endpointId, `/cancel/${runpodJobId}`);
			} catch {}
			await pool.query(
				`UPDATE jobs SET status='cancelled', error='balance exhausted', completed_at=now() WHERE id=$1`,
				[jobId]
			);
			return;
		}
	}

	if (!last || last.status !== 'COMPLETED') {
		await pool.query(
			`UPDATE jobs SET status='failed', error=$2, completed_at=now() WHERE id=$1`,
			[jobId, last?.error || `terminal status ${last?.status || 'TIMEOUT'} (no charge)`]
		);
		return;
	}

	// 3. process output
	const output = last.output || {};
	const executionTimeMs = Number(last.executionTime || 0);
	const rowRes = await pool.query('SELECT gpu_class FROM jobs WHERE id=$1', [jobId]);
	const gpu = rowRes.rows[0]?.gpu_class;
	const cost = billCents(executionTimeMs, gpu);

	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		const outputFiles = Array.isArray(output.output_files) ? output.output_files : [];
		for (const f of outputFiles) {
			if (!f.filename || !f.content_b64) continue;
			await uploadOutput(client, jobId, userId, f);
		}
		if (output.log) {
			await uploadOutput(client, jobId, userId, {
				filename: 'log',
				content_b64: Buffer.from(output.log).toString('base64'),
				mime: 'text/plain'
			});
		}
		await debit(client, userId, cost, jobId, `${tool} · ${(executionTimeMs / 1000).toFixed(1)}s on ${gpu}`);
		await client.query(
			`UPDATE jobs SET status='completed', actual_cost_cents=$2, execution_time_ms=$3,
				output_dir=$4, completed_at=now() WHERE id=$1`,
			[jobId, cost, executionTimeMs, `/u/${userId}/jobs/${jobId}/output/`]
		);
		await client.query('COMMIT');
		console.log(`[worker] ${jobId} → completed, billed ${cost}¢`);
	} catch (e) {
		await client.query('ROLLBACK');
		await pool.query(
			`UPDATE jobs SET status='failed', error=$2, completed_at=now() WHERE id=$1`,
			[jobId, `post-completion error: ${e.message}`]
		);
		throw e;
	} finally {
		client.release();
	}
}

// ---------- main ----------
async function main() {
	const boss = new PgBoss({ connectionString: DB, schema: 'pgboss', retryLimit: 0 });
	await boss.start();
	console.log('[worker] subscribed to docking-jobs');

	await boss.work('docking-jobs', { teamSize: 4, teamConcurrency: 2 }, async (job) => {
		try {
			await handle(job);
		} catch (e) {
			console.error('[worker] job error', e);
			throw e;
		}
	});

	process.on('SIGTERM', async () => {
		console.log('[worker] SIGTERM, stopping...');
		await boss.stop();
		process.exit(0);
	});
}

main().catch((e) => {
	console.error('[worker] fatal:', e);
	process.exit(1);
});
