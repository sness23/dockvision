import { env } from '$env/dynamic/private';
import gpuRates from '../../../config/gpu-rates.json' with { type: 'json' };

const MARKUP = Number(env.MARKUP_MULTIPLIER ?? '1.5');
const STORAGE_FREE_GB = Number(env.STORAGE_FREE_GB ?? '5');
const STORAGE_CENTS_PER_GB_MONTH = Number(env.STORAGE_PRICE_CENTS_PER_GB_MONTH ?? '4');

export type GpuClass = keyof typeof gpuRates;

export function gpuRateCentsPerSec(gpu: string): number {
	const rates = gpuRates as unknown as Record<string, { cents_per_sec: number } | string>;
	const rate = rates[gpu];
	if (!rate || typeof rate === 'string') throw new Error(`unknown gpu class: ${gpu}`);
	return rate.cents_per_sec;
}

export function billCents(executionTimeMs: number, gpu: string): number {
	const seconds = executionTimeMs / 1000;
	const raw = seconds * gpuRateCentsPerSec(gpu);
	return Math.ceil(raw * MARKUP);
}

export function estimateCents(typicalRuntimeSec: number, gpu: string): number {
	const raw = typicalRuntimeSec * gpuRateCentsPerSec(gpu);
	return Math.ceil(raw * MARKUP);
}

export function dailyStorageCents(totalBytes: number): number {
	const gb = totalBytes / 1e9;
	const billable = Math.max(0, gb - STORAGE_FREE_GB);
	return Math.ceil((billable * STORAGE_CENTS_PER_GB_MONTH) / 30);
}

export function formatCents(cents: number): string {
	const dollars = cents / 100;
	if (Math.abs(dollars) < 0.01) return `$${dollars.toFixed(4)}`;
	return `$${dollars.toFixed(2)}`;
}

export const config = {
	markup: MARKUP,
	storageFreeBytes: STORAGE_FREE_GB * 1e9,
	storageCentsPerGbMonth: STORAGE_CENTS_PER_GB_MONTH,
	topupMinCents: Number(env.TOPUP_MIN_CENTS ?? '1000')
};
