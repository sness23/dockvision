import { describe, it, expect } from 'vitest';
import { resolveUserPath, s3KeyFor, displayPath, PathError } from './resolve';

describe('resolveUserPath', () => {
	const user = '42';
	const cwd = '/u/42';

	it('resolves absolute paths under the user root', () => {
		expect(resolveUserPath(user, cwd, '/u/42/inputs/p.pdb')).toBe('/u/42/inputs/p.pdb');
	});

	it('resolves relative paths against cwd', () => {
		expect(resolveUserPath(user, '/u/42/inputs', 'p.pdb')).toBe('/u/42/inputs/p.pdb');
	});

	it('normalizes . and ..', () => {
		expect(resolveUserPath(user, '/u/42/inputs/sub', '../p.pdb')).toBe('/u/42/inputs/p.pdb');
	});

	it('rejects escapes via ..', () => {
		expect(() => resolveUserPath(user, cwd, '../99/secret')).toThrow(PathError);
	});

	it('rejects absolute paths into other users', () => {
		expect(() => resolveUserPath(user, cwd, '/u/99/inputs/p.pdb')).toThrow(PathError);
	});

	it('rejects null bytes', () => {
		expect(() => resolveUserPath(user, cwd, 'foo\0bar')).toThrow(PathError);
	});

	it('treats /-prefixed paths as user-root-relative', () => {
		expect(resolveUserPath(user, cwd, '/casp/T1146')).toBe('/u/42/casp/T1146');
		expect(resolveUserPath(user, cwd, '/')).toBe('/u/42');
	});

	it('accepts full /u/<id> paths verbatim', () => {
		expect(resolveUserPath(user, cwd, '/u/42/inputs/x')).toBe('/u/42/inputs/x');
	});

	it('still rejects cross-user explicit paths', () => {
		expect(() => resolveUserPath(user, cwd, '/u/99/x')).toThrow(PathError);
	});
});

describe('displayPath', () => {
	it('strips the user root', () => {
		expect(displayPath('42', '/u/42/casp/T1146')).toBe('/casp/T1146');
		expect(displayPath('42', '/u/42')).toBe('/');
	});

	it('passes through paths outside the root', () => {
		expect(displayPath('42', '/elsewhere')).toBe('/elsewhere');
	});
});

describe('s3KeyFor', () => {
	it('maps virtual paths to per-user S3 keys', () => {
		expect(s3KeyFor('42', '/u/42/inputs/p.pdb')).toBe('u/42/inputs/p.pdb');
	});

	it('refuses cross-user paths', () => {
		expect(() => s3KeyFor('42', '/u/99/inputs/p.pdb')).toThrow(PathError);
	});
});
