<script lang="ts">
	import { goto } from '$app/navigation';

	const { data } = $props();
	const tool = $derived(data.tool);
	const entries = $derived(Object.entries(tool.args));

	// One-time read — the wizard's tool spec is fixed by the URL param.
	/* eslint-disable svelte/valid-compile */
	let values = $state<Record<string, string>>(
		Object.fromEntries(
			Object.entries(data.tool.args).map(([k, spec]) => [
				k,
				spec.default !== undefined ? String(spec.default) : ''
			])
		)
	);
	/* eslint-enable svelte/valid-compile */
	let submitting = $state(false);
	let result = $state<{ ok: boolean; message: string } | null>(null);

	function quote(s: string): string {
		if (/^[a-zA-Z0-9_./\-=:@]+$/.test(s)) return s;
		return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
	}

	function buildLine(): string {
		const parts: string[] = ['run', tool.name];
		for (const [k, spec] of entries) {
			const v = values[k];
			if (!v || (spec.default !== undefined && String(spec.default) === v)) {
				if (!spec.required) continue;
			}
			if (spec.type === 'boolean') {
				if (v === 'true' || v === 'on') parts.push(`--${k}`);
				continue;
			}
			parts.push(`--${k}=${quote(v)}`);
		}
		return parts.join(' ');
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		const line = buildLine();
		submitting = true;
		result = null;
		try {
			const res = await fetch('/api/cmd', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ line, cwd: '/' })
			});
			const body = await res.json();
			if (body.type === 'error') {
				result = { ok: false, message: body.message };
			} else if (body.type === 'text') {
				result = {
					ok: true,
					message: (body.lines as { s: string }[]).map((l) => l.s).join('\n')
				};
				setTimeout(() => goto('/app'), 2000);
			} else {
				result = { ok: true, message: JSON.stringify(body, null, 2) };
			}
		} catch (err) {
			result = { ok: false, message: (err as Error).message };
		} finally {
			submitting = false;
		}
	}
</script>

<section>
	<h1>Run {tool.displayName}</h1>
	<p class="dim">
		{tool.description}<br />
		<span class="mono"
			>{tool.gpu} · ~{(data.typicalSec / 60).toFixed(1)} min · est. {data.estimateText}</span
		>
	</p>

	<form onsubmit={submit}>
		{#each entries as [name, spec]}
			<label class="row">
				<span class="label">
					{name}
					{#if spec.required}<span class="req">*</span>{/if}
				</span>
				{#if spec.type === 'boolean'}
					<input
						type="checkbox"
						checked={values[name] === 'true'}
						onchange={(e) => (values[name] = (e.target as HTMLInputElement).checked ? 'true' : '')}
					/>
				{:else}
					<input
						type={spec.type === 'number' ? 'number' : 'text'}
						bind:value={values[name]}
						required={spec.required}
						placeholder={spec.type === 'path' ? '/inputs/your-file.pdb' : ''}
					/>
				{/if}
				<span class="hint">{spec.description}</span>
			</label>
		{/each}

		<div class="actions">
			<a href="/app"><button type="button" class="secondary">cancel</button></a>
			<button type="submit" disabled={submitting}>
				{submitting ? 'submitting…' : `submit (est. ${data.estimateText})`}
			</button>
		</div>
	</form>

	{#if result}
		<pre class="result {result.ok ? 'ok' : 'err'}">{result.message}</pre>
	{/if}

	<p class="dim hint">
		this is the wizard view — the CLI equivalent is:<br />
		<code>{buildLine()}</code>
	</p>
</section>

<style>
	section {
		max-width: 700px;
		margin: 2em auto;
	}
	h1 {
		font-family: var(--mono);
	}
	.dim {
		color: var(--fg-dim);
	}
	.mono {
		font-family: var(--mono);
	}
	.req {
		color: var(--err);
	}
	form {
		margin-top: 1.5em;
	}
	.row {
		display: grid;
		grid-template-columns: 130px 1fr;
		gap: 0.75em;
		align-items: center;
		margin-bottom: 0.6em;
	}
	.row .hint {
		grid-column: 2;
		color: var(--fg-dim);
		font-size: 0.85em;
		margin-top: -0.3em;
	}
	.label {
		font-family: var(--mono);
	}
	.actions {
		display: flex;
		gap: 0.5em;
		justify-content: flex-end;
		margin-top: 1.5em;
	}
	.result {
		margin-top: 1em;
		padding: 1em;
		background: var(--bg-elev);
		border-radius: 4px;
		border: 1px solid var(--border);
		white-space: pre-wrap;
		font-family: var(--mono);
		font-size: 0.85em;
	}
	.result.ok {
		border-left: 3px solid var(--ok);
	}
	.result.err {
		border-left: 3px solid var(--err);
	}
	code {
		background: var(--bg-elev);
		padding: 0.1em 0.3em;
		border-radius: 3px;
		font-size: 0.85em;
	}
</style>
