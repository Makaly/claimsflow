import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';

interface FeatureFlag {
  id: string;
  key: string;
  description?: string;
  enabled: boolean;
  targetingJsonb: Record<string, unknown>;
  updatedAt: string;
}

export default function FeatureFlagsAdmin() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const { data: flags = [], isLoading } = useQuery<FeatureFlag[]>({
    queryKey: ['feature-flags'],
    queryFn: async () => (await api.get('/feature-flags')).data,
  });

  const toggle = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch(`/feature-flags/${id}`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feature-flags'] }),
  });

  const create = useMutation({
    mutationFn: async () =>
      api.post('/feature-flags', { key: newKey, description: newDesc, enabled: false }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feature-flags'] });
      setNewKey('');
      setNewDesc('');
      setCreating(false);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/feature-flags/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feature-flags'] }),
  });

  if (isLoading) return <div className="p-6">Loading feature flags…</div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Feature Flags</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Canary pattern: set targeting.percentage to roll out gradually.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium"
        >
          New Flag
        </button>
      </div>

      {creating && (
        <div className="border rounded-lg p-4 space-y-3 bg-muted/40">
          <h3 className="font-semibold text-sm">Create flag</h3>
          <input
            className="w-full border rounded px-3 py-1.5 text-sm font-mono"
            placeholder="key (e.g. bulk_approve_v2)"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
          />
          <input
            className="w-full border rounded px-3 py-1.5 text-sm"
            placeholder="description"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              onClick={() => create.mutate()}
              disabled={!newKey || create.isPending}
              className="px-3 py-1.5 bg-primary text-primary-foreground rounded text-sm"
            >
              Create
            </button>
            <button
              onClick={() => setCreating(false)}
              className="px-3 py-1.5 border rounded text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Key</th>
              <th className="text-left px-4 py-3 font-medium">Description</th>
              <th className="text-left px-4 py-3 font-medium">Targeting</th>
              <th className="text-left px-4 py-3 font-medium">Enabled</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {flags.map((flag) => (
              <tr key={flag.id} className="border-t">
                <td className="px-4 py-3 font-mono text-xs">{flag.key}</td>
                <td className="px-4 py-3 text-muted-foreground">{flag.description ?? '—'}</td>
                <td className="px-4 py-3">
                  <pre className="text-xs whitespace-pre-wrap break-all max-w-xs">
                    {JSON.stringify(flag.targetingJsonb, null, 2)}
                  </pre>
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => toggle.mutate({ id: flag.id, enabled: !flag.enabled })}
                    className={`px-3 py-1 rounded-full text-xs font-medium ${
                      flag.enabled
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {flag.enabled ? 'ON' : 'OFF'}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => {
                      if (confirm(`Delete flag '${flag.key}'?`)) remove.mutate(flag.id);
                    }}
                    className="text-destructive text-xs hover:underline"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {flags.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No feature flags yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
