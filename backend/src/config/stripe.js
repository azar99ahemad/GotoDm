const Stripe = require('stripe');

let stripeClient = null;

function getStripe() {
  if (!stripeClient) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY environment variable is required');
    }
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2023-10-16',
    });
  }
  return stripeClient;
}

const PLANS = {
  free: {
    name: 'Free',
    dmLimit: 500,
    priceId: null,
  },
  starter: {
    name: 'Starter',
    dmLimit: 2000,
    priceId: process.env.STRIPE_PRICE_STARTER,
  },
  pro: {
    name: 'Pro',
    dmLimit: 10000,
    priceId: process.env.STRIPE_PRICE_PRO,
  },
  agency: {
    name: 'Agency',
    dmLimit: 50000,
    priceId: process.env.STRIPE_PRICE_AGENCY,
  },
};

module.exports = { getStripe, PLANS };
