<script lang="ts">
	import { onMount, onDestroy, getContext } from 'svelte';
	import type { ViewerProps, MolViewerHandle } from './types';
	import type { WmStore } from './store.svelte';
	import MolConsole from './MolConsole.svelte';

	let { viewer, leafId }: { viewer: ViewerProps; leafId: string } = $props();
	const wm = getContext<WmStore>('wm');

	let host: HTMLDivElement;
	// Mol* Viewer instance — $state so the docked MolConsole sees it once ready.
	let mv = $state<MolViewerHandle | null>(null);
	let ro: ResizeObserver | null = null;
	let loadedKey = '';
	let consoleVisible = $state(true);

	// Vendored Mol* build (from ~/github/sness23/molstar0/build/viewer), served
	// from static/. Self-hosted — no CDN dependency.
	const MOLSTAR_JS = '/molstar/molstar.js';
	const MOLSTAR_CSS = '/molstar/molstar.css';

	async function loadMolstar() {
		const w = window as typeof window & {
			molstar?: { Viewer: { create: (el: HTMLElement, o: unknown) => Promise<unknown> } };
		};
		if (w.molstar) return w.molstar;
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
				existing.addEventListener('error', () => reject(new Error('molstar load failed')));
				return;
			}
			const s = document.createElement('script');
			s.src = MOLSTAR_JS;
			s.onload = () => resolve();
			s.onerror = () => reject(new Error('molstar load failed'));
			document.head.appendChild(s);
		});
		return w.molstar!;
	}

	function resize() {
		mv?.handleResize?.();
		mv?.plugin?.canvas3d?.handleResize?.();
	}

	async function reload() {
		if (!mv) return;
		const key = viewer.structures.map((s) => s.url).join('|');
		if (key === loadedKey) return;
		loadedKey = key;
		try {
			await mv.plugin?.clear?.();
		} catch {
			/* fresh viewer — nothing to clear */
		}
		// Empty structures = a restored layout slot. Leave the scene empty; the
		// title bar shows the placeholder and the mol-console can `load <pdbid>`.
		for (const s of viewer.structures) {
			if (mv.loadStructureFromUrl) await mv.loadStructureFromUrl(s.url, s.format);
		}
		resize();
	}

	onMount(async () => {
		try {
			const molstar = await loadMolstar();
			mv = (await molstar.Viewer.create(host, {
				layoutIsExpanded: false,
				layoutShowControls: false,
				layoutShowRemoteState: false,
				layoutShowSequence: true,
				layoutShowLog: false,
				viewportShowExpand: true,
				pdbProvider: 'rcsb'
			})) as typeof mv;
			// Dark 3D canvas background (matches the smol6 setup).
			mv?.plugin?.canvas3d?.setProps?.({ renderer: { backgroundColor: 0x000000 } });
			await reload();
		} catch (e) {
			console.error('viewer init failed', e);
		}

		let raf = 0;
		ro = new ResizeObserver(() => {
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(resize);
		});
		ro.observe(host);
	});

	// Reload when the viewer pane is reused for a different structure set.
	$effect(() => {
		void viewer.structures;
		reload();
	});

	// F2 toggles the mol-console only. $effect is client-only + auto-cleans up.
	$effect(() => {
		function onKey(e: KeyboardEvent) {
			if (e.key === 'F2') {
				e.preventDefault();
				consoleVisible = !consoleVisible;
			}
		}
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	onDestroy(() => {
		ro?.disconnect();
		mv?.dispose?.();
	});
</script>

<div class="viewer" role="presentation" onpointerdown={() => wm.focus(leafId)}>
	<div class="bar mono">
		{viewer.title || '(no structure — load via mol-console)'}<span class="hint">
			· F2 toggles mol-console</span
		>
	</div>
	<div bind:this={host} class="host"></div>
	<MolConsole {mv} visible={consoleVisible} />
</div>

<style>
	.viewer {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
		background: var(--bg);
	}
	.bar {
		flex: 0 0 auto;
		padding: 0.25em 0.6em;
		font-size: 0.8em;
		color: var(--fg-dim);
		border-bottom: 1px solid var(--border);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.host {
		flex: 1 1 0;
		min-width: 0;
		min-height: 0;
		position: relative;
	}
	.mono {
		font-family: var(--mono);
	}
	.hint {
		color: var(--border);
	}
</style>
