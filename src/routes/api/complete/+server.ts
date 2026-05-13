// Tab-completion: given the current line + cwd + cursor pos, return
// candidate completions and the index to start replacing from.

import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { query } from '$lib/server/db';
import { verifyBearer } from '$lib/server/api-keys';
import { listTools } from '$lib/server/tools';
import { resolveUserPath, PathError } from '$lib/fs/resolve';
import type { RequestHandler } from './$types';

const COMMANDS = [
	'ls', 'cd', 'pwd', 'cat', 'view', 'du', 'pin', 'unpin', 'rm', 'upload', 'download',
	'tools', 'tool', 'run', 'jobs', 'status', 'cancel', 'log',
	'whoami', 'cost', 'topup', 'keys', 'help', 'clear', 'exit'
];

const PATH_COMMANDS = new Set([
	'ls', 'cd', 'cat', 'view', 'du', 'pin', 'unpin', 'rm', 'download', 'upload'
]);

const Body = z.object({
	line: z.string().max(8192),
	cwd: z.string().max(2048),
	pos: z.number().int().min(0).max(8192)
});

export const POST: RequestHandler = async (event) => {
	const bearer = await verifyBearer(event.request.headers.get('authorization'));
	const session = bearer ? null : await event.locals.auth?.();
	const userId = bearer
		? bearer.userId
		: Number((session?.user as { id?: string | number } | undefined)?.id);
	if (!userId) throw error(401, 'not authenticated');

	const parsed = Body.safeParse(await event.request.json().catch(() => ({})));
	if (!parsed.success) throw error(400, 'bad body');
	const { line, cwd, pos } = parsed.data;

	const userRoot = `/u/${userId}`;
	const safeCwd = cwd.startsWith(userRoot) ? cwd : userRoot;

	const upto = line.slice(0, pos);
	const tokens = upto.split(/\s+/);
	const lastToken = tokens[tokens.length - 1];
	const replaceFrom = pos - lastToken.length;

	// 1) command-name completion at first token
	if (tokens.length === 1) {
		const matches = COMMANDS.filter((c) => c.startsWith(lastToken)).map((c) => c + ' ');
		return json({ completions: matches, replaceFrom });
	}

	const cmd = tokens[0];

	// 2) `run <tool>` completion at second token
	if (cmd === 'run' && tokens.length === 2) {
		const toolNames = listTools().map((t) => t.name);
		return json({
			completions: toolNames.filter((n) => n.startsWith(lastToken)).map((n) => n + ' '),
			replaceFrom
		});
	}

	// 3) path completion: command takes paths AND we're past the command position,
	//    OR previous token is --<flag-that-takes-path>
	const wantsPath =
		PATH_COMMANDS.has(cmd) ||
		(cmd === 'run' && tokens.length > 2 && tokens[tokens.length - 2].startsWith('--'));

	if (wantsPath) {
		// Resolve the directory part of lastToken against cwd.
		let dirInput: string;
		let prefix: string;
		const slashIdx = lastToken.lastIndexOf('/');
		if (slashIdx < 0) {
			dirInput = '.';
			prefix = lastToken;
		} else {
			dirInput = lastToken.slice(0, slashIdx) || '/';
			prefix = lastToken.slice(slashIdx + 1);
		}

		let dirAbs: string;
		try {
			dirAbs = resolveUserPath(String(userId), safeCwd, dirInput);
		} catch (e) {
			if (e instanceof PathError) return json({ completions: [], replaceFrom });
			throw e;
		}

		const dirPrefix = dirAbs === userRoot ? userRoot + '/' : dirAbs + '/';
		const rows = await query<{ path: string }>(
			`SELECT path FROM files WHERE user_id = $1 AND path LIKE $2 ORDER BY path LIMIT 200`,
			[userId, dirPrefix + prefix + '%']
		);
		const seen = new Set<string>();
		const out: string[] = [];
		for (const r of rows) {
			const rel = r.path.slice(dirPrefix.length);
			const firstSeg = rel.split('/')[0];
			if (!firstSeg.startsWith(prefix)) continue;
			const isDir = rel.includes('/');
			const display = isDir ? firstSeg + '/' : firstSeg;
			if (seen.has(display)) continue;
			seen.add(display);
			out.push(display);
			if (out.length >= 30) break;
		}
		// preserve the dir prefix the user typed
		const dirText = slashIdx < 0 ? '' : lastToken.slice(0, slashIdx + 1);
		return json({ completions: out.map((c) => dirText + c), replaceFrom });
	}

	return json({ completions: [], replaceFrom });
};
