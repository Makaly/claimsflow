import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/services/api';

interface UsageRow {
  metric: string;
  used: number;
  limit: number | null; // null = unlimited
}

interface UsageSummary {
  tenantId: string | null;
  plan: 'core' | 'pro' | 'enterprise';
  status: 'active' | 'grace' | 'expired' | 'revoked' | 'unlicensed';
  enforcement: 'report' | 'enforce';
  expiresAt: string | null;
  features: string[];
  period: string;
  usage: UsageRow[];
}

interface LicenseInfo {
  tenantId: string;
  tenantName: string;
  licenseKey: string | null;
  plan: 'core' | 'pro' | 'enterprise';
  licenseType: 'TRIAL' | 'CORE' | 'PRO' | 'ENTERPRISE' | 'ON_PREM';
  licenseStartDate: string;
  licenseExpiryDate: string | null;
  licenseStatus: 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' | 'REVOKED';
  licensePausedAt: string | null;
  daysRemaining: number | null;
  isExpired: boolean;
  isPaused: boolean;
  isReadOnly: boolean;
  maxSeats: number;
  maxClaimsPerMonth: number;
  maxExtractionsPerMonth: number;
  features: string[];
}

interface MeResponse {
  info: LicenseInfo | null;
  usage: UsageSummary;
}

interface TierManifest {
  id: 'core' | 'pro' | 'enterprise';
  label: string;
  price: string;
  maxSeats: string;
  maxClaimsPerMonth: string;
  maxExtractionsPerMonth: string;
  features: string[];
}

interface LicenseRow {
  id: string;
  tenantId: string | null;
  plan: string;
  enforcement: 'report' | 'enforce';
  status: 'active' | 'grace' | 'expired' | 'revoked';
  issuedTo: string | null;
  issuedAt: string;
  expiresAt: string | null;
  graceDays: number;
  lastVerifiedAt: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  ACTIVE: 'bg-green-100 text-green-800',
  grace: 'bg-amber-100 text-amber-800',
  expired: 'bg-red-100 text-red-700',
  EXPIRED: 'bg-red-100 text-red-700',
  SUSPENDED: 'bg-amber-100 text-amber-800',
  revoked: 'bg-gray-200 text-gray-600',
  REVOKED: 'bg-gray-200 text-gray-600',
  unlicensed: 'bg-brand-100 text-brand-800',
};

const UNLIMITED = 999999;
const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
const prettyMetric = (m: string) => m.charAt(0).toUpperCase() + m.slice(1);
const prettyFeature = (f: string) => f.replace(/_/g, ' ');

type IssueType = 'TRIAL' | 'CORE' | 'PRO' | 'ENTERPRISE';

export default function UsageLicense() {
  const qc = useQueryClient();
  const [token, setToken] = useState('');
  const [downloading, setDownloading] = useState(false);

  // Issue-licence form state
  const [issueTenantId, setIssueTenantId] = useState('');
  const [issueType, setIssueType] = useState<IssueType>('PRO');
  const [issueMonths, setIssueMonths] = useState(12);
  const [issuedTo, setIssuedTo] = useState('');

  const { data: me, isLoading } = useQuery<MeResponse>({
    queryKey: ['licenses', 'me'],
    queryFn: async () => (await api.get('/licenses/me')).data,
  });

  const { data: tiersResp } = useQuery<{ tiers: TierManifest[] }>({
    queryKey: ['licenses', 'tiers'],
    queryFn: async () => (await api.get('/licenses/tiers')).data,
  });

  const { data: licenses = [] } = useQuery<LicenseRow[]>({
    queryKey: ['licenses', 'history'],
    queryFn: async () => (await api.get('/licenses/history')).data,
  });

  const { data: allTenants = [] } = useQuery<LicenseInfo[]>({
    queryKey: ['licenses', 'all'],
    queryFn: async () => (await api.get('/licenses/all')).data,
  });

  const install = useMutation({
    mutationFn: async () => (await api.post('/licenses/install', { token: token.trim() })).data,
    onSuccess: (res: { ok: boolean; licenseId?: string; reason?: string }) => {
      if (res.ok) {
        toast.success(`License installed (${res.licenseId?.slice(0, 8)}…)`);
        setToken('');
        qc.invalidateQueries({ queryKey: ['licenses'] });
      } else {
        toast.error(`Install rejected: ${res.reason ?? 'invalid token'}`);
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Install failed'),
  });

  const revoke = useMutation({
    mutationFn: (licenseId: string) => api.post('/licenses/revoke', { licenseId }),
    onSuccess: () => {
      toast.success('License revoked');
      qc.invalidateQueries({ queryKey: ['licenses'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Revoke failed'),
  });

  const issue = useMutation({
    mutationFn: async () => {
      if (!issueTenantId) throw new Error('Select a tenant');
      return (
        await api.post(`/licenses/apply/${issueTenantId}`, {
          licenseType: issueType,
          // TRIAL uses its 14-day catalog default; others take the chosen term.
          durationDays: issueType === 'TRIAL' ? undefined : Math.max(1, issueMonths) * 30,
          issuedTo: issuedTo.trim() || undefined,
        })
      ).data;
    },
    onSuccess: (info: LicenseInfo) => {
      toast.success(`Issued ${info.licenseType} licence to ${info.tenantName}`);
      setIssuedTo('');
      qc.invalidateQueries({ queryKey: ['licenses'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? e?.message ?? 'Issue failed'),
  });

  const renew = useMutation({
    mutationFn: ({ tenantId, licenseType }: { tenantId: string; licenseType: string }) =>
      api.post(`/licenses/apply/${tenantId}`, {
        licenseType,
        durationDays: licenseType === 'TRIAL' ? undefined : 365,
      }),
    onSuccess: () => {
      toast.success('Licence renewed (+12 months)');
      qc.invalidateQueries({ queryKey: ['licenses'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Renew failed'),
  });

  const pauseResume = useMutation({
    mutationFn: ({ tenantId, type }: { tenantId: string; type: 'PAUSE' | 'RESUME' }) =>
      api.post(`/licenses/pause-request/${tenantId}`, { type, autoApprove: true }),
    onSuccess: (_data, vars) => {
      toast.success(vars.type === 'PAUSE' ? 'Subscription paused' : 'Subscription resumed (paused days credited)');
      qc.invalidateQueries({ queryKey: ['licenses'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Action failed'),
  });

  const rowBusy = (tenantId: string) =>
    (renew.isPending && renew.variables?.tenantId === tenantId) ||
    (pauseResume.isPending && pauseResume.variables?.tenantId === tenantId);

  const downloadCert = async () => {
    if (!me?.info?.tenantId) {
      toast.error('No tenant licence to certify');
      return;
    }
    setDownloading(true);
    try {
      const res = await api.get(`/licenses/preview-pdf/${me.info.tenantId}`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      toast.error('Could not generate certificate');
    } finally {
      setDownloading(false);
    }
  };

  if (isLoading) return <div className="p-6">Loading licence…</div>;

  const info = me?.info ?? null;
  const usage = me?.usage;
  const tiers = tiersResp?.tiers ?? [];
  const tenantLabel = usage?.tenantId ?? 'Internal (default tenant)';
  const currentPlan = info?.plan ?? usage?.plan;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Usage &amp; License</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Plan entitlements, lifecycle status, metered usage, and the licence certificate.
          </p>
        </div>
        {info && (
          <button
            onClick={downloadCert}
            disabled={downloading}
            className="px-4 py-2 border rounded-md text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            {downloading ? 'Generating…' : '⬇ Download certificate (PDF)'}
          </button>
        )}
      </div>

      {/* Read-only / paused banner */}
      {info?.isReadOnly && (
        <div className="border border-red-200 bg-red-50 text-red-800 rounded-lg p-4 text-sm">
          <strong>Read-only mode.</strong> This licence has expired — existing data remains viewable, but
          creating or editing claims is blocked until it is renewed.
        </div>
      )}
      {info?.isPaused && (
        <div className="border border-amber-200 bg-amber-50 text-amber-800 rounded-lg p-4 text-sm">
          <strong>Subscription paused.</strong> Access is suspended; remaining time is preserved and credited
          back on resume.
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard label="Plan" value={(currentPlan ?? '—').toUpperCase()} />
        <SummaryCard
          label="Status"
          value={
            <span
              className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                STATUS_STYLES[info?.licenseStatus ?? usage?.status ?? 'unlicensed']
              }`}
            >
              {info?.licenseStatus ?? usage?.status ?? 'unlicensed'}
            </span>
          }
        />
        <SummaryCard label="Type" value={info?.licenseType ?? '—'} />
        <SummaryCard
          label="Expires"
          value={
            <span>
              {fmtDate(info?.licenseExpiryDate ?? usage?.expiresAt ?? null)}
              {info?.daysRemaining != null && (
                <span className="block text-xs font-normal text-muted-foreground">
                  {info.daysRemaining} day{info.daysRemaining === 1 ? '' : 's'} left
                </span>
              )}
            </span>
          }
        />
      </div>

      <p className="text-xs text-muted-foreground -mt-2">
        Tenant: <span className="font-mono">{tenantLabel}</span> · Billing period:{' '}
        <span className="font-mono">{usage?.period}</span>
        {usage?.enforcement === 'report' && <> · Report mode meters usage but never blocks requests.</>}
        {info?.licenseKey && <> · Key: <span className="font-mono">{info.licenseKey}</span></>}
      </p>

      {/* Usage meters */}
      <div className="border rounded-lg p-4 space-y-4">
        <h2 className="font-semibold text-sm">Usage this period</h2>
        {usage?.usage.map((u) => <UsageMeter key={u.metric} row={u} />)}
        {(!usage?.usage || usage.usage.length === 0) && (
          <p className="text-sm text-muted-foreground">No metered usage recorded yet.</p>
        )}
      </div>

      {/* Tier matrix */}
      {tiers.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-semibold text-sm">Plans</h2>
          <div className="grid md:grid-cols-3 gap-4">
            {tiers.map((t) => {
              const isCurrent = t.id === currentPlan;
              return (
                <div
                  key={t.id}
                  className={`border rounded-lg p-4 ${isCurrent ? 'border-primary ring-1 ring-primary' : ''}`}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold">{t.label}</h3>
                    {isCurrent && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary text-primary-foreground">
                        Current
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">{t.price}</p>
                  <div className="text-xs text-muted-foreground mt-2 space-y-0.5">
                    <div>Seats: {t.maxSeats}</div>
                    <div>Claims/mo: {t.maxClaimsPerMonth}</div>
                    <div>Extractions/mo: {t.maxExtractionsPerMonth}</div>
                  </div>
                  <ul className="mt-3 space-y-1">
                    {t.features.map((f, i) => (
                      <li key={i} className="text-xs flex gap-1.5">
                        <span className="text-primary">✓</span>
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Issue a licence (admin) */}
      <div className="border rounded-lg p-4 space-y-3">
        <h2 className="font-semibold text-sm">Issue a licence</h2>
        <p className="text-xs text-muted-foreground">
          Activate or renew a plan for a tenant directly — no token needed. Seat/claim/extraction caps and
          features come from the plan catalog. Use the token box below instead for the internal (default) tenant.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="text-xs space-y-1 block">
            <span className="text-muted-foreground">Tenant</span>
            <select
              value={issueTenantId}
              onChange={(e) => setIssueTenantId(e.target.value)}
              className="w-full border rounded px-2 py-1.5 text-sm bg-background"
            >
              <option value="">Select tenant…</option>
              {allTenants.map((t) => (
                <option key={t.tenantId} value={t.tenantId}>
                  {t.tenantName} · {t.licenseStatus}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs space-y-1 block">
            <span className="text-muted-foreground">Licence type</span>
            <select
              value={issueType}
              onChange={(e) => setIssueType(e.target.value as IssueType)}
              className="w-full border rounded px-2 py-1.5 text-sm bg-background"
            >
              <option value="TRIAL">Trial (14 days)</option>
              <option value="CORE">Core</option>
              <option value="PRO">Professional</option>
              <option value="ENTERPRISE">Enterprise</option>
            </select>
          </label>
          <label className="text-xs space-y-1 block">
            <span className="text-muted-foreground">Term (months)</span>
            <input
              type="number"
              min={1}
              max={120}
              value={issueMonths}
              disabled={issueType === 'TRIAL'}
              onChange={(e) => setIssueMonths(Number(e.target.value))}
              className="w-full border rounded px-2 py-1.5 text-sm bg-background disabled:opacity-50"
            />
          </label>
          <label className="text-xs space-y-1 block">
            <span className="text-muted-foreground">Issued to (optional)</span>
            <input
              type="text"
              value={issuedTo}
              placeholder="e.g. CIC Insurance Group"
              onChange={(e) => setIssuedTo(e.target.value)}
              className="w-full border rounded px-2 py-1.5 text-sm bg-background"
            />
          </label>
        </div>
        <button
          onClick={() => issue.mutate()}
          disabled={!issueTenantId || issue.isPending}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50"
        >
          {issue.isPending ? 'Issuing…' : 'Issue licence'}
        </button>
      </div>

      {/* All tenant licences */}
      {allTenants.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div className="px-4 py-3 bg-muted/50 font-semibold text-sm">All tenant licences</div>
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Tenant</th>
                <th className="text-left px-4 py-2 font-medium">Type</th>
                <th className="text-left px-4 py-2 font-medium">Plan</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Expires</th>
                <th className="text-left px-4 py-2 font-medium">Days left</th>
                <th className="text-right px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {allTenants.map((t) => {
                const busy = rowBusy(t.tenantId);
                return (
                  <tr key={t.tenantId} className="border-t">
                    <td className="px-4 py-2">{t.tenantName}</td>
                    <td className="px-4 py-2 text-xs">{t.licenseType}</td>
                    <td className="px-4 py-2 uppercase text-xs">{t.plan}</td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[t.licenseStatus]}`}>
                        {t.licenseStatus}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs">{fmtDate(t.licenseExpiryDate)}</td>
                    <td className="px-4 py-2 text-xs">{t.daysRemaining ?? '∞'}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap space-x-3">
                      <button
                        onClick={() => renew.mutate({ tenantId: t.tenantId, licenseType: t.licenseType })}
                        disabled={busy}
                        className="text-primary text-xs hover:underline disabled:opacity-50"
                      >
                        Renew
                      </button>
                      {t.licenseStatus === 'SUSPENDED' ? (
                        <button
                          onClick={() => pauseResume.mutate({ tenantId: t.tenantId, type: 'RESUME' })}
                          disabled={busy}
                          className="text-green-600 text-xs hover:underline disabled:opacity-50"
                        >
                          Resume
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            if (confirm(`Pause ${t.tenantName}? Access is suspended until resumed; remaining time is preserved.`))
                              pauseResume.mutate({ tenantId: t.tenantId, type: 'PAUSE' });
                          }}
                          disabled={busy || t.licenseStatus === 'REVOKED'}
                          className="text-amber-600 text-xs hover:underline disabled:opacity-50"
                        >
                          Pause
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Included features */}
      <div className="border rounded-lg p-4 space-y-3">
        <h2 className="font-semibold text-sm">Included features (active licence)</h2>
        <div className="flex flex-wrap gap-2">
          {usage?.features.length ? (
            usage.features.map((f) => (
              <span key={f} className="px-2.5 py-1 rounded-full text-xs bg-muted text-foreground/80 capitalize">
                {prettyFeature(f)}
              </span>
            ))
          ) : (
            <span className="text-sm text-muted-foreground">
              No features enabled — licence expired or unlicensed (read-only).
            </span>
          )}
        </div>
      </div>

      {/* Install a license */}
      <div className="border rounded-lg p-4 space-y-3 bg-muted/40">
        <h2 className="font-semibold text-sm">Install a license token</h2>
        <p className="text-xs text-muted-foreground">
          Paste a signed token from the license CLI. It is verified against the embedded public key before
          activation; the previous active license for the tenant is retired automatically.
        </p>
        <textarea
          className="w-full border rounded px-3 py-2 text-xs font-mono h-24 resize-y"
          placeholder="base64url-payload.base64url-signature"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <button
          onClick={() => install.mutate()}
          disabled={!token.trim() || install.isPending}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50"
        >
          {install.isPending ? 'Installing…' : 'Install license'}
        </button>
      </div>

      {/* Licenses table */}
      <div className="border rounded-lg overflow-hidden">
        <div className="px-4 py-3 bg-muted/50 font-semibold text-sm">License history</div>
        <table className="w-full text-sm">
          <thead className="bg-muted/30">
            <tr>
              <th className="text-left px-4 py-2 font-medium">License</th>
              <th className="text-left px-4 py-2 font-medium">Tenant</th>
              <th className="text-left px-4 py-2 font-medium">Plan</th>
              <th className="text-left px-4 py-2 font-medium">Issued to</th>
              <th className="text-left px-4 py-2 font-medium">Issued</th>
              <th className="text-left px-4 py-2 font-medium">Expires</th>
              <th className="text-left px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {licenses.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="px-4 py-2 font-mono text-xs">{l.id.slice(0, 8)}…</td>
                <td className="px-4 py-2 font-mono text-xs">{l.tenantId ?? 'internal'}</td>
                <td className="px-4 py-2 uppercase text-xs">{l.plan}</td>
                <td className="px-4 py-2 text-muted-foreground">{l.issuedTo ?? '—'}</td>
                <td className="px-4 py-2 text-xs">{fmtDate(l.issuedAt)}</td>
                <td className="px-4 py-2 text-xs">{fmtDate(l.expiresAt)}</td>
                <td className="px-4 py-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[l.status]}`}>
                    {l.status}
                  </span>
                  {l.enforcement === 'report' && (
                    <span className="ml-1 text-[10px] text-muted-foreground">report</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  {(l.status === 'active' || l.status === 'grace') && (
                    <button
                      onClick={() => {
                        if (confirm(`Revoke license ${l.id.slice(0, 8)}…? This cannot be undone.`))
                          revoke.mutate(l.id);
                      }}
                      disabled={revoke.isPending}
                      className="text-destructive text-xs hover:underline"
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {licenses.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  No licenses installed. The tenant is running on the default plan.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border rounded-lg p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-lg font-bold mt-1">{value}</div>
    </div>
  );
}

function UsageMeter({ row }: { row: UsageRow }) {
  const unlimited = row.limit === null || row.limit >= UNLIMITED;
  const pct = unlimited ? 0 : Math.min(100, Math.round((row.used / Math.max(1, row.limit!)) * 100));
  const over = !unlimited && row.used > row.limit!;
  const near = !unlimited && pct >= 80;
  const barColor = over ? 'bg-red-500' : near ? 'bg-amber-500' : 'bg-primary';

  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="font-medium">{prettyMetric(row.metric)}</span>
        <span className="text-muted-foreground">
          {row.used.toLocaleString()}
          {unlimited ? ' / unlimited' : ` / ${row.limit!.toLocaleString()} (${pct}%)`}
        </span>
      </div>
      <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} rounded-full transition-all`}
          style={{ width: unlimited ? '4%' : `${pct}%` }}
        />
      </div>
    </div>
  );
}
