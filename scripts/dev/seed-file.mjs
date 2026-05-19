#!/usr/bin/env node
// Seed a single local file into a dockvision user's virtual filesystem.
// Uploads to MinIO/S3 and inserts the `files` row.
//
//   node scripts/dev/seed-file.mjs <local-file> <virtual-path> [user-id]
//   node scripts/dev/seed-file.mjs /tmp/1erm.pdb /1erm.pdb 1

import fs from 'node:fs';
import path from 'node:path';
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

const localFile = process.argv[2];
let virtualPath = process.argv[3];
const userId = Number(process.argv[4] || 1);

if (!localFile || !virtualPath) {
	console.error('usage: seed-file.mjs <local-file> <virtual-path> [user-id]');
	process.exit(1);
}
if (!fs.existsSync(localFile)) {
	console.error(`no such file: ${localFile}`);
	process.exit(1);
}

// Normalize the virtual path to /u/<id>/...
const root = `/u/${userId}`;
if (!virtualPath.startsWith('/')) virtualPath = '/' + virtualPath;
if (!virtualPath.startsWith(root + '/')) virtualPath = root + virtualPath;
const s3Key = 'u/' + virtualPath.slice(3); // strip leading "/u/"

function mimeFor(name) {
	if (name.endsWith('.pdb')) return 'chemical/x-pdb';
	if (name.endsWith('.cif')) return 'chemical/x-cif';
	if (name.endsWith('.sdf')) return 'chemical/x-mdl-sdfile';
	if (name.endsWith('.fasta') || name.endsWith('.fa')) return 'application/x-fasta';
	if (name.endsWith('.json')) return 'application/json';
	return 'application/octet-stream';
}

const s3 = new S3Client({
	region: process.env.AWS_REGION || 'us-east-1',
	endpoint: process.env.S3_ENDPOINT || undefined,
	forcePathStyle: !!process.env.S3_ENDPOINT,
	credentials: {
		accessKeyId: process.env.AWS_ACCESS_KEY_ID,
		secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
	}
});
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const buf = fs.readFileSync(localFile);
const mime = mimeFor(virtualPath);

await s3.send(
	new PutObjectCommand({
		Bucket: process.env.S3_BUCKET || 'dockvision-prod',
		Key: s3Key,
		Body: buf,
		ContentType: mime
	})
);
await pool.query(
	`INSERT INTO files (user_id, path, s3_key, size_bytes, mime, expires_at)
	 VALUES ($1, $2, $3, $4, $5, now() + interval '180 days')
	 ON CONFLICT (user_id, path) DO UPDATE
	   SET s3_key = EXCLUDED.s3_key, size_bytes = EXCLUDED.size_bytes,
	       mime = EXCLUDED.mime, expires_at = EXCLUDED.expires_at`,
	[userId, virtualPath, s3Key, buf.length, mime]
);
await pool.end();
console.log(`seeded ${virtualPath}  (${buf.length}B, ${mime})`);
