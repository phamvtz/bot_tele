import Stripe from "stripe";

/**
 * Stripe Payment Provider
 * 
 * Implements payment checkout and webhook verification for Stripe.
 * Can be replaced with VNPay, MoMo, etc. by implementing same interface.
 */
export function createStripeProvider() {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    return {
        name: "stripe",

        /**
         * Create a checkout session for payment
         * @param {Object} params - Payment parameters
         * @param {string} params.orderId - Internal order ID
         * @param {number} params.amount - Amount in smallest currency unit
         * @param {string} params.currency - Currency code (VND, USD, etc.)
         * @param {string} params.productName - Product display name
         * @param {number} params.quantity - Quantity purchased
         * @returns {Promise<{checkoutUrl: string, paymentRef: string}>}
         */
        async createCheckout({ orderId, amount, currency, productName, quantity }) {
            const session = await stripe.checkout.sessions.create({
                mode: "payment",
                line_items: [
                    {
                        quantity,
                        price_data: {
                            currency: currency.toLowerCase(),
                            unit_amount: Math.round(amount / quantity), // Unit price
                            product_data: { name: productName },
                        },
                    },
                ],
                metadata: { orderId },
                success_url: `${process.env.BASE_URL}/paid?order=${orderId}`,
                cancel_url: `${process.env.BASE_URL}/cancel?order=${orderId}`,
            });

            return {
                checkoutUrl: session.url,
                paymentRef: session.id
            };
        },

        /**
         * Verify webhook signature and parse event
         * Express route needs raw body: bodyParser.raw({ type: "application/json" })
         * @param {Object} req - Express request object with raw body
         * @returns {Object} Stripe event object
         */
        verifyWebhook(req) {
            const sig = req.headers["stripe-signature"];
            const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

            // Create new Stripe instance for webhook verification
            const stripeVerify = new Stripe(process.env.STRIPE_SECRET_KEY);

            return stripeVerify.webhooks.constructEvent(req.body, sig, webhookSecret);
        },

        /**
         * Extract order ID from webhook event
         * @param {Object} event - Stripe event object
         * @returns {string|null} Order ID or null
         */
        getOrderIdFromEvent(event) {
            if (event.type === "checkout.session.completed") {
                return event.data.object.metadata?.orderId || null;
            }
            return null;
        },

        /**
         * Check if event indicates successful payment
         * @param {Object} event - Stripe event object
         * @returns {boolean}
         */
        isPaymentSuccess(event) {
            return event.type === "checkout.session.completed";
        },
    };
}
