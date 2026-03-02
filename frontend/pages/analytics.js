import { useEffect, useState } from 'react';
import Head from 'next/head';
import Layout from '../components/Layout';
import api from '../lib/api';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';

export default function Analytics() {
  const [daily,       setDaily]       = useState([]);
  const [byAuto,      setByAuto]      = useState([]);
  const [loading,     setLoading]     = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/analytics/daily?days=30'),
      api.get('/analytics/automations'),
    ])
      .then(([dl, au]) => {
        setDaily(dl.data.map((d) => ({
          ...d,
          day: new Date(d.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          sent:   parseInt(d.sent, 10)   || 0,
          failed: parseInt(d.failed, 10) || 0,
        })));
        setByAuto(au.data.map((a) => ({
          ...a,
          sent:   parseInt(a.sent, 10)   || 0,
          failed: parseInt(a.failed, 10) || 0,
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

  return (
    <Layout>
      <Head><title>Analytics – GotoDM</title></Head>

      <h1 className="text-2xl font-bold text-gray-900 mb-6">Analytics</h1>

      {/* Daily volume */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm mb-8">
        <h2 className="font-semibold text-gray-700 mb-4">Daily Message Volume (Last 30 days)</h2>
        {daily.length === 0 ? (
          <p className="text-gray-400 text-sm">No data yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="sent"   name="Sent"   fill="#a855f7" radius={[4,4,0,0]} />
              <Bar dataKey="failed" name="Failed" fill="#ef4444" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Per-automation breakdown */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200">
          <h2 className="font-semibold text-gray-700">Performance by Automation</h2>
        </div>
        {byAuto.length === 0 ? (
          <p className="text-gray-400 text-sm p-5">No automation data yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="px-5 py-3 text-left">Automation</th>
                <th className="px-5 py-3 text-left">Trigger</th>
                <th className="px-5 py-3 text-right">Sent</th>
                <th className="px-5 py-3 text-right">Failed</th>
                <th className="px-5 py-3 text-right">Success Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {byAuto.map((a) => {
                const total = a.sent + a.failed;
                const rate  = total > 0 ? Math.round((a.sent / total) * 100) : 100;
                return (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-medium text-gray-800">{a.name}</td>
                    <td className="px-5 py-3 text-gray-500 text-xs">{a.trigger_type}</td>
                    <td className="px-5 py-3 text-right text-green-600 font-mono">{a.sent}</td>
                    <td className="px-5 py-3 text-right text-red-500 font-mono">{a.failed}</td>
                    <td className="px-5 py-3 text-right">
                      <span className={`font-medium ${rate >= 90 ? 'text-green-600' : rate >= 70 ? 'text-yellow-600' : 'text-red-500'}`}>
                        {rate}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Layout>
  );
}
