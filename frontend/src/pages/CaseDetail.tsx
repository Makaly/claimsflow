import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';

interface TimelineEvent {
  kind: 'status_change' | 'comment' | 'appeal';
  at: string;
  data: Record<string, unknown>;
}

export default function CaseDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [comment, setComment] = useState('');

  const { data: caseRow, isLoading } = useQuery({
    queryKey: ['case', id],
    queryFn: async () => (await api.get(`/cases/${id}`)).data,
    enabled: !!id,
  });

  const { data: timeline = [] } = useQuery<TimelineEvent[]>({
    queryKey: ['case-timeline', id],
    queryFn: async () => (await api.get(`/cases/${id}/timeline`)).data,
    enabled: !!id,
  });

  const updateStatus = useMutation({
    mutationFn: (status: string) => api.patch(`/cases/${id}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['case', id] });
      qc.invalidateQueries({ queryKey: ['case-timeline', id] });
    },
  });

  const postComment = useMutation({
    mutationFn: (body: string) => api.post(`/cases/${id}/comments`, { body }),
    onSuccess: () => {
      setComment('');
      qc.invalidateQueries({ queryKey: ['case-timeline', id] });
    },
  });

  if (isLoading || !caseRow) return <div className="p-6">Loading case…</div>;

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Case</h1>
          <p className="text-sm text-muted-foreground">Claim {caseRow.claim?.claimNumber}</p>
        </div>
        <div className="flex gap-2">
          {['open', 'on-hold', 'resolved', 'escalated'].map((s) => (
            <button
              key={s}
              disabled={caseRow.status === s || updateStatus.isPending}
              onClick={() => updateStatus.mutate(s)}
              className="px-3 py-1.5 text-xs border rounded hover:bg-muted disabled:opacity-40"
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 text-sm">
        <div className="border rounded-lg p-3">
          <span className="text-muted-foreground">Status</span>
          <p className="font-semibold mt-1">{caseRow.status}</p>
        </div>
        <div className="border rounded-lg p-3">
          <span className="text-muted-foreground">SLA due</span>
          <p className="font-semibold mt-1">
            {caseRow.slaDueAt ? new Date(caseRow.slaDueAt).toLocaleString() : '—'}
          </p>
        </div>
        <div className="border rounded-lg p-3">
          <span className="text-muted-foreground">Owner</span>
          <p className="font-semibold mt-1">{caseRow.owner?.name ?? '—'}</p>
        </div>
      </div>

      <div>
        <h2 className="font-semibold mb-3">Timeline</h2>
        <div className="space-y-3">
          {timeline.map((ev, i) => (
            <div key={i} className="flex gap-3 text-sm">
              <span className="text-muted-foreground text-xs w-36 shrink-0">
                {new Date(ev.at).toLocaleString()}
              </span>
              <div className="border-l-2 pl-3">
                <span className="text-xs font-medium uppercase text-muted-foreground">{ev.kind}</span>
                {ev.kind === 'comment' && (
                  <p className="mt-0.5">{(ev.data as any).body}</p>
                )}
                {ev.kind === 'status_change' && (
                  <p className="mt-0.5">
                    {(ev.data as any).fromStatus} → {(ev.data as any).toStatus}
                  </p>
                )}
                {ev.kind === 'appeal' && (
                  <p className="mt-0.5">Appeal filed: {(ev.data as any).status}</p>
                )}
              </div>
            </div>
          ))}
          {!timeline.length && (
            <p className="text-muted-foreground text-sm">No events yet.</p>
          )}
        </div>
      </div>

      <div>
        <h2 className="font-semibold mb-3">Add comment</h2>
        <textarea
          className="w-full border rounded p-3 text-sm resize-none"
          rows={3}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Write a case note…"
        />
        <button
          disabled={!comment.trim() || postComment.isPending}
          onClick={() => postComment.mutate(comment)}
          className="mt-2 px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium disabled:opacity-40"
        >
          Post comment
        </button>
      </div>
    </div>
  );
}
