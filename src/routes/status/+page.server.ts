// Public status page — aggregate stats only, no per-user data leakage.

import { query } from '$lib/server/db';
import type { PageServerLoad } from './$types';

interface ToolRow {
	tool: string;
	n: string;
	failed: string;
	avg_runtime_ms: string;
}
interface QueueRow {
	queued: string;
	running: string;
}
interface AlertRow {
	kind: string;
	severity: string;
	message: string;
	created_at: Date;
}
interface CalibRow {
	tool: string;
	p50_runtime_sec: number;
	sample_count: number;
	updated_at: Date;
}

export const load: PageServerLoad = async () => {
	let queue: QueueRow | null = null;
	let tools: ToolRow[] = [];
	let alerts: AlertRow[] = [];
	let calib: CalibRow[] = [];
	let dbOk = false;

	try {
		const q = await query<QueueRow>(
			`SELECT
				COUNT(*) FILTER (WHERE status = 'queued')  AS queued,
				COUNT(*) FILTER (WHERE status = 'running') AS running
			 FROM jobs`
		);
		queue = q[0] ?? { queued: '0', running: '0' };

		tools = await query<ToolRow>(
			`SELECT
				tool,
				COUNT(*)::text AS n,
				COUNT(*) FILTER (WHERE status = 'failed')::text AS failed,
				COALESCE(AVG(execution_time_ms) FILTER (WHERE status = 'completed'), 0)::text
					AS avg_runtime_ms
			 FROM jobs
			 WHERE created_at > now() - interval '24 hours'
			 GROUP BY tool
			 ORDER BY tool`
		);

		alerts = await query<AlertRow>(
			`SELECT kind, severity, message, created_at FROM system_alerts
			 WHERE acknowledged = FALSE AND created_at > now() - interval '7 days'
			 ORDER BY created_at DESC LIMIT 10`
		);

		calib = await query<CalibRow>(
			`SELECT tool, p50_runtime_sec, sample_count, updated_at FROM tool_calibration
			 ORDER BY tool`
		);
		dbOk = true;
	} catch (e) {
		console.error('[status] db error', e);
	}

	return {
		dbOk,
		queue,
		tools,
		alerts,
		calib,
		generatedAt: new Date().toISOString()
	};
};
