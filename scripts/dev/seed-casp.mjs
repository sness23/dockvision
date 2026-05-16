#!/usr/bin/env node
// Seed a CASP target's files into the local dockvision instance.
// Uploads receptor.pdb / ligand.sdf / target.json to MinIO and inserts the
// matching `files` rows in Postgres for the given user.
//
//   node scripts/dev/seed-casp.mjs T1146           # default user_id=1
//   node scripts/dev/seed-casp.mjs T1146 2         # specific user_id

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv() {
	const envPath = path.resolve(__dirname, '..', '..', '.env');
	if (!fs.existsSync(envPath)) return;
	for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
		if (!m) continue;
		const [, k, v] = m;
		if (!process.env[k]) process.env[k] = v.replace(/^["']|["']$/g, '');
	}
}
loadEnv();

const target = process.argv[2];
const userId = Number(process.argv[3] || 1);
if (!target) {
	console.error('usage: seed-casp.mjs <target-id> [user-id]');
	process.exit(1);
}

const VAULT = path.join(os.homedir(), 'data', 'vaults', 'casp', 'inputs', 'casp15', target);
if (!fs.existsSync(VAULT)) {
	console.error(`target not found at ${VAULT}`);
	process.exit(1);
}

const BUCKET = process.env.S3_BUCKET || 'dockvision-prod';

const s3 = new S3Client({
	region: process.env.AWS_REGION || 'us-east-1',
	endpoint: process.env.S3_ENDPOINT,
	forcePathStyle: !!process.env.S3_ENDPOINT,
	credentials: {
		accessKeyId: process.env.AWS_ACCESS_KEY_ID,
		secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
	}
});

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

function expiresAt() {
	const d = new Date();
	d.setDate(d.getDate() + 180);
	return d;
}

async function upload(file) {
	const buf = fs.readFileSync(file.local);
	await s3.send(
		new PutObjectCommand({
			Bucket: BUCKET,
			Key: file.s3Key,
			Body: buf,
			ContentType: file.mime
		})
	);
	await pool.query(
		`INSERT INTO files (user_id, path, s3_key, size_bytes, mime, expires_at)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (user_id, path) DO UPDATE
		   SET s3_key=EXCLUDED.s3_key, size_bytes=EXCLUDED.size_bytes,
		       mime=EXCLUDED.mime, expires_at=EXCLUDED.expires_at`,
		[userId, file.virtualPath, file.s3Key, buf.length, file.mime, expiresAt()]
	);
	console.log(`  ${file.virtualPath}  (${buf.length}B)`);
}

const base = `casp/${target}`;
const files = [
	{
		local: path.join(VAULT, 'receptor.pdb'),
		virtualPath: `/u/${userId}/${base}/receptor.pdb`,
		s3Key: `u/${userId}/${base}/receptor.pdb`,
		mime: 'chemical/x-pdb'
	},
	{
		local: path.join(VAULT, 'receptor.fasta'),
		virtualPath: `/u/${userId}/${base}/receptor.fasta`,
		s3Key: `u/${userId}/${base}/receptor.fasta`,
		mime: 'application/x-fasta'
	},
	{
		local: path.join(VAULT, 'target.json'),
		virtualPath: `/u/${userId}/${base}/target.json`,
		s3Key: `u/${userId}/${base}/target.json`,
		mime: 'application/json'
	}
];

const ligDir = path.join(VAULT, 'ligands');
if (fs.existsSync(ligDir)) {
	for (const f of fs.readdirSync(ligDir)) {
		if (!f.endsWith('.sdf')) continue;
		files.push({
			local: path.join(ligDir, f),
			// land each ligand at the friendly name ligand.sdf if only one exists;
			// else keep its original name.
			virtualPath: `/u/${userId}/${base}/${f}`,
			s3Key: `u/${userId}/${base}/${f}`,
			mime: 'chemical/x-mdl-sdfile'
		});
	}
}

// If there's exactly one ligand, also link it as ligand.sdf for convenience.
const oneLig = files.filter((f) => f.mime === 'chemical/x-mdl-sdfile');
if (oneLig.length === 1 && !oneLig[0].virtualPath.endsWith('/ligand.sdf')) {
	const original = oneLig[0];
	files.push({
		...original,
		virtualPath: `/u/${userId}/${base}/ligand.sdf`,
		s3Key: `u/${userId}/${base}/ligand.sdf`
	});
}

console.log(`seeding ${target} → /casp/${target}/ for user ${userId}`);
for (const f of files) {
	if (!fs.existsSync(f.local)) {
		console.log(`  (skip — missing local file: ${f.local})`);
		continue;
	}
	await upload(f);
}
await pool.end();
console.log('done.');
