import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import Layout from '../components/Layout';
import api from '../lib/api';

export default function Connect() {
  const router  = useRouter();
  const [accounts, setAccounts] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    api.get('/instagram/accounts')
      .then(({ data }) => setAccounts(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleConnect() {
    setConnecting(true);
    try {
      const { data } = await api.get('/instagram/connect');
      window.location.href = data.url;
    } catch (err) {
      alert('Failed to start OAuth flow: ' + (err.response?.data?.error || err.message));
      setConnecting(false);
    }
  }

  async function handleDisconnect(accountId) {
    if (!confirm('Disconnect this Instagram account?')) return;
    await api.delete(`/instagram/accounts/${accountId}`);
    setAccounts((prev) => prev.filter((a) => a.id !== accountId));
  }

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64 text-gray-400">Loading…</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <Head><title>Connect Instagram – GotoDM</title></Head>

      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Connect Instagram</h1>
        <p className="text-gray-500 text-sm mb-6">
          Connect your Instagram Business or Creator account via the official Meta OAuth flow.
          Your account must be linked to a Facebook Page.
        </p>

        {accounts.length > 0 && (
          <div className="space-y-3 mb-8">
            {accounts.map((account) => (
              <div
                key={account.id}
                className="flex items-center justify-between bg-white border border-gray-200 rounded-xl p-4 shadow-sm"
              >
                <div className="flex items-center gap-3">
                  {account.profile_picture_url ? (
                    <img
                      src={account.profile_picture_url}
                      alt={account.username}
                      className="w-10 h-10 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center text-brand-600 font-bold">
                      {account.username?.[0]?.toUpperCase()}
                    </div>
                  )}
                  <div>
                    <p className="font-semibold text-gray-900">@{account.username}</p>
                    <p className="text-xs text-gray-400">
                      {account.name} ·{' '}
                      {account.token_expires_at
                        ? `Token expires ${new Date(account.token_expires_at).toLocaleDateString()}`
                        : 'Token: no expiry'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                    account.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {account.is_active ? 'Active' : 'Inactive'}
                  </span>
                  <button
                    onClick={() => handleDisconnect(account.id)}
                    className="text-sm text-red-400 hover:text-red-600 transition-colors"
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={handleConnect}
          disabled={connecting}
          className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white px-6 py-3 rounded-xl font-medium disabled:opacity-50 transition-colors shadow-sm"
        >
          <span>📸</span>
          {connecting ? 'Redirecting to Meta…' : 'Connect Instagram Account'}
        </button>

        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-700">
          <p className="font-semibold mb-2">Requirements:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>Instagram Business or Creator account</li>
            <li>Connected to a Facebook Page you manage</li>
            <li>instagram_manage_messages permission</li>
            <li>instagram_manage_comments permission</li>
          </ul>
        </div>
      </div>
    </Layout>
  );
}
