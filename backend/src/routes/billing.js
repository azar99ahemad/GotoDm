const express = require('express');
const { authenticate } = require('../middleware/auth');
const {
  createCheckoutSession,
  createPortalSession,
  handleWebhookEvent,
} = require('../services/stripeService');
const { getStripe } = require('../config/stripe');
const { pool } = require('../db');
const logger = require('../config/logger');

const router = express.Router();

// GET /api/billing/plans  →  Public plan listing
router.get('/plans', (req, res) => {
  const { PLANS } = require('../config/stripe');
  const plans = Object.entries(PLANS).map(([key, plan]) => ({
    id: key,
    name: plan.name,
    dmLimit: plan.dmLimit,
    priceId: plan.priceId || null,
  }));
  res.json(plans);
});

// GET /api/billing/subscription  →  Current subscription status
router.get('/subscription', authenticate, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.*, ul.dm_sent, ul.dm_limit, ul.period_start, ul.period_end
     FROM subscriptions s
     LEFT JOIN usage_limits ul
       ON ul.user_id = s.user_id
       AND ul.period_start <= NOW()
       AND ul.period_end   >= NOW()
     WHERE s.user_id = $1
     LIMIT 1`,
    [req.user.id],
  );
  if (rows.length === 0) return res.status(404).json({ error: 'No subscription found' });
  const { stripe_customer_id, ...safe } = rows[0];
  res.json(safe);
});

// POST /api/billing/checkout  →  Create Stripe Checkout session
router.post('/checkout', authenticate, async (req, res) => {
  const { plan } = req.body;
  if (!plan) return res.status(400).json({ error: 'plan is required' });

  try {
    const session = await createCheckoutSession({
      user: req.user,
      plan,
      successUrl: `${process.env.FRONTEND_URL}/billing?success=1`,
      cancelUrl: `${process.env.FRONTEND_URL}/billing`,
    });
    res.json({ url: session.url });
  } catch (err) {
    logger.error('Checkout session error', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// POST /api/billing/portal  →  Create Stripe Customer Portal session
router.post('/portal', authenticate, async (req, res) => {
  try {
    const session = await createPortalSession({
      user: req.user,
      returnUrl: `${process.env.FRONTEND_URL}/billing`,
    });
    res.json({ url: session.url });
  } catch (err) {
    logger.error('Portal session error', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/billing/webhook  →  Stripe webhook handler
 *
 * rawBody is attached by the express raw body middleware (see index.js).
 * Must NOT go through express.json() for signature verification to work.
 */
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const stripe = getStripe();

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    logger.warn('Stripe webhook signature verification failed', { error: err.message });
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  try {
    await handleWebhookEvent(event);
    res.json({ received: true });
  } catch (err) {
    logger.error('Stripe webhook handler error', { error: err.message });
    res.status(500).json({ error: 'Webhook handler error' });
  }
});

module.exports = router;
