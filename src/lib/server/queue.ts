import { PgBoss } from 'pg-boss';
type PgBossType = InstanceType<typeof PgBoss>;
import { env } from '$env/dynamic/private';

let _boss: PgBossType | null = null;
let _started = false;

export async function getBoss(): Promise<PgBossType> {
	if (!_boss) {
		_boss = new PgBoss({
			connectionString: env.DATABASE_URL ?? '',
			schema: 'pgboss'
		});
	}
	if (!_started) {
		await _boss.start();
		_started = true;
	}
	return _boss;
}

export const JOB_QUEUE = 'docking-jobs';

export interface JobPayload {
	jobId: string;
	userId: number;
	tool: string;
	endpointId: string;
	input: unknown;
	maxRuntimeSec: number;
}
