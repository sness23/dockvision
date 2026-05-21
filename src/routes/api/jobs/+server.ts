// Structured JSON list of the signed-in user's recent jobs — used by the
// JobsMonitor pane (text /api/cmd `jobs` is for the terminal).

import { json, error } from '@sveltejs/kit';
import { query } from '$lib/server/db';
import { verifyBearer } from '$lib/server/api-keys';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const bearer = await verifyBearer(event.request.headers.get('authorization'));
	const session = bearer ? null : await event.locals.auth?.();
	const userId = bearer
		? bearer.userId
		: Number((session?.user as { id?: string | number } | undefined)?.id);
	if (!userId) throw error(401, 'not authenticated');

	const limit = Math.min(Number(event.url.searchParams.get('limit') ?? '50'), 200);
	const rows = await query<{
		id: string;
		tool: string;
		status: string;
		gpu_class: string;
		estimated_cost_cents: string;
		actual_cost_cents: string | null;
		execution_time_ms: string | null;
		tag: string | null;
		error: string | null;
		created_at: Date;
		completed_at: Date | null;
	}>(
		`SELECT id, tool, status, gpu_class,
		        estimated_cost_cents, actual_cost_cents, execution_time_ms,
		        tag, error, created_at, completed_at
		 FROM jobs
		 WHERE user_id = $1
		 ORDER BY created_at DESC
		 LIMIT ${limit}`,
		[userId]
	);
	return json(rows);
};
