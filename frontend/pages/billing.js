import { useEffect, useState } from 'react';
import Head from 'next/head';
import Layout from '../components/Layout';
import api from '../lib/api';

const PLAN_FEATURES = {
  free:    { dms: '500 DMs/mo', price: '$0/mo', color: 'gray',   accounts: '1 account' },
  starter: { dms: '2,000 DMs/mo', price: '$29/mo', color: 'blue',   accounts: '3 accounts' },
  pro:     { dms: '10,000 DMs/mo', price: '$79/mo', color: 'purple', accounts: '10 accounts' },
  agency:  { dms: '50,000 DMs/mo', price: '$199/mo', color: 'amber',  accounts: 'Unlimited' },
};

export default function Billing() {
  const [subscription, setSubscription] = useState(null);
  const [plans,        setPlans]        = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [upgrading,    setUpgrading]    = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/billing/subscription'),
      api.get('/billing/plans'),
    ])
      .then(([sub, pl]) => {
        setSubscription(sub.data);
        setPlans(pl.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleUpgrade(planId) {
    if (planId === 'free') return;
    setUpgrading(planId);
    try {
      const { data } = await api.post('/billing/checkout', { plan: planId });
      window.location.href = data.url;
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to start checkout');
      setUpgrading('');
    }
  }

  async function handlePortal() {
    try {
      const { data } = await api.post('/billing/portal');
      window.location.href = data.url;
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to open billing portal');
    }
  }

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64 text-gray-400">Loading…</div>
      </Layout>
    );
  }

  const currentPlan = subscription?.plan || 'free';

  return (
    <Layout>
      <Head><title>Billing – GotoDM</title></Head>

      <div className="max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
          {subscription?.stripe_subscription_id && (
            <button
              onClick={handlePortal}
              className="text-sm border border-gray-300 text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Manage Subscription →
            </button>
          )}
        </div>

        {/* Current usage */}
        {subscription && (
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm mb-8">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm text-gray-500">Current Plan</p>
                <p className="text-xl font-bold text-gray-900 capitalize">{currentPlan}</p>
              </div>
              <span className={`px-3 py-1 text-sm rounded-full font-medium ${
                subscription.status === 'active'   ? 'bg-green-100 text-green-700' :
                subscription.status === 'past_due' ? 'bg-yellow-100 text-yellow-700' :
                                                     'bg-gray-100 text-gray-500'
              }`}>
                {subscription.status}
              </span>
            </div>
            {subscription.dm_limit && (
              <>
                <div className="flex justify-between text-sm text-gray-600 mb-2">
                  <span>DM Usage</span>
                  <span>{subscription.dm_sent || 0} / {subscription.dm_limit}</span>
                </div>
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand-500 rounded-full"
                    style={{ width: `${Math.min(((subscription.dm_sent || 0) / subscription.dm_limit) * 100, 100)}%` }}
                  />
                </div>
              </>
            )}
            {subscription.current_period_end && (
              <p className="text-xs text-gray-400 mt-2">
                Renews {new Date(subscription.current_period_end).toLocaleDateString()}
              </p>
            )}
          </div>
        )}

        {/* Plan cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {plans.map((plan) => {
            const meta = PLAN_FEATURES[plan.id] || {};
            const isCurrent = plan.id === currentPlan;
            return (
              <div
                key={plan.id}
                className={`bg-white border rounded-xl p-5 shadow-sm flex flex-col ${
                  isCurrent ? 'border-brand-500 ring-2 ring-brand-200' : 'border-gray-200'
                }`}
              >
                <div className="mb-4">
                  <h3 className="font-bold text-gray-900 text-lg">{plan.name}</h3>
                  <p className="text-2xl font-bold text-brand-600 mt-1">{meta.price || '—'}</p>
                </div>
                <ul className="text-sm text-gray-600 space-y-2 flex-1 mb-4">
                  <li>✅ {meta.dms}</li>
                  <li>✅ {meta.accounts}</li>
                  <li>✅ Keyword automations</li>
                  <li>✅ Analytics dashboard</li>
                </ul>
                {isCurrent ? (
                  <span className="block text-center text-sm font-medium text-brand-600 bg-brand-50 rounded-lg py-2">
                    Current Plan
                  </span>
                ) : (
                  <button
                    onClick={() => handleUpgrade(plan.id)}
                    disabled={!!upgrading || plan.id === 'free'}
                    className="w-full bg-brand-600 hover:bg-brand-700 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
                  >
                    {upgrading === plan.id ? 'Redirecting…' : plan.id === 'free' ? 'Downgrade' : 'Upgrade'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Layout>
  );
}
