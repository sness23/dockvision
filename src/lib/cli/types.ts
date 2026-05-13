export interface CmdContext {
	userId: number;
	userEmail: string;
	cwd: string;
	origin: string;
}

export interface TextLine {
	t?: 'normal' | 'dim' | 'ok' | 'warn' | 'err';
	s: string;
}

export type CmdResponse =
	| { type: 'text'; lines: TextLine[] }
	| { type: 'cd'; newCwd: string }
	| { type: 'upload'; targetPath: string; uploadUrl: string }
	| { type: 'redirect'; url: string }
	| { type: 'confirm'; prompt: string; commitToken: string }
	| { type: 'error'; message: string };

export function text(...lines: (string | TextLine)[]): CmdResponse {
	return {
		type: 'text',
		lines: lines.map((l) => (typeof l === 'string' ? { s: l } : l))
	};
}

export function err(message: string): CmdResponse {
	return { type: 'error', message };
}
