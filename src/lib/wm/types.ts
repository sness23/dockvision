// Tiling window-manager layout model — an i3-style tree of split containers
// and leaf panes. Serializable (no DOM refs, no parent pointers).

export type Orientation = 'horizontal' | 'vertical';
export type LeafKind = 'terminal' | 'viewer';
export type FocusDir = 'left' | 'right' | 'up' | 'down';

export interface ViewerProps {
	structures: { url: string; format: string; label: string }[];
	title: string;
}

/** Loosely-typed handle on a Mol* Viewer instance (the vendored bundle has no types). */
export interface MolViewerHandle {
	loadStructureFromUrl?: (url: string, format: string) => Promise<unknown>;
	loadPdb?: (id: string) => unknown;
	handleResize?: () => void;
	plugin?: {
		clear?: () => Promise<unknown> | unknown;
		canvas3d?: { handleResize?: () => void; setProps?: (p: unknown) => void };
		managers?: { camera?: { reset?: () => void } };
	};
	dispose?: () => void;
}

export interface LeafNode {
	type: 'leaf';
	id: string;
	kind: LeafKind;
	/** present when kind === 'viewer' */
	viewer?: ViewerProps;
}

export interface SplitNode {
	type: 'split';
	id: string;
	orientation: Orientation;
	children: PaneNode[];
	/** fractions, one per child, summing to ~1 */
	sizes: number[];
}

export type PaneNode = SplitNode | LeafNode;

export interface Layout {
	root: PaneNode;
	focusedId: string;
}

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}
