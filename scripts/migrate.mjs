#!/usr/bin/env node
// Minimal SQL-file-based migrator. Numbered .sql files in migrations/.
// Tracks applied state in schema_migrations.
//
//   node scripts/migrate.mjs up        run pending migrations
//   node scripts/migrate.mjs status    list applied/pending

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'migrations');

function loadEnv() {
	const envPath = path.resolve(__dirname, '..', '.env');
	if (!fs.existsSync(envPath)) return;
	const lines = fs.readFileSync(envPath, 'utf8').split('\n');
	for (const line of lines) {
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
		if (!m) continue;
		const [, k, v] = m;
		if (!process.env[k]) process.env[k] = v.replace(/^["']|["']$/g, '');
	}
}

function discover() {
	return fs
		.readdirSync(MIGRATIONS_DIR)
		.filter((f) => /^\d+_.+\.sql$/.test(f))
		.sort()
		.map((f) => {
			const id = parseInt(f.split('_', 1)[0], 10);
			return { id, name: f, path: path.join(MIGRATIONS_DIR, f) };
		});
}

async function ensureBookkeeping(client) {
	await client.query(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			id          INTEGER PRIMARY KEY,
			name        TEXT NOT NULL,
			applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
		);
	`);
}

async function applied(client) {
	const r = await client.query('SELECT id FROM schema_migrations ORDER BY id');
	return new Set(r.rows.map((row) => row.id));
}

async function up() {
	loadEnv();
	if (!process.env.DATABASE_URL) {
		console.error('DATABASE_URL is not set (check .env)');
		process.exit(1);
	}
	const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	try {
		await ensureBookkeeping(client);
		const done = await applied(client);
		for (const m of discover()) {
			if (done.has(m.id)) continue;
			console.log(`applying  ${m.name}`);
			const sql = fs.readFileSync(m.path, 'utf8');
			await client.query('BEGIN');
			try {
				await client.query(sql);
				await client.query('INSERT INTO schema_migrations (id, name) VALUES ($1, $2)', [
					m.id,
					m.name
				]);
				await client.query('COMMIT');
			} catch (err) {
				await client.query('ROLLBACK');
				console.error(`FAILED on ${m.name}:`, err.message);
				process.exit(1);
			}
		}
		console.log('done.');
	} finally {
		await client.end();
	}
}

async function status() {
	loadEnv();
	const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	try {
		await ensureBookkeeping(client);
		const done = await applied(client);
		for (const m of discover()) {
			console.log(`${done.has(m.id) ? '[x]' : '[ ]'} ${m.name}`);
		}
	} finally {
		await client.end();
	}
}

const cmd = process.argv[2];
if (cmd === 'up') await up();
else if (cmd === 'status') await status();
else {
	console.log('usage: migrate.mjs <up|status>');
	process.exit(1);
}
