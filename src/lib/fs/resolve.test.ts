import { describe, it, expect } from 'vitest';
import { resolveUserPath, s3KeyFor, PathError } from './resolve';

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
});

describe('s3KeyFor', () => {
	it('maps virtual paths to per-user S3 keys', () => {
		expect(s3KeyFor('42', '/u/42/inputs/p.pdb')).toBe('u/42/inputs/p.pdb');
	});

	it('refuses cross-user paths', () => {
		expect(() => s3KeyFor('42', '/u/99/inputs/p.pdb')).toThrow(PathError);
	});
});
