import { env } from '$env/dynamic/private';
import { query } from './db';
import gninaSpec from '../../../config/tools/gnina.json' with { type: 'json' };
import boltz2Spec from '../../../config/tools/boltz2.json' with { type: 'json' };
import protenixSpec from '../../../config/tools/protenix.json' with { type: 'json' };

export interface ToolArgSpec {
	type: 'path' | 'number' | 'string' | 'boolean';
	required: boolean;
	default?: unknown;
	description: string;
}

export interface ToolSpec {
	name: string;
	displayName: string;
	version: string;
	description: string;
	license: string;
	upstream: string;
	gpu: string;
	typicalRuntimeSec: number;
	maxRuntimeSec: number;
	endpointEnv: string;
	outputSlots?: number;
	args: Record<string, ToolArgSpec>;
}

const SPECS: Record<string, ToolSpec> = {
	gnina: gninaSpec as ToolSpec,
	boltz2: boltz2Spec as ToolSpec,
	protenix: protenixSpec as ToolSpec
};

export function listTools(): ToolSpec[] {
	return Object.values(SPECS);
}

export function getTool(name: string): ToolSpec | null {
	return SPECS[name] ?? null;
}

export function endpointIdFor(tool: ToolSpec): string {
	const id = (env as Record<string, string | undefined>)[tool.endpointEnv];
	if (!id) throw new Error(`${tool.endpointEnv} not set`);
	return id;
}

/**
 * Return the runtime to use for pre-flight estimates: prefer the recon-worker's
 * p50 from `tool_calibration` when ≥ 5 samples available, else fall back to the
 * static `typicalRuntimeSec` from the JSON config.
 */
export async function calibratedTypicalSec(tool: ToolSpec): Promise<number> {
	try {
		const rows = await query<{ p50_runtime_sec: number; sample_count: number }>(
			'SELECT p50_runtime_sec, sample_count FROM tool_calibration WHERE tool = $1',
			[tool.name]
		);
		if (rows.length && Number(rows[0].sample_count) >= 5) {
			return Number(rows[0].p50_runtime_sec);
		}
	} catch {
		// DB unreachable / table not yet migrated — fall through to static.
	}
	return tool.typicalRuntimeSec;
}
