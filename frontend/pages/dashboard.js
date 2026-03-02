import { useEffect, useState } from 'react';
import Head from 'next/head';
import Layout from '../components/Layout';
import api from '../lib/api';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';

export default function Dashboard() {
  const [overview, setOverview] = useState(null);
  const [daily,    setDaily]    = useState([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/analytics/overview'),
      api.get('/analytics/daily?days=14'),
    ])
      .then(([ov, dl]) => {
        setOverview(ov.data);
        setDaily(dl.data.map((d) => ({
          ...d,
          day: new Date(d.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        })));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64 text-gray-400">Loading…</div>
      </Layout>
    );
  }

  const stats = [
    { label: 'Total DMs Sent',  value: overview?.total_dms_sent  ?? '—', icon: '📤' },
    { label: 'Success Rate',    value: overview?.success_rate != null ? `${overview.success_rate}%` : '—', icon: '✅' },
    { label: 'DMs This Period', value: overview?.usage?.dm_sent   ?? '—', icon: '📊' },
    { label: 'DM Limit',        value: overview?.usage?.dm_limit  ?? '—', icon: '🔢' },
  ];

  return (
    <Layout>
      <Head><title>Dashboard – GotoDM</title></Head>

      <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map(({ label, value, icon }) => (
          <div key={label} className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <div className="text-2xl mb-2">{icon}</div>
            <div className="text-2xl font-bold text-gray-900">{value}</div>
            <div className="text-sm text-gray-500 mt-1">{label}</div>
          </div>
        ))}
      </div>

      {/* Usage progress */}
      {overview?.usage && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm mb-8">
          <div className="flex justify-between text-sm text-gray-600 mb-2">
            <span>DM Usage this period</span>
            <span>{overview.usage.dm_sent} / {overview.usage.dm_limit}</span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-500 rounded-full transition-all"
              style={{ width: `${Math.min((overview.usage.dm_sent / overview.usage.dm_limit) * 100, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Daily chart */}
      {daily.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm mb-8">
          <h2 className="font-semibold text-gray-700 mb-4">Daily DM Volume (Last 14 days)</h2>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="day" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Area type="monotone" dataKey="sent"   stroke="#a855f7" fill="#f3e8ff" name="Sent" />
              <Area type="monotone" dataKey="failed" stroke="#ef4444" fill="#fee2e2" name="Failed" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Recent activity */}
      {overview?.recent_logs?.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-200">
            <h2 className="font-semibold text-gray-700">Recent Messages</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="px-5 py-3 text-left">Account</th>
                <th className="px-5 py-3 text-left">Type</th>
                <th className="px-5 py-3 text-left">Status</th>
                <th className="px-5 py-3 text-left">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {overview.recent_logs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 text-gray-700">@{log.ig_username}</td>
                  <td className="px-5 py-3 text-gray-500">{log.message_type}</td>
                  <td className="px-5 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      log.status === 'sent'   ? 'bg-green-100 text-green-700' :
                      log.status === 'failed' ? 'bg-red-100 text-red-700'    :
                                                'bg-yellow-100 text-yellow-700'
                    }`}>
                      {log.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-gray-400">
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
}
