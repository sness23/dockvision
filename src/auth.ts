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
	} else if (env.NODE_ENV !== 'production') {
		// Local dev fallback — log magic links to the server console so you can
		// click through without configuring SMTP.
		providers.push(
			Nodemailer({
				server: 'smtp://localhost:1025',
				from: 'no-reply@dockvision.local',
				sendVerificationRequest({ identifier, url }) {
					console.log('\n========================================');
					console.log(`  DEV magic link for ${identifier}`);
					console.log(`  ${url}`);
					console.log('========================================\n');
				}
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
	pages: { signIn: '/login' },
	callbacks: {
		// pg-adapter passes the DB user as the second arg; surface its id so
		// /api/cmd can authenticate by session (the email-only default isn't enough).
		session({ session, user }) {
			if (user) {
				(session.user as { id?: string | number }).id = user.id;
			}
			return session;
		}
	}
});
