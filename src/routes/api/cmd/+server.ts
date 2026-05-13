import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { dispatch } from '$lib/cli';
import type { RequestHandler } from './$types';

const Body = z.object({
	line: z.string().min(1).max(8192),
	cwd: z.string().min(1).max(2048)
});

export const POST: RequestHandler = async (event) => {
	const session = await event.locals.auth?.();
	const user = session?.user;
	if (!user?.email) throw error(401, 'not signed in');

	const parsed = Body.safeParse(await event.request.json().catch(() => ({})));
	if (!parsed.success) throw error(400, parsed.error.message);

	// Auth.js gives us email; the user's int id is in our users table.
	// session.user.id is also populated by the pg adapter.
	const userId = Number((user as { id?: string | number }).id);
	if (!userId) throw error(401, 'user id missing from session');

	const res = await dispatch(parsed.data.line, {
		userId,
		userEmail: user.email,
		cwd: parsed.data.cwd,
		origin: event.url.origin
	});
	return json(res);
};
