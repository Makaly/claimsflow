// TODO: This is a data-plumbing + minimal UI stub (F4 spec). Drag-and-drop
// reordering is NOT implemented. The list renders steps as vertical cards with
// add/edit/remove actions and a Publish button.
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/services/api';

interface WorkflowStep {
  id: string;
  kind: string;
  sla_hours: number;
  branch_rule?: string;
}

interface WorkflowDef {
  id: string;
  name: string;
  version: number;
  status: string;
  dslJsonb: { steps: WorkflowStep[] };
  updatedAt: string;
}

const STEP_KINDS = ['initial_review', 'maker_check', 'checker_review', 'fraud_check', 'final_approval'];

export default function WorkflowDesigner() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<WorkflowDef | null>(null);
  const [steps, setSteps] = useState<WorkflowStep[]>([]);

  const { data: defs = [], isLoading } = useQuery<WorkflowDef[]>({
    queryKey: ['workflow-definitions'],
    queryFn: async () => (await api.get('/workflow-definitions')).data,
  });

  const save = useMutation({
    mutationFn: (def: WorkflowDef) =>
      api.patch(`/workflow-definitions/${def.id}`, { dslJsonb: { steps } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflow-definitions'] }),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post('/workflow-definitions', { name: 'New Workflow', dslJsonb: { steps: [] } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['workflow-definitions'] });
      setSelected(res.data);
      setSteps([]);
    },
  });

  const publish = useMutation({
    mutationFn: (id: string) => api.post(`/workflow-definitions/${id}/publish`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflow-definitions'] }),
  });

  const selectDef = (def: WorkflowDef) => {
    setSelected(def);
    setSteps(def.dslJsonb?.steps ?? []);
  };

  const addStep = () => {
    setSteps([...steps, { id: crypto.randomUUID(), kind: STEP_KINDS[0], sla_hours: 24 }]);
  };

  const removeStep = (idx: number) => setSteps(steps.filter((_, i) => i !== idx));

  const updateStep = (idx: number, patch: Partial<WorkflowStep>) => {
    setSteps(steps.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  if (isLoading) return <div className="p-6">Loading workflow definitions…</div>;

  return (
    <div className="p-6 flex gap-6">
      {/* Sidebar: definition list */}
      <div className="w-64 shrink-0 space-y-2">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-sm">Definitions</h2>
          <button
            onClick={() => create.mutate()}
            className="text-xs text-primary hover:underline"
          >
            + New
          </button>
        </div>
        {defs.map((def) => (
          <button
            key={def.id}
            onClick={() => selectDef(def)}
            className={`w-full text-left p-3 border rounded-lg text-sm transition-colors ${
              selected?.id === def.id ? 'bg-primary/10 border-primary' : 'hover:bg-muted'
            }`}
          >
            <div className="font-medium truncate">{def.name}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              v{def.version} · {def.status}
            </div>
          </button>
        ))}
      </div>

      {/* Main: step editor */}
      {selected ? (
        <div className="flex-1 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold">{selected.name}</h1>
              <p className="text-sm text-muted-foreground">
                Version {selected.version} · {selected.status}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => save.mutate(selected)}
                disabled={save.isPending}
                className="px-3 py-1.5 border rounded text-sm"
              >
                Save draft
              </button>
              <button
                onClick={() => publish.mutate(selected.id)}
                disabled={publish.isPending || selected.status === 'published'}
                className="px-3 py-1.5 bg-primary text-primary-foreground rounded text-sm font-medium disabled:opacity-40"
              >
                Publish
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {steps.map((step, idx) => (
              <div key={step.id} className="border rounded-lg p-4 space-y-3 bg-card">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-muted-foreground">Step {idx + 1}</span>
                  <button onClick={() => removeStep(idx)} className="text-destructive text-xs">Remove</button>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground">Kind</label>
                    <select
                      value={step.kind}
                      onChange={(e) => updateStep(idx, { kind: e.target.value })}
                      className="w-full border rounded px-2 py-1 text-sm mt-1"
                    >
                      {STEP_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">SLA hours</label>
                    <input
                      type="number"
                      value={step.sla_hours}
                      onChange={(e) => updateStep(idx, { sla_hours: parseInt(e.target.value, 10) })}
                      className="w-full border rounded px-2 py-1 text-sm mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Branch rule</label>
                    <input
                      value={step.branch_rule ?? ''}
                      onChange={(e) => updateStep(idx, { branch_rule: e.target.value })}
                      placeholder="e.g. amount > 100000"
                      className="w-full border rounded px-2 py-1 text-sm mt-1"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={addStep}
            className="w-full border-2 border-dashed rounded-lg py-3 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
          >
            + Add step
          </button>

          {/* TODO: drag-and-drop reordering — see F4 spec note */}
          <p className="text-xs text-muted-foreground italic">
            TODO: drag-and-drop step reordering not implemented in this stub.
          </p>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          Select or create a workflow definition.
        </div>
      )}
    </div>
  );
}
