// Pure helpers over the layout tree — no Svelte runes, no mutation of inputs
// beyond what the callers explicitly do.

import type { PaneNode, SplitNode, LeafNode, Layout, Rect, FocusDir, Orientation } from './types';

let counter = 0;

export function genId(prefix = 'p'): string {
	return `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;
}

export function allLeaves(node: PaneNode): LeafNode[] {
	if (node.type === 'leaf') return [node];
	return node.children.flatMap(allLeaves);
}

export function findLeaf(root: PaneNode, id: string): LeafNode | null {
	for (const l of allLeaves(root)) if (l.id === id) return l;
	return null;
}

export function findSplit(node: PaneNode, id: string): SplitNode | null {
	if (node.type === 'leaf') return null;
	if (node.id === id) return node;
	for (const c of node.children) {
		const found = findSplit(c, id);
		if (found) return found;
	}
	return null;
}

/** Locate a node's parent split + its index within that split. */
export function findParent(
	root: PaneNode,
	id: string
): { parent: SplitNode; index: number } | null {
	if (root.type === 'leaf') return null;
	for (let i = 0; i < root.children.length; i++) {
		if (root.children[i].id === id) return { parent: root, index: i };
		const deeper = findParent(root.children[i], id);
		if (deeper) return deeper;
	}
	return null;
}

/** Geometry of every leaf in [0,1] space, for geometric focus navigation. */
export function computeRects(root: PaneNode): Map<string, Rect> {
	const out = new Map<string, Rect>();
	function rec(node: PaneNode, rect: Rect) {
		if (node.type === 'leaf') {
			out.set(node.id, rect);
			return;
		}
		const horizontal = node.orientation === 'horizontal';
		const total = horizontal ? rect.w : rect.h;
		let offset = horizontal ? rect.x : rect.y;
		node.children.forEach((child, i) => {
			const size = node.sizes[i] * total;
			rec(
				child,
				horizontal
					? { x: offset, y: rect.y, w: size, h: rect.h }
					: { x: rect.x, y: offset, w: rect.w, h: size }
			);
			offset += size;
		});
	}
	rec(root, { x: 0, y: 0, w: 1, h: 1 });
	return out;
}

/** Nearest leaf in a direction from the focused leaf — geometric, i3-like. */
export function focusInDir(layout: Layout, dir: FocusDir): string | null {
	const rects = computeRects(layout.root);
	const cur = rects.get(layout.focusedId);
	if (!cur) return null;
	const cx = cur.x + cur.w / 2;
	const cy = cur.y + cur.h / 2;
	let best: string | null = null;
	let bestDist = Infinity;
	for (const [id, r] of rects) {
		if (id === layout.focusedId) continue;
		const rx = r.x + r.w / 2;
		const ry = r.y + r.h / 2;
		const vBandOverlap = r.y < cy + cur.h / 2 && r.y + r.h > cy - cur.h / 2;
		const hBandOverlap = r.x < cx + cur.w / 2 && r.x + r.w > cx - cur.w / 2;
		let ok = false;
		if (dir === 'left') ok = rx < cx && vBandOverlap;
		else if (dir === 'right') ok = rx > cx && vBandOverlap;
		else if (dir === 'up') ok = ry < cy && hBandOverlap;
		else if (dir === 'down') ok = ry > cy && hBandOverlap;
		if (!ok) continue;
		const d = Math.hypot(rx - cx, ry - cy);
		if (d < bestDist) {
			bestDist = d;
			best = id;
		}
	}
	return best;
}

export function axisOf(dir: FocusDir): Orientation {
	return dir === 'left' || dir === 'right' ? 'horizontal' : 'vertical';
}
