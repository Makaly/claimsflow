import { useState, useEffect, useRef } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import {
  Search, FileText, Eye, Download, Merge,
  Scissors, CheckCircle2, XCircle,
  Trash2, Link2, RefreshCw, PenLine,
  Sparkles, Loader2, Plus,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { formatDate } from '@/lib/utils'
import { Pagination } from '@/components/Pagination'
import { PdfViewerModal } from '@/components/PdfViewerModal'
import { AnnotationCanvas } from '@/components/AnnotationCanvas'
import api from '@/services/api'
import { useAuthStore } from '@/store/authStore'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Document {
  id: string
  originalName: string
  filename: string
  mimetype: string
  documentType?: string
  claimId?: string
  claim?: { claimNumber: string }
  batchNumber?: string
  size: number
  ocrStatus: string
  ocrConfidence?: number
  pageCount?: number
  hasAnnotations: boolean
  annotationsCount: number
  hasWatermark: boolean
  isLatestVersion: boolean
  createdAt: string
  edmsStatus?: string
}

interface PurgeRequest {
  id: string
  mergedDocumentId?: string
  sourceDocumentIds: string[]
  reason: string
  requestedBy: string
  status: 'pending' | 'approved' | 'rejected'
  createdAt: string
}

// ─── Color helpers ────────────────────────────────────────────────────────────

const ocrColors: Record<string, string> = {
  completed: 'bg-emerald-100 text-emerald-800',
  processing: 'bg-blue-100 text-blue-800',
  manual_review: 'bg-amber-100 text-amber-800',
  failed: 'bg-red-100 text-red-800',
  pending: 'bg-gray-100 text-gray-600',
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Documents() {
  const { user } = useAuthStore()
  const [documents, setDocuments] = useState<Document[]>([])
  const [purgeRequests, setPurgeRequests] = useState<PurgeRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Viewer
  const [viewerOpen, setViewerOpen] = useState(false)
  const [viewerUrl, setViewerUrl] = useState('')
  const [viewerFilename, setViewerFilename] = useState('')

  // Annotation dialog
  const [annotateDoc, setAnnotateDoc] = useState<Document | null>(null)

  // Merge dialog
  const [showMergeDialog, setShowMergeDialog] = useState(false)
  const [mergeOutputName, setMergeOutputName] = useState('merged.pdf')
  const [mergeClaimId, setMergeClaimId] = useState('')
  const [mergingLoading, setMergingLoading] = useState(false)

  // Split dialog
  const [splitDoc, setSplitDoc] = useState<Document | null>(null)
  const [splitRanges, setSplitRanges] = useState<Array<{ start: number; end: number; name: string; documentType?: string }>>([{ start: 1, end: 1, name: 'part_1' }])
  const [analyzingPages, setAnalyzingPages] = useState(false)
  const [analysisDone, setAnalysisDone] = useState(false)
  const [thumbnails, setThumbnails] = useState<string[]>([])
  const [thumbsLoading, setThumbsLoading] = useState(false)
  const splitPdfDocRef = useRef<any>(null)

  const SEGMENT_COLORS = ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316','#6366f1']
  const getPageSegmentIdx = (page: number) =>
    splitRanges.findIndex(r => r.start <= page && page <= r.end)

  const loadSplitThumbnails = async (doc: Document) => {
    setThumbsLoading(true)
    setThumbnails([])
    try {
      const res = await api.get(`/documents/${doc.id}/download`, { responseType: 'arraybuffer' })
      const arrayBuffer = res.data as ArrayBuffer
      const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise
      splitPdfDocRef.current = pdfDoc
      const total = pdfDoc.numPages
      const thumbs: string[] = []
      for (let p = 1; p <= total; p++) {
        const page = await pdfDoc.getPage(p)
        const viewport = page.getViewport({ scale: 0.13 })
        const canvas = document.createElement('canvas')
        canvas.width = viewport.width
        canvas.height = viewport.height
        await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise
        thumbs.push(canvas.toDataURL('image/jpeg', 0.75))
      }
      setThumbnails(thumbs)
    } catch {
      setThumbnails([])
    } finally {
      setThumbsLoading(false)
    }
  }

  // Purge dialog
  const [showPurgeReview, setShowPurgeReview] = useState(false)
  const [selectedPurge, setSelectedPurge] = useState<PurgeRequest | null>(null)
  const [purgeNotes, setPurgeNotes] = useState('')

  // EDMS sync
  const [syncingId, setSyncingId] = useState<string | null>(null)

  useEffect(() => {
    fetchDocuments()
    fetchPurgeRequests()
  }, [])

  const fetchDocuments = async () => {
    try {
      const res = await api.get('/documents')
      // Backend returns { documents: [...], total: N }
      const docs = Array.isArray(res.data) ? res.data : (res.data?.documents ?? [])
      setDocuments(docs)
    } catch {
      setDocuments(getDemoDocuments())
    } finally {
      setLoading(false)
    }
  }

  const fetchPurgeRequests = async () => {
    try {
      const res = await api.get('/documents/purge-requests/pending')
      setPurgeRequests(res.data)
    } catch { /* silent */ }
  }

  // ─── Filtered list ────────────────────────────────────────────

  const filtered = documents.filter(doc => {
    const matchesSearch =
      doc.originalName.toLowerCase().includes(search.toLowerCase()) ||
      (doc.claim?.claimNumber || '').toLowerCase().includes(search.toLowerCase()) ||
      (doc.batchNumber || '').toLowerCase().includes(search.toLowerCase())
    const matchesType = typeFilter === 'all' || doc.documentType === typeFilter
    return matchesSearch && matchesType
  })

  // ─── Selection ────────────────────────────────────────────────

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filtered.map(d => d.id)))
    }
  }

  // ─── Viewer ───────────────────────────────────────────────────

  const openViewer = async (doc: Document) => {
    setViewerFilename(doc.originalName)
    setViewerOpen(true)
    try {
      const res = await api.get(`/documents/${doc.id}/download`, { responseType: 'blob' })
      setViewerUrl(URL.createObjectURL(res.data as Blob))
    } catch {
      const baseUrl = import.meta.env.VITE_API_URL || '/api'
      setViewerUrl(`${baseUrl}/documents/${doc.id}/download`)
    }
  }

  // ─── Merge ────────────────────────────────────────────────────

  const startMerge = () => {
    if (selectedIds.size < 2) {
      toast.error('Select at least 2 documents to merge')
      return
    }
    const doc = documents.find(d => selectedIds.has(d.id))
    setMergeClaimId(doc?.claimId || '')
    setShowMergeDialog(true)
  }

  const executeMerge = async () => {
    setMergingLoading(true)
    try {
      const res = await api.post('/documents/merge', {
        documentIds: [...selectedIds],
        outputName: mergeOutputName,
        claimId: mergeClaimId,
      })
      toast.success(`Merged into ${mergeOutputName} — purge request created for approval`)
      setShowMergeDialog(false)
      setSelectedIds(new Set())
      fetchDocuments()
      fetchPurgeRequests()
    } catch (err: any) {
      toast.error(`Merge failed: ${err?.response?.data?.message || err?.message}`)
    } finally {
      setMergingLoading(false)
    }
  }

  // ─── Split ────────────────────────────────────────────────────

  const analyzePages = async () => {
    if (!splitDoc) return
    setAnalyzingPages(true)
    setAnalysisDone(false)
    try {
      const res = await api.post(`/documents/${splitDoc.id}/analyze-pages`)
      const { segments, totalPages } = res.data
      if (segments && segments.length > 0) {
        setSplitRanges(segments.map((s: any) => ({
          start: s.start,
          end: s.end,
          name: s.label?.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40) || `part_${s.start}`,
          documentType: s.documentType,
        })))
        setAnalysisDone(true)
        toast.success(`AI identified ${segments.length} document section(s) across ${totalPages} pages`)
      }
    } catch (err: any) {
      toast.error(`Analysis failed: ${err?.response?.data?.message || err?.message}`)
    } finally {
      setAnalyzingPages(false)
    }
  }

  const executeSplit = async () => {
    if (!splitDoc) return
    try {
      const res = await api.post(`/documents/${splitDoc.id}/split`, { pageRanges: splitRanges })
      const count = res.data.splitDocuments?.length ?? splitRanges.length
      toast.success(`${count} document(s) created`, {
        description: 'The list below has been refreshed with the new documents.',
        duration: 4000,
      })
      setSplitDoc(null)
      setAnalysisDone(false)
      fetchDocuments()
    } catch (err: any) {
      toast.error(`Split failed: ${err?.response?.data?.message || err?.message}`)
    }
  }

  // ─── Purge approval ───────────────────────────────────────────

  const approvePurge = async (req: PurgeRequest) => {
    try {
      await api.post(`/documents/purge-requests/${req.id}/approve`, { notes: purgeNotes })
      toast.success(`Purge approved — ${req.sourceDocumentIds.length} source(s) removed`)
      setShowPurgeReview(false)
      fetchPurgeRequests()
      fetchDocuments()
    } catch (err: any) {
      toast.error(`Failed: ${err?.response?.data?.message || err?.message}`)
    }
  }

  const rejectPurge = async (req: PurgeRequest) => {
    try {
      await api.post(`/documents/purge-requests/${req.id}/reject`, { notes: purgeNotes || 'Rejected' })
      toast.info('Purge request rejected')
      setShowPurgeReview(false)
      fetchPurgeRequests()
    } catch (err: any) {
      toast.error(`Failed: ${err?.response?.data?.message || err?.message}`)
    }
  }

  // ─── EDMS sync ────────────────────────────────────────────────

  const triggerEdmsSync = async (docId: string) => {
    setSyncingId(docId)
    try {
      await api.post(`/documents/${docId}/edms-sync`)
      toast.success('Synced to EDMS')
      fetchDocuments()
    } catch (err: any) {
      toast.error(`EDMS sync failed: ${err?.message}`)
    } finally {
      setSyncingId(null)
    }
  }

  // ─── Stats ────────────────────────────────────────────────────

  const stats = {
    total: documents.length,
    ocrDone: documents.filter(d => d.ocrStatus === 'completed').length,
    review: documents.filter(d => d.ocrStatus === 'manual_review').length,
    failed: documents.filter(d => d.ocrStatus === 'failed').length,
    pendingPurge: purgeRequests.length,
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Documents</h1>
          <p className="text-muted-foreground">View, annotate, merge and manage claim documents</p>
        </div>
        {purgeRequests.length > 0 && (
          <Badge
            className="bg-amber-100 text-amber-800 cursor-pointer hover:bg-amber-200"
            onClick={() => setShowPurgeReview(true)}
          >
            {purgeRequests.length} purge request(s) pending approval
          </Badge>
        )}
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-5">
        {[
          { label: 'Total', value: stats.total, color: '' },
          { label: 'OCR Done', value: stats.ocrDone, color: 'text-emerald-600' },
          { label: 'Needs Review', value: stats.review, color: 'text-amber-600' },
          { label: 'Failed', value: stats.failed, color: 'text-red-600' },
          { label: 'Purge Pending', value: stats.pendingPurge, color: 'text-orange-600' },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="documents">
        <TabsList>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="purge">
            Purge Requests
            {purgeRequests.length > 0 && (
              <Badge className="ml-1.5 h-4 min-w-4 text-[10px] px-1 bg-amber-500">{purgeRequests.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Documents tab ── */}
        <TabsContent value="documents" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input placeholder="Search documents, claims, batches…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
                </div>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="w-[180px]"><SelectValue placeholder="Document Type" /></SelectTrigger>
                  <SelectContent>
                    {['all', 'invoice', 'lab_result', 'prescription', 'discharge_summary', 'medical_report', 'claim_form', 'pre_auth', 'referral', 'merged'].map(t => (
                      <SelectItem key={t} value={t}>{t === 'all' ? 'All Types' : t.replace(/_/g, ' ')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedIds.size > 0 && (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={startMerge} className="gap-1">
                      <Merge className="h-3.5 w-3.5" /> Merge ({selectedIds.size})
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                      Clear
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-9">
                      <Checkbox
                        checked={selectedIds.size === filtered.length && filtered.length > 0}
                        onCheckedChange={selectAll}
                      />
                    </TableHead>
                    <TableHead>Document</TableHead>
                    <TableHead>Claim / Batch</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Pages</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>OCR</TableHead>
                    <TableHead>Confidence</TableHead>
                    <TableHead>EDMS</TableHead>
                    <TableHead>Uploaded</TableHead>
                    <TableHead className="w-32"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">No documents found</TableCell></TableRow>
                  ) : filtered.slice((page - 1) * pageSize, page * pageSize).map((doc) => (
                    <TableRow key={doc.id} className={selectedIds.has(doc.id) ? 'bg-blue-50 dark:bg-blue-950/20' : ''}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(doc.id)}
                          onCheckedChange={() => toggleSelect(doc.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div>
                            <p className="text-sm font-medium truncate max-w-[180px]">{doc.originalName}</p>
                            {doc.hasAnnotations && (
                              <p className="text-[10px] text-blue-500">{doc.annotationsCount} annotation(s)</p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          {doc.claim && <p className="text-xs font-mono">{doc.claim.claimNumber}</p>}
                          {doc.batchNumber && <p className="text-[10px] text-muted-foreground">{doc.batchNumber}</p>}
                        </div>
                      </TableCell>
                      <TableCell>
                        {doc.documentType && (
                          <Badge variant="outline" className="capitalize text-[10px]">
                            {doc.documentType.replace(/_/g, ' ')}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{doc.pageCount || '—'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{(doc.size / 1024).toFixed(0)} KB</TableCell>
                      <TableCell>
                        <Badge className={`${ocrColors[doc.ocrStatus] || ocrColors.pending} text-[10px]`} variant="secondary">
                          {doc.ocrStatus.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {doc.ocrConfidence != null ? (
                          <div className="flex items-center gap-1.5">
                            <Progress
                              value={doc.ocrConfidence * 100}
                              className="h-1.5 w-14"
                            />
                            <span className={`text-xs font-medium ${doc.ocrConfidence > 0.85 ? 'text-emerald-600' : doc.ocrConfidence > 0.7 ? 'text-amber-600' : 'text-red-600'}`}>
                              {(doc.ocrConfidence * 100).toFixed(0)}%
                            </span>
                          </div>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-[10px] cursor-pointer ${doc.edmsStatus === 'synced' ? 'border-emerald-300 text-emerald-700' : 'border-gray-300 text-gray-500'}`}
                          onClick={() => triggerEdmsSync(doc.id)}
                          title="Click to sync to EDMS"
                        >
                          {syncingId === doc.id ? (
                            <RefreshCw className="h-3 w-3 animate-spin" />
                          ) : doc.edmsStatus === 'synced' ? (
                            <><CheckCircle2 className="h-3 w-3 mr-1" />Synced</>
                          ) : (
                            <><Link2 className="h-3 w-3 mr-1" />Sync</>
                          )}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(doc.createdAt)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="View" onClick={() => openViewer(doc)}>
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Annotate" onClick={() => setAnnotateDoc(doc)}>
                            <PenLine className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Split & Categorize"
                            onClick={() => {
                              setSplitDoc(doc)
                              setSplitRanges([{ start: 1, end: doc.pageCount || 1, name: 'part_1' }])
                              setAnalysisDone(false)
                              setThumbnails([])
                              if (doc.mimetype === 'application/pdf') loadSplitThumbnails(doc)
                            }}>
                            <Scissors className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Download"
                            onClick={() => window.open(`${import.meta.env.VITE_API_URL || '/api'}/documents/${doc.id}/download`, '_blank')}>
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination
                page={page}
                pageSize={pageSize}
                total={filtered.length}
                onPageChange={setPage}
                onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Purge Requests tab ── */}
        <TabsContent value="purge" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pending Purge Approvals</CardTitle>
            </CardHeader>
            <CardContent>
              {purgeRequests.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No pending purge requests</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Merged Document</TableHead>
                      <TableHead>Sources to Purge</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Requested By</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {purgeRequests.map(req => (
                      <TableRow key={req.id}>
                        <TableCell className="font-mono text-xs">{req.mergedDocumentId?.slice(0, 8)}…</TableCell>
                        <TableCell>
                          <Badge variant="outline">{req.sourceDocumentIds.length} document(s)</Badge>
                        </TableCell>
                        <TableCell className="text-sm">{req.reason}</TableCell>
                        <TableCell className="text-sm">{req.requestedBy}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatDate(req.createdAt)}</TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 h-7"
                              onClick={() => { setSelectedPurge(req); setShowPurgeReview(true) }}>
                              Review
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── PDF Viewer ── */}
      <PdfViewerModal
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
        url={viewerUrl}
        filename={viewerFilename}
      />

      {/* ── Annotation dialog ── */}
      <Dialog open={!!annotateDoc} onOpenChange={(o) => !o && setAnnotateDoc(null)}>
        <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Annotate — {annotateDoc?.originalName}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto relative bg-gray-100 rounded">
            {annotateDoc && (
              <div className="p-4">
                <p className="text-sm text-muted-foreground mb-3">
                  Use the toolbar at the bottom to add stamps, highlights, redactions, notes, signatures, or drawings.
                </p>
                <AnnotationCanvas
                  documentId={annotateDoc.id}
                  pageNumber={1}
                  canvasWidth={600}
                  canvasHeight={800}
                  userName={user?.name}
                  userRole={user?.role}
                  onAnnotationChange={fetchDocuments}
                />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Merge dialog ── */}
      <Dialog open={showMergeDialog} onOpenChange={setShowMergeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge {selectedIds.size} Documents</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Output File Name</Label>
              <Input value={mergeOutputName} onChange={(e) => setMergeOutputName(e.target.value)} placeholder="merged.pdf" />
            </div>
            <p className="text-xs text-muted-foreground">
              A purge request will be created to remove the source documents after merging.
              A claims officer must approve before the originals are deleted.
            </p>
            <div className="rounded bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
              Source documents ({selectedIds.size}) will be queued for purge approval after merge completes.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMergeDialog(false)}>Cancel</Button>
            <Button onClick={executeMerge} disabled={mergingLoading}>
              {mergingLoading ? 'Merging…' : 'Merge Documents'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Split & Categorize dialog ── */}
      <Dialog open={!!splitDoc} onOpenChange={(o) => { if (!o) { setSplitDoc(null); setAnalysisDone(false) } }}>
        <DialogContent className="max-w-5xl p-0 gap-0 overflow-hidden" style={{ height: '82vh' }}>
          <DialogTitle className="sr-only">Split &amp; Categorize Document</DialogTitle>
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b bg-background shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <Scissors className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <h2 className="text-sm font-semibold leading-tight">Split &amp; Categorize</h2>
                <p className="text-[11px] text-muted-foreground leading-tight">{splitDoc?.originalName} · {splitDoc?.pageCount || '?'} pages</p>
              </div>
            </div>
            {analysisDone && (
              <span className="flex items-center gap-1 text-[11px] text-emerald-600 font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" /> {splitRanges.length} section{splitRanges.length !== 1 ? 's' : ''} identified
              </span>
            )}
          </div>

          {/* Two-panel body */}
          <div className="flex overflow-hidden" style={{ height: 'calc(82vh - 57px)' }}>
            {/* Left: thumbnail grid */}
            <div className="w-[52%] border-r flex flex-col overflow-hidden bg-slate-50 dark:bg-slate-900/40">
              <div className="px-4 py-2 border-b bg-background/80 shrink-0 flex items-center justify-between">
                <p className="text-[11px] font-medium text-muted-foreground">Pages — bordered by section colour</p>
                <Button size="sm" variant={analysisDone ? 'outline' : 'default'}
                  className={`h-7 text-xs gap-1 ${!analysisDone ? 'bg-blue-600 hover:bg-blue-700' : ''}`}
                  onClick={analyzePages} disabled={analyzingPages}>
                  {analyzingPages
                    ? <><RefreshCw className="h-3 w-3 animate-spin" />Analyzing…</>
                    : <><Sparkles className="h-3 w-3" />{analysisDone ? 'Re-analyze' : 'Auto-Categorize'}</>
                  }
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                {thumbsLoading ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin" />
                    <p className="text-xs">Rendering page previews…</p>
                  </div>
                ) : thumbnails.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
                    <FileText className="h-10 w-10 opacity-20" />
                    <p className="text-xs">Click the scissors icon to load this document</p>
                  </div>
                ) : (
                  <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))' }}>
                    {thumbnails.map((thumb, idx) => {
                      const page = idx + 1
                      const segIdx = getPageSegmentIdx(page)
                      const color = segIdx >= 0 ? SEGMENT_COLORS[segIdx % SEGMENT_COLORS.length] : '#cbd5e1'
                      return (
                        <div key={idx} className="flex flex-col items-center gap-1">
                          <div className="relative rounded-md overflow-hidden shadow-sm transition-transform hover:scale-105"
                            style={{ border: `2.5px solid ${color}`, width: '100%' }}>
                            <div style={{ height: 4, background: color }} />
                            {thumb ? (
                              <img src={thumb} alt={`p${page}`}
                                style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover', display: 'block' }} />
                            ) : (
                              <div style={{ aspectRatio: '3/4', background: '#f1f5f9' }} className="flex items-center justify-center">
                                <FileText className="h-5 w-5 text-muted-foreground/40" />
                              </div>
                            )}
                            {segIdx >= 0 && (
                              <div className="absolute top-1 right-1 text-white text-[9px] font-bold rounded-full flex items-center justify-center"
                                style={{ background: color, width: 16, height: 16 }}>
                                {segIdx + 1}
                              </div>
                            )}
                          </div>
                          <span className="text-[10px] tabular-nums font-medium" style={{ color }}>p.{page}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Right: section definitions */}
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="px-4 py-2 border-b bg-background/80 shrink-0 flex items-center justify-between">
                <p className="text-[11px] font-medium text-muted-foreground">Sections · {splitRanges.length} defined</p>
                <button className="text-[11px] text-blue-600 font-medium hover:text-blue-800 flex items-center gap-1"
                  onClick={() => setSplitRanges(prev => [...prev, {
                    start: Math.max(1, (prev[prev.length - 1]?.end ?? 0) + 1),
                    end: splitDoc?.pageCount || 1,
                    name: `section_${prev.length + 1}`,
                  }])}>
                  + Add Section
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                {splitRanges.map((range, i) => {
                  const color = SEGMENT_COLORS[i % SEGMENT_COLORS.length]
                  const DOC_TYPES = [
                    { value: 'invoice',           label: 'Invoice / Bill',      icon: '🧾' },
                    { value: 'lab_result',        label: 'Lab Results',         icon: '🔬' },
                    { value: 'prescription',      label: 'Prescription',        icon: '💊' },
                    { value: 'discharge_summary', label: 'Discharge Summary',   icon: '🏥' },
                    { value: 'medical_report',    label: 'Medical Report',      icon: '📋' },
                    { value: 'claim_form',        label: 'Claim Form',          icon: '📝' },
                    { value: 'pre_auth',          label: 'Pre-Authorization',   icon: '✅' },
                    { value: 'referral',          label: 'Referral Letter',     icon: '📨' },
                    { value: 'supporting',        label: 'Supporting Document', icon: '📎' },
                  ]
                  const docLabel = DOC_TYPES.find(d => d.value === range.documentType)
                  return (
                    <div key={i} className="rounded-xl border bg-card shadow-sm overflow-hidden"
                      style={{ borderTop: `3px solid ${color}` }}>
                      <div className="flex items-center gap-2.5 px-3 pt-2.5 pb-2">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white text-[11px] font-bold"
                          style={{ background: color }}>{i + 1}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-semibold truncate">
                            {docLabel ? `${docLabel.icon} ${docLabel.label}` : 'Uncategorized section'}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            Pages {range.start}–{range.end} · {Math.max(0, range.end - range.start + 1)} page{range.end - range.start !== 0 ? 's' : ''}
                          </p>
                        </div>
                        {splitRanges.length > 1 && (
                          <button className="text-muted-foreground/40 hover:text-destructive"
                            onClick={() => setSplitRanges(prev => prev.filter((_, j) => j !== i))}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      <div className="px-3 pb-3 space-y-2">
                        <Select value={range.documentType || ''}
                          onValueChange={(v) => { const u = [...splitRanges]; u[i] = { ...u[i], documentType: v }; setSplitRanges(u) }}>
                          <SelectTrigger className="h-8 text-xs bg-muted/40 border-muted-foreground/20">
                            <SelectValue placeholder="Select document type…" />
                          </SelectTrigger>
                          <SelectContent>
                            {DOC_TYPES.map(opt => (
                              <SelectItem key={opt.value} value={opt.value}>{opt.icon} {opt.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="flex items-center gap-1.5">
                          <div className="flex items-center gap-1 rounded-md border bg-muted/30 px-2 py-1">
                            <span className="text-[10px] text-muted-foreground font-medium">p.</span>
                            <Input type="number" min={1} max={splitDoc?.pageCount} value={range.start}
                              onChange={(e) => { const u = [...splitRanges]; u[i] = { ...u[i], start: +e.target.value || 1 }; setSplitRanges(u) }}
                              className="w-10 h-6 text-center text-xs border-none bg-transparent p-0 focus-visible:ring-0" />
                            <span className="text-muted-foreground text-xs">–</span>
                            <Input type="number" min={1} max={splitDoc?.pageCount} value={range.end}
                              onChange={(e) => { const u = [...splitRanges]; u[i] = { ...u[i], end: +e.target.value || 1 }; setSplitRanges(u) }}
                              className="w-10 h-6 text-center text-xs border-none bg-transparent p-0 focus-visible:ring-0" />
                          </div>
                          <Input value={range.name}
                            onChange={(e) => { const u = [...splitRanges]; u[i] = { ...u[i], name: e.target.value }; setSplitRanges(u) }}
                            placeholder="File name…"
                            className="h-7 flex-1 text-xs bg-muted/30 border-muted-foreground/20" />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="border-t px-4 py-3 bg-background shrink-0 flex items-center justify-between">
                <p className="text-[11px] text-muted-foreground">
                  {splitRanges.filter(r => r.documentType).length}/{splitRanges.length} categorized
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="h-8"
                    onClick={() => { setSplitDoc(null); setAnalysisDone(false) }}>Cancel</Button>
                  <Button size="sm" className="h-8 gap-1.5 bg-blue-600 hover:bg-blue-700"
                    onClick={executeSplit} disabled={splitRanges.length === 0}>
                    <Scissors className="h-3.5 w-3.5" />
                    Split {splitRanges.length} Document{splitRanges.length !== 1 ? 's' : ''}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Purge review dialog ── */}
      <Dialog open={showPurgeReview && !!selectedPurge} onOpenChange={(o) => { if (!o) { setShowPurgeReview(false); setSelectedPurge(null) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review Purge Request</DialogTitle>
          </DialogHeader>
          {selectedPurge && (
            <div className="space-y-3">
              <div className="rounded bg-red-50 border border-red-200 p-3 text-sm text-red-800">
                <strong>Warning:</strong> Approving this request will permanently delete{' '}
                {selectedPurge.sourceDocumentIds.length} source document(s) from disk.
                This action cannot be undone.
              </div>
              <p><strong className="text-sm">Reason:</strong> <span className="text-sm">{selectedPurge.reason}</span></p>
              <p><strong className="text-sm">Requested by:</strong> <span className="text-sm">{selectedPurge.requestedBy}</span></p>
              <p><strong className="text-sm">Documents to purge:</strong> <span className="text-sm">{selectedPurge.sourceDocumentIds.length}</span></p>
              <div className="space-y-1.5">
                <Label>Review Notes</Label>
                <Input value={purgeNotes} onChange={(e) => setPurgeNotes(e.target.value)} placeholder="Optional notes…" />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setShowPurgeReview(false); setSelectedPurge(null) }}>Cancel</Button>
            <Button variant="destructive" onClick={() => selectedPurge && rejectPurge(selectedPurge)}>
              <XCircle className="h-4 w-4 mr-1" /> Reject
            </Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => selectedPurge && approvePurge(selectedPurge)}>
              <CheckCircle2 className="h-4 w-4 mr-1" /> Approve Purge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Demo data ────────────────────────────────────────────────────────────────

function getDemoDocuments(): Document[] {
  return [
    { id: '1', originalName: 'invoice_kamau.pdf', filename: 'inv1.pdf', mimetype: 'application/pdf', documentType: 'invoice', claim: { claimNumber: 'CLM-2026-00142' }, batchNumber: 'CIC-20260410-001', size: 245000, ocrStatus: 'completed', ocrConfidence: 0.95, pageCount: 2, hasAnnotations: false, annotationsCount: 0, hasWatermark: true, isLatestVersion: true, createdAt: '2026-04-10T09:00:00Z' },
    { id: '2', originalName: 'lab_results_wanjiku.pdf', filename: 'lab1.pdf', mimetype: 'application/pdf', documentType: 'lab_result', claim: { claimNumber: 'CLM-2026-00141' }, size: 890000, ocrStatus: 'completed', ocrConfidence: 0.88, pageCount: 4, hasAnnotations: true, annotationsCount: 2, hasWatermark: false, isLatestVersion: true, createdAt: '2026-04-09T14:30:00Z' },
    { id: '3', originalName: 'prescription_ochieng.jpg', filename: 'rx1.jpg', mimetype: 'image/jpeg', documentType: 'prescription', claim: { claimNumber: 'CLM-2026-00140' }, size: 1200000, ocrStatus: 'manual_review', ocrConfidence: 0.62, pageCount: 1, hasAnnotations: false, annotationsCount: 0, hasWatermark: false, isLatestVersion: true, createdAt: '2026-04-09T08:30:00Z' },
    { id: '4', originalName: 'discharge_summary.pdf', filename: 'dc1.pdf', mimetype: 'application/pdf', documentType: 'discharge_summary', claim: { claimNumber: 'CLM-2026-00139' }, size: 560000, ocrStatus: 'completed', ocrConfidence: 0.91, pageCount: 3, hasAnnotations: false, annotationsCount: 0, hasWatermark: true, isLatestVersion: true, createdAt: '2026-04-08T16:00:00Z' },
    { id: '5', originalName: 'medical_report.tiff', filename: 'mr1.tiff', mimetype: 'image/tiff', documentType: 'medical_report', claim: { claimNumber: 'CLM-2026-00138' }, size: 3400000, ocrStatus: 'processing', ocrConfidence: undefined, pageCount: 6, hasAnnotations: false, annotationsCount: 0, hasWatermark: false, isLatestVersion: true, createdAt: '2026-04-08T11:00:00Z' },
    { id: '6', originalName: 'invoice_njeri.pdf', filename: 'inv2.pdf', mimetype: 'application/pdf', documentType: 'invoice', claim: { claimNumber: 'CLM-2026-00137' }, size: 180000, ocrStatus: 'failed', ocrConfidence: undefined, pageCount: 1, hasAnnotations: false, annotationsCount: 0, hasWatermark: false, isLatestVersion: true, createdAt: '2026-04-07T10:00:00Z' },
  ]
}
