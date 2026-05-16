<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import '@xterm/xterm/css/xterm.css';
	import MolView from '$lib/components/MolView.svelte';

	const { data } = $props();
	const userId = $derived(
		(data.session?.user as { id?: string | number } | undefined)?.id
	);
	const email = $derived(data.session?.user?.email ?? '');
	const initialCwd = $derived(userId ? `/u/${userId}` : '/');

	let termDiv: HTMLDivElement;
	let fileInput: HTMLInputElement;
	type Term = import('@xterm/xterm').Terminal;
	type FitAddon = import('@xterm/addon-fit').FitAddon;
	let term: Term | null = null;
	let fit: FitAddon | null = null;
	let cwd = $state('/');
	let balance = $state<number | null>(null);
	let buffer = '';
	let history: string[] = [];
	let historyIdx = -1;
	let pendingUpload: { target: string } | null = null;
	let molView = $state<{
		structures: { url: string; format: string; label: string }[];
		title: string;
	} | null>(null);
	let eventSource: EventSource | null = null;
	let pollFallback: ReturnType<typeof setInterval> | null = null;

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
		const root = userId ? `/u/${userId}` : '';
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
		switch (kind) {
			case 'ok':
				return C.ok;
			case 'warn':
				return C.warn;
			case 'err':
				return C.err;
			case 'dim':
				return C.dim;
			default:
				return '';
		}
	}

	async function fetchBalance() {
		const res = await postCmd('cost', cwd);
		if (res?.type === 'text') {
			const first = res.lines[0]?.s ?? '';
			const m = first.match(/\$([\d.]+)/);
			if (m) balance = Number(m[1]);
		}
	}

	async function postCmd(line: string, cwdNow: string) {
		const res = await fetch('/api/cmd', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ line, cwd: cwdNow })
		});
		if (!res.ok) {
			return { type: 'error' as const, message: await res.text() };
		}
		return res.json();
	}

	function renderResponse(t: Term, res: { type: string; [k: string]: unknown }) {
		if (res.type === 'text') {
			const lines = res.lines as { s: string; t?: string }[];
			for (const l of lines) {
				const color = colorFor(l.t);
				writeLine(t, color ? `${color}${l.s}${C.reset}` : l.s);
			}
		} else if (res.type === 'error') {
			writeLine(t, `${C.err}error:${C.reset} ${res.message}`);
		} else if (res.type === 'cd') {
			cwd = res.newCwd as string;
		} else if (res.type === 'redirect') {
			window.open(res.url as string, '_blank');
			writeLine(t, `${C.dim}→ opened ${C.reset}`);
		} else if (res.type === 'mol-view') {
			molView = {
				structures: res.structures as { url: string; format: string; label: string }[],
				title: res.title as string
			};
			writeLine(t, `${C.dim}→ opened viewer (esc to close)${C.reset}`);
		} else if (res.type === 'upload') {
			// handled in upload flow
		}
	}

	async function handleUpload(t: Term, line: string) {
		// Parse target path from `upload <path>`
		const m = line.match(/^upload\s+(\S+)/);
		if (!m) {
			writeLine(t, `${C.err}usage: upload <target-path>${C.reset}`);
			return;
		}
		const target = m[1].replace(/^["']|["']$/g, '');
		pendingUpload = { target };
		fileInput.value = '';
		fileInput.click();
	}

	async function onFilePicked(file: File) {
		if (!term || !pendingUpload) return;
		const t = term;
		const target = pendingUpload.target;
		pendingUpload = null;
		const mime = file.type || 'application/octet-stream';
		const cmdLine = `upload "${target}" --content-type="${mime}" --size=${file.size}`;
		const res = await postCmd(cmdLine, cwd);
		if (res.type !== 'upload') {
			renderResponse(t, res);
			showPrompt(t);
			return;
		}
		writeLine(t, `${C.dim}uploading ${(file.size / 1024).toFixed(1)}K → ${res.targetPath}${C.reset}`);
		try {
			const putRes = await fetch(res.uploadUrl, {
				method: 'PUT',
				headers: { 'Content-Type': mime },
				body: file
			});
			if (!putRes.ok) throw new Error(`S3 PUT failed: ${putRes.status}`);
			writeLine(t, `${C.ok}upload ok${C.reset}`);
		} catch (e) {
			writeLine(t, `${C.err}upload failed: ${(e as Error).message}${C.reset}`);
		}
		showPrompt(t);
	}

	async function execute(t: Term, line: string) {
		if (!line.trim()) {
			showPrompt(t);
			return;
		}
		history.push(line);
		historyIdx = history.length;

		if (line.trim() === 'clear') {
			t.clear();
			showPrompt(t);
			return;
		}
		if (/^upload\s+/.test(line.trim())) {
			await handleUpload(t, line.trim());
			return;
		}

		const res = await postCmd(line, cwd);
		renderResponse(t, res);
		showPrompt(t);
		// Refresh balance asynchronously after potentially debit-affecting commands.
		if (/^(run|topup|rm)\b/.test(line.trim())) fetchBalance();
	}

	function eraseLine(t: Term) {
		t.write('\r\x1b[K' + prompt() + buffer);
	}

	onMount(async () => {
		if (!browser) return;
		cwd = initialCwd;
		const { Terminal } = await import('@xterm/xterm');
		const { FitAddon } = await import('@xterm/addon-fit');
		term = new Terminal({
			cursorBlink: true,
			fontFamily: 'JetBrains Mono, Menlo, Consolas, monospace',
			fontSize: 13,
			theme: {
				background: '#000000',
				foreground: '#c9d1d9',
				cursor: '#58a6ff'
			},
			convertEol: true
		});
		fit = new FitAddon();
		term.loadAddon(fit);
		term.open(termDiv);
		fit.fit();

		const t = term;

		// Shift+Ctrl+C → copy selection. Shift+Ctrl+V → paste from clipboard.
		// Pure Ctrl+C still sends ^C (interrupts the current input line).
		t.attachCustomKeyEventHandler((e) => {
			if (e.type !== 'keydown') return true;
			if (!(e.ctrlKey && e.shiftKey)) return true;
			if (e.code === 'KeyC' || e.key === 'C' || e.key === 'c') {
				e.preventDefault();
				const sel = t.getSelection();
				if (sel) navigator.clipboard.writeText(sel).catch(() => {});
				return false;
			}
			if (e.code === 'KeyV' || e.key === 'V' || e.key === 'v') {
				e.preventDefault();
				navigator.clipboard
					.readText()
					.then((text) => {
						const cleaned = text.replace(/\r\n?/g, '\n');
						// Submit on newline; otherwise append to buffer + echo.
						const parts = cleaned.split('\n');
						for (let i = 0; i < parts.length; i++) {
							const chunk = parts[i];
							if (chunk) {
								buffer += chunk;
								t.write(chunk);
							}
							if (i < parts.length - 1) {
								// Synthesize an Enter — submit current buffer.
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

		writeLine(t, `${C.bold}DockVision${C.reset} · signed in as ${C.cyan}${email}${C.reset}`);
		writeLine(t, `${C.dim}type 'help' for commands, 'whoami' for your account${C.reset}`);
		writeLine(t, `${C.dim}copy: ⇧⌃C  ·  paste: ⇧⌃V${C.reset}`);
		writeLine(t);
		showPrompt(t);

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
					// Ctrl+C
					t.write('^C\r\n');
					buffer = '';
					showPrompt(t);
				} else if (ch === '\x0c') {
					// Ctrl+L
					t.clear();
					showPrompt(t);
					t.write(buffer);
				} else if (data === '\x1b[A') {
					// Up arrow
					if (historyIdx > 0) {
						historyIdx--;
						buffer = history[historyIdx];
						eraseLine(t);
					}
					return;
				} else if (data === '\x1b[B') {
					// Down arrow
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

		window.addEventListener('resize', () => fit?.fit());
		fetchBalance();
		startEventStream(t);
	});

	function startEventStream(t: Term) {
		try {
			eventSource = new EventSource('/api/events');
			eventSource.addEventListener('balance', (e) => {
				try {
					const data = JSON.parse((e as MessageEvent).data);
					balance = Number(data.cents) / 100;
				} catch {}
			});
			eventSource.addEventListener('job', (e) => {
				try {
					const d = JSON.parse((e as MessageEvent).data);
					const col =
						d.status === 'completed' ? C.ok : d.status === 'failed' ? C.err : C.warn;
					writeLine(
						t,
						`${C.dim}[job ${d.id.slice(0, 8)}]${C.reset} ${col}${d.status}${C.reset} ${d.tool}${
							d.cost_cents ? ` · $${(d.cost_cents / 100).toFixed(3)}` : ''
						}`
					);
					showPrompt(t);
					t.write(buffer);
				} catch {}
			});
			eventSource.onerror = () => {
				eventSource?.close();
				eventSource = null;
				if (!pollFallback) pollFallback = setInterval(fetchBalance, 30_000);
			};
		} catch {
			if (!pollFallback) pollFallback = setInterval(fetchBalance, 30_000);
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
			// common prefix
			const common = completions.reduce((acc, s) =>
				acc === null ? s : commonPrefix(acc, s)
			, null as string | null);
			if (common && common.length > buffer.length - replaceFrom) {
				buffer = buffer.slice(0, replaceFrom) + common;
				eraseLine(t);
				return;
			}
			// list options
			t.write('\r\n');
			for (const c of completions.slice(0, 30)) t.write(`  ${c}\r\n`);
			showPrompt(t);
			t.write(buffer);
		} catch {}
	}

	function commonPrefix(a: string, b: string): string {
		let i = 0;
		while (i < a.length && i < b.length && a[i] === b[i]) i++;
		return a.slice(0, i);
	}

	onDestroy(() => {
		term?.dispose();
		eventSource?.close();
		if (pollFallback) clearInterval(pollFallback);
	});
</script>

<div class="topbar mono">
	<span>DockVision shell</span>
	<span class="grow"></span>
	<span class="dim">{email}</span>
	<span class="bal">
		{#if balance !== null}
			${balance.toFixed(2)}
		{:else}
			…
		{/if}
	</span>
</div>

<div bind:this={termDiv} class="term"></div>

<input
	bind:this={fileInput}
	type="file"
	style="display:none"
	onchange={(e) => {
		const f = (e.target as HTMLInputElement).files?.[0];
		if (f) onFilePicked(f);
	}}
/>

{#if molView}
	<MolView
		structures={molView.structures}
		title={molView.title}
		onClose={() => (molView = null)}
	/>
{/if}

<style>
	.topbar {
		display: flex;
		gap: 1em;
		align-items: center;
		padding: 0.5em 1em;
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-radius: 4px 4px 0 0;
		border-bottom: none;
		font-size: 0.9em;
	}
	.grow {
		flex: 1;
	}
	.dim {
		color: var(--fg-dim);
	}
	.bal {
		font-family: var(--mono);
		color: var(--ok);
		font-weight: 600;
	}
	.term {
		height: 70vh;
		padding: 0.5em;
		background: #000;
		border: 1px solid var(--border);
		border-radius: 0 0 4px 4px;
	}
	.mono {
		font-family: var(--mono);
	}
</style>
