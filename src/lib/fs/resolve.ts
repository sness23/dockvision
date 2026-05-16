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

	// Paths starting with /u/<this-user>/... are taken as-is.
	// Paths starting with /u/<other>... are rejected.
	// Paths starting with / but not /u/... are root-relative (/ is the user root).
	// Other inputs are cwd-relative.
	let start: string;
	if (input.startsWith(root + '/') || input === root) {
		start = input;
	} else if (input.startsWith('/u/')) {
		throw new PathError('path escapes user root');
	} else if (input.startsWith('/')) {
		start = root + input;
	} else {
		start = `${cwd || root}/${input}`;
	}

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

/** Strip the per-user root from a virtual path for display ("/u/1/casp" → "/casp"). */
export function displayPath(userId: string, virtualPath: string): string {
	const root = `/u/${userId}`;
	if (virtualPath === root) return '/';
	if (virtualPath.startsWith(root + '/')) return virtualPath.slice(root.length);
	return virtualPath;
}

/** Convert a virtual path to an S3 key under the per-user prefix. */
export function s3KeyFor(userId: string, virtualPath: string): string {
	const prefix = `/u/${userId}/`;
	if (!virtualPath.startsWith(prefix)) {
		throw new PathError('path not in user root');
	}
	return `u/${userId}/${virtualPath.slice(prefix.length)}`;
}
