import { env } from '$env/dynamic/private';

const BASE = 'https://api.runpod.ai/v2';

export interface RunpodJob {
	id: string;
	status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT';
	delayTime?: number; // ms in queue
	executionTime?: number; // ms running (billed)
	output?: unknown;
	error?: string;
}

function headers() {
	if (!env.RUNPOD_API_KEY) throw new Error('RUNPOD_API_KEY not set');
	return {
		Authorization: `Bearer ${env.RUNPOD_API_KEY}`,
		'Content-Type': 'application/json'
	};
}

export async function submit(endpointId: string, input: unknown): Promise<RunpodJob> {
	const res = await fetch(`${BASE}/${endpointId}/run`, {
		method: 'POST',
		headers: headers(),
		body: JSON.stringify({ input })
	});
	if (!res.ok) throw new Error(`runpod submit failed: ${res.status} ${await res.text()}`);
	return (await res.json()) as RunpodJob;
}

export async function getStatus(endpointId: string, jobId: string): Promise<RunpodJob> {
	const res = await fetch(`${BASE}/${endpointId}/status/${jobId}`, {
		headers: headers()
	});
	if (!res.ok) throw new Error(`runpod status failed: ${res.status} ${await res.text()}`);
	return (await res.json()) as RunpodJob;
}

export async function cancel(endpointId: string, jobId: string): Promise<void> {
	const res = await fetch(`${BASE}/${endpointId}/cancel/${jobId}`, {
		method: 'POST',
		headers: headers()
	});
	if (!res.ok) throw new Error(`runpod cancel failed: ${res.status} ${await res.text()}`);
}
