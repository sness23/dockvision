<script lang="ts">
	import { setContext } from 'svelte';
	import { WmStore } from './store.svelte';
	import PaneTree from './PaneTree.svelte';
	import type { FocusDir } from './types';

	let { userId, userEmail }: { userId: number; userEmail: string } = $props();

	const wm = new WmStore();
	wm.userId = userId;
	wm.userEmail = userEmail;
	setContext('wm', wm);

	const DIRS: Record<string, FocusDir> = {
		ArrowLeft: 'left',
		ArrowRight: 'right',
		ArrowUp: 'up',
		ArrowDown: 'down'
	};

	// Capture-phase so window-manager chords are handled before xterm sees them.
	function onKeydown(e: KeyboardEvent) {
		if (!e.altKey) return;
		const dir = DIRS[e.key];
		if (dir) {
			e.preventDefault();
			e.stopPropagation();
			if (e.shiftKey) wm.resizeFocused(dir);
			else wm.focusDir(dir);
			return;
		}
		if ((e.key === 'w' || e.key === 'W') && !e.shiftKey) {
			e.preventDefault();
			e.stopPropagation();
			wm.closeFocused();
		}
	}

	// $effect runs client-only; its cleanup runs on unmount. Avoids the
	// onDestroy-runs-during-SSR trap (window is not defined on the server).
	$effect(() => {
		window.addEventListener('keydown', onKeydown, true);
		return () => window.removeEventListener('keydown', onKeydown, true);
	});
</script>

<div class="workspace">
	<PaneTree node={wm.layout.root} />
</div>

<style>
	.workspace {
		width: 100%;
		height: 100%;
		background: #000;
	}
</style>
