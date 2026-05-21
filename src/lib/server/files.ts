import { CopyObjectCommand } from '@aws-sdk/client-s3';
import { query } from './db';
import { resolveUserPath, s3KeyFor, PathError } from '../fs/resolve';
import { s3, BUCKET, presignedGet, presignedPut, deleteObject } from './s3';

export interface FileRow {
	id: string;
	user_id: number;
	path: string;
	s3_key: string;
	size_bytes: number;
	mime: string | null;
	sha256: string | null;
	pinned: boolean;
	created_at: Date;
	expires_at: Date | null;
	links_to: string | null;
}

const RETENTION_DAYS = 180;

function expiresAt(): Date {
	const d = new Date();
	d.setDate(d.getDate() + RETENTION_DAYS);
	return d;
}

export async function list(
	userId: number,
	cwd: string,
	input: string
): Promise<{ kind: 'dir' | 'file'; name: string; size: number; pinned: boolean }[]> {
	const path = resolveUserPath(String(userId), cwd, input || cwd);
	const prefix = path === `/u/${userId}` ? `/u/${userId}/` : path + '/';
	const rows = await query<FileRow>(
		`SELECT * FROM files WHERE user_id = $1 AND (path = $2 OR path LIKE $3) ORDER BY path`,
		[userId, path, prefix + '%']
	);

	const seenDirs = new Set<string>();
	const out: { kind: 'dir' | 'file'; name: string; size: number; pinned: boolean }[] = [];

	for (const row of rows) {
		if (row.path === path) {
			out.push({
				kind: 'file',
				name: row.path.split('/').pop() || row.path,
				size: Number(row.size_bytes),
				pinned: row.pinned
			});
			continue;
		}
		const rel = row.path.slice(prefix.length);
		const firstSeg = rel.split('/')[0];
		if (rel.includes('/')) {
			if (!seenDirs.has(firstSeg)) {
				seenDirs.add(firstSeg);
				out.push({ kind: 'dir', name: firstSeg + '/', size: 0, pinned: false });
			}
		} else {
			out.push({
				kind: 'file',
				name: firstSeg,
				size: Number(row.size_bytes),
				pinned: row.pinned
			});
		}
	}
	return out;
}

export async function stat(userId: number, cwd: string, input: string): Promise<FileRow | null> {
	const path = resolveUserPath(String(userId), cwd, input);
	const rows = await query<FileRow>('SELECT * FROM files WHERE user_id = $1 AND path = $2', [
		userId,
		path
	]);
	return rows[0] ?? null;
}

export async function dirExists(userId: number, path: string): Promise<boolean> {
	if (path === `/u/${userId}`) return true;
	const rows = await query<{ n: string }>(
		`SELECT 1 AS n FROM files WHERE user_id = $1 AND path LIKE $2 LIMIT 1`,
		[userId, path + '/%']
	);
	return rows.length > 0;
}

export async function createUpload(
	userId: number,
	cwd: string,
	input: string,
	contentType: string,
	sizeBytes: number
): Promise<{ uploadUrl: string; path: string; s3Key: string }> {
	const path = resolveUserPath(String(userId), cwd, input);
	if (!path.startsWith(`/u/${userId}/`)) throw new PathError('cannot upload to root');
	const s3Key = s3KeyFor(String(userId), path);
	const uploadUrl = await presignedPut(s3Key, contentType);

	// Pre-create the file row so the trigger increments storage on success.
	// If upload fails the client must call /api/upload/abort or the row will be GC'd.
	await query(
		`INSERT INTO files (user_id, path, s3_key, size_bytes, mime, expires_at)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (user_id, path) DO UPDATE
		   SET s3_key = EXCLUDED.s3_key,
		       size_bytes = EXCLUDED.size_bytes,
		       mime = EXCLUDED.mime,
		       expires_at = EXCLUDED.expires_at`,
		[userId, path, s3Key, sizeBytes, contentType, expiresAt()]
	);

	return { uploadUrl, path, s3Key };
}

export async function presignDownload(
	userId: number,
	cwd: string,
	input: string
): Promise<{ url: string; row: FileRow }> {
	const row = await stat(userId, cwd, input);
	if (!row) throw new Error(`no such file: ${input}`);
	const url = await presignedGet(row.s3_key);
	return { url, row };
}

/** Rename / move a file within the user's virtual fs. S3 object is not moved
 *  (we just update files.path → the path is virtual, s3_key stays). */
export async function move(
	userId: number,
	cwd: string,
	srcInput: string,
	dstInput: string
): Promise<{ srcPath: string; dstPath: string }> {
	const srcRow = await stat(userId, cwd, srcInput);
	if (!srcRow) throw new Error(`no such file: ${srcInput}`);
	const dstPath = resolveUserPath(String(userId), cwd, dstInput);
	if (dstPath === srcRow.path) return { srcPath: srcRow.path, dstPath };
	const existing = await query<FileRow>('SELECT id FROM files WHERE user_id = $1 AND path = $2', [
		userId,
		dstPath
	]);
	if (existing.length) throw new Error(`destination exists: ${dstInput}`);
	await query('UPDATE files SET path = $1 WHERE id = $2', [dstPath, srcRow.id]);
	return { srcPath: srcRow.path, dstPath };
}

/** S3 server-side copy + new files row. Storage trigger fires (real bytes count). */
export async function copy(
	userId: number,
	cwd: string,
	srcInput: string,
	dstInput: string
): Promise<{ srcPath: string; dstPath: string; size: number }> {
	const srcRow = await stat(userId, cwd, srcInput);
	if (!srcRow) throw new Error(`no such file: ${srcInput}`);
	if (srcRow.links_to) throw new Error('cannot copy a /results/ alias (copy its source instead)');
	const dstPath = resolveUserPath(String(userId), cwd, dstInput);
	if (dstPath === srcRow.path) throw new Error('cp: src and dst are the same');
	const existing = await query<FileRow>('SELECT id FROM files WHERE user_id = $1 AND path = $2', [
		userId,
		dstPath
	]);
	if (existing.length) throw new Error(`destination exists: ${dstInput}  (use rm first)`);
	const dstKey = s3KeyFor(String(userId), dstPath);
	await s3.send(
		new CopyObjectCommand({
			Bucket: BUCKET,
			CopySource: `${BUCKET}/${srcRow.s3_key}`,
			Key: dstKey,
			ContentType: srcRow.mime ?? 'application/octet-stream',
			MetadataDirective: 'REPLACE'
		})
	);
	await query(
		`INSERT INTO files (user_id, path, s3_key, size_bytes, mime, expires_at)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		[userId, dstPath, dstKey, srcRow.size_bytes, srcRow.mime, expiresAt()]
	);
	return { srcPath: srcRow.path, dstPath, size: Number(srcRow.size_bytes) };
}

export async function setPinned(
	userId: number,
	cwd: string,
	input: string,
	pinned: boolean
): Promise<FileRow> {
	const path = resolveUserPath(String(userId), cwd, input);
	const rows = await query<FileRow>(
		`UPDATE files SET pinned = $3, expires_at = CASE WHEN $3 THEN NULL ELSE $4 END
		 WHERE user_id = $1 AND path = $2 RETURNING *`,
		[userId, path, pinned, expiresAt()]
	);
	if (!rows.length) throw new Error(`no such file: ${input}`);
	return rows[0];
}

export async function remove(userId: number, cwd: string, input: string): Promise<FileRow> {
	const row = await stat(userId, cwd, input);
	if (!row) throw new Error(`no such file: ${input}`);
	// A link row only aliases bytes — never delete the underlying S3 object,
	// just drop the alias. Real files delete their object.
	if (!row.links_to) {
		await deleteObject(row.s3_key);
	}
	await query('DELETE FROM files WHERE id = $1', [row.id]);
	return row;
}

/** Used by the job worker to record output files coming back from a RunPod handler. */
export async function registerJobOutput(opts: {
	userId: number;
	jobId: string;
	filename: string;
	s3Key: string;
	sizeBytes: number;
	mime: string;
}): Promise<void> {
	const path = `/u/${opts.userId}/jobs/${opts.jobId}/output/${opts.filename}`;
	await query(
		`INSERT INTO files (user_id, path, s3_key, size_bytes, mime, expires_at)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (user_id, path) DO UPDATE
		   SET s3_key = EXCLUDED.s3_key,
		       size_bytes = EXCLUDED.size_bytes,
		       mime = EXCLUDED.mime`,
		[opts.userId, path, opts.s3Key, opts.sizeBytes, opts.mime, expiresAt()]
	);
}

export interface OutputSlot {
	idx: number;
	url: string;
	s3Key: string;
}

/**
 * Pre-allocate N presigned PUT URLs for a job's outputs. Handler uploads to
 * these directly; worker registers files by matching slot idx → S3 key.
 * Lifts the 20MB base64 cap.
 */
export async function allocOutputSlots(
	userId: number,
	jobId: string,
	count: number
): Promise<{ slots: OutputSlot[]; logUrl: string; logS3Key: string }> {
	const slots: OutputSlot[] = [];
	for (let i = 0; i < count; i++) {
		const s3Key = slotKey(userId, jobId, i);
		const url = await presignedPut(s3Key, 'application/octet-stream', 6 * 3600);
		slots.push({ idx: i, url, s3Key });
	}
	const logS3Key = logKey(userId, jobId);
	const logUrl = await presignedPut(logS3Key, 'text/plain', 6 * 3600);
	return { slots, logUrl, logS3Key };
}

export function slotKey(userId: number, jobId: string, idx: number): string {
	return `u/${userId}/jobs/${jobId}/_slots/${idx}.bin`;
}

export function logKey(userId: number, jobId: string): string {
	return `u/${userId}/jobs/${jobId}/log.txt`;
}

export async function totalBytes(userId: number): Promise<number> {
	const rows = await query<{ storage_bytes: string }>(
		'SELECT storage_bytes FROM users WHERE id = $1',
		[userId]
	);
	return rows.length ? Number(rows[0].storage_bytes) : 0;
}
