import { useCallback, useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { Loader2, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  /** URL to the document. Cookie-based auth (axios `withCredentials`) carries
   *  the JWT for inline previews of /providers/:id/onboarding-documents/:docId/file. */
  url: string
  /** Pages already acknowledged for this admin (from /review-readiness). */
  alreadyViewed?: number[]
  /** Called once after the document loads. */
  onLoadPages?: (totalPages: number) => void
  /** Called each time the user lands on a page they have not seen before. */
  onPageView?: (page: number) => void | Promise<void>
}

/**
 * Minimal page-by-page viewer used in the admin approval flow. Unlike the
 * full PdfViewerModal, this one:
 *   - is inline (no modal)
 *   - emits a "page viewed" event each time the user advances to a NEW page,
 *     which is how the backend builds the per-page audit trail
 *   - renders only one page at a time so the user must take an explicit step
 *     to "see" each page, which is the compliance bar we promised
 */
export function ReviewPdfPager({ url, alreadyViewed = [], onLoadPages, onPageView }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const docRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null)
  const reportedRef = useRef<Set<number>>(new Set(alreadyViewed))

  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Re-seed the reported set whenever the parent gives us a new baseline.
  useEffect(() => {
    reportedRef.current = new Set(alreadyViewed)
  }, [alreadyViewed.join(',')])

  // Load the document.
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    pdfjsLib.getDocument({ url, withCredentials: true }).promise
      .then((doc) => {
        if (cancelled) return
        docRef.current = doc
        setPageCount(doc.numPages)
        setPage(1)
        onLoadPages?.(doc.numPages)
      })
      .catch((e) => { if (!cancelled) setError(e?.message || 'Failed to load document') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => {
      cancelled = true
      renderTaskRef.current?.cancel()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  // Render the active page.
  const render = useCallback(async () => {
    const doc = docRef.current
    if (!doc || !canvasRef.current) return
    renderTaskRef.current?.cancel()
    try {
      const p = await doc.getPage(page)
      const viewport = p.getViewport({ scale: zoom })
      const canvas = canvasRef.current
      const ctx = canvas.getContext('2d')!
      canvas.width = viewport.width
      canvas.height = viewport.height
      renderTaskRef.current = p.render({ canvasContext: ctx, viewport } as any)
      await renderTaskRef.current.promise
    } catch (e: any) {
      if (e?.name !== 'RenderingCancelledException') console.error(e)
    }
  }, [page, zoom])

  useEffect(() => { render() }, [render])

  // Report the page view exactly once per (admin, document, page).
  useEffect(() => {
    if (!pageCount || !onPageView) return
    if (reportedRef.current.has(page)) return
    reportedRef.current.add(page)
    Promise.resolve(onPageView(page)).catch(() => {
      // If the network call fails, allow a retry by un-marking.
      reportedRef.current.delete(page)
    })
  }, [page, pageCount, onPageView])

  if (loading) {
    return (
      <div className="flex h-72 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading document…
      </div>
    )
  }
  if (error) {
    return <div className="flex h-72 items-center justify-center text-sm text-red-500">{error}</div>
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}>
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="font-medium tabular-nums">{page} / {pageCount}</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          {reportedRef.current.size >= pageCount && pageCount > 0 && (
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
              <CheckCircle2 className="h-3 w-3" /> All pages viewed
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}><ZoomOut className="h-3.5 w-3.5" /></Button>
          <span className="w-12 text-center text-xs">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}><ZoomIn className="h-3.5 w-3.5" /></Button>
        </div>
      </div>

      <div className="max-h-[70vh] overflow-auto rounded-md border bg-muted/30 p-3 text-center">
        <canvas ref={canvasRef} className="mx-auto shadow-sm" />
      </div>
    </div>
  )
}
