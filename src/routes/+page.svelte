<script lang="ts">
	const { data } = $props();
</script>

<section class="hero">
	<h1>DockVision</h1>
	<p class="lede">
		Open-source, CLI-shaped web platform for protein-ligand docking and co-folding on serverless
		GPUs. Transparent per-second pricing. CASP-aware from day one.
	</p>
	<div class="cta">
		{#if data.session?.user}
			<a href="/app"><button>open app</button></a>
		{:else}
			<a href="/login"><button>sign in</button></a>
		{/if}
		<a href="https://github.com/sness23/dockvision"
			><button class="secondary">source (AGPL-3.0)</button></a
		>
	</div>
</section>

<section class="grid">
	<div class="card">
		<h3>real cost, real seconds</h3>
		<p>
			Every job shows the RunPod GPU seconds we used and the 1.5× markup. No credit system, no
			obfuscation.
		</p>
	</div>
	<div class="card">
		<h3>the terminal you already know</h3>
		<p>
			<code>ls</code>, <code>cat</code>, <code>run gnina</code>, <code>jobs</code>. A restricted
			shell grammar in your browser. Wizard fallback for the wet-lab folks.
		</p>
	</div>
	<div class="card">
		<h3>self-host if you want</h3>
		<p>
			AGPL-3.0. Bring your own RunPod, Stripe, and S3 — pay providers directly, skip our markup. We
			sell ergonomics, not access.
		</p>
	</div>
</section>

<style>
	.hero {
		text-align: center;
		padding: 4em 1em 3em;
	}
	h1 {
		font-family: var(--mono);
		font-size: 3em;
		margin: 0 0 0.3em;
	}
	.lede {
		max-width: 640px;
		margin: 0 auto;
		font-size: 1.15em;
		color: var(--fg-dim);
	}
	.cta {
		margin-top: 2em;
		display: flex;
		gap: 0.75em;
		justify-content: center;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: 1em;
		margin-top: 2em;
	}
	.card {
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 1.25em;
	}
	.card h3 {
		font-family: var(--mono);
		margin-top: 0;
	}
	.card code {
		background: var(--bg);
		padding: 0.1em 0.3em;
		border-radius: 3px;
	}
</style>
