const { getStripe, PLANS } = require('../config/stripe');
const { pool } = require('../db');
const logger = require('../config/logger');

/**
 * Create or retrieve a Stripe customer for the given user.
 */
async function getOrCreateCustomer(user) {
  const stripe = getStripe();

  const { rows } = await pool.query(
    'SELECT stripe_customer_id FROM subscriptions WHERE user_id = $1 LIMIT 1',
    [user.id],
  );

  if (rows.length > 0 && rows[0].stripe_customer_id) {
    return rows[0].stripe_customer_id;
  }

  const customer = await stripe.customers.create({
    email: user.email,
    name: user.full_name || undefined,
    metadata: { user_id: user.id },
  });

  // Persist (or update) subscription row with customer ID only
  await pool.query(
    `INSERT INTO subscriptions (user_id, stripe_customer_id, plan, status)
     VALUES ($1, $2, 'free', 'active')
     ON CONFLICT (stripe_customer_id) DO NOTHING`,
    [user.id, customer.id],
  );

  return customer.id;
}

/**
 * Create a Stripe Checkout session for a plan upgrade.
 */
async function createCheckoutSession({ user, plan, successUrl, cancelUrl }) {
  const stripe = getStripe();
  const planConfig = PLANS[plan];
  if (!planConfig || !planConfig.priceId) {
    throw new Error(`Invalid plan: ${plan}`);
  }

  const customerId = await getOrCreateCustomer(user);

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: planConfig.priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    allow_promotion_codes: true,
    metadata: { user_id: user.id, plan },
  });

  return session;
}

/**
 * Create a Stripe Customer Portal session for subscription management.
 */
async function createPortalSession({ user, returnUrl }) {
  const stripe = getStripe();
  const customerId = await getOrCreateCustomer(user);

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  return session;
}

/**
 * Handle incoming Stripe webhook events.
 * Keeps the subscriptions and usage_limits tables in sync.
 */
async function handleWebhookEvent(event) {
  const stripe = getStripe();

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      if (session.mode !== 'subscription') break;

      const subscription = await stripe.subscriptions.retrieve(session.subscription);
      await syncSubscription(subscription, session.metadata?.plan);
      break;
    }

    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      await syncSubscription(subscription);
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      await pool.query(
        `UPDATE subscriptions SET status = 'past_due', updated_at = NOW()
         WHERE stripe_subscription_id = $1`,
        [invoice.subscription],
      );
      break;
    }

    default:
      logger.debug('Unhandled Stripe event type', { type: event.type });
  }
}

/**
 * Upsert the subscription row from a Stripe Subscription object.
 */
async function syncSubscription(stripeSub, planOverride) {
  const stripe = getStripe();

  // Determine plan from price metadata or override
  let plan = planOverride;
  if (!plan) {
    const priceId = stripeSub.items.data[0]?.price?.id;
    plan = Object.keys(PLANS).find((k) => PLANS[k].priceId === priceId) || 'free';
  }

  const { rows } = await pool.query(
    'SELECT user_id FROM subscriptions WHERE stripe_customer_id = $1',
    [stripeSub.customer],
  );
  if (rows.length === 0) return;

  const userId = rows[0].user_id;

  await pool.query(
    `UPDATE subscriptions SET
       stripe_subscription_id = $1,
       plan                   = $2,
       status                 = $3,
       current_period_start   = to_timestamp($4),
       current_period_end     = to_timestamp($5),
       cancel_at_period_end   = $6,
       updated_at             = NOW()
     WHERE user_id = $7`,
    [
      stripeSub.id,
      plan,
      stripeSub.status,
      stripeSub.current_period_start,
      stripeSub.current_period_end,
      stripeSub.cancel_at_period_end,
      userId,
    ],
  );

  // Sync usage_limits for the new period
  const dmLimit = PLANS[plan]?.dmLimit || 500;
  await pool.query(
    `INSERT INTO usage_limits (user_id, period_start, period_end, dm_limit)
     VALUES ($1, to_timestamp($2), to_timestamp($3), $4)
     ON CONFLICT (user_id, period_start)
     DO UPDATE SET dm_limit = EXCLUDED.dm_limit, updated_at = NOW()`,
    [userId, stripeSub.current_period_start, stripeSub.current_period_end, dmLimit],
  );

  logger.info('Subscription synced', { userId, plan, status: stripeSub.status });
}

module.exports = {
  getOrCreateCustomer,
  createCheckoutSession,
  createPortalSession,
  handleWebhookEvent,
};
