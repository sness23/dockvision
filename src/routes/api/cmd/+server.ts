import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { dispatch } from '$lib/cli';
import { verifyBearer } from '$lib/server/api-keys';
import type { RequestHandler } from './$types';

const Body = z.object({
	line: z.string().min(1).max(8192),
	cwd: z.string().min(1).max(2048)
});

export const POST: RequestHandler = async (event) => {
	// 1) Bearer API key (CLI shim) — preferred when present.
	const bearer = await verifyBearer(event.request.headers.get('authorization'));

	// 2) Browser session.
	const session = bearer ? null : await event.locals.auth?.();
	const sessionUser = session?.user;

	const userId = bearer
		? bearer.userId
		: Number((sessionUser as { id?: string | number } | undefined)?.id);
	const userEmail = bearer ? bearer.email : sessionUser?.email;

	if (!userId || !userEmail) throw error(401, 'not authenticated');

	const parsed = Body.safeParse(await event.request.json().catch(() => ({})));
	if (!parsed.success) throw error(400, parsed.error.message);

	// Normalize cwd: '/' or anything outside /u/<userId> becomes the user's root.
	// CLI shim callers don't know their userId on the first hit, so '/' is the wire default.
	const userRoot = `/u/${userId}`;
	const cwd = parsed.data.cwd && parsed.data.cwd.startsWith(userRoot) ? parsed.data.cwd : userRoot;

	const res = await dispatch(parsed.data.line, {
		userId,
		userEmail,
		cwd,
		origin: event.url.origin
	});
	return json(res);
};
