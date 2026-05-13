import { Pool } from 'pg';
import { env } from '$env/dynamic/private';

let _pool: Pool | null = null;

function getPool(): Pool {
	if (!_pool) {
		if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
		_pool = new Pool({
			connectionString: env.DATABASE_URL,
			max: 10,
			idleTimeoutMillis: 30_000
		});
	}
	return _pool;
}

export const pool = new Proxy({} as Pool, {
	get(_target, prop, receiver) {
		const real = getPool();
		const v = Reflect.get(real, prop, receiver);
		return typeof v === 'function' ? v.bind(real) : v;
	}
});

export async function query<T = Record<string, unknown>>(
	text: string,
	params?: unknown[]
): Promise<T[]> {
	const res = await getPool().query(text, params as unknown[] | undefined);
	return res.rows as T[];
}
