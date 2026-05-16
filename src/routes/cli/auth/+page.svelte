<script lang="ts">
	const { data } = $props();
</script>

<section>
	<h1>CLI authorized</h1>
	<p class="dim">A new API key was minted for {data.email}.</p>

	<pre class="key">{data.key}</pre>

	<p class="warn">Copy this now — it will not be shown again.</p>

	<p class="dim">Use it with the <code>dvk</code> CLI:</p>
	<pre class="cmd">export DOCKVISION_API_KEY={data.key}
# or persist it:
mkdir -p ~/.dockvision && echo {data.key} &gt; ~/.dockvision/api-key</pre>

	<p class="dim">
		If you started this from <code>dvk login</code>, it should have completed automatically —
		you can close this tab.
	</p>
</section>

<style>
	section {
		max-width: 640px;
		margin: 3em auto;
	}
	h1 {
		font-family: var(--mono);
	}
	.dim {
		color: var(--fg-dim);
	}
	.warn {
		color: var(--warn);
	}
	.key,
	.cmd {
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 0.8em;
		font-family: var(--mono);
		font-size: 0.85em;
		white-space: pre-wrap;
		word-break: break-all;
	}
	.key {
		border-left: 3px solid var(--ok);
	}
	code {
		background: var(--bg-elev);
		padding: 0.1em 0.3em;
		border-radius: 3px;
	}
</style>
