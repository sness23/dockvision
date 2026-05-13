import { error, text as textResponse } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { stripe } from '$lib/server/stripe';
import { topupIfNew } from '$lib/server/balance';
import type { RequestHandler } from './$types';
import type Stripe from 'stripe';

export const POST: RequestHandler = async (event) => {
	const sig = event.request.headers.get('stripe-signature');
	if (!sig) throw error(400, 'missing stripe-signature');
	if (!env.STRIPE_WEBHOOK_SECRET) throw error(500, 'STRIPE_WEBHOOK_SECRET not set');

	const rawBody = await event.request.text();
	let evt: Stripe.Event;
	try {
		evt = stripe().webhooks.constructEvent(rawBody, sig, env.STRIPE_WEBHOOK_SECRET);
	} catch (e) {
		throw error(400, `webhook signature failed: ${(e as Error).message}`);
	}

	if (evt.type === 'checkout.session.completed') {
		const session = evt.data.object as Stripe.Checkout.Session;
		const userId = Number(session.metadata?.userId);
		const kind = session.metadata?.kind;
		if (kind === 'topup' && userId && session.amount_total && session.payment_intent) {
			const pi =
				typeof session.payment_intent === 'string'
					? session.payment_intent
					: session.payment_intent.id;
			const result = await topupIfNew({
				userId,
				amountCents: session.amount_total,
				stripePaymentIntent: pi,
				description: `Stripe top-up · $${(session.amount_total / 100).toFixed(2)}`
			});
			console.log(
				`[stripe-webhook] topup user=${userId} applied=${result.applied} new=${result.newBalance}`
			);
		}
	}

	return textResponse('ok');
};
