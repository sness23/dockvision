import { SvelteKitAuth } from '@auth/sveltekit';
import type { Provider } from '@auth/sveltekit/providers';
import Nodemailer from '@auth/sveltekit/providers/nodemailer';
import Google from '@auth/sveltekit/providers/google';
import GitHub from '@auth/sveltekit/providers/github';
import PostgresAdapter from '@auth/pg-adapter';
import { env } from '$env/dynamic/private';
import { pool } from '$lib/server/db';

function buildProviders(): Provider[] {
	const providers: Provider[] = [];

	if (env.EMAIL_HOST && env.EMAIL_FROM) {
		providers.push(
			Nodemailer({
				server: {
					host: env.EMAIL_HOST,
					port: Number(env.EMAIL_PORT || 587),
					auth:
						env.EMAIL_USER && env.EMAIL_PASS
							? { user: env.EMAIL_USER, pass: env.EMAIL_PASS }
							: undefined
				},
				from: env.EMAIL_FROM
			})
		);
	}

	if (env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET) {
		providers.push(
			Google({
				clientId: env.AUTH_GOOGLE_ID,
				clientSecret: env.AUTH_GOOGLE_SECRET
			})
		);
	}

	if (env.AUTH_GITHUB_ID && env.AUTH_GITHUB_SECRET) {
		providers.push(
			GitHub({
				clientId: env.AUTH_GITHUB_ID,
				clientSecret: env.AUTH_GITHUB_SECRET
			})
		);
	}

	return providers;
}

export const { handle, signIn, signOut } = SvelteKitAuth({
	adapter: PostgresAdapter(pool),
	providers: buildProviders(),
	secret: env.AUTH_SECRET,
	trustHost: true,
	pages: { signIn: '/login' }
});
