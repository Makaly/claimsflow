import { useState, useEffect, useCallback } from 'react'
import {
  FileText, CheckCircle, Building2, Award, Users, Handshake, Calendar,
  Upload, Loader2, RefreshCw, Trash2, Plus, X, FileUp, Clock, ShieldCheck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useAuthStore } from '@/store/authStore'

type DocCategory =
  | 'company_profile'
  | 'experience_evidence'
  | 'firm_certifications'
  | 'staff_certifications'
  | 'program_of_works'
  | 'other'

interface OnboardingDoc {
  id: string
  category: DocCategory
  fileName: string
  filePath: string
  fileSize?: number
  mimeType?: string
  uploadedAt: string
}

interface Reference {
  id: string
  clientName: string
  contactPerson: string
  contactEmail?: string
  contactPhone?: string
  servicesProvided: string
  engagementStartDate: string
  engagementEndDate?: string
}

interface Packet {
  providerId: string
  providerName: string
  approvalStatus: string
  onboardingSubmittedAt: string | null
  sections: {
    a_companyProfile:    { complete: boolean; companyStructure: string | null; documents: OnboardingDoc[] }
    b_yearsOfExperience: { complete: boolean; yearsProvidingServices: number | null; documents: OnboardingDoc[] }
    c_scopeUnderstanding:{ complete: boolean; scopeUnderstanding: string | null }
    d_certifications:    { complete: boolean; firmDocuments: OnboardingDoc[]; staffDocuments: OnboardingDoc[] }
    e_references:        { complete: boolean; references: Reference[] }
    f_programOfWorks:    { complete: boolean; programOfWorksText: string | null; documents: OnboardingDoc[] }
  }
  completedCount: number
  totalSections: number
  isComplete: boolean
  missing: string[]
}

const token = () => localStorage.getItem('token')
const auth = () => ({ Authorization: `Bearer ${token()}` })

/**
 * Full onboarding form shown to pending provider_admin users. Replaces the
 * single proof-document uploader. Six sections mirror the procurement spec.
 */
export function ProviderOnboarding({ onApproved }: { onApproved: () => void }) {
  const { user } = useAuthStore()
  const [packet, setPacket] = useState<Packet | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const fetchPacket = useCallback(async () => {
    setRefreshing(true)
    try {
      const res = await fetch('/api/providers/self-service/onboarding-packet', { headers: auth() })
      if (res.ok) {
        const data: Packet = await res.json()
        setPacket(data)
        if (data.approvalStatus === 'approved') onApproved()
      }
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [onApproved])

  useEffect(() => { fetchPacket() }, [fetchPacket])

  const patchInfo = async (body: Record<string, any>) => {
    const res = await fetch('/api/providers/self-service/onboarding-info', {
      method: 'PATCH',
      headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) fetchPacket()
  }

  const uploadDoc = async (category: DocCategory, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('category', category)
    const res = await fetch('/api/providers/self-service/onboarding-document', {
      method: 'POST', headers: auth(), body: fd,
    })
    if (res.ok) fetchPacket()
    else alert('Upload failed: ' + (await res.text()))
  }

  const deleteDoc = async (id: string) => {
    const res = await fetch(`/api/providers/self-service/onboarding-document/${id}`, {
      method: 'DELETE', headers: auth(),
    })
    if (res.ok) fetchPacket()
  }

  const addReference = async (ref: Omit<Reference, 'id'>) => {
    const res = await fetch('/api/providers/self-service/references', {
      method: 'POST',
      headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify(ref),
    })
    if (res.ok) fetchPacket()
    else alert('Failed: ' + (await res.text()))
  }

  const deleteReference = async (id: string) => {
    const res = await fetch(`/api/providers/self-service/references/${id}`, {
      method: 'DELETE', headers: auth(),
    })
    if (res.ok) fetchPacket()
  }

  const submitPacket = async () => {
    setSubmitting(true); setSubmitError(null)
    try {
      const res = await fetch('/api/providers/self-service/onboarding-submit', {
        method: 'POST', headers: auth(),
      })
      if (res.ok) { fetchPacket() }
      else {
        const err = await res.json().catch(() => ({}))
        setSubmitError(typeof err.message === 'string' ? err.message : 'Packet is incomplete')
      }
    } finally { setSubmitting(false) }
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-[60vh]">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  }
  if (!packet) return <div className="p-6 text-center text-muted-foreground">Failed to load onboarding packet.</div>

  const s = packet.sections
  const progressPct = (packet.completedCount / packet.totalSections) * 100
  const submitted = !!packet.onboardingSubmittedAt

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Header */}
      <div className="text-center space-y-3">
        <div className="mx-auto w-16 h-16 rounded-full bg-amber-500/10 border-2 border-amber-500/30 flex items-center justify-center">
          <ShieldCheck className="h-8 w-8 text-amber-500" />
        </div>
        <h1 className="text-2xl font-bold">Complete your provider onboarding</h1>
        <p className="text-muted-foreground text-sm max-w-lg mx-auto">
          Welcome, <strong className="text-foreground">{user?.name}</strong>. Per the CIC procurement
          requirements, please submit the following information and supporting documents for
          <strong className="text-foreground"> {packet.providerName}</strong>. CIC staff will review
          your submission and activate your account within 1–2 business days.
        </p>
      </div>

      {/* Progress */}
      <Card>
        <CardContent className="pt-5 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold">{packet.completedCount} of {packet.totalSections} sections complete</span>
            <Button variant="ghost" size="sm" onClick={fetchPacket} disabled={refreshing}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
            </Button>
          </div>
          <Progress value={progressPct} className="h-2" />
          {submitted && (
            <div className="flex items-start gap-2 rounded-md bg-blue-500/10 border border-blue-500/30 p-3 mt-3 text-sm">
              <Clock className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
              <div>
                <strong className="text-blue-500">Submitted for review</strong>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Submitted on {new Date(packet.onboardingSubmittedAt!).toLocaleString()}. You can still edit
                  any section; the approval will be based on your latest data.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section (a) — Company Profile */}
      <SectionCard
        letter="a" title="Company Profile" icon={Building2} complete={s.a_companyProfile.complete}
        description="Updated company profile including legal structure."
      >
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Company structure</Label>
            <Select
              value={s.a_companyProfile.companyStructure ?? ''}
              onValueChange={v => patchInfo({ companyStructure: v })}
            >
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sole_proprietorship">Sole Proprietorship</SelectItem>
                <SelectItem value="partnership">Partnership</SelectItem>
                <SelectItem value="registered_company">Registered Company</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DocList
            label="Company profile document"
            category="company_profile"
            docs={s.a_companyProfile.documents}
            onUpload={uploadDoc}
            onDelete={deleteDoc}
          />
        </div>
      </SectionCard>

      {/* Section (b) — Years of Experience */}
      <SectionCard
        letter="b" title="Years providing similar services" icon={Calendar}
        complete={s.b_yearsOfExperience.complete}
        description="State the number of years your organisation has been providing similar services and attach evidence."
      >
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Years providing similar services</Label>
            <Input
              type="number" min={0}
              className="mt-1 max-w-[160px]"
              value={s.b_yearsOfExperience.yearsProvidingServices ?? ''}
              onChange={e => patchInfo({ yearsProvidingServices: parseInt(e.target.value) || 0 })}
            />
          </div>
          <DocList
            label="Supporting evidence (e.g. incorporation certificate, operating licence history)"
            category="experience_evidence"
            docs={s.b_yearsOfExperience.documents}
            onUpload={uploadDoc}
            onDelete={deleteDoc}
          />
        </div>
      </SectionCard>

      {/* Section (c) — Scope Understanding */}
      <SectionCard
        letter="c" title="Understanding of scope of service provision" icon={FileText}
        complete={s.c_scopeUnderstanding.complete}
        description="In at least 100 characters, describe your understanding of the scope of service provision as per CIC's project specifications."
      >
        <Textarea
          rows={6}
          className="font-mono text-sm"
          placeholder="Describe your understanding of the required services, deliverables, and how your organisation will meet CIC's project specifications..."
          defaultValue={s.c_scopeUnderstanding.scopeUnderstanding ?? ''}
          onBlur={e => patchInfo({ scopeUnderstanding: e.target.value })}
        />
        <p className="text-xs text-muted-foreground mt-1">
          {(s.c_scopeUnderstanding.scopeUnderstanding?.length ?? 0)} / 100 characters minimum
        </p>
      </SectionCard>

      {/* Section (d) — Certifications */}
      <SectionCard
        letter="d" title="Certifications" icon={Award}
        complete={s.d_certifications.complete}
        description="Upload certifications for both the firm and its staff relevant to the service scope."
      >
        <div className="space-y-4">
          <DocList
            label="Firm-level certifications"
            category="firm_certifications"
            docs={s.d_certifications.firmDocuments}
            onUpload={uploadDoc}
            onDelete={deleteDoc}
          />
          <DocList
            label="Staff-level certifications"
            category="staff_certifications"
            docs={s.d_certifications.staffDocuments}
            onUpload={uploadDoc}
            onDelete={deleteDoc}
          />
        </div>
      </SectionCard>

      {/* Section (e) — References */}
      <SectionCard
        letter="e" title="References (within the last 5 years)" icon={Handshake}
        complete={s.e_references.complete}
        description="Provide at least 2 past engagements where similar services were offered within the last 5 years."
      >
        <ReferencesEditor
          references={s.e_references.references}
          onAdd={addReference}
          onDelete={deleteReference}
        />
      </SectionCard>

      {/* Section (f) — Program of Works */}
      <SectionCard
        letter="f" title="Program of works with timelines" icon={Users}
        complete={s.f_programOfWorks.complete}
        description="Provide a detailed program of works with clear timelines for executing the services. Text or an uploaded document is acceptable."
      >
        <div className="space-y-3">
          <Textarea
            rows={5}
            placeholder="Describe your program of works including phases, key milestones, and timelines..."
            defaultValue={s.f_programOfWorks.programOfWorksText ?? ''}
            onBlur={e => patchInfo({ programOfWorksText: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Or upload a detailed program-of-works document instead:
          </p>
          <DocList
            label="Program of works document"
            category="program_of_works"
            docs={s.f_programOfWorks.documents}
            onUpload={uploadDoc}
            onDelete={deleteDoc}
          />
        </div>
      </SectionCard>

      {/* Submit */}
      <Card className={packet.isComplete ? 'border-emerald-500/50 bg-emerald-500/5' : ''}>
        <CardContent className="pt-5 space-y-3">
          {packet.isComplete ? (
            <>
              <div className="flex items-center gap-2 text-emerald-500">
                <CheckCircle className="h-5 w-5" />
                <span className="font-semibold">All 6 sections complete</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {submitted
                  ? 'You have already submitted your packet. Any changes above are saved automatically. CIC staff will review your submission.'
                  : 'Submit your packet for CIC review. You will be notified by email when your account is activated.'}
              </p>
              {!submitted && (
                <Button onClick={submitPacket} disabled={submitting} className="bg-emerald-500 hover:bg-emerald-400 text-black font-semibold">
                  {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting…</> : <>Submit for CIC review</>}
                </Button>
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Complete all 6 sections to submit your packet for review.
                <span className="block mt-1 text-xs">
                  Missing: {packet.missing.map(m => m.replace(/^[a-f]_/, '')).join(', ')}
                </span>
              </p>
              <Button disabled className="opacity-60 cursor-not-allowed">
                Submit for CIC review ({packet.completedCount}/{packet.totalSections})
              </Button>
            </>
          )}
          {submitError && <p className="text-sm text-destructive">{submitError}</p>}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-center">
        Questions? Contact <a href="mailto:claims@cic.co.ke" className="underline">claims@cic.co.ke</a>
      </p>
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SectionCard({
  letter, title, icon: Icon, complete, description, children,
}: {
  letter: string; title: string; icon: any; complete: boolean;
  description: string; children: React.ReactNode;
}) {
  return (
    <Card className={complete ? 'border-emerald-500/30' : ''}>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
            complete
              ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-500'
              : 'bg-muted text-muted-foreground border border-border'
          }`}>
            {complete ? <CheckCircle className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
          </div>
          <div className="flex-1">
            <CardTitle className="text-base flex items-center gap-2">
              <Badge variant="secondary" className="text-[10px] font-mono">({letter})</Badge>
              {title}
              {complete && <Badge className="bg-emerald-500/15 text-emerald-500 border-emerald-500/30 text-[10px]">COMPLETE</Badge>}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">{description}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function DocList({
  label, category, docs, onUpload, onDelete,
}: {
  label: string; category: DocCategory; docs: OnboardingDoc[];
  onUpload: (c: DocCategory, f: File) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
}) {
  const [uploading, setUploading] = useState(false)
  return (
    <div className="space-y-2">
      <Label className="text-xs">{label}</Label>
      {docs.length > 0 && (
        <div className="space-y-1.5">
          {docs.map(d => (
            <div key={d.id} className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-1.5 text-sm">
              <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="flex-1 truncate">{d.fileName}</span>
              {d.fileSize && <span className="text-xs text-muted-foreground">{(d.fileSize / 1024).toFixed(1)} KB</span>}
              <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive"
                onClick={() => onDelete(d.id)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <label className="cursor-pointer w-fit">
        <input
          type="file"
          className="hidden"
          accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
          disabled={uploading}
          onChange={async e => {
            const f = e.target.files?.[0]
            if (!f) return
            setUploading(true)
            try { await onUpload(category, f) } finally { setUploading(false); e.target.value = '' }
          }}
        />
        <div className="flex items-center gap-2 rounded-md border border-dashed border-primary/40 bg-primary/5 hover:bg-primary/10 px-3 py-2 text-xs text-primary font-medium w-fit transition-colors">
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileUp className="h-3.5 w-3.5" />}
          {uploading ? 'Uploading…' : docs.length === 0 ? 'Upload file' : 'Add another file'}
        </div>
      </label>
    </div>
  )
}

function ReferencesEditor({
  references, onAdd, onDelete,
}: {
  references: Reference[];
  onAdd: (r: Omit<Reference, 'id'>) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
}) {
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<Omit<Reference, 'id'>>({
    clientName: '', contactPerson: '', contactEmail: '', contactPhone: '',
    servicesProvided: '', engagementStartDate: '', engagementEndDate: '',
  })

  const submit = async () => {
    if (!form.clientName || !form.contactPerson || !form.servicesProvided || !form.engagementStartDate) {
      alert('Please fill client name, contact person, services provided, and start date')
      return
    }
    setSaving(true)
    try {
      await onAdd(form)
      setForm({ clientName: '', contactPerson: '', contactEmail: '', contactPhone: '',
        servicesProvided: '', engagementStartDate: '', engagementEndDate: '' })
      setShowForm(false)
    } finally { setSaving(false) }
  }

  return (
    <div className="space-y-3">
      {references.length > 0 && (
        <div className="space-y-2">
          {references.map(r => (
            <div key={r.id} className="rounded-md border bg-muted/30 p-3 text-sm space-y-1 relative">
              <Button variant="ghost" size="icon" className="absolute top-1 right-1 h-7 w-7 text-destructive"
                onClick={() => onDelete(r.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
              <p className="font-semibold">{r.clientName}</p>
              <p className="text-xs text-muted-foreground">Contact: {r.contactPerson}{r.contactEmail && ` · ${r.contactEmail}`}{r.contactPhone && ` · ${r.contactPhone}`}</p>
              <p className="text-xs">
                {new Date(r.engagementStartDate).toLocaleDateString()} – {r.engagementEndDate ? new Date(r.engagementEndDate).toLocaleDateString() : 'ongoing'}
              </p>
              <p className="text-xs text-muted-foreground">{r.servicesProvided}</p>
            </div>
          ))}
        </div>
      )}

      {!showForm ? (
        <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" /> Add reference
        </Button>
      ) : (
        <div className="rounded-lg border bg-card p-4 space-y-3 relative">
          <Button variant="ghost" size="icon" className="absolute top-2 right-2 h-7 w-7"
            onClick={() => setShowForm(false)}>
            <X className="h-3.5 w-3.5" />
          </Button>
          <p className="text-sm font-semibold">New reference</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Client / Organisation *</Label>
              <Input value={form.clientName} onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Contact person *</Label>
              <Input value={form.contactPerson} onChange={e => setForm(f => ({ ...f, contactPerson: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Contact email</Label>
              <Input type="email" value={form.contactEmail ?? ''} onChange={e => setForm(f => ({ ...f, contactEmail: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Contact phone</Label>
              <Input value={form.contactPhone ?? ''} onChange={e => setForm(f => ({ ...f, contactPhone: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Start date *</Label>
              <Input type="date" value={form.engagementStartDate} onChange={e => setForm(f => ({ ...f, engagementStartDate: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">End date (blank = ongoing)</Label>
              <Input type="date" value={form.engagementEndDate ?? ''} onChange={e => setForm(f => ({ ...f, engagementEndDate: e.target.value }))} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Services provided *</Label>
            <Textarea rows={3} value={form.servicesProvided}
              onChange={e => setForm(f => ({ ...f, servicesProvided: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button size="sm" onClick={submit} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
              Save reference
            </Button>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Minimum 2 references. Currently {references.length} / 2+.
      </p>
    </div>
  )
}
