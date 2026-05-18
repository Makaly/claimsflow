import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  AlertTriangle, FileQuestion, Loader2, RefreshCw,
  CheckCircle2, ExternalLink, Eye, Search, Sparkles, Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import api from '@/services/api'

interface UnknownDoc {
  id: string
  fileName: string
  mimeType: string
  guessedType: string | null
  guessedProvider: string | null
  rawExtract: Record<string, string> | null
  status: 'pending' | 'reviewed' | 'template_created'
  reviewedBy: string | null
  reviewedAt: string | null
  notes: string | null
  createdAt: string
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending:          { label: 'Pending Review', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  reviewed:         { label: 'Reviewed',       color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'  },
  template_created: { label: 'Template Added', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
}

export default function UnknownDocuments() {
  const navigate = useNavigate()
  const [docs, setDocs]         = useState<UnknownDoc[]>([])
  const [total, setTotal]       = useState(0)
  const [loading, setLoading]   = useState(true)
  const [statusFilter, setStatusFilter] = useState('pending')
  const [page, setPage]         = useState(1)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [notes, setNotes]       = useState('')
  const [viewingId, setViewingId]       = useState<string | null>(null)
  const [deletingId, setDeletingId]     = useState<string | null>(null)
  const [missingFileIds, setMissingFileIds] = useState<Set<string>>(new Set())
  const blobUrlsRef = useRef<Record<string, string>>({})
  const limit = 15

  const viewFile = async (doc: UnknownDoc) => {
    if (missingFileIds.has(doc.id)) return
    setViewingId(doc.id)
    try {
      if (blobUrlsRef.current[doc.id]) {
        window.open(blobUrlsRef.current[doc.id], '_blank')
        return
      }
      let blob: Blob
      try {
        const { data } = await api.get(`/unknown-documents/${doc.id}/file`, { responseType: 'blob' })
        blob = data
      } catch (err: any) {
        if (err?.response?.status === 404) {
          setMissingFileIds(prev => new Set([...prev, doc.id]))
          toast.error('Original file no longer on disk', {
            description: 'This record can be safely deleted — the source file was in a temporary folder that has been cleaned up.',
          })
        } else {
          throw err
        }
        return
      }
      const url = URL.createObjectURL(blob)
      blobUrlsRef.current[doc.id] = url
      window.open(url, '_blank')
    } catch (err: any) {
      toast.error('Could not load file', { description: err.message })
    } finally {
      setViewingId(null)
    }
  }

  const deleteRecord = async (id: string) => {
    setDeletingId(id)
    try {
      await api.delete(`/unknown-documents/${id}`)
      toast.success('Record deleted')
      setDocs(prev => prev.filter(d => d.id !== id))
      setTotal(prev => prev - 1)
    } catch (err: any) {
      toast.error('Delete failed', { description: err?.response?.data?.message || err.message })
    } finally {
      setDeletingId(null)
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/unknown-documents', {
        params: { status: statusFilter || undefined, page, limit },
      })
      setDocs(data.items)
      setTotal(data.total)
    } finally {
      setLoading(false)
    }
  }, [statusFilter, page])

  useEffect(() => { load() }, [load])

  const markReviewed = async (id: string) => {
    await api.patch(`/unknown-documents/${id}/review`, { notes })
    setReviewingId(null)
    setNotes('')
    load()
  }

  const openInClassifier = (doc: UnknownDoc) => {
    navigate('/settings?tab=document-classifiers')
  }

  return (
    <div className="space-y-6 max-w-6xl">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileQuestion className="h-6 w-6 text-amber-500" />
            Unknown Documents
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Documents uploaded that didn't match any classifier template. Review and create templates for them.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1) }}>
          <SelectTrigger className="w-44 h-8 text-xs">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pending Review</SelectItem>
            <SelectItem value="reviewed">Reviewed</SelectItem>
            <SelectItem value="template_created">Template Created</SelectItem>
            <SelectItem value="">All Statuses</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{total} document{total !== 1 ? 's' : ''}</span>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : docs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
          <CheckCircle2 className="h-12 w-12 mb-3 opacity-30" />
          <p className="text-sm font-medium">No unknown documents{statusFilter === 'pending' ? ' pending review' : ''}</p>
          <p className="text-xs mt-1">All uploaded documents matched existing classifier templates.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {docs.map((doc) => {
            const st = STATUS_LABELS[doc.status] || STATUS_LABELS.pending
            const isReviewing = reviewingId === doc.id
            const fields = doc.rawExtract ? Object.entries(doc.rawExtract).filter(([, v]) => v) : []

            return (
              <div key={doc.id} className="rounded-xl border bg-card shadow-sm p-4 space-y-3">
                {/* Row 1: filename + status */}
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                      <p className="font-semibold text-sm truncate">{doc.fileName}</p>
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${st.color}`}>
                        {st.label}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Uploaded {new Date(doc.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                    {missingFileIds.has(doc.id) ? (
                      <>
                        <span className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-red-200 bg-red-50 text-red-600 text-xs font-medium">
                          <AlertTriangle className="h-3 w-3" /> File Missing
                        </span>
                        <Button size="sm" variant="outline"
                          className="h-7 text-xs gap-1.5 border-red-200 text-red-600 hover:bg-red-50"
                          onClick={() => deleteRecord(doc.id)}
                          disabled={deletingId === doc.id}>
                          {deletingId === doc.id
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <><Trash2 className="h-3 w-3" /> Delete Record</>
                          }
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                        onClick={() => viewFile(doc)}
                        disabled={viewingId === doc.id}>
                        {viewingId === doc.id
                          ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</>
                          : <><Eye className="h-3.5 w-3.5" /> View File</>
                        }
                      </Button>
                    )}
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                      onClick={() => openInClassifier(doc)}>
                      <ExternalLink className="h-3.5 w-3.5" /> Open in Classifier
                    </Button>
                    {doc.status === 'pending' && (
                      <Button size="sm" variant="default" className="h-7 text-xs gap-1.5"
                        onClick={() => setReviewingId(isReviewing ? null : doc.id)}>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {isReviewing ? 'Cancel' : 'Mark Reviewed'}
                      </Button>
                    )}
                  </div>
                </div>

                {/* AI guess */}
                {(doc.guessedType || doc.guessedProvider) && (
                  <div className="rounded-md bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 px-3 py-2 flex items-start gap-2">
                    <Sparkles className="h-3.5 w-3.5 text-violet-500 shrink-0 mt-0.5" />
                    <div className="min-w-0 text-xs text-violet-800 dark:text-violet-200">
                      <span className="font-semibold">AI Analysis: </span>
                      {doc.guessedType && <span>{doc.guessedType}</span>}
                      {doc.guessedProvider && <span className="text-muted-foreground"> · {doc.guessedProvider}</span>}
                    </div>
                  </div>
                )}

                {/* Extracted fields (best effort) */}
                {fields.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {fields.slice(0, 8).map(([k, v]) => (
                      <div key={k} className="rounded-md bg-muted/60 px-2 py-1 text-xs">
                        <span className="text-muted-foreground">{k}: </span>
                        <span className="font-mono font-medium">{v}</span>
                      </div>
                    ))}
                    {fields.length > 8 && (
                      <span className="text-xs text-muted-foreground self-center">+{fields.length - 8} more</span>
                    )}
                  </div>
                )}

                {/* Mark reviewed form */}
                {isReviewing && (
                  <div className="rounded-lg border bg-background p-3 space-y-2">
                    <Input
                      className="h-8 text-xs" placeholder="Optional notes (what kind of document is it?)"
                      value={notes} onChange={(e) => setNotes(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button size="sm" className="h-7 text-xs gap-1.5" onClick={() => markReviewed(doc.id)}>
                        <CheckCircle2 className="h-3.5 w-3.5" /> Confirm Review
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setReviewingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span className="text-xs text-muted-foreground">Page {page} of {Math.ceil(total / limit)}</span>
          <Button variant="outline" size="sm" disabled={page >= Math.ceil(total / limit)} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  )
}
