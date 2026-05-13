import minimist from 'minimist';
import { query } from '../server/db';
import { getBalance } from '../server/balance';
import { totalBytes } from '../server/files';
import { topupCheckoutSession } from '../server/stripe';
import { config, formatCents } from '../server/pricing';
import { text, err, type CmdContext, type CmdResponse, type TextLine } from './types';

export async function whoami(_argv: string[], ctx: CmdContext): Promise<CmdResponse> {
	const balance = await getBalance(ctx.userId);
	const bytes = await totalBytes(ctx.userId);
	const gb = bytes / 1e9;
	return text(
		{ s: `user:    ${ctx.userEmail}` },
		{ s: `id:      ${ctx.userId}`, t: 'dim' },
		{ s: `balance: ${formatCents(balance)}` },
		{ s: `storage: ${gb.toFixed(2)} GB`, t: 'dim' }
	);
}

export async function cost(_argv: string[], ctx: CmdContext): Promise<CmdResponse> {
	const balance = await getBalance(ctx.userId);
	const since = new Date();
	since.setDate(1);
	since.setHours(0, 0, 0, 0);

	const totals = await query<{ kind: string; total: string }>(
		`SELECT kind, COALESCE(SUM(-amount_cents), 0)::text AS total
		 FROM billing_events
		 WHERE user_id = $1 AND created_at >= $2 AND amount_cents < 0
		 GROUP BY kind`,
		[ctx.userId, since]
	);
	const byKind: Record<string, number> = {};
	for (const r of totals) byKind[r.kind] = Number(r.total);

	const lines: TextLine[] = [
		{ s: `balance:               ${formatCents(balance)}` },
		{ s: '' },
		{ s: 'month-to-date spend:', t: 'dim' },
		{ s: `  compute (jobs):      ${formatCents(byKind.job ?? 0)}` },
		{ s: `  storage:             ${formatCents(byKind.storage ?? 0)}` },
		{
			s: `  total:               ${formatCents((byKind.job ?? 0) + (byKind.storage ?? 0))}`,
			t: 'ok'
		}
	];
	return { type: 'text', lines };
}

export async function topup(argv: string[], ctx: CmdContext): Promise<CmdResponse> {
	const args = minimist(argv);
	const amountDollars = Number(args._[0] || args.amount || 10);
	if (!Number.isFinite(amountDollars) || amountDollars <= 0) {
		return err('usage: topup [amount-in-dollars]   (minimum $' + config.topupMinCents / 100 + ')');
	}
	const amountCents = Math.round(amountDollars * 100);
	if (amountCents < config.topupMinCents) {
		return err(`minimum top-up is ${formatCents(config.topupMinCents)}`);
	}
	const session = await topupCheckoutSession({
		userId: ctx.userId,
		userEmail: ctx.userEmail,
		amountCents,
		origin: ctx.origin
	});
	if (!session.url) return err('stripe did not return a checkout URL');
	return { type: 'redirect', url: session.url };
}
