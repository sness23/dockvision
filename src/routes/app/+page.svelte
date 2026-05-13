<script lang="ts">
	const { data } = $props();
</script>

<section class="shell">
	<div class="banner mono">
		DockVision shell · signed in as <strong>{data.session?.user?.email}</strong>
	</div>
	<pre class="placeholder mono">
welcome to DockVision.

the xterm.js CLI lands here in Phase 1.

for now, this is the auth-guarded /app placeholder.
</pre>
</section>

<style>
	.shell {
		font-family: var(--mono);
	}
	.banner {
		padding: 0.5em 1em;
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-radius: 4px 4px 0 0;
		border-bottom: none;
	}
	.placeholder {
		margin: 0;
		padding: 1em;
		background: #000;
		border: 1px solid var(--border);
		border-radius: 0 0 4px 4px;
		min-height: 60vh;
		color: var(--fg);
	}
</style>
