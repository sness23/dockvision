import minimist from 'minimist';
import * as files from '../server/files';
import { query } from '../server/db';
import { presignedGet } from '../server/s3';
import { resolveUserPath, PathError } from '../fs/resolve';
import { text, err, type CmdContext, type CmdResponse, type TextLine } from './types';

function molFormat(p: string): string | null {
	const ext = p.split('.').pop()?.toLowerCase() ?? '';
	if (ext === 'cif' || ext === 'mmcif') return 'mmcif';
	if (ext === 'pdb') return 'pdb';
	if (ext === 'sdf') return 'sdf';
	if (ext === 'mol') return 'mol';
	return null;
}

function fmtSize(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}M`;
	return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}G`;
}

export async function pwd(_argv: string[], ctx: CmdContext): Promise<CmdResponse> {
	return text(ctx.cwd);
}

export async function cd(argv: string[], ctx: CmdContext): Promise<CmdResponse> {
	const target = argv[0] ?? `/u/${ctx.userId}`;
	let resolved: string;
	try {
		resolved = resolveUserPath(String(ctx.userId), ctx.cwd, target);
	} catch (e) {
		if (e instanceof PathError) return err(e.message);
		throw e;
	}
	if (resolved !== `/u/${ctx.userId}` && !(await files.dirExists(ctx.userId, resolved))) {
		return err(`no such directory: ${target}`);
	}
	return { type: 'cd', newCwd: resolved };
}

export async function ls(argv: string[], ctx: CmdContext): Promise<CmdResponse> {
	const args = minimist(argv);
	const path = args._[0] ?? ctx.cwd;
	try {
		const items = await files.list(ctx.userId, ctx.cwd, path);
		if (items.length === 0) return text({ s: '(empty)', t: 'dim' });
		const lines: TextLine[] = items.map((it) => ({
			s: it.kind === 'dir' ? it.name : `${fmtSize(it.size).padStart(7)}  ${it.pinned ? '*' : ' '} ${it.name}`,
			t: it.kind === 'dir' ? 'normal' : it.pinned ? 'ok' : 'normal'
		}));
		return { type: 'text', lines };
	} catch (e) {
		return err((e as Error).message);
	}
}

export async function cat(argv: string[], ctx: CmdContext): Promise<CmdResponse> {
	if (!argv[0]) return err('usage: cat <file>');
	try {
		const { url, row } = await files.presignDownload(ctx.userId, ctx.cwd, argv[0]);
		// Fetch and return as text. Binary files error out.
		const res = await fetch(url);
		const buf = Buffer.from(await res.arrayBuffer());
		const isText =
			(row.mime?.startsWith('text/') ?? false) ||
			['application/json', 'application/xml'].includes(row.mime ?? '') ||
			/\.(txt|json|sdf|pdb|cif|fasta|yaml|yml|csv|tsv|md|log|a3m)$/i.test(row.path);
		if (!isText && buf.subarray(0, 8000).includes(0)) {
			return err(`binary file (${fmtSize(Number(row.size_bytes))}). Use 'download ${argv[0]}'.`);
		}
		return text(...buf.toString('utf8').split('\n').map((s) => ({ s })));
	} catch (e) {
		return err((e as Error).message);
	}
}

export async function du(_argv: string[], ctx: CmdContext): Promise<CmdResponse> {
	const bytes = await files.totalBytes(ctx.userId);
	return text(
		{ s: `${fmtSize(bytes)}  total` },
		{ s: `${(bytes / 1e9).toFixed(3)} GB (precise)`, t: 'dim' }
	);
}

export async function pin(argv: string[], ctx: CmdContext): Promise<CmdResponse> {
	if (!argv[0]) return err('usage: pin <file>');
	try {
		const row = await files.setPinned(ctx.userId, ctx.cwd, argv[0], true);
		return text({ s: `pinned ${row.path}`, t: 'ok' });
	} catch (e) {
		return err((e as Error).message);
	}
}

export async function unpin(argv: string[], ctx: CmdContext): Promise<CmdResponse> {
	if (!argv[0]) return err('usage: unpin <file>');
	try {
		const row = await files.setPinned(ctx.userId, ctx.cwd, argv[0], false);
		return text({ s: `unpinned ${row.path}`, t: 'ok' });
	} catch (e) {
		return err((e as Error).message);
	}
}

export async function rm(argv: string[], ctx: CmdContext): Promise<CmdResponse> {
	if (!argv[0]) return err('usage: rm <file>');
	try {
		const row = await files.remove(ctx.userId, ctx.cwd, argv[0]);
		return text({ s: `removed ${row.path}`, t: 'ok' });
	} catch (e) {
		return err((e as Error).message);
	}
}

export async function view(argv: string[], ctx: CmdContext): Promise<CmdResponse> {
	if (!argv[0]) return err('usage: view <file> [more-files...]   |   view <job-dir>');

	// Single arg might be a job directory.
	if (argv.length === 1) {
		let resolved: string;
		try {
			resolved = resolveUserPath(String(ctx.userId), ctx.cwd, argv[0]);
		} catch (e) {
			if (e instanceof PathError) return err(e.message);
			throw e;
		}
		const jobMatch = resolved.match(/^\/u\/\d+\/jobs\/([0-9a-fA-F-]{36})(?:\/output)?\/?$/);
		if (jobMatch) return viewJob(ctx, jobMatch[1]);
	}

	// One or more files — overlay them in the same Mol* scene.
	const structures: { url: string; format: string; label: string }[] = [];
	for (const pathArg of argv) {
		try {
			const { url, row } = await files.presignDownload(ctx.userId, ctx.cwd, pathArg);
			const fmt = molFormat(row.path);
			if (!fmt) {
				const ext = row.path.split('.').pop() ?? '?';
				return err(`unsupported viewer format for ${pathArg}: .${ext} (use cif/pdb/sdf/mol)`);
			}
			const name = row.path.split('/').pop() ?? row.path;
			structures.push({ url, format: fmt, label: name });
		} catch (e) {
			return err((e as Error).message);
		}
	}
	const title = structures.length === 1
		? structures[0].label
		: `${structures.length} structures: ${structures.map((s) => s.label).join(', ')}`;
	return { type: 'mol-view', structures, title };
}

export async function mv(argv: string[], ctx: CmdContext): Promise<CmdResponse> {
	if (argv.length !== 2) return err('usage: mv <src> <dst>');
	try {
		const r = await files.move(ctx.userId, ctx.cwd, argv[0], argv[1]);
		return text({ s: `${r.srcPath} → ${r.dstPath}`, t: 'ok' });
	} catch (e) {
		return err((e as Error).message);
	}
}

export async function cp(argv: string[], ctx: CmdContext): Promise<CmdResponse> {
	if (argv.length !== 2) return err('usage: cp <src> <dst>');
	try {
		const r = await files.copy(ctx.userId, ctx.cwd, argv[0], argv[1]);
		return text({ s: `${r.srcPath} → ${r.dstPath}  (${r.size}B)`, t: 'ok' });
	} catch (e) {
		return err((e as Error).message);
	}
}

async function viewJob(ctx: CmdContext, jobId: string): Promise<CmdResponse> {
	const jobs = await query<{ args: Record<string, unknown>; tool: string; status: string }>(
		'SELECT args, tool, status FROM jobs WHERE id = $1 AND user_id = $2',
		[jobId, ctx.userId]
	);
	if (!jobs.length) return err('no such job');
	const job = jobs[0];

	const structures: { url: string; format: string; label: string }[] = [];

	// Input receptor, if it is itself a structure file (the GNINA case — Mol*
	// overlays the docked poses on it; co-folder outputs already include it).
	const receptor = job.args?.receptor;
	if (typeof receptor === 'string') {
		const fmt = molFormat(receptor);
		if (fmt) {
			const row = await files.stat(ctx.userId, `/u/${ctx.userId}`, receptor);
			if (row) {
				structures.push({ url: await presignedGet(row.s3_key), format: fmt, label: 'receptor' });
			}
		}
	}

	// Output structures.
	const outRows = await query<{ path: string; s3_key: string }>(
		`SELECT path, s3_key FROM files
		 WHERE user_id = $1 AND path LIKE $2 ORDER BY path`,
		[ctx.userId, `/u/${ctx.userId}/jobs/${jobId}/output/%`]
	);
	for (const r of outRows) {
		const fmt = molFormat(r.path);
		if (!fmt) continue;
		structures.push({
			url: await presignedGet(r.s3_key),
			format: fmt,
			label: r.path.split('/').pop() ?? r.path
		});
	}

	if (!structures.length) {
		return err(
			job.status === 'completed'
				? 'no viewable structures in this job'
				: `job is ${job.status} — nothing to view yet`
		);
	}
	return { type: 'mol-view', structures, title: `job ${jobId.slice(0, 8)} · ${job.tool}` };
}

export async function download(argv: string[], ctx: CmdContext): Promise<CmdResponse> {
	if (!argv[0]) return err('usage: download <file>');
	try {
		const { url, row } = await files.presignDownload(ctx.userId, ctx.cwd, argv[0]);
		return {
			type: 'redirect',
			url
		};
	} catch (e) {
		return err((e as Error).message);
	}
}

export async function upload(argv: string[], ctx: CmdContext): Promise<CmdResponse> {
	// `upload <target-path> [contentType] [sizeBytes]`
	// Client opens its file picker, then re-runs with the chosen file's metadata.
	// The /api/cmd route stamps `argv` from the form upload; here we generate the
	// presigned PUT URL and the client PUTs directly.
	const args = minimist(argv);
	const target = args._[0];
	if (!target) return err('usage: upload <target-path>');
	const contentType = String(args['content-type'] ?? 'application/octet-stream');
	const size = Number(args['size'] ?? 0);
	try {
		const { uploadUrl, path } = await files.createUpload(
			ctx.userId,
			ctx.cwd,
			target,
			contentType,
			size
		);
		return { type: 'upload', targetPath: path, uploadUrl };
	} catch (e) {
		return err((e as Error).message);
	}
}
