import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Layout from '../../components/Layout';
import AutomationCard from '../../components/AutomationCard';
import api from '../../lib/api';

export default function AutomationsIndex() {
  const [automations, setAutomations] = useState([]);
  const [accounts,    setAccounts]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [showCreate,  setShowCreate]  = useState(false);
  const [newForm,     setNewForm]     = useState({
    instagram_account_id: '',
    name: '',
    trigger_type: 'dm_keyword',
  });
  const [creating, setCreating] = useState(false);

  const TRIGGERS = [
    { value: 'comment_keyword', label: '💬 Comment Keyword' },
    { value: 'dm_keyword',      label: '✉️ DM Keyword' },
    { value: 'first_dm',        label: '👋 First DM' },
    { value: 'story_mention',   label: '📸 Story Mention' },
  ];

  useEffect(() => {
    Promise.all([
      api.get('/automations'),
      api.get('/instagram/accounts'),
    ])
      .then(([auto, accts]) => {
        setAutomations(auto.data);
        setAccounts(accts.data);
        if (accts.data.length > 0) {
          setNewForm((p) => ({ ...p, instagram_account_id: accts.data[0].id }));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setCreating(true);
    try {
      const { data } = await api.post('/automations', newForm);
      setAutomations((prev) => [data, ...prev]);
      setShowCreate(false);
      setNewForm((p) => ({ ...p, name: '', trigger_type: 'dm_keyword' }));
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create automation');
    } finally {
      setCreating(false);
    }
  }

  async function handleToggle(automation) {
    const { data } = await api.patch(`/automations/${automation.id}`, {
      is_active: !automation.is_active,
    });
    setAutomations((prev) => prev.map((a) => (a.id === data.id ? data : a)));
  }

  async function handleDelete(id) {
    if (!confirm('Delete this automation?')) return;
    await api.delete(`/automations/${id}`);
    setAutomations((prev) => prev.filter((a) => a.id !== id));
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
      <Head><title>Automations – GotoDM</title></Head>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Automations</h1>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          + New Automation
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <form onSubmit={handleCreate} className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm mb-6 space-y-4">
          <h3 className="font-semibold text-gray-800">New Automation</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                required
                value={newForm.name}
                onChange={(e) => setNewForm((p) => ({ ...p, name: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="e.g. Price Keyword DM"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Instagram Account</label>
              <select
                required
                value={newForm.instagram_account_id}
                onChange={(e) => setNewForm((p) => ({ ...p, instagram_account_id: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>@{a.username}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Trigger</label>
              <select
                value={newForm.trigger_type}
                onChange={(e) => setNewForm((p) => ({ ...p, trigger_type: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                {TRIGGERS.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={creating || accounts.length === 0}
              className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors">
              {creating ? 'Creating…' : 'Create'}
            </button>
            <button type="button" onClick={() => setShowCreate(false)}
              className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">
              Cancel
            </button>
          </div>
          {accounts.length === 0 && (
            <p className="text-sm text-amber-600">
              No Instagram accounts connected.{' '}
              <Link href="/connect" className="underline">Connect one first →</Link>
            </p>
          )}
        </form>
      )}

      {/* Automation list */}
      {automations.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <div className="text-5xl mb-3">⚡</div>
          <p>No automations yet. Create your first one!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {automations.map((automation) => (
            <Link key={automation.id} href={`/automations/${automation.id}`} className="block">
              <AutomationCard
                automation={automation}
                onToggle={(e) => { e.preventDefault && e.preventDefault(); handleToggle(automation); }}
                onDelete={(id) => { handleDelete(id); }}
              />
            </Link>
          ))}
        </div>
      )}
    </Layout>
  );
}
