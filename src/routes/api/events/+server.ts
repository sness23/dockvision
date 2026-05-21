// Server-Sent Events stream — balance + job status changes for the signed-in user.
// xterm subscribes via EventSource; falls back to polling if the stream drops.

import { error } from '@sveltejs/kit';
import { query } from '$lib/server/db';
import { verifyBearer } from '$lib/server/api-keys';
import type { RequestHandler } from './$types';

const TICK_MS = 2500;

export const GET: RequestHandler = async (event) => {
	const bearer = await verifyBearer(event.request.headers.get('authorization'));
	const session = bearer ? null : await event.locals.auth?.();
	const userId = bearer
		? bearer.userId
		: Number((session?.user as { id?: string | number } | undefined)?.id);
	if (!userId) throw error(401, 'not authenticated');

	const encoder = new TextEncoder();
	let timer: ReturnType<typeof setTimeout> | null = null;

	const stream = new ReadableStream({
		async start(controller) {
			let lastBalance = Number.NaN;
			const lastStatus = new Map<string, string>();
			const lastCost = new Map<string, number>();
			let aborted = false;

			event.request.signal.addEventListener('abort', () => {
				aborted = true;
				if (timer) clearTimeout(timer);
				try {
					controller.close();
				} catch {
					/* already closed */
				}
			});

			function send(kind: string, data: unknown) {
				if (aborted) return;
				try {
					controller.enqueue(encoder.encode(`event: ${kind}\ndata: ${JSON.stringify(data)}\n\n`));
				} catch {
					aborted = true;
				}
			}

			send('hello', { ok: true });

			async function tick() {
				if (aborted) return;
				try {
					const bal = await query<{ balance_cents: string }>(
						'SELECT balance_cents FROM users WHERE id = $1',
						[userId]
					);
					if (bal.length) {
						const cents = Number(bal[0].balance_cents);
						if (cents !== lastBalance) {
							send('balance', { cents });
							lastBalance = cents;
						}
					}

					const jobs = await query<{
						id: string;
						status: string;
						tool: string;
						actual_cost_cents: string | null;
					}>(
						`SELECT id, status, tool, actual_cost_cents FROM jobs
						 WHERE user_id = $1 AND created_at > now() - interval '2 hours'
						 ORDER BY created_at DESC LIMIT 50`,
						[userId]
					);
					for (const j of jobs) {
						const cost = j.actual_cost_cents ? Number(j.actual_cost_cents) : 0;
						if (lastStatus.get(j.id) !== j.status || lastCost.get(j.id) !== cost) {
							send('job', {
								id: j.id,
								status: j.status,
								tool: j.tool,
								cost_cents: cost
							});
							lastStatus.set(j.id, j.status);
							lastCost.set(j.id, cost);
						}
					}
				} catch (e) {
					console.error('[sse]', e);
				}
				if (!aborted) timer = setTimeout(tick, TICK_MS);
			}
			tick();
		},
		cancel() {
			if (timer) clearTimeout(timer);
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
};
