#!/usr/bin/env node
// DockVision MSA microservice.
//
// POST /msa { sequence } → { a3m_url, cache_hit }
//
// Caches A3M files in S3 keyed by sha256(normalized sequence). On cache miss
// shells out to MMseqs2 against the ColabFold-style DB. The actual DB
// (~700 GB) must be installed on the host at MSA_DB_DIR — see
// services/msa/README.md.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { S3Client, HeadObjectCommand, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

function loadEnv() {
	const envPath = path.resolve(process.cwd(), '.env');
	if (!fs.existsSync(envPath)) return;
	for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
		if (!m) continue;
		const [, k, v] = m;
		if (!process.env[k]) process.env[k] = v.replace(/^["']|["']$/g, '');
	}
}
loadEnv();

const PORT = Number(process.env.MSA_PORT || 4000);
const BIND = process.env.MSA_BIND || '127.0.0.1';
const BUCKET = process.env.S3_BUCKET || 'dockvision-prod';
const CACHE_PREFIX = process.env.MSA_CACHE_PREFIX || 'msa-cache';
const MMSEQS_BIN = process.env.MMSEQS_BIN || 'mmseqs';
const MSA_DB_DIR = process.env.MSA_DB_DIR || '/srv/dockvision-msa/db';
const MSA_TMP_DIR = process.env.MSA_TMP_DIR || os.tmpdir();
const MMSEQS_THREADS = process.env.MMSEQS_THREADS || '8';

const s3 = new S3Client({
	region: process.env.AWS_REGION || 'us-east-1',
	endpoint: process.env.S3_ENDPOINT || undefined,
	forcePathStyle: !!process.env.S3_ENDPOINT,
	credentials:
		process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
			? {
					accessKeyId: process.env.AWS_ACCESS_KEY_ID,
					secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
				}
			: undefined
});

function normalize(seq) {
	return seq.replace(/\s+/g, '').toUpperCase();
}

function hashSeq(seq) {
	return crypto.createHash('sha256').update(normalize(seq)).digest('hex');
}

function cacheKey(hash) {
	return `${CACHE_PREFIX}/${hash}.a3m`;
}

async function cacheHit(hash) {
	try {
		await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: cacheKey(hash) }));
		return true;
	} catch {
		return false;
	}
}

async function presignGet(hash) {
	return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: cacheKey(hash) }), {
		expiresIn: 6 * 3600
	});
}

function checkMmseqs() {
	try {
		return new Promise((resolve) => {
			const p = spawn(MMSEQS_BIN, ['version']);
			p.on('error', () => resolve(false));
			p.on('exit', (code) => resolve(code === 0));
		});
	} catch {
		return Promise.resolve(false);
	}
}

async function runMmseqs(sequence, workDir) {
	if (!fs.existsSync(MSA_DB_DIR)) {
		throw new Error(`MSA_DB_DIR not present: ${MSA_DB_DIR} (see services/msa/README.md)`);
	}
	const fasta = path.join(workDir, 'query.fasta');
	fs.writeFileSync(fasta, `>query\n${normalize(sequence)}\n`);
	const queryDb = path.join(workDir, 'queryDB');
	const resultDb = path.join(workDir, 'resultDB');
	const tmp = path.join(workDir, 'tmp');
	fs.mkdirSync(tmp, { recursive: true });
	const a3m = path.join(workDir, 'out.a3m');

	function run(args) {
		return new Promise((resolve, reject) => {
			const p = spawn(MMSEQS_BIN, args, { stdio: 'inherit' });
			p.on('error', reject);
			p.on('exit', (code) =>
				code === 0 ? resolve(undefined) : reject(new Error(`mmseqs ${args[0]} → ${code}`))
			);
		});
	}

	await run(['createdb', fasta, queryDb]);
	await run([
		'search',
		queryDb,
		path.join(MSA_DB_DIR, 'uniref30'),
		resultDb,
		tmp,
		'--threads', MMSEQS_THREADS,
		'-s', '8'
	]);
	await run([
		'result2msa',
		queryDb,
		path.join(MSA_DB_DIR, 'uniref30'),
		resultDb,
		a3m,
		'--msa-format-mode', '6'
	]);
	return a3m;
}

async function handleMsa(body) {
	const { sequence } = JSON.parse(body);
	if (!sequence || typeof sequence !== 'string') {
		return { status: 400, body: { error: 'sequence required' } };
	}
	if (sequence.length < 16 || sequence.length > 4096) {
		return { status: 400, body: { error: 'sequence length 16..4096' } };
	}
	const hash = hashSeq(sequence);

	if (await cacheHit(hash)) {
		const url = await presignGet(hash);
		return { status: 200, body: { a3m_url: url, cache_hit: true, hash } };
	}

	const mmseqsOk = await checkMmseqs();
	if (!mmseqsOk) {
		return {
			status: 503,
			body: { error: `${MMSEQS_BIN} not found — install MMseqs2 and the ColabFold DB` }
		};
	}

	const workDir = fs.mkdtempSync(path.join(MSA_TMP_DIR, 'msa_'));
	try {
		const a3m = await runMmseqs(sequence, workDir);
		const data = fs.readFileSync(a3m);
		await s3.send(
			new PutObjectCommand({
				Bucket: BUCKET,
				Key: cacheKey(hash),
				Body: data,
				ContentType: 'text/plain'
			})
		);
		const url = await presignGet(hash);
		return { status: 200, body: { a3m_url: url, cache_hit: false, hash } };
	} finally {
		fs.rmSync(workDir, { recursive: true, force: true });
	}
}

const server = http.createServer(async (req, res) => {
	if (req.method === 'GET' && req.url === '/healthz') {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ ok: true, db_present: fs.existsSync(MSA_DB_DIR) }));
		return;
	}
	if (req.method !== 'POST' || req.url !== '/msa') {
		res.writeHead(404).end('not found');
		return;
	}
	try {
		let body = '';
		for await (const chunk of req) body += chunk;
		const out = await handleMsa(body);
		res.writeHead(out.status, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify(out.body));
	} catch (e) {
		console.error('[msa] error', e);
		res.writeHead(500, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ error: e.message }));
	}
});

server.listen(PORT, BIND, () => {
	console.log(`[msa] listening on ${BIND}:${PORT}, db=${MSA_DB_DIR}, bucket=${BUCKET}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
