import { listTools, getTool, calibratedTypicalSec } from '../server/tools';
import { estimateCents, formatCents } from '../server/pricing';
import { err, type CmdContext, type CmdResponse, type TextLine } from './types';

export async function toolsList(_argv: string[], _ctx: CmdContext): Promise<CmdResponse> {
	const lines: TextLine[] = [
		{ s: 'available tools:' },
		{ s: '' },
		{ s: 'NAME       GPU       TYPICAL  EST. COST', t: 'dim' }
	];
	for (const t of listTools()) {
		const typical = await calibratedTypicalSec(t);
		const cost = estimateCents(typical, t.gpu);
		const mins = (typical / 60).toFixed(1);
		lines.push({
			s: `${t.name.padEnd(10)} ${t.gpu.padEnd(9)} ${(mins + ' min').padEnd(9)} ~${formatCents(cost)}`
		});
	}
	lines.push({ s: '' });
	lines.push({ s: "run 'tool <name>' for full arg schema.", t: 'dim' });
	return { type: 'text', lines };
}

export async function toolInfo(argv: string[], _ctx: CmdContext): Promise<CmdResponse> {
	if (!argv[0]) return err('usage: tool <name>');
	const t = getTool(argv[0]);
	if (!t) return err(`unknown tool: ${argv[0]}`);
	const typical = await calibratedTypicalSec(t);
	const cost = estimateCents(typical, t.gpu);
	const lines: TextLine[] = [
		{ s: `${t.displayName} (${t.name}) ${t.version}` },
		{ s: t.description, t: 'dim' },
		{ s: `license:  ${t.license}` },
		{ s: `upstream: ${t.upstream}`, t: 'dim' },
		{ s: `gpu:      ${t.gpu}` },
		{ s: `typical:  ${(typical / 60).toFixed(1)} min  (~${formatCents(cost)})` },
		{ s: `max:      ${(t.maxRuntimeSec / 60).toFixed(0)} min` },
		{ s: '' },
		{ s: 'arguments:' }
	];
	for (const [name, spec] of Object.entries(t.args)) {
		const tag = spec.required ? '*' : ' ';
		const def = spec.default !== undefined ? ` (default ${spec.default})` : '';
		lines.push({
			s: `  ${tag} --${name.padEnd(16)} ${spec.type.padEnd(8)} ${spec.description}${def}`
		});
	}
	return { type: 'text', lines };
}
