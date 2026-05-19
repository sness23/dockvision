<script lang="ts">
	import { onMount, onDestroy, getContext } from 'svelte';
	import { browser } from '$app/environment';
	import '@xterm/xterm/css/xterm.css';
	import type { WmStore } from './store.svelte';
	import type { FocusDir } from './types';

	let { leafId }: { leafId: string } = $props();
	const wm = getContext<WmStore>('wm');

	let termDiv: HTMLDivElement;
	let fileInput: HTMLInputElement;
	type Term = import('@xterm/xterm').Terminal;
	type FitAddon = import('@xterm/addon-fit').FitAddon;
	let term: Term | null = null;
	let fit: FitAddon | null = null;
	let ro: ResizeObserver | null = null;
	let cwd = $state('/');
	let buffer = '';
	let history: string[] = [];
	let historyIdx = -1;
	let pendingUpload: { target: string } | null = null;
	let eventSource: EventSource | null = null;

	const C = {
		reset: '\x1b[0m',
		dim: '\x1b[90m',
		ok: '\x1b[32m',
		warn: '\x1b[33m',
		err: '\x1b[31m',
		cyan: '\x1b[36m',
		bold: '\x1b[1m'
	};

	function prompt(): string {
		const root = wm.userId ? `/u/${wm.userId}` : '';
		let display = cwd;
		if (root && cwd === root) display = '/';
		else if (root && cwd.startsWith(root + '/')) display = cwd.slice(root.length);
		return `${C.cyan}${display}${C.reset} ${C.bold}$${C.reset} `;
	}

	function writeLine(t: Term, s = '') {
		t.writeln(s);
	}
	function showPrompt(t: Term) {
		t.write(prompt());
	}
	function colorFor(kind?: string): string {
		return kind === 'ok'
			? C.ok
			: kind === 'warn'
				? C.warn
				: kind === 'err'
					? C.err
					: kind === 'dim'
						? C.dim
						: '';
	}

	async function postCmd(line: string, cwdNow: string) {
		const res = await fetch('/api/cmd', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ line, cwd: cwdNow })
		});
		if (!res.ok) return { type: 'error' as const, message: await res.text() };
		return res.json();
	}

	function renderResponse(t: Term, res: { type: string; [k: string]: unknown }) {
		if (res.type === 'text') {
			for (const l of res.lines as { s: string; t?: string }[]) {
				const color = colorFor(l.t);
				writeLine(t, color ? `${color}${l.s}${C.reset}` : l.s);
			}
		} else if (res.type === 'error') {
			writeLine(t, `${C.err}error:${C.reset} ${res.message}`);
		} else if (res.type === 'cd') {
			cwd = res.newCwd as string;
		} else if (res.type === 'redirect') {
			window.open(res.url as string, '_blank');
			writeLine(t, `${C.dim}→ opened${C.reset}`);
		} else if (res.type === 'mol-view') {
			wm.openViewer(
				res.structures as { url: string; format: string; label: string }[],
				res.title as string
			);
			writeLine(t, `${C.dim}→ viewer pane (alt+← / alt+→ to move focus)${C.reset}`);
		}
	}

	async function handleUpload(t: Term, line: string) {
		const m = line.match(/^upload\s+(\S+)/);
		if (!m) {
			writeLine(t, `${C.err}usage: upload <target-path>${C.reset}`);
			return;
		}
		pendingUpload = { target: m[1].replace(/^["']|["']$/g, '') };
		fileInput.value = '';
		fileInput.click();
	}

	async function onFilePicked(file: File) {
		if (!term || !pendingUpload) return;
		const t = term;
		const target = pendingUpload.target;
		pendingUpload = null;
		const mime = file.type || 'application/octet-stream';
		const res = await postCmd(
			`upload "${target}" --content-type="${mime}" --size=${file.size}`,
			cwd
		);
		if (res.type !== 'upload') {
			renderResponse(t, res);
			showPrompt(t);
			return;
		}
		writeLine(t, `${C.dim}uploading ${(file.size / 1024).toFixed(1)}K → ${res.targetPath}${C.reset}`);
		try {
			const put = await fetch(res.uploadUrl, {
				method: 'PUT',
				headers: { 'Content-Type': mime },
				body: file
			});
			if (!put.ok) throw new Error(`S3 PUT failed: ${put.status}`);
			writeLine(t, `${C.ok}upload ok${C.reset}`);
		} catch (e) {
			writeLine(t, `${C.err}upload failed: ${(e as Error).message}${C.reset}`);
		}
		showPrompt(t);
	}

	async function execute(t: Term, line: string) {
		const trimmed = line.trim();
		if (!trimmed) {
			showPrompt(t);
			return;
		}
		history.push(line);
		historyIdx = history.length;

		if (trimmed === 'clear') {
			t.clear();
			showPrompt(t);
			return;
		}
		// Client-side window-manager commands.
		if (trimmed === 'close') {
			wm.closeFocused();
			showPrompt(t);
			return;
		}
		const focusM = trimmed.match(/^focus\s+(left|right|up|down)$/);
		if (focusM) {
			wm.focusDir(focusM[1] as FocusDir);
			showPrompt(t);
			return;
		}
		if (/^upload\s+/.test(trimmed)) {
			await handleUpload(t, trimmed);
			return;
		}

		const res = await postCmd(line, cwd);
		renderResponse(t, res);
		showPrompt(t);
	}

	function eraseLine(t: Term) {
		t.write('\r\x1b[K' + prompt() + buffer);
	}

	function startEventStream(t: Term) {
		try {
			eventSource = new EventSource('/api/events');
			eventSource.addEventListener('job', (e) => {
				try {
					const d = JSON.parse((e as MessageEvent).data);
					const col = d.status === 'completed' ? C.ok : d.status === 'failed' ? C.err : C.warn;
					writeLine(
						t,
						`${C.dim}[job ${d.id.slice(0, 8)}]${C.reset} ${col}${d.status}${C.reset} ${d.tool}${
							d.cost_cents ? ` · $${(d.cost_cents / 100).toFixed(3)}` : ''
						}`
					);
					showPrompt(t);
					t.write(buffer);
				} catch {
					/* ignore malformed event */
				}
			});
			eventSource.onerror = () => {
				eventSource?.close();
				eventSource = null;
			};
		} catch {
			/* SSE unavailable — job notifications just won't stream */
		}
	}

	async function completeAt(t: Term) {
		try {
			const res = await fetch('/api/complete', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ line: buffer, cwd, pos: buffer.length })
			});
			if (!res.ok) return;
			const { completions, replaceFrom } = (await res.json()) as {
				completions: string[];
				replaceFrom: number;
			};
			if (!completions.length) return;
			if (completions.length === 1) {
				buffer = buffer.slice(0, replaceFrom) + completions[0];
				eraseLine(t);
				return;
			}
			const common = completions.reduce(
				(acc, s) => (acc === null ? s : commonPrefix(acc, s)),
				null as string | null
			);
			if (common && common.length > buffer.length - replaceFrom) {
				buffer = buffer.slice(0, replaceFrom) + common;
				eraseLine(t);
				return;
			}
			t.write('\r\n');
			for (const c of completions.slice(0, 30)) t.write(`  ${c}\r\n`);
			showPrompt(t);
			t.write(buffer);
		} catch {
			/* completion is best-effort */
		}
	}

	function commonPrefix(a: string, b: string): string {
		let i = 0;
		while (i < a.length && i < b.length && a[i] === b[i]) i++;
		return a.slice(0, i);
	}

	onMount(async () => {
		if (!browser) return;
		cwd = wm.userId ? `/u/${wm.userId}` : '/';
		const { Terminal } = await import('@xterm/xterm');
		const { FitAddon } = await import('@xterm/addon-fit');
		term = new Terminal({
			cursorBlink: true,
			fontFamily: 'JetBrains Mono, Menlo, Consolas, monospace',
			fontSize: 13,
			theme: { background: '#000000', foreground: '#c9d1d9', cursor: '#58a6ff' },
			convertEol: true
		});
		fit = new FitAddon();
		term.loadAddon(fit);
		term.open(termDiv);
		fit.fit();
		const t = term;

		// Shift+Ctrl+C copy / Shift+Ctrl+V paste. Pure Ctrl+C still sends ^C.
		// Alt+arrows are left for the window manager (return false → not consumed).
		t.attachCustomKeyEventHandler((e) => {
			if (e.type !== 'keydown') return true;
			if (e.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
				return false;
			}
			if (!(e.ctrlKey && e.shiftKey)) return true;
			if (e.code === 'KeyC') {
				e.preventDefault();
				const sel = t.getSelection();
				if (sel) navigator.clipboard.writeText(sel).catch(() => {});
				return false;
			}
			if (e.code === 'KeyV') {
				e.preventDefault();
				navigator.clipboard
					.readText()
					.then((text) => {
						const parts = text.replace(/\r\n?/g, '\n').split('\n');
						for (let i = 0; i < parts.length; i++) {
							if (parts[i]) {
								buffer += parts[i];
								t.write(parts[i]);
							}
							if (i < parts.length - 1) {
								t.write('\r\n');
								const line = buffer;
								buffer = '';
								execute(t, line);
							}
						}
					})
					.catch(() => {});
				return false;
			}
			return true;
		});

		writeLine(t, `${C.bold}DockVision${C.reset} · ${C.cyan}${wm.userEmail}${C.reset}`);
		writeLine(t, `${C.dim}help · whoami · view <file> opens a pane · close · focus <dir>${C.reset}`);
		writeLine(t, `${C.dim}panes: alt+arrows focus · alt+shift+arrows resize · alt+w close${C.reset}`);
		writeLine(t);
		showPrompt(t);
		t.focus(); // ready to type immediately — no click needed

		t.onData(async (data) => {
			if (data === '\t') {
				await completeAt(t);
				return;
			}
			for (const ch of data) {
				if (ch === '\r') {
					t.write('\r\n');
					const line = buffer;
					buffer = '';
					await execute(t, line);
				} else if (ch === '\x7f' || ch === '\b') {
					if (buffer.length > 0) {
						buffer = buffer.slice(0, -1);
						t.write('\b \b');
					}
				} else if (ch === '\x03') {
					t.write('^C\r\n');
					buffer = '';
					showPrompt(t);
				} else if (ch === '\x0c') {
					t.clear();
					showPrompt(t);
					t.write(buffer);
				} else if (data === '\x1b[A') {
					if (historyIdx > 0) {
						historyIdx--;
						buffer = history[historyIdx];
						eraseLine(t);
					}
					return;
				} else if (data === '\x1b[B') {
					if (historyIdx < history.length - 1) {
						historyIdx++;
						buffer = history[historyIdx];
					} else {
						historyIdx = history.length;
						buffer = '';
					}
					eraseLine(t);
					return;
				} else if (ch >= ' ' && ch <= '~') {
					buffer += ch;
					t.write(ch);
				}
			}
		});

		let raf = 0;
		ro = new ResizeObserver(() => {
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(() => fit?.fit());
		});
		ro.observe(termDiv);

		startEventStream(t);
	});

	onDestroy(() => {
		ro?.disconnect();
		term?.dispose();
		eventSource?.close();
	});
</script>

<div
	class="term"
	role="presentation"
	onpointerdown={() => wm.focus(leafId)}
>
	<div bind:this={termDiv} class="xterm-host"></div>
</div>

<input
	bind:this={fileInput}
	type="file"
	style="display:none"
	onchange={(e) => {
		const f = (e.target as HTMLInputElement).files?.[0];
		if (f) onFilePicked(f);
	}}
/>

<style>
	.term {
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
		background: #000;
		padding: 0.3em;
		box-sizing: border-box;
	}
	.xterm-host {
		width: 100%;
		height: 100%;
	}
</style>
