<script lang="ts">
	import { signIn } from '@auth/sveltekit/client';

	let email = $state('');
	let submitting = $state(false);

	async function submitEmail(e: SubmitEvent) {
		e.preventDefault();
		submitting = true;
		await signIn('nodemailer', { email, callbackUrl: '/app' });
	}
</script>

<section class="auth">
	<h1>sign in</h1>
	<p class="hint">enter your email — we'll send you a magic link.</p>

	<form onsubmit={submitEmail}>
		<input
			type="email"
			required
			placeholder="you@example.edu"
			bind:value={email}
			disabled={submitting}
		/>
		<button type="submit" disabled={submitting}>
			{submitting ? 'sending…' : 'send link'}
		</button>
	</form>

	<div class="alt">
		<button class="secondary" onclick={() => signIn('google', { callbackUrl: '/app' })}>
			continue with Google
		</button>
		<button class="secondary" onclick={() => signIn('github', { callbackUrl: '/app' })}>
			continue with GitHub
		</button>
	</div>

	<p class="fine">by signing in you agree to our <a href="/terms">terms</a>.</p>
</section>

<style>
	.auth {
		max-width: 420px;
		margin: 4em auto;
		text-align: center;
	}
	h1 {
		font-family: var(--mono);
	}
	.hint {
		color: var(--fg-dim);
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 0.5em;
		margin: 2em 0 1.5em;
	}
	.alt {
		display: flex;
		flex-direction: column;
		gap: 0.5em;
	}
	.fine {
		margin-top: 2em;
		color: var(--fg-dim);
		font-size: 0.85em;
	}
</style>
