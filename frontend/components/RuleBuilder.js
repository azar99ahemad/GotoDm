import { useState } from 'react';
import api from '../lib/api';

const MATCH_TYPES  = ['contains', 'exact', 'starts_with', 'regex'];
const ACTION_TYPES = ['send_dm', 'reply_comment'];

export default function RuleBuilder({ automationId, onRuleAdded }) {
  const [form, setForm] = useState({
    keyword:      '',
    match_type:   'contains',
    action_type:  'send_dm',
    message_text: '',
    delay_seconds: 0,
    priority:     0,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        keyword:       form.keyword.trim() || null,
        delay_seconds: parseInt(form.delay_seconds, 10) || 0,
        priority:      parseInt(form.priority, 10) || 0,
      };
      const { data } = await api.post(`/automations/${automationId}/rules`, payload);
      onRuleAdded(data);
      setForm({ keyword: '', match_type: 'contains', action_type: 'send_dm', message_text: '', delay_seconds: 0, priority: 0 });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save rule');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-gray-50 border border-gray-200 rounded-xl p-5 space-y-4">
      <h4 className="font-semibold text-gray-700">Add New Rule</h4>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="grid grid-cols-2 gap-4">
        {/* Keyword */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Keyword <span className="text-gray-400 text-xs">(leave blank for catch-all)</span>
          </label>
          <input
            type="text"
            name="keyword"
            value={form.keyword}
            onChange={handleChange}
            placeholder="e.g. price, info, buy"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        {/* Match type */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Match Type</label>
          <select
            name="match_type"
            value={form.match_type}
            onChange={handleChange}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {MATCH_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        {/* Action type */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Action</label>
          <select
            name="action_type"
            value={form.action_type}
            onChange={handleChange}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {ACTION_TYPES.map((t) => (
              <option key={t} value={t}>{t.replace('_', ' ')}</option>
            ))}
          </select>
        </div>

        {/* Delay */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Delay (seconds)</label>
          <input
            type="number"
            name="delay_seconds"
            value={form.delay_seconds}
            onChange={handleChange}
            min={0}
            max={3600}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
      </div>

      {/* Message text */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Reply Message <span className="text-gray-400 text-xs">Supports {'{'} name {'}'} and {'{'} username {'}'}</span>
        </label>
        <textarea
          name="message_text"
          value={form.message_text}
          onChange={handleChange}
          rows={3}
          required
          placeholder="Hi {name}! Thanks for reaching out..."
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>

      <button
        type="submit"
        disabled={saving}
        className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
      >
        {saving ? 'Saving…' : '+ Add Rule'}
      </button>
    </form>
  );
}
