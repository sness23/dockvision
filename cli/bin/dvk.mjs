#!/usr/bin/env node
// dvk — DockVision command-line client.
//
//   dvk whoami
//   dvk ls /inputs
//   dvk run gnina --receptor /inputs/p.pdb --ligand /inputs/l.sdf
//   dvk upload ./local-protein.pdb /inputs/protein.pdb
//
// Reads DOCKVISION_API_KEY from env or ~/.dockvision/api-key.
// Reads DOCKVISION_URL or defaults to https://dockvision.doi.bio.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';

const API_URL = process.env.DOCKVISION_URL || 'https://dockvision.doi.bio';
const KEY_FILE = path.join(os.homedir(), '.dockvision', 'api-key');

function readKey() {
	if (process.env.DOCKVISION_API_KEY) return process.env.DOCKVISION_API_KEY.trim();
	if (fs.existsSync(KEY_FILE)) return fs.readFileSync(KEY_FILE, 'utf8').trim();
	return null;
}

const COLORS = {
	reset: '\x1b[0m',
	dim: '\x1b[90m',
	ok: '\x1b[32m',
	warn: '\x1b[33m',
	err: '\x1b[31m',
	cyan: '\x1b[36m'
};
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
function paint(s, k) {
	if (!useColor || !k) return s;
	return (COLORS[k] || '') + s + COLORS.reset;
}

function usage() {
	console.log(`dvk — DockVision CLI

  dvk <command> [args...]

setup:
  dvk login                          # browser-based — mints + saves a key
  (or manually: export DOCKVISION_API_KEY=dvk_xxx_yyyy)
  export DOCKVISION_URL=${API_URL}   # default

examples:
  dvk login
  dvk whoami
  dvk cost
  dvk tools
  dvk ls
  dvk upload ./protein.pdb /inputs/protein.pdb
  dvk upload-dir ./T1146 /casp/T1146
  dvk run gnina --receptor /casp/T1146/receptor.pdb --ligand /casp/T1146/ligand.sdf
  dvk jobs --running
  dvk status <job-id>
  dvk download /u/<uid>/jobs/<jid>/output/poses.sdf > poses.sdf
  dvk download-dir /jobs/<jid>/output ./out

create an API key from the web shell at /app:  keys create laptop`);
}

function quote(s) {
	if (/^[a-zA-Z0-9_.\-/=:@]+$/.test(s)) return s;
	return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function openBrowser(url) {
	const cmd =
		process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
	const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
	try {
		spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
		return true;
	} catch {
		return false;
	}
}

async function handleLogin() {
	const server = http.createServer((req, res) => {
		const u = new URL(req.url, 'http://127.0.0.1');
		if (u.pathname !== '/cb') {
			res.writeHead(404);
			res.end();
			return;
		}
		const key = u.searchParams.get('key');
		if (!key) {
			res.writeHead(400, { 'Content-Type': 'text/plain' });
			res.end('no key in callback');
			return;
		}
		fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
		fs.writeFileSync(KEY_FILE, key.trim() + '\n', { mode: 0o600 });
		res.writeHead(200, { 'Content-Type': 'text/html' });
		res.end(
			'<!doctype html><body style="font-family:system-ui;background:#0d1117;color:#c9d1d9;padding:3em">' +
				'<h2>DockVision CLI authorized</h2><p>Key saved. You can close this tab.</p></body>'
		);
		console.log(paint(`logged in — key saved to ${KEY_FILE}`, 'ok'));
		setTimeout(() => {
			server.close();
			process.exit(0);
		}, 200);
	});

	server.listen(0, '127.0.0.1', () => {
		const { port } = server.address();
		const authUrl = `${API_URL}/cli/auth?port=${port}`;
		console.log('authorize DockVision CLI in your browser:');
		console.log('  ' + paint(authUrl, 'cyan'));
		if (!openBrowser(authUrl)) {
			console.log(paint('(could not auto-open a browser — paste the URL above)', 'dim'));
		}
	});

	setTimeout(() => {
		console.error(paint('login timed out after 3 minutes', 'err'));
		process.exit(1);
	}, 180_000);
}

async function callCmd(line, apiKey) {
	const res = await fetch(`${API_URL}/api/cmd`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`
		},
		body: JSON.stringify({ line, cwd: '/' })
	});
	if (!res.ok) {
		const body = await res.text();
		throw new Error(`HTTP ${res.status}: ${body}`);
	}
	return res.json();
}

async function handleUpload(args, apiKey) {
	const [localFile, target] = args;
	if (!localFile || !target) {
		console.error('usage: dvk upload <local-file> <target-path>');
		process.exit(1);
	}
	if (!fs.existsSync(localFile)) {
		console.error(`no such file: ${localFile}`);
		process.exit(1);
	}
	const stat = fs.statSync(localFile);
	const ext = path.extname(localFile).toLowerCase();
	const mimeMap = {
		'.pdb': 'chemical/x-pdb',
		'.cif': 'chemical/x-cif',
		'.sdf': 'chemical/x-mdl-sdfile',
		'.fasta': 'application/x-fasta',
		'.fa': 'application/x-fasta',
		'.json': 'application/json',
		'.yaml': 'application/x-yaml',
		'.yml': 'application/x-yaml',
		'.txt': 'text/plain'
	};
	const mime = mimeMap[ext] || 'application/octet-stream';
	const line = `upload ${quote(target)} --content-type=${quote(mime)} --size=${stat.size}`;
	const res = await callCmd(line, apiKey);
	if (res.type === 'error') {
		console.error(paint('error: ' + res.message, 'err'));
		process.exit(1);
	}
	if (res.type !== 'upload') {
		console.error('unexpected response:', res);
		process.exit(1);
	}
	const data = fs.readFileSync(localFile);
	const put = await fetch(res.uploadUrl, {
		method: 'PUT',
		headers: { 'Content-Type': mime },
		body: data
	});
	if (!put.ok) {
		console.error(`S3 PUT failed: ${put.status} ${await put.text()}`);
		process.exit(1);
	}
	console.log(paint(`uploaded ${stat.size}B → ${res.targetPath}`, 'ok'));
}

async function walkLocalDir(root) {
	const out = [];
	async function rec(dir, rel) {
		for (const ent of await fs.promises.readdir(dir, { withFileTypes: true })) {
			const abs = path.join(dir, ent.name);
			const r = rel ? path.posix.join(rel, ent.name) : ent.name;
			if (ent.isDirectory()) await rec(abs, r);
			else if (ent.isFile()) out.push({ abs, rel: r });
		}
	}
	await rec(root, '');
	return out;
}

async function handleUploadDir(args, apiKey) {
	const [localDir, target] = args;
	if (!localDir || !target) {
		console.error('usage: dvk upload-dir <local-dir> <target-virtual-path>');
		process.exit(1);
	}
	if (!fs.existsSync(localDir) || !fs.statSync(localDir).isDirectory()) {
		console.error(`not a directory: ${localDir}`);
		process.exit(1);
	}
	const files = await walkLocalDir(localDir);
	if (files.length === 0) {
		console.error('(empty)');
		return;
	}
	const targetClean = target.replace(/\/+$/, '');
	console.log(paint(`uploading ${files.length} files to ${targetClean}/`, 'dim'));
	let ok = 0;
	for (const f of files) {
		const targetPath = `${targetClean}/${f.rel}`;
		try {
			await handleUpload([f.abs, targetPath], apiKey);
			ok++;
		} catch (e) {
			console.error(paint(`failed: ${f.rel} — ${e.message}`, 'err'));
		}
	}
	console.log(paint(`uploaded ${ok}/${files.length}`, ok === files.length ? 'ok' : 'warn'));
}

async function handleDownloadDir(args, apiKey) {
	const [virtualDir, localDir] = args;
	if (!virtualDir || !localDir) {
		console.error('usage: dvk download-dir <virtual-dir> <local-dir>');
		process.exit(1);
	}
	// `ls <virtualDir>` recursively. We do this by calling ls server-side and
	// recursing into entries that end with '/'.
	fs.mkdirSync(localDir, { recursive: true });

	async function rec(virt, local) {
		const res = await callCmd(`ls ${quote(virt)}`, apiKey);
		if (res.type !== 'text') {
			console.error(paint(`ls failed for ${virt}`, 'err'));
			return;
		}
		const names = res.lines
			.map((l) => l.s.trim())
			.filter((s) => s && !s.startsWith('(') && s !== '');
		for (const line of names) {
			// ls line shape: "  12.3K    name" (file) or "name/" (dir).
			const parts = line.split(/\s+/);
			const last = parts[parts.length - 1];
			if (!last) continue;
			if (last.endsWith('/')) {
				const subVirt = `${virt.replace(/\/+$/, '')}/${last.slice(0, -1)}`;
				const subLocal = path.join(local, last.slice(0, -1));
				fs.mkdirSync(subLocal, { recursive: true });
				await rec(subVirt, subLocal);
			} else {
				const subVirt = `${virt.replace(/\/+$/, '')}/${last}`;
				const localFile = path.join(local, last);
				const dl = await callCmd(`download ${quote(subVirt)}`, apiKey);
				if (dl.type !== 'redirect') {
					console.error(paint(`  ${last}: ${dl.message || 'no url'}`, 'err'));
					continue;
				}
				const get = await fetch(dl.url);
				if (!get.ok) {
					console.error(paint(`  ${last}: HTTP ${get.status}`, 'err'));
					continue;
				}
				const buf = Buffer.from(await get.arrayBuffer());
				fs.writeFileSync(localFile, buf);
				console.log(paint(`  ${subVirt} → ${localFile}  (${buf.length}B)`, 'dim'));
			}
		}
	}
	await rec(virtualDir, localDir);
	console.log(paint(`done → ${localDir}`, 'ok'));
}

async function handleDownload(args, apiKey) {
	const [virtualPath] = args;
	if (!virtualPath) {
		console.error('usage: dvk download <virtual-path>');
		process.exit(1);
	}
	const line = `download ${quote(virtualPath)}`;
	const res = await callCmd(line, apiKey);
	if (res.type === 'error') {
		console.error(paint('error: ' + res.message, 'err'));
		process.exit(1);
	}
	if (res.type !== 'redirect') {
		console.error('unexpected response:', res);
		process.exit(1);
	}
	const get = await fetch(res.url);
	if (!get.ok) {
		console.error(`S3 GET failed: ${get.status}`);
		process.exit(1);
	}
	const buf = Buffer.from(await get.arrayBuffer());
	if (process.stdout.isTTY) {
		// write to a sensible filename
		const name = virtualPath.split('/').pop() || 'download';
		fs.writeFileSync(name, buf);
		console.error(paint(`saved ${buf.length}B → ${name}`, 'ok'));
	} else {
		process.stdout.write(buf);
	}
}

function renderResponse(res) {
	if (res.type === 'text') {
		for (const l of res.lines) {
			console.log(paint(l.s, l.t));
		}
	} else if (res.type === 'error') {
		console.error(paint('error: ' + res.message, 'err'));
		process.exit(1);
	} else if (res.type === 'redirect') {
		console.log(res.url);
	} else if (res.type === 'cd') {
		console.log(`cwd: ${res.newCwd}`);
	} else if (res.type === 'mol-view') {
		console.log(`viewer URL (open in browser):  ${res.file}`);
		console.log(paint(`(${res.format})`, 'dim'));
	} else {
		console.log(JSON.stringify(res, null, 2));
	}
}

async function main() {
	const argv = process.argv.slice(2);
	if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
		usage();
		return;
	}
	const [cmd, ...args] = argv;

	if (cmd === 'login') {
		await handleLogin();
		return;
	}

	const apiKey = readKey();
	if (!apiKey) {
		console.error('No API key. Run `dvk login`, or set DOCKVISION_API_KEY.');
		process.exit(1);
	}

	if (cmd === 'upload') {
		await handleUpload(args, apiKey);
		return;
	}
	if (cmd === 'upload-dir') {
		await handleUploadDir(args, apiKey);
		return;
	}
	if (cmd === 'download') {
		await handleDownload(args, apiKey);
		return;
	}
	if (cmd === 'download-dir') {
		await handleDownloadDir(args, apiKey);
		return;
	}

	const line = [cmd, ...args.map(quote)].join(' ');
	try {
		const res = await callCmd(line, apiKey);
		renderResponse(res);
	} catch (e) {
		console.error(paint(`error: ${e.message}`, 'err'));
		process.exit(1);
	}
}

main();
