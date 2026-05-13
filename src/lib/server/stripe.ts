import Stripe from 'stripe';
import { env } from '$env/dynamic/private';

let _stripe: Stripe | null = null;

export function stripe(): Stripe {
	if (!_stripe) {
		if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY not set');
		_stripe = new Stripe(env.STRIPE_SECRET_KEY);
	}
	return _stripe;
}

export function topupCheckoutSession(opts: {
	userId: number;
	userEmail: string;
	amountCents: number;
	origin: string;
}) {
	return stripe().checkout.sessions.create({
		mode: 'payment',
		customer_email: opts.userEmail,
		line_items: [
			{
				price_data: {
					currency: 'usd',
					product_data: {
						name: 'DockVision credit',
						description: `Prepaid balance for user ${opts.userId}`
					},
					unit_amount: opts.amountCents
				},
				quantity: 1
			}
		],
		metadata: {
			userId: String(opts.userId),
			kind: 'topup'
		},
		success_url: `${opts.origin}/billing?topup=ok`,
		cancel_url: `${opts.origin}/billing?topup=cancelled`
	});
}
