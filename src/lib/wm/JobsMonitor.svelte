<script lang="ts">
	import { onMount, onDestroy, getContext } from 'svelte';
	import type { WmStore } from './store.svelte';

	let { leafId }: { leafId: string } = $props();
	const wm = getContext<WmStore>('wm');

	interface JobRow {
		id: string;
		tool: string;
		status: string;
		gpu_class: string;
		estimated_cost_cents: string;
		actual_cost_cents: string | null;
		execution_time_ms: string | null;
		tag: string | null;
		error: string | null;
		created_at: string;
		completed_at: string | null;
	}

	let jobs = $state<JobRow[]>([]);
	let error = $state<string | null>(null);
	let loading = $state(true);
	let evt: EventSource | null = null;

	function fmtCost(j: JobRow): string {
		const c = j.actual_cost_cents ?? j.estimated_cost_cents;
		const cents = Number(c);
		if (!Number.isFinite(cents) || cents === 0) return '—';
		const prefix = j.actual_cost_cents ? '' : '~';
		return `${prefix}$${(cents / 100).toFixed(cents < 100 ? 3 : 2)}`;
	}

	function fmtAge(iso: string | null): string {
		if (!iso) return '—';
		const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
		if (sec < 60) return `${sec}s`;
		if (sec < 3600) return `${Math.floor(sec / 60)}m`;
		if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
		return `${Math.floor(sec / 86400)}d`;
	}

	function fmtRuntime(j: JobRow): string {
		if (!j.execution_time_ms) return '—';
		const sec = Number(j.execution_time_ms) / 1000;
		return sec < 60 ? `${sec.toFixed(0)}s` : `${(sec / 60).toFixed(1)}m`;
	}

	function statusClass(s: string): string {
		if (s === 'completed') return 'ok';
		if (s === 'failed' || s === 'cancelled' || s === 'rejected') return 'err';
		if (s === 'running') return 'warn';
		return 'dim';
	}

	async function refresh() {
		try {
			const res = await fetch('/api/jobs?limit=50');
			if (!res.ok) {
				error = `HTTP ${res.status}`;
				return;
			}
			jobs = await res.json();
			error = null;
		} catch (e) {
			error = (e as Error).message;
		} finally {
			loading = false;
		}
	}

	function applyJobEvent(d: { id: string; status: string; cost_cents?: number; tool?: string }) {
		const idx = jobs.findIndex((j) => j.id === d.id);
		if (idx >= 0) {
			const next = { ...jobs[idx], status: d.status };
			if (d.cost_cents) next.actual_cost_cents = String(d.cost_cents);
			if (d.status === 'completed' || d.status === 'failed') {
				next.completed_at = new Date().toISOString();
			}
			jobs = [...jobs.slice(0, idx), next, ...jobs.slice(idx + 1)];
		} else {
			// new job we didn't have — refetch full list (cheap; bounded by limit)
			refresh();
		}
	}

	// Periodic age tick so "ago" updates without a re-fetch.
	let tick = $state(0);
	let tickHandle: ReturnType<typeof setInterval> | null = null;

	onMount(() => {
		refresh();
		tickHandle = setInterval(() => (tick = tick + 1), 10_000);
		try {
			evt = new EventSource('/api/events');
			evt.addEventListener('job', (e) => {
				try {
					applyJobEvent(JSON.parse((e as MessageEvent).data));
				} catch {
					/* malformed event — ignore */
				}
			});
			evt.onerror = () => {
				evt?.close();
				evt = null;
			};
		} catch {
			/* SSE unavailable — we'll just rely on the periodic refresh below */
		}
		// Slow background refresh as belt-and-suspenders.
		const refreshHandle = setInterval(refresh, 30_000);
		return () => clearInterval(refreshHandle);
	});

	onDestroy(() => {
		evt?.close();
		if (tickHandle) clearInterval(tickHandle);
	});
</script>

<div
	class="jobs"
	role="presentation"
	onpointerdown={() => wm.focus(leafId)}
>
	<div class="bar mono">
		jobs <span class="dim">· {jobs.length}</span>
		<span class="grow"></span>
		<button class="refresh mono" onclick={refresh} aria-label="refresh">↻</button>
	</div>

	{#if loading && jobs.length === 0}
		<div class="empty">loading…</div>
	{:else if error}
		<div class="empty err">error: {error}</div>
	{:else if jobs.length === 0}
		<div class="empty dim">(no jobs yet — try <code>run gnina ...</code>)</div>
	{:else}
		<div class="rows mono">
			<div class="row head dim">
				<span class="c-id">id</span>
				<span class="c-tool">tool</span>
				<span class="c-tag">tag</span>
				<span class="c-status">status</span>
				<span class="c-cost">cost</span>
				<span class="c-rt">runtime</span>
				<span class="c-age">age</span>
			</div>
			{#each jobs as j (j.id)}
				{@const _ = tick}
				<div class="row" class:focused={false}>
					<span class="c-id" title={j.id}>{j.id.slice(0, 8)}</span>
					<span class="c-tool">{j.tool}</span>
					<span class="c-tag dim">{j.tag ?? '—'}</span>
					<span class="c-status {statusClass(j.status)}">{j.status}</span>
					<span class="c-cost">{fmtCost(j)}</span>
					<span class="c-rt dim">{fmtRuntime(j)}</span>
					<span class="c-age dim">{fmtAge(j.created_at)}</span>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.jobs {
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		background: var(--bg);
		overflow: hidden;
	}
	.bar {
		flex: 0 0 auto;
		padding: 0.25em 0.6em;
		font-size: 0.8em;
		color: var(--fg-dim);
		border-bottom: 1px solid var(--border);
		display: flex;
		align-items: center;
		gap: 0.4em;
	}
	.grow {
		flex: 1;
	}
	.refresh {
		background: transparent;
		border: none;
		color: var(--fg-dim);
		cursor: pointer;
		padding: 0 0.4em;
	}
	.refresh:hover {
		color: var(--accent);
	}
	.empty {
		padding: 1.2em;
		font-family: var(--mono);
		font-size: 0.85em;
	}
	.rows {
		flex: 1 1 0;
		overflow: auto;
		font-size: 0.78em;
		line-height: 1.6;
	}
	.row {
		display: grid;
		grid-template-columns: 9ch 9ch 1fr 11ch 8ch 8ch 7ch;
		gap: 0.4em;
		padding: 0 0.6em;
		white-space: nowrap;
	}
	.row.head {
		border-bottom: 1px solid var(--border);
		font-weight: 600;
		position: sticky;
		top: 0;
		background: var(--bg);
	}
	.row > span {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.dim {
		color: var(--fg-dim);
	}
	.ok {
		color: var(--ok);
	}
	.warn {
		color: var(--warn);
	}
	.err {
		color: var(--err);
	}
	code {
		background: var(--bg-elev);
		padding: 0.05em 0.3em;
		border-radius: 3px;
	}
	.mono {
		font-family: var(--mono);
	}
</style>
