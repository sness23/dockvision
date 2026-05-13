import minimist from 'minimist';
import { query } from '../server/db';
import * as files from '../server/files';
import { resolveUserPath, s3KeyFor } from '../fs/resolve';
import { presignedGet } from '../server/s3';
import { assertCanAfford } from '../server/balance';
import { estimateCents, formatCents } from '../server/pricing';
import { getTool, endpointIdFor } from '../server/tools';
import { getBoss, JOB_QUEUE, type JobPayload } from '../server/queue';
import { cancel as runpodCancel } from '../server/runpod';
import { text, err, type CmdContext, type CmdResponse, type TextLine } from './types';

interface JobRow {
	id: string;
	tool: string;
	status: string;
	gpu_class: string;
	estimated_cost_cents: string;
	actual_cost_cents: string | null;
	execution_time_ms: string | null;
	error: string | null;
	args: Record<string, unknown>;
	runpod_endpoint_id: string | null;
	runpod_job_id: string | null;
	created_at: Date;
	started_at: Date | null;
	completed_at: Date | null;
}

function fmtAgo(d: Date | null | string): string {
	if (!d) return '-';
	const date = typeof d === 'string' ? new Date(d) : d;
	const sec = Math.floor((Date.now() - date.getTime()) / 1000);
	if (sec < 60) return `${sec}s ago`;
	if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
	if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
	return `${Math.floor(sec / 86400)}d ago`;
}

export async function run(argv: string[], ctx: CmdContext): Promise<CmdResponse> {
	if (!argv[0]) return err('usage: run <tool> [args]');
	const toolName = argv[0];
	const tool = getTool(toolName);
	if (!tool) return err(`unknown tool: ${toolName}`);

	const parsed = minimist(argv.slice(1));
	const validated: Record<string, unknown> = {};
	for (const [name, spec] of Object.entries(tool.args)) {
		let v: unknown = parsed[name];
		if (v === undefined && spec.default !== undefined) v = spec.default;
		if (v === undefined) {
			if (spec.required) return err(`missing required --${name}`);
			continue;
		}
		if (spec.type === 'number') {
			const n = Number(v);
			if (!Number.isFinite(n)) return err(`--${name} must be a number`);
			validated[name] = n;
		} else if (spec.type === 'boolean') {
			validated[name] = Boolean(v);
		} else {
			validated[name] = String(v);
		}
	}

	// Resolve path args to S3 keys + presigned GET URLs.
	const inputUrls: Record<string, string> = {};
	for (const [name, spec] of Object.entries(tool.args)) {
		if (spec.type !== 'path' || validated[name] === undefined) continue;
		const virtualPath = resolveUserPath(String(ctx.userId), ctx.cwd, String(validated[name]));
		const row = await files.stat(ctx.userId, ctx.cwd, String(validated[name]));
		if (!row) return err(`input not found: ${validated[name]}`);
		inputUrls[name] = await presignedGet(row.s3_key);
		validated[name] = virtualPath;
	}

	const estimate = estimateCents(tool.typicalRuntimeSec, tool.gpu);

	try {
		await assertCanAfford(ctx.userId, estimate);
	} catch (e) {
		return err((e as Error).message);
	}

	let endpointId: string;
	try {
		endpointId = endpointIdFor(tool);
	} catch (e) {
		return err((e as Error).message);
	}

	const inserted = await query<{ id: string }>(
		`INSERT INTO jobs
			(user_id, tool, tool_version, args, gpu_class, runpod_endpoint_id,
			 status, estimated_cost_cents)
		 VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7)
		 RETURNING id`,
		[
			ctx.userId,
			tool.name,
			tool.version,
			JSON.stringify(validated),
			tool.gpu,
			endpointId,
			estimate
		]
	);
	const jobId = inserted[0].id;

	// Allocate an output prefix; handler will return base64 outputs which the
	// worker will register under this prefix.
	const outputPrefix = `u/${ctx.userId}/jobs/${jobId}/output`;

	const payload: JobPayload = {
		jobId,
		userId: ctx.userId,
		tool: tool.name,
		endpointId,
		input: {
			tool: tool.name,
			args: validated,
			input_urls: inputUrls,
			output_prefix: outputPrefix,
			max_runtime_sec: tool.maxRuntimeSec
		},
		maxRuntimeSec: tool.maxRuntimeSec
	};

	const boss = await getBoss();
	await boss.send(JOB_QUEUE, payload);

	const lines: TextLine[] = [
		{ s: `submitted job ${jobId}`, t: 'ok' },
		{ s: `tool:      ${tool.displayName} (${tool.name}) on ${tool.gpu}`, t: 'dim' },
		{ s: `estimate:  ${formatCents(estimate)}  (${tool.typicalRuntimeSec}s typical × markup)`, t: 'dim' },
		{ s: '' },
		{ s: `run 'status ${jobId}' or 'jobs --running' to track.` }
	];
	return { type: 'text', lines };
}

export async function list(argv: string[], ctx: CmdContext): Promise<CmdResponse> {
	const args = minimist(argv, { boolean: ['running', 'all'] });
	const limit = Math.min(Number(args.limit ?? 20), 100);
	let where = 'user_id = $1';
	if (args.running) where += " AND status IN ('queued', 'running')";
	const rows = await query<JobRow>(
		`SELECT * FROM jobs WHERE ${where} ORDER BY created_at DESC LIMIT ${limit}`,
		[ctx.userId]
	);
	if (rows.length === 0) return text({ s: '(no jobs)', t: 'dim' });

	const lines: TextLine[] = [
		{ s: 'ID                                    TOOL       STATUS      COST     AGE', t: 'dim' }
	];
	for (const r of rows) {
		const cost = r.actual_cost_cents
			? formatCents(Number(r.actual_cost_cents))
			: '~' + formatCents(Number(r.estimated_cost_cents));
		lines.push({
			s: `${r.id}  ${r.tool.padEnd(10)} ${r.status.padEnd(11)} ${cost.padEnd(8)} ${fmtAgo(r.created_at)}`,
			t:
				r.status === 'completed'
					? 'ok'
					: r.status === 'failed' || r.status === 'cancelled'
						? 'err'
						: r.status === 'running'
							? 'warn'
							: 'normal'
		});
	}
	return { type: 'text', lines };
}

export async function status(argv: string[], ctx: CmdContext): Promise<CmdResponse> {
	if (!argv[0]) return err('usage: status <job_id>');
	const rows = await query<JobRow>(
		'SELECT * FROM jobs WHERE id = $1 AND user_id = $2',
		[argv[0], ctx.userId]
	);
	if (!rows.length) return err('no such job');
	const r = rows[0];
	const lines: TextLine[] = [
		{ s: `job ${r.id}` },
		{ s: `tool:       ${r.tool}` },
		{
			s: `status:     ${r.status}`,
			t: r.status === 'completed' ? 'ok' : r.status === 'failed' ? 'err' : 'normal'
		},
		{ s: `gpu:        ${r.gpu_class}`, t: 'dim' },
		{ s: `estimated:  ${formatCents(Number(r.estimated_cost_cents))}` }
	];
	if (r.execution_time_ms) {
		lines.push({ s: `runtime:    ${(Number(r.execution_time_ms) / 1000).toFixed(1)}s` });
	}
	if (r.actual_cost_cents !== null) {
		lines.push({ s: `actual:     ${formatCents(Number(r.actual_cost_cents))}`, t: 'ok' });
	}
	if (r.error) {
		lines.push({ s: `error:      ${r.error}`, t: 'err' });
	}
	lines.push({ s: `created:    ${fmtAgo(r.created_at)}`, t: 'dim' });
	if (r.completed_at) lines.push({ s: `completed:  ${fmtAgo(r.completed_at)}`, t: 'dim' });
	if (r.status === 'completed') {
		lines.push({ s: '' });
		lines.push({ s: `outputs in /u/${ctx.userId}/jobs/${r.id}/output/` });
	}
	return { type: 'text', lines };
}

export async function cancel(argv: string[], ctx: CmdContext): Promise<CmdResponse> {
	if (!argv[0]) return err('usage: cancel <job_id>');
	const rows = await query<JobRow>(
		'SELECT * FROM jobs WHERE id = $1 AND user_id = $2',
		[argv[0], ctx.userId]
	);
	if (!rows.length) return err('no such job');
	const r = rows[0];
	if (!['queued', 'running'].includes(r.status)) return err(`job is already ${r.status}`);
	if (r.runpod_endpoint_id && r.runpod_job_id) {
		try {
			await runpodCancel(r.runpod_endpoint_id, r.runpod_job_id);
		} catch (e) {
			return err(`runpod cancel failed: ${(e as Error).message}`);
		}
	}
	await query("UPDATE jobs SET status = 'cancelled', completed_at = now() WHERE id = $1", [r.id]);
	return text({ s: `cancelled job ${r.id}`, t: 'warn' });
}

export async function log(argv: string[], ctx: CmdContext): Promise<CmdResponse> {
	if (!argv[0]) return err('usage: log <job_id>');
	try {
		const logPath = `/u/${ctx.userId}/jobs/${argv[0]}/log`;
		const row = await files.stat(ctx.userId, '/', logPath);
		if (!row) return err('no log yet (job may not have completed)');
		const url = await presignedGet(s3KeyFor(String(ctx.userId), logPath));
		const res = await fetch(url);
		const body = await res.text();
		return text(...body.split('\n').map((s) => ({ s })));
	} catch (e) {
		return err((e as Error).message);
	}
}
