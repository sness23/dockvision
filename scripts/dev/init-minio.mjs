#!/usr/bin/env node
// Create the dockvision bucket on a local MinIO instance and apply CORS so
// presigned PUT/GET from the browser works.
//
//   node scripts/dev/init-minio.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	S3Client,
	CreateBucketCommand,
	PutBucketCorsCommand,
	HeadBucketCommand
} from '@aws-sdk/client-s3';

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

const ENDPOINT = process.env.S3_ENDPOINT || 'http://localhost:9000';
const BUCKET = process.env.S3_BUCKET || 'dockvision-prod';
const REGION = process.env.AWS_REGION || 'us-east-1';

const s3 = new S3Client({
	region: REGION,
	endpoint: ENDPOINT,
	forcePathStyle: true,
	credentials: {
		accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'minioadmin',
		secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'minioadmin'
	}
});

async function ensureBucket() {
	try {
		await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
		console.log(`bucket ${BUCKET} already exists`);
	} catch {
		await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
		console.log(`created bucket ${BUCKET}`);
	}
}

async function ensureCors() {
	// MinIO 2024+ doesn't implement PutBucketCors via the S3 API and defaults to
	// allowing any origin — best-effort attempt, swallow NotImplemented.
	try {
		await s3.send(
			new PutBucketCorsCommand({
				Bucket: BUCKET,
				CORSConfiguration: {
					CORSRules: [
						{
							AllowedMethods: ['GET', 'PUT', 'HEAD'],
							AllowedOrigins: [
								'http://localhost:5173',
								'http://localhost:5174',
								'http://localhost:3000',
								'http://127.0.0.1:5173',
								'http://127.0.0.1:5174'
							],
							AllowedHeaders: ['*'],
							ExposeHeaders: ['ETag'],
							MaxAgeSeconds: 3000
						}
					]
				}
			})
		);
		console.log('cors policy applied');
	} catch (e) {
		if (e?.Code === 'NotImplemented') {
			console.log('cors: MinIO allows all origins by default (PutBucketCors NotImplemented — fine)');
		} else {
			throw e;
		}
	}
}

await ensureBucket();
await ensureCors();
console.log(`\ndone. minio console: ${ENDPOINT.replace(':9000', ':9001')}  (minioadmin / minioadmin)`);
