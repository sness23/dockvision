// CLI device-login hop. `dvk login` opens the browser here; we mint an API
// key for the signed-in user and bounce it to dvk's local callback server.

import { redirect, error } from '@sveltejs/kit';
import { createKey } from '$lib/server/api-keys';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth?.();
	if (!session?.user) {
		// sign in, then come back to this exact URL
		const back = encodeURIComponent(event.url.pathname + event.url.search);
		throw redirect(303, `/login?callbackUrl=${back}`);
	}
	const userId = Number((session.user as { id?: string | number }).id);
	if (!userId) throw error(401, 'user id missing from session');

	const port = event.url.searchParams.get('port');
	const name = `cli-${new Date().toISOString().slice(0, 10)}`;
	const { full, prefix } = await createKey(userId, name);

	if (port && /^\d{2,5}$/.test(port)) {
		// hand the key to the local dvk callback server
		throw redirect(303, `http://127.0.0.1:${port}/cb?key=${encodeURIComponent(full)}`);
	}

	// manual flow — no local server; show the key once
	return { key: full, prefix, email: session.user.email };
};
