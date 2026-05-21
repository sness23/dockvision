import { parse as shellTokenize } from 'shell-quote';
import { text, err, type CmdContext, type CmdResponse } from './types';
import * as account from './account';
import * as fs from './fs';
import * as toolsCmd from './tools-cmd';
import * as jobs from './jobs';
import * as keysCmd from './keys';
import { seed } from './seed';

type Handler = (argv: string[], ctx: CmdContext) => Promise<CmdResponse>;

const COMMANDS: Record<string, { run: Handler; help: string }> = {
	// account
	whoami: { run: account.whoami, help: 'show your account info + balance' },
	cost: { run: account.cost, help: 'show balance + month-to-date spend' },
	topup: { run: account.topup, help: 'top up balance via Stripe' },
	// fs
	ls: { run: fs.ls, help: 'list files' },
	cd: { run: fs.cd, help: 'change directory' },
	pwd: { run: fs.pwd, help: 'print current directory' },
	cat: { run: fs.cat, help: 'print file contents' },
	du: { run: fs.du, help: 'storage usage' },
	pin: { run: fs.pin, help: 'mark file immune from auto-expiry' },
	unpin: { run: fs.unpin, help: 'reverse pin' },
	rm: { run: fs.rm, help: 'delete file' },
	mv: { run: fs.mv, help: 'rename / move a file' },
	cp: { run: fs.cp, help: 'copy a file (S3 server-side)' },
	upload: { run: fs.upload, help: 'upload a local file (opens picker)' },
	download: { run: fs.download, help: 'download a file to local disk' },
	// tools
	tools: { run: toolsCmd.toolsList, help: 'list available tools + costs' },
	tool: { run: toolsCmd.toolInfo, help: 'show tool details + args' },
	// jobs
	run: { run: jobs.run, help: 'submit a docking job' },
	jobs: { run: jobs.list, help: 'list your jobs' },
	status: { run: jobs.status, help: 'show job status' },
	cancel: { run: jobs.cancel, help: 'cancel a running job' },
	log: { run: jobs.log, help: 'show job log' },
	// account / api keys
	keys: { run: keysCmd.keys, help: 'manage API keys (list/create/revoke)' },
	// viewer
	view: { run: fs.view, help: 'open a structure file or job result in Mol* viewer' },
	// seeding (dev / vault-equipped instances only)
	seed: { run: seed, help: 'seed a CASP target into /casp/ (seed casp <target>)' }
};

export async function dispatch(line: string, ctx: CmdContext): Promise<CmdResponse> {
	const trimmed = line.trim();
	if (!trimmed) return text();

	// Built-ins not in COMMANDS
	if (trimmed === 'help' || trimmed.startsWith('help ')) return helpCmd(trimmed.slice(4).trim());
	if (trimmed === 'clear') return text();

	const tokens = shellTokenize(trimmed).filter((t) => typeof t === 'string') as string[];
	const [cmd, ...argv] = tokens;
	const entry = COMMANDS[cmd];
	if (!entry) return err(`unknown command: ${cmd}  (try 'help')`);
	try {
		return await entry.run(argv, ctx);
	} catch (e) {
		console.error(`[cli] ${cmd} failed:`, e);
		return err((e as Error).message || 'unknown error');
	}
}

function helpCmd(query: string): CmdResponse {
	if (query) {
		const entry = COMMANDS[query];
		if (!entry) return err(`unknown command: ${query}`);
		return text({ s: `${query} — ${entry.help}` });
	}
	const lines = Object.entries(COMMANDS).map(([name, e]) => ({
		s: `  ${name.padEnd(10)} ${e.help}`
	}));
	return text(
		{ s: 'commands:' },
		...lines,
		{ s: '' },
		{ s: "type 'help <cmd>' for one-line detail." }
	);
}
