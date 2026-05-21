<script lang="ts">
	import { setContext } from 'svelte';
	import { browser } from '$app/environment';
	import { WmStore } from './store.svelte';
	import PaneTree from './PaneTree.svelte';
	import type { FocusDir, Layout } from './types';

	let { userId, userEmail }: { userId: number; userEmail: string } = $props();

	const LAYOUT_KEY = 'dockvision-wm-layout-v1';

	function loadPersisted(): Layout | null {
		if (!browser) return null;
		try {
			const raw = localStorage.getItem(LAYOUT_KEY);
			return raw ? (JSON.parse(raw) as Layout) : null;
		} catch {
			return null;
		}
	}

	const wm = new WmStore(loadPersisted());
	// One-time init from props — userId/email don't change for a logged-in session.
	/* eslint-disable-next-line svelte/valid-compile */
	wm.userId = userId;
	/* eslint-disable-next-line svelte/valid-compile */
	wm.userEmail = userEmail;
	setContext('wm', wm);

	const DIRS: Record<string, FocusDir> = {
		ArrowLeft: 'left',
		ArrowRight: 'right',
		ArrowUp: 'up',
		ArrowDown: 'down'
	};

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

	// Capture-phase keyboard handler so WM chords land before xterm sees them.
	$effect(() => {
		window.addEventListener('keydown', onKeydown, true);
		return () => window.removeEventListener('keydown', onKeydown, true);
	});

	// Persist the layout shape across refreshes. Debounced so divider drags don't
	// hammer localStorage. Viewer content (expiring URLs) is stripped on serialize.
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		const serialized = wm.serialize();
		if (!browser) return;
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			try {
				localStorage.setItem(LAYOUT_KEY, serialized);
			} catch {
				/* quota / disabled storage — best-effort */
			}
		}, 400);
		return () => {
			if (saveTimer) clearTimeout(saveTimer);
		};
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
