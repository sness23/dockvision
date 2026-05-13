<script lang="ts">
	const { data } = $props();
	const queue = $derived(data.queue ?? { queued: '0', running: '0' });
	const queueTotal = $derived(Number(queue.queued) + Number(queue.running));
	const status = $derived(!data.dbOk ? 'down' : queueTotal > 50 ? 'degraded' : 'ok');
	const statusColor = $derived(
		status === 'ok' ? '#3fb950' : status === 'degraded' ? '#d29922' : '#f85149'
	);
</script>

<section>
	<h1>system status</h1>

	<div class="banner" style="border-left-color: {statusColor}">
		<span class="dot" style="background: {statusColor}"></span>
		<span class="mono"
			>{status === 'ok' ? 'all systems normal' : status === 'degraded' ? 'queue backlog' : 'database unreachable'}</span
		>
		<span class="grow"></span>
		<span class="dim">as of {data.generatedAt}</span>
	</div>

	<h2>queue</h2>
	<table class="mono">
		<tbody>
			<tr><td>queued</td><td>{queue.queued}</td></tr>
			<tr><td>running</td><td>{queue.running}</td></tr>
		</tbody>
	</table>

	<h2>last 24 hours</h2>
	{#if data.tools.length === 0}
		<p class="dim">no jobs in the last 24 h</p>
	{:else}
		<table class="mono">
			<thead><tr><th>tool</th><th>jobs</th><th>failures</th><th>avg runtime</th></tr></thead>
			<tbody>
				{#each data.tools as t}
					<tr>
						<td>{t.tool}</td>
						<td>{t.n}</td>
						<td class={Number(t.failed) > 0 ? 'warn' : ''}>{t.failed}</td>
						<td>{(Number(t.avg_runtime_ms) / 1000).toFixed(1)} s</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}

	<h2>tool calibration</h2>
	{#if data.calib.length === 0}
		<p class="dim">no calibration yet (need ≥5 completed runs per tool)</p>
	{:else}
		<table class="mono">
			<thead><tr><th>tool</th><th>p50 runtime</th><th>samples</th><th>updated</th></tr></thead>
			<tbody>
				{#each data.calib as c}
					<tr>
						<td>{c.tool}</td>
						<td>{c.p50_runtime_sec} s</td>
						<td>{c.sample_count}</td>
						<td class="dim">{new Date(c.updated_at).toISOString().slice(0, 19).replace('T', ' ')}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}

	<h2>open alerts</h2>
	{#if data.alerts.length === 0}
		<p class="dim">none</p>
	{:else}
		<ul>
			{#each data.alerts as a}
				<li>
					<span class="badge {a.severity}">{a.severity}</span>
					<span class="mono">{a.kind}</span>:
					{a.message}
					<span class="dim"> · {new Date(a.created_at).toISOString().slice(0, 19).replace('T', ' ')}</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	section {
		max-width: 800px;
		margin: 2em auto;
	}
	h1, h2 {
		font-family: var(--mono);
	}
	h2 {
		margin-top: 2em;
		font-size: 1em;
		color: var(--fg-dim);
	}
	.banner {
		display: flex;
		gap: 0.6em;
		align-items: center;
		padding: 0.6em 1em;
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-left: 3px solid;
		border-radius: 4px;
	}
	.grow { flex: 1; }
	.dim { color: var(--fg-dim); }
	.mono { font-family: var(--mono); }
	.warn { color: var(--warn); }
	.dot {
		width: 0.6em; height: 0.6em; border-radius: 50%;
		display: inline-block;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.95em;
	}
	th, td {
		text-align: left;
		padding: 0.4em 0.8em;
		border-bottom: 1px solid var(--border);
	}
	th { color: var(--fg-dim); font-weight: normal; }
	ul { padding-left: 1em; }
	li { margin-bottom: 0.4em; }
	.badge {
		display: inline-block;
		padding: 0.05em 0.4em;
		border-radius: 3px;
		font-size: 0.75em;
		font-family: var(--mono);
		text-transform: uppercase;
	}
	.badge.info  { background: #1f6feb; color: white; }
	.badge.warn  { background: #d29922; color: #1c1c1c; }
	.badge.error { background: #f85149; color: white; }
</style>
