import { Pool } from 'pg';
import { env } from '$env/dynamic/private';

if (!env.DATABASE_URL) {
	throw new Error('DATABASE_URL is not set');
}

export const pool = new Pool({
	connectionString: env.DATABASE_URL,
	max: 10,
	idleTimeoutMillis: 30_000
});

export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
	text: string,
	params?: unknown[]
): Promise<T[]> {
	const res = await pool.query(text, params as unknown[] | undefined);
	return res.rows as T[];
}
