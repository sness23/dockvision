<script lang="ts">
	import { onMount } from 'svelte';
	import type { MolViewerHandle } from './types';

	let { mv, visible = true }: { mv: MolViewerHandle | null; visible?: boolean } = $props();

	const HISTORY_KEY = 'dockvision-molconsole-history';

	let lines = $state<string[]>([
		"mol-console — type 'help'. commands: color · load <pdbid> · clear · reset · cls"
	]);
	let input = $state('');
	let inputEl = $state<HTMLInputElement>();
	let firstVisibleRun = true;
	let scrollEl = $state<HTMLDivElement>();
	let history: string[] = [];
	let historyIdx = -1;

	type MolstarApi = {
		executeHelp?: (
			plugin: unknown,
			cmd?: string
		) => { success?: boolean; helpText?: string; message?: string };
		parseColorCommand?: (s: string) => { mode: string };
		executeSimpleColor?: (plugin: unknown, cmd: unknown) => Promise<{ message?: string }>;
	};

	function molstar(): MolstarApi | undefined {
		return (window as typeof window & { molstar?: MolstarApi }).molstar;
	}

	function out(s: string) {
		lines = [...lines, ...s.split('\n')];
		queueMicrotask(() => {
			if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
		});
	}

	function loadHistory() {
		try {
			const saved = localStorage.getItem(HISTORY_KEY);
			if (saved) {
				history = JSON.parse(saved);
				historyIdx = history.length;
			}
		} catch {
			/* corrupt / unavailable storage — start fresh */
		}
	}

	function addHistory(cmd: string) {
		if (!cmd.trim() || history[history.length - 1] === cmd) return;
		history.push(cmd);
		historyIdx = history.length;
		try {
			localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-100)));
		} catch {
			/* storage full / unavailable */
		}
	}

	async function dispatch(raw: string) {
		const line = raw.trim();
		if (!line) return;
		out('mol> ' + line);
		const parts = line.split(/\s+/);
		const cmd = parts[0].toLowerCase();
		const m = molstar();

		if (cmd === 'cls' || cmd === 'clear-console') {
			lines = [];
			return;
		}
		if (cmd === 'help') {
			if (!m?.executeHelp) {
				out('help unavailable (molstar build lacks the command API)');
				return;
			}
			const r = m.executeHelp(mv?.plugin ?? null, parts[1]);
			out(r.helpText || r.message || '(no help)');
			return;
		}
		if (cmd === 'color') {
			if (!mv) {
				out('error: no structure loaded');
				return;
			}
			try {
				const parsed = m?.parseColorCommand?.(line);
				if (!parsed || parsed.mode === 'unknown') {
					out('error: invalid color command — try "help color"');
					return;
				}
				if (parsed.mode === 'simple') {
					const r = await m!.executeSimpleColor!(mv.plugin, parsed);
					out(r?.message ?? 'done');
				} else {
					out(`error: color mode "${parsed.mode}" not implemented`);
				}
			} catch (e) {
				out('error: ' + (e as Error).message);
			}
			return;
		}
		if (cmd === 'load') {
			const id = parts[1];
			if (!id || !/^[a-z0-9]{4}$/i.test(id)) {
				out('usage: load <4-char pdb id>   (e.g. load 1erm)');
				return;
			}
			mv?.plugin?.clear?.();
			mv?.loadPdb?.(id);
			out('loading pdb ' + id.toLowerCase());
			return;
		}
		if (cmd === 'clear' || cmd === 'close') {
			mv?.plugin?.clear?.();
			out('cleared structures');
			return;
		}
		if (cmd === 'reset') {
			mv?.plugin?.managers?.camera?.reset?.();
			out('camera reset');
			return;
		}
		out(`unknown command: ${cmd} — try 'help'`);
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			const cmd = input;
			input = '';
			if (cmd.trim()) {
				addHistory(cmd);
				dispatch(cmd);
			}
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (historyIdx > 0) {
				historyIdx--;
				input = history[historyIdx];
			}
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			if (historyIdx < history.length - 1) {
				historyIdx++;
				input = history[historyIdx];
			} else {
				historyIdx = history.length;
				input = '';
			}
		}
	}

	onMount(loadHistory);

	// Focus the input when the console is toggled back on (F2), but not on the
	// initial mount — that would steal focus from the freshly-opened viewer.
	$effect(() => {
		if (firstVisibleRun) {
			firstVisibleRun = false;
			return;
		}
		if (visible) inputEl?.focus();
	});
</script>

<div class="mol-console" class:hidden={!visible}>
	<div class="out" bind:this={scrollEl}>
		{#each lines as l}<div class="line">{l}</div>{/each}
	</div>
	<div class="in-line">
		<span class="prompt">mol&gt;</span>
		<input
			class="in"
			bind:this={inputEl}
			bind:value={input}
			onkeydown={onKey}
			placeholder="color · load · help · reset · clear"
			autocomplete="off"
			spellcheck="false"
		/>
	</div>
</div>

<style>
	.mol-console {
		flex: 0 0 150px;
		display: flex;
		flex-direction: column;
		background: #000;
		border-top: 1px solid var(--border);
		font-family: var(--mono);
		font-size: 12px;
	}
	.mol-console.hidden {
		display: none;
	}
	.out {
		flex: 1 1 0;
		overflow-y: auto;
		padding: 0.4em 0.6em;
		color: #3fb950;
		line-height: 1.45;
		white-space: pre-wrap;
		word-break: break-word;
	}
	.line {
		min-height: 1.45em;
	}
	.in-line {
		display: flex;
		align-items: center;
		gap: 0.4em;
		padding: 0.3em 0.6em;
		border-top: 1px solid rgba(63, 185, 80, 0.25);
	}
	.prompt {
		color: #3fb950;
		font-weight: 600;
	}
	.in {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		color: #3fb950;
		font-family: var(--mono);
		font-size: 12px;
		padding: 0;
	}
	.in::placeholder {
		color: rgba(63, 185, 80, 0.35);
	}
</style>
