import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/services/api';

interface InstallStatus {
  mode: 'standalone' | 'managed';
  installationId: string;
  status: 'UNLICENSED' | 'ACTIVE' | 'LOCKED' | 'SUSPENDED' | 'REVOKED';
  locked: boolean;
  plan: string | null;
  leaseExpiresAt: string | null;
  lastValidatedAt: string | null;
  daysSinceValidation: number | null;
  lastError: string | null;
  reason?: string;
}

interface InstallationRow {
  id: string;
  label: string | null;
  hostname: string | null;
  version: string | null;
  plan: string;
  status: string;
  lastSeenAt: string | null;
  lastSeenIp: string | null;
  expiresAt: string | null;
  leaseTtlHours: number;
}

interface ActivationKeyRow {
  id: string;
  key: string;
  plan: string;
  status: 'UNUSED' | 'USED' | 'REVOKED';
  maxActivations: number;
  usedCount: number;
  boundInstallationId: string | null;
  issuedTo: string | null;
  termDays: number;
  expiresAt: string | null;
  createdAt: string;
}

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-800',
  UNLICENSED: 'bg-brand-100 text-brand-800',
  LOCKED: 'bg-red-100 text-red-700',
  SUSPENDED: 'bg-amber-100 text-amber-800',
  REVOKED: 'bg-gray-200 text-gray-600',
  USED: 'bg-green-100 text-green-800',
  UNUSED: 'bg-brand-100 text-brand-800',
};

const fmt = (s: string | null) =>
  s ? new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const leaseDays = (s: string | null) =>
  s ? Math.max(0, Math.ceil((new Date(s).getTime() - Date.now()) / 86_400_000)) : null;

export default function InstallationLicense() {
  const qc = useQueryClient();
  const [activationKey, setActivationKey] = useState('');
  const [label, setLabel] = useState('');

  // Key-generation form
  const [genPlan, setGenPlan] = useState<'core' | 'pro' | 'enterprise'>('pro');
  const [genCount, setGenCount] = useState(1);
  const [genTermDays, setGenTermDays] = useState(365);
  const [genMaxActivations, setGenMaxActivations] = useState(1);
  const [genIssuedTo, setGenIssuedTo] = useState('');

  const { data: status } = useQuery<InstallStatus>({
    queryKey: ['installation', 'status'],
    queryFn: async () => (await api.get('/installation/status')).data,
    refetchInterval: 30_000,
  });

  // License-server admin views. These return [] on a client-only node where the
  // server tables are empty — harmless.
  const { data: installs = [] } = useQuery<InstallationRow[]>({
    queryKey: ['installation', 'server', 'installations'],
    queryFn: async () => (await api.get('/license-server/installations')).data,
    retry: false,
  });
  const { data: keys = [] } = useQuery<ActivationKeyRow[]>({
    queryKey: ['installation', 'server', 'keys'],
    queryFn: async () => (await api.get('/license-server/keys')).data,
    retry: false,
  });

  const activate = useMutation({
    mutationFn: async () =>
      (await api.post('/installation/activate', { activationKey: activationKey.trim(), label: label.trim() || undefined })).data,
    onSuccess: () => {
      toast.success('Installation activated');
      setActivationKey('');
      qc.invalidateQueries({ queryKey: ['installation'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Activation failed'),
  });

  const checkIn = useMutation({
    mutationFn: async () => (await api.post('/installation/heartbeat-now', {})).data,
    onSuccess: (r: { ok: boolean; reason?: string }) => {
      if (r.ok) toast.success('Checked in — lease refreshed');
      else toast.error(`Check-in failed: ${r.reason ?? 'unreachable'}`);
      qc.invalidateQueries({ queryKey: ['installation'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Check-in failed'),
  });

  const genKeys = useMutation({
    mutationFn: async () =>
      (
        await api.post('/license-server/keys', {
          plan: genPlan,
          count: genCount,
          termDays: genTermDays,
          maxActivations: genMaxActivations,
          issuedTo: genIssuedTo.trim() || undefined,
        })
      ).data,
    onSuccess: (created: ActivationKeyRow[]) => {
      toast.success(`Generated ${created.length} activation key(s)`);
      setGenIssuedTo('');
      qc.invalidateQueries({ queryKey: ['installation', 'server', 'keys'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Generation failed'),
  });

  const setInstallStatus = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'suspend' | 'resume' | 'revoke' }) =>
      api.post(`/license-server/installations/${id}/${action}`),
    onSuccess: () => {
      toast.success('Installation updated');
      qc.invalidateQueries({ queryKey: ['installation', 'server'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Update failed'),
  });

  const revokeKey = useMutation({
    mutationFn: (id: string) => api.post(`/license-server/keys/${id}/revoke`),
    onSuccess: () => {
      toast.success('Key revoked');
      qc.invalidateQueries({ queryKey: ['installation', 'server', 'keys'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Revoke failed'),
  });

  const copyKey = (k: string) => {
    navigator.clipboard?.writeText(k).then(
      () => toast.success('Key copied'),
      () => undefined,
    );
  };

  const lease = leaseDays(status?.leaseExpiresAt ?? null);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Installation &amp; Licence</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Track installations of the system, activate them with an online key, and manage the central licence
          server. Each install phones home periodically; if it can&apos;t reach the server for ~7 days its lease
          lapses and it locks until it reconnects.
        </p>
      </div>

      {/* ── This installation ─────────────────────────────────────────── */}
      <div className="border rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="font-semibold text-sm">This installation</h2>
          <button
            onClick={() => checkIn.mutate()}
            disabled={checkIn.isPending || status?.mode === 'standalone'}
            className="px-3 py-1.5 border rounded-md text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            {checkIn.isPending ? 'Checking in…' : '⟳ Check in now'}
          </button>
        </div>

        {status?.mode === 'standalone' && (
          <div className="text-xs bg-muted/50 border rounded p-3 text-muted-foreground">
            This node is <strong>standalone</strong> — no licence server is configured (<code>LICENSE_SERVER_URL</code>{' '}
            unset), so it never locks. Set that env var on customer installs to enforce phone-home licensing.
          </div>
        )}

        {status?.locked && status?.mode === 'managed' && (
          <div className="border border-red-200 bg-red-50 text-red-800 rounded p-3 text-sm">
            <strong>Installation inactive.</strong> {status.reason === 'lease_expired_offline'
              ? 'It has not validated its licence within the required window. Reconnect to the internet and check in.'
              : status.reason === 'not_activated'
              ? 'This installation has not been activated yet — enter an activation key below.'
              : `Locked (${status.reason}).`}
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card label="Status">
            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[status?.status ?? 'UNLICENSED']}`}>
              {status?.status ?? '—'}
            </span>
          </Card>
          <Card label="Plan">{(status?.plan ?? '—').toUpperCase()}</Card>
          <Card label="Lease valid for">{lease === null ? '—' : `${lease} day${lease === 1 ? '' : 's'}`}</Card>
          <Card label="Last check-in">
            <span className="text-sm">
              {status?.daysSinceValidation === null || status?.daysSinceValidation === undefined
                ? '—'
                : status.daysSinceValidation === 0
                ? 'today'
                : `${status.daysSinceValidation}d ago`}
            </span>
          </Card>
        </div>

        <p className="text-xs text-muted-foreground">
          Installation ID: <span className="font-mono">{status?.installationId ?? '—'}</span>
          {status?.leaseExpiresAt && <> · Lease expires {fmt(status.leaseExpiresAt)}</>}
          {status?.lastError && <> · <span className="text-red-600">Last error: {status.lastError}</span></>}
        </p>

        {/* Activation */}
        <div className="border-t pt-4 space-y-2">
          <h3 className="text-sm font-medium">Activate with an online key</h3>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={activationKey}
              onChange={(e) => setActivationKey(e.target.value)}
              placeholder="CICX-PRO-XXXX-XXXX-XXXX-XXXX"
              className="flex-1 border rounded px-3 py-2 text-sm font-mono bg-background"
            />
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label (optional, e.g. CIC HQ)"
              className="sm:w-56 border rounded px-3 py-2 text-sm bg-background"
            />
            <button
              onClick={() => activate.mutate()}
              disabled={!activationKey.trim() || activate.isPending || status?.mode === 'standalone'}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50"
            >
              {activate.isPending ? 'Activating…' : 'Activate'}
            </button>
          </div>
        </div>
      </div>

      {/* ── License server: installations ─────────────────────────────── */}
      <div className="border rounded-lg overflow-hidden">
        <div className="px-4 py-3 bg-muted/50 font-semibold text-sm flex items-center justify-between">
          <span>Installations (license server)</span>
          <span className="text-xs font-normal text-muted-foreground">{installs.length} registered</span>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/30">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Installation</th>
              <th className="text-left px-4 py-2 font-medium">Host</th>
              <th className="text-left px-4 py-2 font-medium">Plan</th>
              <th className="text-left px-4 py-2 font-medium">Status</th>
              <th className="text-left px-4 py-2 font-medium">Last seen</th>
              <th className="text-right px-4 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {installs.map((i) => {
              const ageMs = i.lastSeenAt ? Date.now() - new Date(i.lastSeenAt).getTime() : Infinity;
              const stale = ageMs > i.leaseTtlHours * 3_600_000;
              return (
                <tr key={i.id} className="border-t">
                  <td className="px-4 py-2">
                    <div>{i.label || '—'}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">{i.id.slice(0, 12)}…</div>
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {i.hostname || '—'}
                    {i.version && <span className="text-muted-foreground"> · v{i.version}</span>}
                  </td>
                  <td className="px-4 py-2 uppercase text-xs">{i.plan}</td>
                  <td className="px-4 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[i.status]}`}>{i.status}</span>
                    {!stale ? (
                      <span className="ml-1 text-[10px] text-green-600">● online</span>
                    ) : (
                      <span className="ml-1 text-[10px] text-muted-foreground">● stale</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs">{fmt(i.lastSeenAt)}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap space-x-3">
                    {i.status === 'SUSPENDED' ? (
                      <button onClick={() => setInstallStatus.mutate({ id: i.id, action: 'resume' })} className="text-green-600 text-xs hover:underline">
                        Resume
                      </button>
                    ) : (
                      i.status !== 'REVOKED' && (
                        <button onClick={() => setInstallStatus.mutate({ id: i.id, action: 'suspend' })} className="text-amber-600 text-xs hover:underline">
                          Suspend
                        </button>
                      )
                    )}
                    {i.status !== 'REVOKED' && (
                      <button
                        onClick={() => {
                          if (confirm(`Revoke installation ${i.label || i.id.slice(0, 12)}? It will lock on next check-in.`))
                            setInstallStatus.mutate({ id: i.id, action: 'revoke' });
                        }}
                        className="text-destructive text-xs hover:underline"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {installs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No installations have activated against this server yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── License server: activation keys ───────────────────────────── */}
      <div className="border rounded-lg p-4 space-y-3">
        <h2 className="font-semibold text-sm">Generate activation keys</h2>
        <p className="text-xs text-muted-foreground">
          Mint keys to hand to deployments. Each binds to the first installation that activates with it (up to its
          activation limit) and grants the chosen plan for the term.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <Field label="Plan">
            <select value={genPlan} onChange={(e) => setGenPlan(e.target.value as any)} className="w-full border rounded px-2 py-1.5 text-sm bg-background">
              <option value="core">Core</option>
              <option value="pro">Professional</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </Field>
          <Field label="How many">
            <input type="number" min={1} max={100} value={genCount} onChange={(e) => setGenCount(Number(e.target.value))} className="w-full border rounded px-2 py-1.5 text-sm bg-background" />
          </Field>
          <Field label="Term (days)">
            <input type="number" min={1} value={genTermDays} onChange={(e) => setGenTermDays(Number(e.target.value))} className="w-full border rounded px-2 py-1.5 text-sm bg-background" />
          </Field>
          <Field label="Activations/key">
            <input type="number" min={1} value={genMaxActivations} onChange={(e) => setGenMaxActivations(Number(e.target.value))} className="w-full border rounded px-2 py-1.5 text-sm bg-background" />
          </Field>
          <Field label="Issued to (optional)">
            <input type="text" value={genIssuedTo} onChange={(e) => setGenIssuedTo(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm bg-background" />
          </Field>
        </div>
        <button onClick={() => genKeys.mutate()} disabled={genKeys.isPending} className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50">
          {genKeys.isPending ? 'Generating…' : 'Generate keys'}
        </button>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <div className="px-4 py-3 bg-muted/50 font-semibold text-sm">Activation keys</div>
        <table className="w-full text-sm">
          <thead className="bg-muted/30">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Key</th>
              <th className="text-left px-4 py-2 font-medium">Plan</th>
              <th className="text-left px-4 py-2 font-medium">Usage</th>
              <th className="text-left px-4 py-2 font-medium">Issued to</th>
              <th className="text-left px-4 py-2 font-medium">Status</th>
              <th className="text-right px-4 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} className="border-t">
                <td className="px-4 py-2 font-mono text-xs">
                  <button onClick={() => copyKey(k.key)} className="hover:underline" title="Copy">
                    {k.key}
                  </button>
                </td>
                <td className="px-4 py-2 uppercase text-xs">{k.plan}</td>
                <td className="px-4 py-2 text-xs">{k.usedCount}/{k.maxActivations} · {k.termDays}d</td>
                <td className="px-4 py-2 text-muted-foreground text-xs">{k.issuedTo ?? '—'}</td>
                <td className="px-4 py-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[k.status]}`}>{k.status}</span>
                </td>
                <td className="px-4 py-2 text-right">
                  {k.status !== 'REVOKED' && (
                    <button onClick={() => revokeKey.mutate(k.id)} className="text-destructive text-xs hover:underline">
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {keys.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No activation keys yet. Generate some above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border rounded-lg p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-lg font-bold mt-1">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="text-xs space-y-1 block">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
