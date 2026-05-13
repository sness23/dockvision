import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { query } from './db';

const PREFIX_LEN = 8;

/**
 * Generate a new API key. The full secret is returned ONCE — callers must show
 * it to the user immediately and store only the hash.
 *
 * Format: dvk_<8-char-prefix>_<43-char-secret>
 *   prefix = 'dvk_' + nanoid-style alphanum  (display + lookup key)
 *   secret = base64url(32 random bytes)
 *   hash   = sha256(full) — what we persist
 */
export function generateKey(): { full: string; prefix: string; hash: string } {
	const prefix = 'dvk_' + randomBytes(6).toString('base64url').slice(0, PREFIX_LEN);
	const secret = randomBytes(32).toString('base64url');
	const full = `${prefix}_${secret}`;
	const hash = createHash('sha256').update(full).digest('hex');
	return { full, prefix, hash };
}

export interface ApiKeyAuth {
	userId: number;
	email: string;
}

/**
 * Verify an `Authorization: Bearer dvk_...` header. Returns the user
 * on success, null otherwise. Touches `last_used_at` on success.
 */
export async function verifyBearer(authHeader: string | null): Promise<ApiKeyAuth | null> {
	if (!authHeader) return null;
	const m = authHeader.match(/^Bearer\s+(\S+)$/);
	if (!m) return null;
	const token = m[1];
	const pm = token.match(/^(dvk_[A-Za-z0-9_-]{4,12})_/);
	if (!pm) return null;
	const prefix = pm[1];

	const rows = await query<{
		user_id: number;
		key_hash: string;
		revoked_at: Date | null;
		email: string;
	}>(
		`SELECT api_keys.user_id, api_keys.key_hash, api_keys.revoked_at, users.email
		 FROM api_keys JOIN users ON users.id = api_keys.user_id
		 WHERE api_keys.key_prefix = $1`,
		[prefix]
	);
	if (!rows.length) return null;

	const candHash = createHash('sha256').update(token).digest('hex');
	const cand = Buffer.from(candHash, 'hex');

	for (const row of rows) {
		if (row.revoked_at) continue;
		const stored = Buffer.from(row.key_hash, 'hex');
		if (stored.length === cand.length && timingSafeEqual(stored, cand)) {
			await query(
				'UPDATE api_keys SET last_used_at = now() WHERE user_id = $1 AND key_prefix = $2',
				[row.user_id, prefix]
			);
			return { userId: Number(row.user_id), email: row.email };
		}
	}
	return null;
}

export async function listKeys(userId: number) {
	return query<{
		id: string;
		key_prefix: string;
		name: string;
		last_used_at: Date | null;
		created_at: Date;
		revoked_at: Date | null;
	}>(
		`SELECT id, key_prefix, name, last_used_at, created_at, revoked_at
		 FROM api_keys WHERE user_id = $1
		 ORDER BY created_at DESC`,
		[userId]
	);
}

export async function createKey(userId: number, name: string) {
	const { full, prefix, hash } = generateKey();
	await query(
		`INSERT INTO api_keys (user_id, key_prefix, key_hash, name, scopes)
		 VALUES ($1, $2, $3, $4, ARRAY['read', 'run'])`,
		[userId, prefix, hash, name]
	);
	return { full, prefix };
}

export async function revokeKey(userId: number, idOrPrefix: string) {
	const rows = await query<{ id: string }>(
		`UPDATE api_keys SET revoked_at = now()
		 WHERE user_id = $1
		   AND revoked_at IS NULL
		   AND (id::text = $2 OR key_prefix = $2)
		 RETURNING id`,
		[userId, idOrPrefix]
	);
	return rows.length > 0;
}
