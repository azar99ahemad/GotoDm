import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Layout from '../../components/Layout';
import RuleBuilder from '../../components/RuleBuilder';
import api from '../../lib/api';

export default function AutomationDetail() {
  const router = useRouter();
  const { id } = router.query;

  const [automation, setAutomation] = useState(null);
  const [rules,      setRules]      = useState([]);
  const [loading,    setLoading]    = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      api.get(`/automations/${id}`),
      api.get(`/automations/${id}/rules`),
    ])
      .then(([auto, rulesRes]) => {
        setAutomation(auto.data);
        setRules(rulesRes.data);
      })
      .catch(() => router.push('/automations'))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleDeleteRule(ruleId) {
    if (!confirm('Delete this rule?')) return;
    await api.delete(`/automations/${id}/rules/${ruleId}`);
    setRules((prev) => prev.filter((r) => r.id !== ruleId));
  }

  if (loading || !automation) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64 text-gray-400">Loading…</div>
      </Layout>
    );
  }

  const triggerLabel = {
    comment_keyword: '💬 Comment Keyword',
    dm_keyword:      '✉️ DM Keyword',
    first_dm:        '👋 First DM',
    story_mention:   '📸 Story Mention',
  }[automation.trigger_type] || automation.trigger_type;

  return (
    <Layout>
      <Head><title>{automation.name} – GotoDM</title></Head>

      <div className="max-w-3xl">
        {/* Header */}
        <div className="mb-6">
          <Link href="/automations" className="text-sm text-brand-600 hover:underline mb-2 inline-block">
            ← Back to Automations
          </Link>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{automation.name}</h1>
              <p className="text-gray-500 text-sm mt-1">
                {triggerLabel} · @{automation.ig_username}
              </p>
            </div>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${
              automation.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
            }`}>
              {automation.is_active ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>

        {/* Rules list */}
        <div className="mb-6">
          <h2 className="font-semibold text-gray-700 mb-3">Rules ({rules.length})</h2>
          {rules.length === 0 ? (
            <p className="text-gray-400 text-sm py-4">No rules yet. Add your first rule below.</p>
          ) : (
            <div className="space-y-3">
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex items-start justify-between gap-4"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      {rule.keyword ? (
                        <span className="bg-brand-100 text-brand-700 text-xs px-2 py-0.5 rounded-full font-mono">
                          {rule.keyword}
                        </span>
                      ) : (
                        <span className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-full">
                          catch-all
                        </span>
                      )}
                      <span className="text-xs text-gray-400">{rule.match_type}</span>
                      <span className="text-xs text-gray-400">→ {rule.action_type.replace('_', ' ')}</span>
                      {rule.delay_seconds > 0 && (
                        <span className="text-xs text-gray-400">⏱ {rule.delay_seconds}s delay</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2">
                      {rule.message_text}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDeleteRule(rule.id)}
                    className="text-red-400 hover:text-red-600 transition-colors text-sm shrink-0"
                    aria-label="Delete rule"
                  >
                    🗑️
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Rule builder */}
        <RuleBuilder
          automationId={id}
          onRuleAdded={(rule) => setRules((prev) => [...prev, rule])}
        />
      </div>
    </Layout>
  );
}
