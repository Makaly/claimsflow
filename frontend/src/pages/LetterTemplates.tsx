import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';

interface Template {
  id: string;
  code: string;
  name: string;
  subject: string;
  bodyTemplate: string;
  channel: string;
  locale: string;
}

export default function LetterTemplates() {
  const qc = useQueryClient();
  const [preview, setPreview] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<Template> | null>(null);

  const { data: templates = [], isLoading } = useQuery<Template[]>({
    queryKey: ['letter-templates'],
    queryFn: async () => (await api.get('/correspondence/templates')).data,
  });

  const save = useMutation({
    mutationFn: (t: Partial<Template>) => api.post('/correspondence/templates', t),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['letter-templates'] }); setEditing(null); },
  });

  if (isLoading) return <div className="p-6">Loading templates…</div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Letter Templates</h1>
        <button
          onClick={() => setEditing({ channel: 'both', locale: 'en' })}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium"
        >
          New Template
        </button>
      </div>

      {editing && (
        <div className="border rounded-lg p-4 space-y-3 bg-muted/40">
          <h3 className="font-semibold">Edit template</h3>
          {(['code', 'name', 'subject'] as const).map((f) => (
            <input
              key={f}
              className="w-full border rounded px-3 py-1.5 text-sm"
              placeholder={f}
              value={(editing as any)[f] ?? ''}
              onChange={(e) => setEditing({ ...editing, [f]: e.target.value })}
            />
          ))}
          <textarea
            className="w-full border rounded px-3 py-1.5 text-sm resize-none"
            rows={6}
            placeholder="Body template (use {{variable}} placeholders)"
            value={editing.bodyTemplate ?? ''}
            onChange={(e) => setEditing({ ...editing, bodyTemplate: e.target.value })}
          />
          <select
            value={editing.channel}
            onChange={(e) => setEditing({ ...editing, channel: e.target.value })}
            className="border rounded px-3 py-1.5 text-sm"
          >
            <option value="email">Email</option>
            <option value="pdf">PDF</option>
            <option value="both">Both</option>
          </select>
          <div className="flex gap-2">
            <button
              onClick={() => save.mutate(editing)}
              disabled={save.isPending}
              className="px-3 py-1.5 bg-primary text-primary-foreground rounded text-sm"
            >
              Save
            </button>
            <button onClick={() => setEditing(null)} className="px-3 py-1.5 border rounded text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-4">
        {templates.map((t) => (
          <div key={t.id} className="border rounded-lg p-4 space-y-2">
            <div className="flex items-start justify-between">
              <div>
                <span className="font-mono text-xs text-muted-foreground">{t.code}</span>
                <h3 className="font-semibold">{t.name}</h3>
                <p className="text-sm text-muted-foreground">Subject: {t.subject}</p>
                <span className="text-xs border px-2 py-0.5 rounded">{t.channel}</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setPreview(preview === t.id ? null : t.id)}
                  className="text-xs text-primary hover:underline"
                >
                  {preview === t.id ? 'Hide' : 'Preview'}
                </button>
                <button
                  onClick={() => setEditing(t)}
                  className="text-xs text-primary hover:underline"
                >
                  Edit
                </button>
              </div>
            </div>
            {preview === t.id && (
              <pre className="text-xs whitespace-pre-wrap bg-muted p-3 rounded-md mt-2">
                {t.bodyTemplate}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
