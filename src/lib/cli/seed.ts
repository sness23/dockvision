import fs from 'node:fs';
import path from 'node:path';
import { env } from '$env/dynamic/private';
import { putObject } from '../server/s3';
import { query } from '../server/db';
import { s3KeyFor } from '../fs/resolve';
import { text, err, type CmdContext, type CmdResponse, type TextLine } from './types';

const CASP_SETS = ['casp15', 'casp16', 'casp17'];

function mimeFor(name: string): string {
	if (name.endsWith('.pdb')) return 'chemical/x-pdb';
	if (name.endsWith('.cif')) return 'chemical/x-cif';
	if (name.endsWith('.sdf')) return 'chemical/x-mdl-sdfile';
	if (name.endsWith('.fasta') || name.endsWith('.fa')) return 'application/x-fasta';
	if (name.endsWith('.json')) return 'application/json';
	return 'application/octet-stream';
}

/**
 * `seed casp <target>` — pre-upload a CASP target's inputs to /casp/<target>/.
 * Only available where CASP_VAULT_DIR points at a casp inputs/ tree
 * (local dev / a www0 with the vault synced). Gated otherwise.
 */
export async function seed(argv: string[], ctx: CmdContext): Promise<CmdResponse> {
	if (argv[0] !== 'casp' || !argv[1]) {
		return err('usage: seed casp <target-id>   (e.g. seed casp T1146)');
	}
	const target = argv[1];
	if (!/^[A-Za-z0-9_]+$/.test(target)) return err('invalid target id');

	const vaultDir = env.CASP_VAULT_DIR;
	if (!vaultDir) {
		return err('seeding not available — CASP_VAULT_DIR is not set on this instance');
	}

	let targetDir: string | null = null;
	for (const set of CASP_SETS) {
		const d = path.join(vaultDir, set, target);
		if (fs.existsSync(d) && fs.statSync(d).isDirectory()) {
			targetDir = d;
			break;
		}
	}
	if (!targetDir) return err(`target ${target} not found under ${vaultDir}/{casp15,16,17}/`);

	const toUpload: { local: string; name: string }[] = [];
	for (const name of ['receptor.pdb', 'receptor.fasta', 'target.json']) {
		const p = path.join(targetDir, name);
		if (fs.existsSync(p)) toUpload.push({ local: p, name });
	}
	const ligDir = path.join(targetDir, 'ligands');
	const ligands: string[] = [];
	if (fs.existsSync(ligDir)) {
		for (const f of fs.readdirSync(ligDir)) {
			if (f.endsWith('.sdf')) {
				toUpload.push({ local: path.join(ligDir, f), name: f });
				ligands.push(f);
			}
		}
	}
	if (toUpload.length === 0) return err(`no recognizable inputs in ${targetDir}`);

	const base = `/u/${ctx.userId}/casp/${target}`;
	const lines: TextLine[] = [{ s: `seeded ${target} → /casp/${target}/`, t: 'ok' }];

	for (const f of toUpload) {
		const buf = fs.readFileSync(f.local);
		const virtualPath = `${base}/${f.name}`;
		const s3Key = s3KeyFor(String(ctx.userId), virtualPath);
		const mime = mimeFor(f.name);
		await putObject(s3Key, buf, mime);
		await query(
			`INSERT INTO files (user_id, path, s3_key, size_bytes, mime, expires_at)
			 VALUES ($1, $2, $3, $4, $5, now() + interval '180 days')
			 ON CONFLICT (user_id, path) DO UPDATE
			   SET s3_key = EXCLUDED.s3_key, size_bytes = EXCLUDED.size_bytes,
			       mime = EXCLUDED.mime, expires_at = EXCLUDED.expires_at`,
			[ctx.userId, virtualPath, s3Key, buf.length, mime]
		);
		lines.push({ s: `  ${f.name}  (${buf.length}B)`, t: 'dim' });
	}

	// If exactly one ligand, alias it as ligand.sdf for convenience.
	if (ligands.length === 1 && ligands[0] !== 'ligand.sdf') {
		const srcPath = `${base}/${ligands[0]}`;
		const src = await query<{ s3_key: string; size_bytes: number; mime: string }>(
			'SELECT s3_key, size_bytes, mime FROM files WHERE user_id = $1 AND path = $2',
			[ctx.userId, srcPath]
		);
		if (src.length) {
			const buf = fs.readFileSync(path.join(ligDir, ligands[0]));
			const aliasPath = `${base}/ligand.sdf`;
			const aliasKey = s3KeyFor(String(ctx.userId), aliasPath);
			await putObject(aliasKey, buf, 'chemical/x-mdl-sdfile');
			await query(
				`INSERT INTO files (user_id, path, s3_key, size_bytes, mime, expires_at)
				 VALUES ($1, $2, $3, $4, $5, now() + interval '180 days')
				 ON CONFLICT (user_id, path) DO UPDATE
				   SET s3_key = EXCLUDED.s3_key, size_bytes = EXCLUDED.size_bytes, mime = EXCLUDED.mime`,
				[ctx.userId, aliasPath, aliasKey, buf.length, 'chemical/x-mdl-sdfile']
			);
			lines.push({ s: `  ligand.sdf  (alias of ${ligands[0]})`, t: 'dim' });
		}
	}

	lines.push({ s: '' });
	lines.push({ s: `try:  ls /casp/${target}    ·    view /casp/${target}/receptor.pdb` });
	return { type: 'text', lines };
}
