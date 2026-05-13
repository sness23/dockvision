<script lang="ts">
	import '../app.css';
	import { page } from '$app/stores';

	let { children, data } = $props();
</script>

<header>
	<nav>
		<a href="/" class="brand">DockVision</a>
		<div class="spacer"></div>
		<a href="/docs">docs</a>
		<a href="/pricing">pricing</a>
		<a href="/status">status</a>
		{#if data.session?.user}
			<a href="/app">app</a>
			<a href="/billing">billing</a>
			<form method="POST" action="/auth/signout" class="inline">
				<button type="submit" class="secondary">sign out</button>
			</form>
		{:else}
			<a href="/login">sign in</a>
		{/if}
	</nav>
</header>

<main>
	{@render children()}
</main>

<style>
	header {
		border-bottom: 1px solid var(--border);
		padding: 0.75em 1.5em;
	}
	nav {
		display: flex;
		gap: 1em;
		align-items: center;
		max-width: 1200px;
		margin: 0 auto;
	}
	.brand {
		font-family: var(--mono);
		font-weight: 700;
		font-size: 1.1em;
		color: var(--fg);
	}
	.spacer {
		flex: 1;
	}
	.inline {
		display: inline;
	}
	main {
		max-width: 1200px;
		margin: 0 auto;
		padding: 2em 1.5em;
	}
</style>
