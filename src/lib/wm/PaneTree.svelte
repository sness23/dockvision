<script lang="ts">
	import { getContext } from 'svelte';
	import type { PaneNode } from './types';
	import type { WmStore } from './store.svelte';
	import { allLeaves } from './layout';
	import PaneTree from './PaneTree.svelte';
	import Terminal from './Terminal.svelte';
	import Viewer from './Viewer.svelte';
	import JobsMonitor from './JobsMonitor.svelte';

	let { node }: { node: PaneNode } = $props();
	const wm = getContext<WmStore>('wm');

	let containerEl = $state<HTMLDivElement>();

	const multiPane = $derived(allLeaves(wm.layout.root).length > 1);

	function startDrag(e: PointerEvent, idx: number) {
		if (node.type !== 'split' || !containerEl) return;
		e.preventDefault();
		const split = node;
		const rect = containerEl.getBoundingClientRect();
		const horizontal = split.orientation === 'horizontal';
		const totalPx = horizontal ? rect.width : rect.height;
		if (totalPx <= 0) return;
		const startPos = horizontal ? e.clientX : e.clientY;
		const startA = split.sizes[idx];
		const startB = split.sizes[idx + 1];
		const handle = e.currentTarget as HTMLElement;
		handle.setPointerCapture(e.pointerId);

		function move(ev: PointerEvent) {
			const pos = horizontal ? ev.clientX : ev.clientY;
			let delta = (pos - startPos) / totalPx;
			delta = Math.max(-(startA - 0.08), Math.min(startB - 0.08, delta));
			const sizes = [...split.sizes];
			sizes[idx] = startA + delta;
			sizes[idx + 1] = startB - delta;
			wm.setSizes(split.id, sizes);
		}
		function up(ev: PointerEvent) {
			handle.releasePointerCapture(ev.pointerId);
			handle.removeEventListener('pointermove', move);
			handle.removeEventListener('pointerup', up);
		}
		handle.addEventListener('pointermove', move);
		handle.addEventListener('pointerup', up);
	}
</script>

{#if node.type === 'leaf'}
	<div class="leaf" class:focused={multiPane && wm.layout.focusedId === node.id}>
		{#if node.kind === 'terminal'}
			<Terminal leafId={node.id} />
		{:else if node.kind === 'viewer' && node.viewer}
			<Viewer leafId={node.id} viewer={node.viewer} />
		{:else if node.kind === 'jobs'}
			<JobsMonitor leafId={node.id} />
		{/if}
	</div>
{:else}
	<div class="split {node.orientation}" bind:this={containerEl}>
		{#each node.children as child, i (child.id)}
			<div class="cell" style="flex: {node.sizes[i]} 1 0">
				<PaneTree node={child} />
			</div>
			{#if i < node.children.length - 1}
				<div
					class="divider {node.orientation}"
					role="separator"
					aria-orientation={node.orientation === 'horizontal' ? 'vertical' : 'horizontal'}
					tabindex="-1"
					onpointerdown={(e) => startDrag(e, i)}
				></div>
			{/if}
		{/each}
	</div>
{/if}

<style>
	.leaf {
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
		position: relative;
	}
	.leaf.focused {
		outline: 1px solid var(--accent);
		outline-offset: -1px;
	}
	.split {
		display: flex;
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
	}
	.split.horizontal {
		flex-direction: row;
	}
	.split.vertical {
		flex-direction: column;
	}
	.cell {
		min-width: 0;
		min-height: 0;
		overflow: hidden;
	}
	.divider {
		flex: 0 0 5px;
		background: var(--border);
		touch-action: none;
	}
	.divider:hover {
		background: var(--accent-dim);
	}
	.divider.horizontal {
		cursor: col-resize;
	}
	.divider.vertical {
		cursor: row-resize;
	}
</style>
