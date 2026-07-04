import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import api from '@/services/api';

interface Case {
  id: string;
  status: string;
  slaDueAt?: string;
  openedAt: string;
  claim: { claimNumber: string; status: string };
  owner?: { name: string };
}

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800',
  'on-hold': 'bg-yellow-100 text-yellow-800',
  resolved: 'bg-green-100 text-green-800',
  escalated: 'bg-red-100 text-red-800',
};

export default function CaseList() {
  const [statusFilter, setStatusFilter] = useState('');

  const { data, isLoading } = useQuery<Case[]>({
    queryKey: ['cases', statusFilter],
    queryFn: async () =>
      (await api.get('/cases', { params: statusFilter ? { status: statusFilter } : {} })).data,
  });

  if (isLoading) return <div className="p-6">Loading cases…</div>;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Cases</h1>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm"
        >
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="on-hold">On Hold</option>
          <option value="resolved">Resolved</option>
          <option value="escalated">Escalated</option>
        </select>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Claim</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-left px-4 py-3 font-medium">Owner</th>
              <th className="text-left px-4 py-3 font-medium">SLA due</th>
              <th className="text-left px-4 py-3 font-medium">Opened</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((c) => (
              <tr key={c.id} className="border-t">
                <td className="px-4 py-3 font-mono text-xs">{c.claim.claimNumber}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[c.status] ?? ''}`}>
                    {c.status}
                  </span>
                </td>
                <td className="px-4 py-3">{c.owner?.name ?? '—'}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {c.slaDueAt ? new Date(c.slaDueAt).toLocaleDateString() : '—'}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {new Date(c.openedAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <Link to={`/cases/${c.id}`} className="text-primary text-xs hover:underline">
                    View
                  </Link>
                </td>
              </tr>
            ))}
            {!data?.length && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No cases found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
