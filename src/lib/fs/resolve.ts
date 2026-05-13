// Path resolution for the virtual filesystem.
// Every CLI command must funnel through this to enforce per-user isolation.

export class PathError extends Error {}

/**
 * Resolve a user-supplied path against the user's root and an optional cwd.
 * Rejects any path that escapes `/u/<userId>/`.
 */
export function resolveUserPath(userId: string, cwd: string, input: string): string {
	if (!userId) throw new PathError('no user');
	const root = `/u/${userId}`;

	const start = input.startsWith('/') ? input : `${cwd || root}/${input}`;
	const parts: string[] = [];
	for (const seg of start.split('/')) {
		if (seg === '' || seg === '.') continue;
		if (seg === '..') {
			if (parts.length === 0) throw new PathError('path escapes user root');
			parts.pop();
			continue;
		}
		if (seg.includes('\0')) throw new PathError('null byte');
		parts.push(seg);
	}
	const resolved = '/' + parts.join('/');

	if (!resolved.startsWith(root + '/') && resolved !== root) {
		throw new PathError('path escapes user root');
	}
	return resolved;
}

/** Convert a virtual path to an S3 key under the per-user prefix. */
export function s3KeyFor(userId: string, virtualPath: string): string {
	const prefix = `/u/${userId}/`;
	if (!virtualPath.startsWith(prefix)) {
		throw new PathError('path not in user root');
	}
	return `u/${userId}/${virtualPath.slice(prefix.length)}`;
}
