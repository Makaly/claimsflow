import { useState, useEffect } from 'react'
import {
  CheckCircle, XCircle, FileText, Loader2, ChevronDown, ChevronRight,
  Building2, Calendar, Award, Handshake, Users,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import api from '@/services/api'

/**
 * Read-only summary of a provider's onboarding packet, shown inside the admin
 * approval dialog. Pulls from GET /api/providers/:id/onboarding-packet.
 */
export function OnboardingPacketReview({ providerId }: { providerId: string }) {
  const [packet, setPacket] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.get(`/providers/${providerId}/onboarding-packet`)
      .then(({ data }) => { if (!cancelled) { setPacket(data); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [providerId])

  if (loading) return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading onboarding packet…
    </div>
  )

  if (!packet) return (
    <div className="text-sm text-muted-foreground italic py-2">Could not load onboarding packet.</div>
  )

  const s = packet.sections
  return (
    <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Onboarding packet</p>
        <div className="flex items-center gap-2">
          {packet.onboardingSubmittedAt
            ? <Badge className="bg-blue-500/15 text-blue-500 border-blue-500/30 text-[10px]">SUBMITTED</Badge>
            : <Badge variant="outline" className="text-[10px]">DRAFT</Badge>}
          {packet.isComplete
            ? <Badge className="bg-emerald-500/15 text-emerald-500 border-emerald-500/30 text-[10px]">
                COMPLETE ({packet.completedCount}/{packet.totalSections})
              </Badge>
            : <Badge variant="destructive" className="text-[10px]">
                INCOMPLETE ({packet.completedCount}/{packet.totalSections})
              </Badge>}
        </div>
      </div>

      <div className="space-y-1.5">
        <Row letter="a" title="Company profile" icon={Building2} complete={s.a_companyProfile.complete}>
          <div className="text-xs space-y-1">
            <div><span className="text-muted-foreground">Structure:</span> {s.a_companyProfile.companyStructure || <em className="text-destructive">not set</em>}</div>
            <Docs docs={s.a_companyProfile.documents} />
          </div>
        </Row>

        <Row letter="b" title="Years providing similar services" icon={Calendar} complete={s.b_yearsOfExperience.complete}>
          <div className="text-xs space-y-1">
            <div><span className="text-muted-foreground">Years:</span> {s.b_yearsOfExperience.yearsProvidingServices ?? <em className="text-destructive">not set</em>}</div>
            <Docs docs={s.b_yearsOfExperience.documents} />
          </div>
        </Row>

        <Row letter="c" title="Scope understanding" icon={FileText} complete={s.c_scopeUnderstanding.complete}>
          <div className="text-xs whitespace-pre-wrap bg-card border rounded p-2 max-h-40 overflow-y-auto">
            {s.c_scopeUnderstanding.scopeUnderstanding || <em className="text-destructive">not provided</em>}
          </div>
        </Row>

        <Row letter="d" title="Certifications" icon={Award} complete={s.d_certifications.complete}>
          <div className="text-xs space-y-2">
            <div>
              <div className="font-medium text-muted-foreground mb-0.5">Firm level</div>
              <Docs docs={s.d_certifications.firmDocuments} />
            </div>
            <div>
              <div className="font-medium text-muted-foreground mb-0.5">Staff level</div>
              <Docs docs={s.d_certifications.staffDocuments} />
            </div>
          </div>
        </Row>

        <Row letter="e" title="References" icon={Handshake} complete={s.e_references.complete}>
          <div className="text-xs space-y-1.5">
            {s.e_references.references.length === 0
              ? <em className="text-destructive">no references added</em>
              : s.e_references.references.map((r: any) => (
                  <div key={r.id} className="bg-card border rounded p-2">
                    <div className="font-semibold">{r.clientName}</div>
                    <div className="text-muted-foreground">
                      Contact: {r.contactPerson}
                      {r.contactEmail && ` · ${r.contactEmail}`}
                      {r.contactPhone && ` · ${r.contactPhone}`}
                    </div>
                    <div>
                      {new Date(r.engagementStartDate).toLocaleDateString()} – {r.engagementEndDate ? new Date(r.engagementEndDate).toLocaleDateString() : 'ongoing'}
                    </div>
                    <div className="text-muted-foreground">{r.servicesProvided}</div>
                  </div>
                ))
            }
          </div>
        </Row>

        <Row letter="f" title="Program of works" icon={Users} complete={s.f_programOfWorks.complete}>
          <div className="text-xs space-y-1.5">
            {s.f_programOfWorks.programOfWorksText && (
              <div className="whitespace-pre-wrap bg-card border rounded p-2 max-h-32 overflow-y-auto">
                {s.f_programOfWorks.programOfWorksText}
              </div>
            )}
            <Docs docs={s.f_programOfWorks.documents} />
          </div>
        </Row>
      </div>
    </div>
  )
}

function Row({ letter, title, icon: Icon, complete, children }: {
  letter: string; title: string; icon: any; complete: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!complete)
  return (
    <div className="rounded-md border bg-card">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
        {complete
          ? <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />
          : <XCircle className="h-4 w-4 text-destructive shrink-0" />}
        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-mono text-muted-foreground">({letter})</span>
        <span className="text-sm font-medium flex-1 truncate">{title}</span>
      </button>
      {open && <div className="px-3 pb-3 pt-1 border-t">{children}</div>}
    </div>
  )
}

function Docs({ docs }: { docs: any[] }) {
  if (!docs || docs.length === 0) return <em className="text-destructive">no documents uploaded</em>
  return (
    <div className="space-y-1">
      {docs.map((d: any) => (
        <div key={d.id} className="flex items-center gap-2">
          <FileText className="h-3 w-3 text-muted-foreground" />
          <span className="truncate">{d.fileName}</span>
          {d.fileSize && <span className="text-muted-foreground">({(d.fileSize / 1024).toFixed(1)} KB)</span>}
        </div>
      ))}
    </div>
  )
}
