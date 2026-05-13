import { error, redirect } from '@sveltejs/kit';
import { getTool, calibratedTypicalSec } from '$lib/server/tools';
import { estimateCents, formatCents } from '$lib/server/pricing';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const session = await event.locals.auth?.();
	if (!session?.user) throw redirect(303, '/login');

	const tool = getTool(event.params.tool);
	if (!tool) throw error(404, 'unknown tool');

	const typicalSec = await calibratedTypicalSec(tool);
	const estimate = estimateCents(typicalSec, tool.gpu);

	return {
		tool,
		typicalSec,
		estimateCents: estimate,
		estimateText: formatCents(estimate)
	};
};
