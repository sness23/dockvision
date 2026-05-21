// WmStore — the live, reactive window-manager state. Created by Workspace,
// shared with descendants via Svelte context.

import type { Layout, LeafNode, PaneNode, Orientation, FocusDir, ViewerProps } from './types';
import { genId, allLeaves, findLeaf, findParent, findSplit, focusInDir, axisOf } from './layout';

export class WmStore {
	layout = $state<Layout>({ root: { type: 'leaf', id: '', kind: 'terminal' }, focusedId: '' });
	userId = $state(0);
	userEmail = $state('');

	constructor(persisted?: Layout | null) {
		const validated = persisted && validateLayout(persisted);
		if (validated) {
			this.layout = validated;
		} else {
			const id = genId('term');
			this.layout = { root: { type: 'leaf', id, kind: 'terminal' }, focusedId: id };
		}
	}

	/** JSON-serializable snapshot of the layout. Viewer pane content (presigned
	 *  URLs that expire) is dropped — only kind + title is retained. */
	serialize(): string {
		function strip(node: PaneNode): PaneNode {
			if (node.type === 'leaf') {
				if (node.kind === 'viewer') {
					return {
						type: 'leaf',
						id: node.id,
						kind: 'viewer',
						viewer: { structures: [], title: node.viewer?.title ?? '' }
					};
				}
				return { type: 'leaf', id: node.id, kind: node.kind };
			}
			return {
				type: 'split',
				id: node.id,
				orientation: node.orientation,
				children: node.children.map(strip),
				sizes: [...node.sizes]
			};
		}
		return JSON.stringify({ root: strip(this.layout.root), focusedId: this.layout.focusedId });
	}

	openJobsMonitor() {
		const existing = allLeaves(this.layout.root).find((l) => l.kind === 'jobs');
		if (existing) {
			this.layout.focusedId = existing.id;
			return;
		}
		const pane: LeafNode = { type: 'leaf', id: genId('jobs'), kind: 'jobs' };
		this.splitWith(this.layout.focusedId, 'vertical', pane);
		this.layout.focusedId = pane.id;
	}

	get focusedKind(): string {
		return findLeaf(this.layout.root, this.layout.focusedId)?.kind ?? 'terminal';
	}

	focus(id: string) {
		if (findLeaf(this.layout.root, id)) this.layout.focusedId = id;
	}

	focusDir(dir: FocusDir) {
		const id = focusInDir(this.layout, dir);
		if (id) this.layout.focusedId = id;
	}

	/** Open (or refocus + reload) the single viewer pane. */
	openViewer(structures: ViewerProps['structures'], title: string) {
		const existing = allLeaves(this.layout.root).find((l) => l.kind === 'viewer');
		if (existing) {
			existing.viewer = { structures, title };
			this.layout.focusedId = existing.id;
			return;
		}
		const viewer: LeafNode = {
			type: 'leaf',
			id: genId('view'),
			kind: 'viewer',
			viewer: { structures, title }
		};
		this.splitWith(this.layout.focusedId, 'horizontal', viewer);
		this.layout.focusedId = viewer.id;
	}

	/** Insert newLeaf next to targetId, splitting in `orientation`. New leaf goes after. */
	splitWith(targetId: string, orientation: Orientation, newLeaf: PaneNode) {
		const found = findParent(this.layout.root, targetId);
		if (!found) {
			// target is the root
			this.layout.root = {
				type: 'split',
				id: genId('split'),
				orientation,
				children: [this.layout.root, newLeaf],
				sizes: [0.5, 0.5]
			};
			return;
		}
		const { parent, index } = found;
		if (parent.orientation === orientation) {
			const share = parent.sizes[index] / 2;
			parent.sizes[index] = share;
			parent.children.splice(index + 1, 0, newLeaf);
			parent.sizes.splice(index + 1, 0, share);
		} else {
			const target = parent.children[index];
			parent.children[index] = {
				type: 'split',
				id: genId('split'),
				orientation,
				children: [target, newLeaf],
				sizes: [0.5, 0.5]
			};
		}
	}

	closeFocused() {
		const id = this.layout.focusedId;
		const found = findParent(this.layout.root, id);
		if (!found) return; // root leaf — never close the last pane
		const { parent, index } = found;
		parent.children.splice(index, 1);
		parent.sizes.splice(index, 1);
		const sum = parent.sizes.reduce((a, b) => a + b, 0) || 1;
		parent.sizes = parent.sizes.map((s) => s / sum);
		this.collapse();
		const remaining = allLeaves(this.layout.root);
		this.layout.focusedId = remaining[Math.min(index, remaining.length - 1)].id;
	}

	/** Collapse any split that ended up with a single child. */
	private collapse() {
		function rec(node: PaneNode): PaneNode {
			if (node.type === 'leaf') return node;
			node.children = node.children.map(rec);
			return node.children.length === 1 ? node.children[0] : node;
		}
		this.layout.root = rec(this.layout.root);
	}

	setSizes(splitId: string, sizes: number[]) {
		const split = findSplit(this.layout.root, splitId);
		if (split) split.sizes = sizes;
	}

	/** Grow/shrink the focused pane along a direction (keyboard resize). */
	resizeFocused(dir: FocusDir, delta = 0.04) {
		const axis = axisOf(dir);
		let childId = this.layout.focusedId;
		// walk up until we find a split on the right axis
		for (;;) {
			const found = findParent(this.layout.root, childId);
			if (!found) return;
			const { parent, index } = found;
			if (parent.orientation === axis) {
				const grow = dir === 'right' || dir === 'down' ? delta : -delta;
				const nb = index + (grow > 0 ? 1 : -1);
				if (nb < 0 || nb >= parent.sizes.length) return;
				const move = Math.min(Math.abs(grow), parent.sizes[nb] - 0.08);
				if (move <= 0) return;
				const s = grow > 0 ? move : -move;
				parent.sizes[index] += s;
				parent.sizes[nb] -= s;
				return;
			}
			childId = parent.id;
		}
	}
}

/** Walk a candidate layout — accept only if it has at least one terminal leaf
 *  and a focused id pointing somewhere real. Repairs the focusedId if it's stale. */
function validateLayout(parsed: unknown): Layout | null {
	try {
		const l = parsed as Layout;
		if (!l || !l.root) return null;
		const leaves = allLeaves(l.root);
		if (!leaves.some((leaf) => leaf.kind === 'terminal')) return null;
		if (!leaves.some((leaf) => leaf.id === l.focusedId)) {
			const t = leaves.find((leaf) => leaf.kind === 'terminal');
			if (!t) return null;
			l.focusedId = t.id;
		}
		return l;
	} catch {
		return null;
	}
}
