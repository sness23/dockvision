import { listKeys, createKey, revokeKey } from '../server/api-keys';
import { text, err, type CmdContext, type CmdResponse, type TextLine } from './types';

function fmtDate(d: Date | null | string): string {
	if (!d) return '-';
	const date = typeof d === 'string' ? new Date(d) : d;
	return date.toISOString().slice(0, 16).replace('T', ' ');
}

export async function keys(argv: string[], ctx: CmdContext): Promise<CmdResponse> {
	const sub = argv[0] ?? 'list';
	if (sub === 'list') return list(ctx);
	if (sub === 'create') return create(argv.slice(1), ctx);
	if (sub === 'revoke') return revoke(argv.slice(1), ctx);
	return err('usage: keys [list|create <name>|revoke <prefix-or-id>]');
}

async function list(ctx: CmdContext): Promise<CmdResponse> {
	const rows = await listKeys(ctx.userId);
	if (!rows.length) return text({ s: '(no api keys)', t: 'dim' });
	const lines: TextLine[] = [
		{ s: 'PREFIX        NAME                LAST USED         CREATED         STATUS', t: 'dim' }
	];
	for (const r of rows) {
		const status = r.revoked_at ? 'revoked' : 'active';
		lines.push({
			s: `${r.key_prefix.padEnd(13)} ${r.name.padEnd(19).slice(0, 19)} ${fmtDate(r.last_used_at).padEnd(17)} ${fmtDate(r.created_at).padEnd(15)} ${status}`,
			t: r.revoked_at ? 'dim' : 'normal'
		});
	}
	return { type: 'text', lines };
}

async function create(argv: string[], ctx: CmdContext): Promise<CmdResponse> {
	if (!argv[0]) return err('usage: keys create <name>');
	const name = argv.join(' ');
	const { full, prefix } = await createKey(ctx.userId, name);
	return text(
		{ s: `created api key ${prefix}`, t: 'ok' },
		{ s: '' },
		{ s: '  ' + full },
		{ s: '' },
		{ s: 'copy this now — it will not be shown again.', t: 'warn' },
		{ s: 'use it with the dvk CLI:', t: 'dim' },
		{ s: '  export DOCKVISION_API_KEY=' + full, t: 'dim' },
		{ s: '  dvk whoami', t: 'dim' }
	);
}

async function revoke(argv: string[], ctx: CmdContext): Promise<CmdResponse> {
	if (!argv[0]) return err('usage: keys revoke <prefix-or-id>');
	const ok = await revokeKey(ctx.userId, argv[0]);
	if (!ok) return err(`no active key matching ${argv[0]}`);
	return text({ s: `revoked ${argv[0]}`, t: 'warn' });
}
