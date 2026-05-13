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
  export DOCKVISION_API_KEY=dvk_xxx_yyyy
  (or echo your key into ~/.dockvision/api-key)
  export DOCKVISION_URL=${API_URL}   # default

examples:
  dvk whoami
  dvk cost
  dvk tools
  dvk ls
  dvk upload ./protein.pdb /inputs/protein.pdb
  dvk run gnina --receptor /inputs/protein.pdb --ligand /inputs/ligand.sdf
  dvk jobs --running
  dvk status <job-id>
  dvk download /u/<uid>/jobs/<jid>/output/poses.sdf > poses.sdf

create an API key from the web shell at /app:  keys create laptop`);
}

function quote(s) {
	if (/^[a-zA-Z0-9_.\-\/=:@]+$/.test(s)) return s;
	return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
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
	const apiKey = readKey();
	if (!apiKey) {
		console.error('No API key. Set DOCKVISION_API_KEY or put it in ~/.dockvision/api-key.');
		console.error("Generate one with 'keys create <name>' in the web shell.");
		process.exit(1);
	}

	const [cmd, ...args] = argv;

	if (cmd === 'upload') {
		await handleUpload(args, apiKey);
		return;
	}
	if (cmd === 'download') {
		await handleDownload(args, apiKey);
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
