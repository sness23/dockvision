<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	let {
		fileUrl,
		format,
		name,
		onClose
	}: { fileUrl: string; format: string; name: string; onClose: () => void } = $props();

	let host: HTMLDivElement;
	let viewer: { dispose?: () => void } | null = null;

	const MOLSTAR_JS = 'https://cdn.jsdelivr.net/npm/molstar/build/viewer/molstar.js';
	const MOLSTAR_CSS = 'https://cdn.jsdelivr.net/npm/molstar/build/viewer/molstar.css';

	async function loadMolstar(): Promise<typeof window & { molstar: unknown }> {
		const w = window as typeof window & {
			molstar?: { Viewer: { create: (el: HTMLElement, opts: unknown) => Promise<unknown> } };
		};
		if (w.molstar) return w as never;
		if (!document.querySelector(`link[href="${MOLSTAR_CSS}"]`)) {
			const link = document.createElement('link');
			link.rel = 'stylesheet';
			link.href = MOLSTAR_CSS;
			document.head.appendChild(link);
		}
		await new Promise<void>((resolve, reject) => {
			const existing = document.querySelector(`script[src="${MOLSTAR_JS}"]`);
			if (existing) {
				existing.addEventListener('load', () => resolve());
				existing.addEventListener('error', () => reject(new Error('molstar script failed')));
				return;
			}
			const s = document.createElement('script');
			s.src = MOLSTAR_JS;
			s.onload = () => resolve();
			s.onerror = () => reject(new Error('molstar script failed'));
			document.head.appendChild(s);
		});
		return w as never;
	}

	onMount(async () => {
		try {
			const w = await loadMolstar();
			const m = (w as unknown as {
				molstar: {
					Viewer: {
						create: (
							el: HTMLElement,
							opts: Record<string, unknown>
						) => Promise<{
							loadStructureFromUrl?: (url: string, format: string) => Promise<unknown>;
							dispose?: () => void;
						}>;
					};
				};
			}).molstar;
			const v = await m.Viewer.create(host, {
				layoutIsExpanded: false,
				layoutShowControls: false,
				layoutShowRemoteState: false,
				layoutShowSequence: true,
				layoutShowLog: false,
				viewportShowExpand: true,
				pdbProvider: 'rcsb'
			});
			viewer = v;
			if (v.loadStructureFromUrl) {
				await v.loadStructureFromUrl(fileUrl, format);
			}
		} catch (e) {
			console.error('mol-view load failed', e);
		}
	});

	onDestroy(() => {
		viewer?.dispose?.();
	});

	function onBackdrop(e: MouseEvent) {
		if (e.target === e.currentTarget) onClose();
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={onKey} />

<div
	class="backdrop"
	onclick={onBackdrop}
	onkeydown={(e) => e.key === 'Escape' && onClose()}
	role="dialog"
	aria-modal="true"
	tabindex="-1"
>
	<div class="frame">
		<div class="title">
			<span class="mono">{name}</span>
			<span class="dim mono">({format})</span>
			<span class="grow"></span>
			<button class="x" onclick={onClose} aria-label="Close">×</button>
		</div>
		<div bind:this={host} class="host"></div>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.7);
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2vh 2vw;
	}
	.frame {
		width: 96vw;
		height: 92vh;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 6px;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.title {
		display: flex;
		gap: 0.6em;
		align-items: center;
		padding: 0.4em 0.8em;
		border-bottom: 1px solid var(--border);
		background: var(--bg-elev);
	}
	.grow {
		flex: 1;
	}
	.dim {
		color: var(--fg-dim);
	}
	.mono {
		font-family: var(--mono);
	}
	.x {
		background: transparent;
		color: var(--fg);
		border: none;
		font-size: 1.4em;
		line-height: 1;
		padding: 0 0.4em;
		cursor: pointer;
	}
	.x:hover {
		color: var(--err);
	}
	.host {
		flex: 1;
		position: relative;
	}
</style>
