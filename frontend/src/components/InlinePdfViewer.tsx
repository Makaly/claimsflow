/**
 * InlinePdfViewer — lightweight PDF.js canvas renderer with OCR field strip,
 * user-annotation overlay, and flash-highlight. Extracted from Claims.tsx so
 * other review queues (CheckerQueue, ClaimsOfficerQueue) can share it.
 *
 * IMPORTANT: always pass a `key` prop tied to the document id/name so the
 * component fully remounts when the document changes. It captures `bytes`/`url`
 * at mount time via a ref and never re-reads them — this avoids "detached
 * ArrayBuffer" errors because pdfjs transfers ArrayBuffer ownership on load.
 */
import { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react'
import { toast } from 'sonner'
import * as pdfjsLib from 'pdfjs-dist'
import {
  ChevronLeft, ChevronRight, Eye, EyeOff,
  AlertTriangle, ScanLine, Loader2,
} from 'lucide-react'
import {
  Annotation as UserAnnotation,
  loadSigImage,
  renderAnnotations,
} from '@/components/annotations/renderer'
import api from '@/services/api'

export interface OcrAnnotation {
  page: number
  label: string
  value: string
  confidence?: number
  bbox?: { x: number; y: number; w: number; h: number }
  anomaly?: boolean
}

interface Props {
  bytes: Uint8Array | null
  url: string | null
  onFullScreen?: () => void
  annotations?: OcrAnnotation[]
  fraudSignalCount?: number
  claimId?: string
  /** When true, the user can drag a rectangle over the page to OCR that region. */
  zoneMode?: boolean
  /** Label of the field being captured — shown in the zone-mode banner. */
  zoneHint?: string
  /** Called with the OCR-extracted text once a zone is recognised. */
  onZoneText?: (text: string) => void
  /** Called when zone mode should end (capture done, or cancelled with Esc). */
  onExitZoneMode?: () => void
}

export function InlinePdfViewer({
  bytes, url, onFullScreen, annotations: annotationsProp = [], fraudSignalCount = 0, claimId,
  zoneMode = false, zoneHint, onZoneText, onExitZoneMode,
}: Props) {
  const srcRef = useRef<{ data: Uint8Array } | { url: string } | null>(
    bytes ? { data: bytes.slice() } : url ? { url } : null,
  )
  const canvasRef       = useRef<HTMLCanvasElement>(null)
  const annotOverlayRef = useRef<HTMLCanvasElement>(null)
  const containerRef    = useRef<HTMLDivElement>(null)
  const renderTaskRef   = useRef<pdfjsLib.RenderTask | null>(null)
  const mountedRef      = useRef(true)

  const [pdfDoc,     setPdfDoc]     = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [page,       setPage]       = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [scale,      setScale]      = useState(1)
  const [canvasDims, setCanvasDims] = useState<{ w: number; h: number } | null>(null)

  const [annotations,     setAnnotations]     = useState<OcrAnnotation[]>(annotationsProp)
  const [showAnnotations, setShowAnnotations] = useState(true)
  const [activeAnnotIdx,  setActiveAnnotIdx]  = useState(-1)
  const [userAnnotations, setUserAnnotations] = useState<UserAnnotation[]>([])
  const [flashBox, setFlashBox] = useState<{ page: number; x: number; y: number; w: number; h: number } | null>(null)

  // ── Zone OCR (drag a box → Tesseract on that region) ──────────────────────
  const [zoneStart, setZoneStart] = useState<{ x: number; y: number } | null>(null)
  const [zoneRect,  setZoneRect]  = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [zoneBusy,  setZoneBusy]  = useState(false)

  useEffect(() => {
    mountedRef.current = true
    if (!srcRef.current) return
    const task = pdfjsLib.getDocument(srcRef.current)
    task.promise
      .then(doc => { if (mountedRef.current) { setPdfDoc(doc); setTotalPages(doc.numPages) } })
      .catch(() => {})
    return () => {
      mountedRef.current = false
      task.destroy()
      renderTaskRef.current?.cancel()
    }
  }, [])

  useLayoutEffect(() => {
    if (!pdfDoc || !canvasRef.current || !containerRef.current || !mountedRef.current) return
    renderTaskRef.current?.cancel()
    const pageNum = page
    pdfDoc.getPage(pageNum).then(pg => {
      const canvas    = canvasRef.current
      const container = containerRef.current
      if (!canvas || !container || !mountedRef.current) return
      const containerW = container.clientWidth || 600
      const vp0 = pg.getViewport({ scale: 1 })
      const fit = containerW / vp0.width
      const vp  = pg.getViewport({ scale: fit * scale })
      canvas.width  = vp.width
      canvas.height = vp.height
      setCanvasDims({ w: vp.width, h: vp.height })
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const rt = pg.render({ canvasContext: ctx, viewport: vp })
      renderTaskRef.current = rt
      rt.promise.catch(() => {})
    }).catch(() => {})
  }, [pdfDoc, page, scale])

  useEffect(() => { setAnnotations(annotationsProp) }, [annotationsProp])

  useEffect(() => {
    if (!claimId) return
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claimId)
    if (!isUuid) return
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await api.get(`/claims/${claimId}/annotations`)
        if (cancelled) return
        const list = Array.isArray(data?.annotations) ? (data.annotations as UserAnnotation[]) : []
        setUserAnnotations(list)
      } catch { /* annotations are optional */ }
    })()
    return () => { cancelled = true }
  }, [claimId])

  useEffect(() => {
    if (!showAnnotations) return
    userAnnotations.forEach(a => {
      if (a.type === 'sign' && a.signatureDataUrl) {
        loadSigImage(a.signatureDataUrl, () => {
          const ov = annotOverlayRef.current
          if (!ov || !canvasDims) return
          const ctx = ov.getContext('2d')
          if (!ctx) return
          renderAnnotations(ctx, userAnnotations, page, canvasDims.w / 600, canvasDims.h / 800)
        })
      }
    })
  }, [userAnnotations, canvasDims, page, showAnnotations])

  useEffect(() => {
    if (!showAnnotations) return
    const ov = annotOverlayRef.current
    if (!ov || !canvasDims) return
    ov.width  = canvasDims.w
    ov.height = canvasDims.h
    const ctx = ov.getContext('2d')
    if (!ctx) return
    renderAnnotations(ctx, userAnnotations, page, canvasDims.w / 600, canvasDims.h / 800)
  }, [userAnnotations, canvasDims, page, showAnnotations])

  if (!srcRef.current) return null

  const pageAnnotations = annotations.filter(a => !a.page || a.page === page)
  const hasAnnotations  = annotations.length > 0 || userAnnotations.length > 0

  const goAnnotation = (delta: number) => {
    const newIdx = Math.max(0, Math.min(annotations.length - 1, activeAnnotIdx + delta))
    setActiveAnnotIdx(newIdx)
    const a = annotations[newIdx]
    if (a?.page) setPage(a.page)
  }

  const jumpToFieldValue = useCallback(async (a: OcrAnnotation) => {
    const idx = annotations.indexOf(a)
    if (idx >= 0) setActiveAnnotIdx(idx)
    if (!pdfDoc) return

    const MONTHS_SHORT = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
    const MONTHS_LONG  = ['january','february','march','april','may','june','july','august','september','october','november','december']
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

    const buildCandidates = (raw: string): string[] => {
      const v = raw.trim()
      if (!v) return []
      const out = new Set<string>([v])
      const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
      if (iso) {
        const [, y, m, d] = iso
        const mi = parseInt(m, 10) - 1
        if (mi >= 0 && mi < 12) {
          const ms = MONTHS_SHORT[mi]; const ml = MONTHS_LONG[mi]
          const dd = d; const ddN = String(parseInt(d, 10))
          out.add(`${dd}-${ms}-${y}`); out.add(`${ddN}-${ms}-${y}`)
          out.add(`${dd} ${ms} ${y}`); out.add(`${ddN} ${ms} ${y}`)
          out.add(`${dd}/${m}/${y}`);  out.add(`${ddN}/${m}/${y}`)
          out.add(`${m}/${dd}/${y}`);  out.add(`${dd}-${m}-${y}`)
          out.add(`${ms} ${dd}, ${y}`); out.add(`${ml} ${dd}, ${y}`)
          out.add(`${dd}${ms}${y}`);   out.add(`${ms}${dd}${y}`)
          out.add(`${dd}${m}${y}`);    out.add(`${m}${dd}${y}`)
        }
      }
      const nums = v.match(/[\d.,]+/g)
      if (nums) {
        for (const n of nums) {
          out.add(n); out.add(n.replace(/,/g, ''))
          const whole = n.split('.')[0].replace(/,/g, '')
          if (whole.length >= 3) out.add(whole)
        }
      }
      const alnum = v.replace(/[^a-zA-Z0-9]/g, '')
      if (alnum && alnum !== v) out.add(alnum)
      return [...out].filter(Boolean)
    }

    type Hit = { page: number; x: number; y: number; w: number; h: number }
    const findOnPage = async (pageNum: number, candidates: string[]): Promise<Hit | null> => {
      const pg = await pdfDoc.getPage(pageNum)
      const viewport    = pg.getViewport({ scale: 1 })
      const textContent = await pg.getTextContent()
      const items = (textContent.items as any[]).filter(it => (it.str || '').trim())
      let big = ''; const offsets: { start: number; end: number; item: any }[] = []
      for (const item of items) {
        const n = norm(item.str)
        if (!n) continue
        offsets.push({ start: big.length, end: big.length + n.length, item })
        big += n
      }
      for (const cand of candidates) {
        const nc = norm(cand)
        if (!nc || nc.length < 2) continue
        const idx2 = big.indexOf(nc)
        if (idx2 < 0) continue
        const endIdx = idx2 + nc.length
        const first  = offsets.find(o => o.end > idx2)
        const last   = [...offsets].reverse().find(o => o.start < endIdx)
        if (!first || !last) continue
        const [,,,,fx,fy] = first.item.transform as number[]
        const [,,,,lx,ly] = last.item.transform as number[]
        const h = Math.max(first.item.height || 12, last.item.height || 12)
        const lastRight = lx + (last.item.width || 40)
        const topY = Math.min(fy, ly); const botY = Math.max(fy, ly) + h
        return { page: pageNum, x: fx - 2, y: viewport.height - botY - 2, w: Math.max(lastRight - fx, 20) + 4, h: (botY - topY) + 4 }
      }
      return null
    }

    const candidates = buildCandidates(a.value || '')
    if (!candidates.length) return
    try {
      const preferred = a.page || 1
      const pageOrder = [preferred]
      for (let p = 1; p <= totalPages; p++) if (p !== preferred) pageOrder.push(p)
      let hit: Hit | null = null
      for (const p of pageOrder) { hit = await findOnPage(p, candidates); if (hit) break }
      if (!hit) {
        setPage(preferred)
        const pg0 = await pdfDoc.getPage(preferred)
        const tc  = await pg0.getTextContent()
        const hasText = (tc.items as any[]).some(it => it.str?.trim())
        if (!hasText) toast.info(`"${a.label}" — location unavailable (scanned document)`, { duration: 3000 })
        else          toast.info(`"${a.label}: ${a.value}" not found on this page`, { duration: 3000 })
        return
      }
      setPage(hit.page)
      requestAnimationFrame(async () => {
        const pg = await pdfDoc.getPage(hit!.page)
        const vp = pg.getViewport({ scale: 1 })
        const dims = canvasRef.current ? { w: canvasRef.current.width, h: canvasRef.current.height } : canvasDims
        if (!dims) return
        const scaleX = dims.w / vp.width; const scaleY = dims.h / vp.height
        setFlashBox({ page: hit!.page, x: hit!.x * scaleX, y: hit!.y * scaleY, w: hit!.w * scaleX, h: hit!.h * scaleY })
        containerRef.current?.scrollTo({ top: Math.max(0, hit!.y * scaleY - 80), behavior: 'smooth' })
        setTimeout(() => setFlashBox(null), 5000)
      })
    } catch { /* best-effort */ }
  }, [pdfDoc, canvasDims, annotations, totalPages])

  // Esc cancels an in-progress zone capture.
  useEffect(() => {
    if (!zoneMode) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setZoneStart(null); setZoneRect(null); onExitZoneMode?.() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoneMode, onExitZoneMode])

  const resetZone = () => { setZoneStart(null); setZoneRect(null) }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b bg-background shrink-0 flex-wrap">
        <div className="flex items-center gap-0.5">
          <button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)}
            className="rounded p-0.5 hover:bg-muted disabled:opacity-30" title="Previous page">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="text-xs text-muted-foreground tabular-nums px-0.5">{page} / {totalPages || '…'}</span>
          <button type="button" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
            className="rounded p-0.5 hover:bg-muted disabled:opacity-30" title="Next page">
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <span className="w-px h-3 bg-border" />
        <div className="flex items-center gap-0.5">
          <button type="button" onClick={() => setScale(s => Math.max(0.5, s - 0.25))}
            className="rounded px-1 py-0.5 hover:bg-muted text-xs font-bold" title="Zoom out">−</button>
          <span className="text-xs text-muted-foreground w-8 text-center tabular-nums">{Math.round(scale * 100)}%</span>
          <button type="button" onClick={() => setScale(s => Math.min(3, s + 0.25))}
            className="rounded px-1 py-0.5 hover:bg-muted text-xs font-bold" title="Zoom in">+</button>
        </div>
        {hasAnnotations && (
          <>
            <span className="w-px h-3 bg-border" />
            <div className="flex items-center gap-0.5">
              <button type="button" onClick={() => goAnnotation(-1)} disabled={activeAnnotIdx <= 0}
                className="rounded p-0.5 hover:bg-muted disabled:opacity-30" title="Previous field">
                <ChevronLeft className="h-3 w-3" />
              </button>
              <span className="text-[10px] text-muted-foreground tabular-nums px-0.5 whitespace-nowrap">
                {activeAnnotIdx >= 0 ? `${activeAnnotIdx + 1} / ${annotations.length} fields` : `${annotations.length} fields`}
              </span>
              <button type="button" onClick={() => goAnnotation(1)} disabled={activeAnnotIdx >= annotations.length - 1}
                className="rounded p-0.5 hover:bg-muted disabled:opacity-30" title="Next field">
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </>
        )}
        <div className="ml-auto flex items-center gap-1">
          {hasAnnotations && (
            <button type="button" onClick={() => setShowAnnotations(v => !v)}
              title={showAnnotations ? 'Hide annotations' : 'Show annotations'}
              className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium border transition-colors ${
                showAnnotations
                  ? 'bg-blue-500/10 border-blue-400/40 text-blue-600 dark:text-blue-400'
                  : 'bg-muted border-transparent text-muted-foreground hover:bg-muted/80'
              }`}>
              {showAnnotations ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              <span>{showAnnotations ? 'Annotations' : 'Hidden'}</span>
            </button>
          )}
          {fraudSignalCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-red-500/10 border border-red-400/30 text-red-600 dark:text-red-400">
              <AlertTriangle className="h-3 w-3" /> {fraudSignalCount} signal{fraudSignalCount !== 1 ? 's' : ''}
            </span>
          )}
          {onFullScreen && (
            <button type="button" onClick={onFullScreen}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted hover:bg-muted/80 border border-transparent">
              <Eye className="h-3 w-3" /> Full view
            </button>
          )}
        </div>
      </div>

      {/* Canvas wrapper - non-scrolling anchor for zone overlay */}
      <div className="flex-1 min-h-0 relative">
        <div ref={containerRef} className={`absolute inset-0 flex justify-center p-2 bg-muted/30 ${zoneMode ? 'overflow-hidden' : 'overflow-auto'}`}>
        {pdfDoc ? (
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <canvas ref={canvasRef} className="shadow-md rounded max-w-full block" />
            {showAnnotations && canvasDims && userAnnotations.length > 0 && (
              <canvas ref={annotOverlayRef} style={{ position: 'absolute', top: 0, left: 0, width: canvasDims.w, height: canvasDims.h, pointerEvents: 'none' }} />
            )}
            {canvasDims && flashBox && flashBox.page === page && (
              <svg style={{ position: 'absolute', top: 0, left: 0, width: canvasDims.w, height: canvasDims.h, pointerEvents: 'none', overflow: 'visible' }}>
                <rect x={flashBox.x - 4} y={flashBox.y - 4} width={flashBox.w + 8} height={flashBox.h + 8}
                  fill="rgba(250,204,21,0.20)" stroke="#f59e0b" strokeWidth={3} strokeDasharray="6 4" rx={4}>
                  <animate attributeName="opacity" values="1;0.35;1;0.35;1;0.35;1" dur="4s" repeatCount="1" />
                </rect>
                <rect x={flashBox.x} y={flashBox.y} width={flashBox.w} height={flashBox.h}
                  fill="rgba(250,204,21,0.45)" stroke="#ca8a04" strokeWidth={2} rx={2} />
                <g transform={`translate(${Math.max(2, flashBox.x - 28)}, ${flashBox.y + flashBox.h / 2})`}>
                  <polygon points="0,-7 18,0 0,7" fill="#ca8a04" opacity="0.9">
                    <animateTransform attributeName="transform" type="translate" values="-6 0; 0 0; -6 0; 0 0; -6 0" dur="1.8s" repeatCount="indefinite" />
                  </polygon>
                </g>
              </svg>
            )}
            {showAnnotations && canvasDims && pageAnnotations.filter(a => !!a.bbox).length > 0 && (
              <svg style={{ position: 'absolute', top: 0, left: 0, width: canvasDims.w, height: canvasDims.h, pointerEvents: 'none' }}>
                {pageAnnotations.filter(a => !!a.bbox).map((a, i) => {
                  const gIdx = annotations.indexOf(a)
                  const isActive = gIdx === activeAnnotIdx
                  const bx = a.bbox!.x * canvasDims.w; const by = a.bbox!.y * canvasDims.h
                  const bw = a.bbox!.w * canvasDims.w; const bh = a.bbox!.h * canvasDims.h
                  const color = a.anomaly ? '#ef4444' : isActive ? '#6366f1' : '#3b82f6'
                  const fillOpacity = isActive ? 0.28 : a.anomaly ? 0.18 : 0.12
                  const labelW = a.label.length * 5.5 + 8
                  const labelY = by > 16 ? by - 14 : by + bh + 2
                  return (
                    <g key={i}>
                      <rect x={bx} y={by} width={bw} height={bh} fill={color} fillOpacity={fillOpacity}
                        stroke={color} strokeWidth={isActive ? 2 : 1.5} strokeDasharray={a.anomaly ? '3 2' : undefined} rx="2" />
                      <rect x={bx} y={labelY} width={Math.max(labelW, 30)} height={13} fill={color} rx="2" />
                      <text x={bx + 4} y={labelY + 9} fontSize="8" fill="white" fontFamily="ui-sans-serif,system-ui,sans-serif" fontWeight="600">{a.label}</text>
                    </g>
                  )
                })}
              </svg>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-muted-foreground m-auto">
            <Loader2 className="h-5 w-5 animate-spin" /><span className="text-sm">Loading…</span>
          </div>
        )}
        </div>{/* end scrollable container */}

        {/* Zone OCR capture layer — sits OUTSIDE the scrollable div so dragging
            never competes with scroll. Covers the full canvas area. Coordinates
            are mapped to canvas pixels via getBoundingClientRect(). */}
        {zoneMode && (
          <div
            style={{ position: 'absolute', inset: 0, zIndex: 40, cursor: zoneBusy ? 'wait' : 'crosshair', userSelect: 'none' }}
            onMouseDown={e => {
              const r = e.currentTarget.getBoundingClientRect()
              const x = e.clientX - r.left; const y = e.clientY - r.top
              setZoneStart({ x, y }); setZoneRect({ x, y, w: 0, h: 0 })
            }}
            onMouseMove={e => {
              if (!zoneStart) return
              const r = e.currentTarget.getBoundingClientRect()
              const cx = e.clientX - r.left; const cy = e.clientY - r.top
              setZoneRect({ x: Math.min(zoneStart.x, cx), y: Math.min(zoneStart.y, cy), w: Math.abs(cx - zoneStart.x), h: Math.abs(cy - zoneStart.y) })
            }}
            onMouseUp={e => {
              if (!zoneRect || !zoneStart || zoneBusy) return
              const overlayRect = e.currentTarget.getBoundingClientRect()
              const canvas = canvasRef.current
              if (!canvas) { resetZone(); return }
              const cr = canvas.getBoundingClientRect()
              // Selection in overlay coords → canvas pixel coords
              const scaleX = canvas.width / cr.width
              const scaleY = canvas.height / cr.height
              const canvasOffX = cr.left - overlayRect.left
              const canvasOffY = cr.top  - overlayRect.top
              const sx = Math.max(0, (zoneRect.x - canvasOffX) * scaleX)
              const sy = Math.max(0, (zoneRect.y - canvasOffY) * scaleY)
              const sw = zoneRect.w * scaleX
              const sh = zoneRect.h * scaleY
              if (sw < 8 || sh < 8) { resetZone(); return }
              setZoneBusy(true)
              // Crop the selection out of the canvas buffer directly
              const off = document.createElement('canvas')
              const up = sw < 240 || sh < 70 ? 3 : 1.5
              off.width = Math.round(sw * up); off.height = Math.round(sh * up)
              const octx = off.getContext('2d')!
              octx.imageSmoothingEnabled = true; octx.imageSmoothingQuality = 'high'
              octx.drawImage(canvas, sx, sy, sw, sh, 0, 0, off.width, off.height)
              off.toBlob(async blob => {
                try {
                  if (!blob) throw new Error('no blob')
                  const fd = new FormData()
                  fd.append('file', new File([blob], 'zone.png', { type: 'image/png' }))
                  const { data } = await api.post('/ocr/zone-text', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 30000 })
                  const text = String(data?.text ?? '').replace(/\s*\n\s*/g, ' ').trim()
                  if (text) onZoneText?.(text)
                  else toast.info('No text detected — try dragging a tighter box around the value')
                } catch { toast.error('Zone OCR failed — please try again') }
                finally { setZoneBusy(false); resetZone(); onExitZoneMode?.() }
              }, 'image/png')
            }}
          >
            {zoneRect && zoneRect.w > 2 && zoneRect.h > 2 && (
              <div style={{
                position: 'absolute', left: zoneRect.x, top: zoneRect.y, width: zoneRect.w, height: zoneRect.h,
                border: '2.5px dashed #06b6d4', background: 'rgba(6,182,212,0.14)', pointerEvents: 'none', boxSizing: 'border-box',
              }} />
            )}
            {zoneBusy && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/30 pointer-events-none">
                <div className="flex items-center gap-2 rounded-full bg-cyan-600 text-white text-sm font-semibold px-4 py-2 shadow-xl">
                  <Loader2 className="h-4 w-4 animate-spin" /> Reading region…
                </div>
              </div>
            )}
          </div>
        )}
      </div>{/* end canvas wrapper */}

      {/* OCR field strip */}
      {showAnnotations && hasAnnotations && (
        <div className="shrink-0 border-t bg-background">
          <div className="flex items-center gap-0.5 px-2 py-1 overflow-x-auto">
            <ScanLine className="h-3 w-3 text-muted-foreground shrink-0 mr-1" />
            {annotations.map((a, i) => (
              <button key={i} type="button" onClick={() => jumpToFieldValue(a)}
                title={`${a.label}: ${a.value}${a.confidence !== undefined ? ` (${(a.confidence * 100).toFixed(0)}%)` : ''} — click to locate in document`}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-medium border whitespace-nowrap transition-colors shrink-0 ${
                  i === activeAnnotIdx
                    ? 'bg-blue-500 text-white border-blue-500'
                    : a.anomaly
                    ? 'bg-red-50 dark:bg-red-950/20 border-red-300 dark:border-red-700 text-red-700 dark:text-red-400 hover:bg-red-100'
                    : 'bg-muted/60 border-border text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}>
                {a.anomaly && <AlertTriangle className="h-2 w-2 shrink-0" />}
                <span className="opacity-70 mr-0.5">{a.label}:</span>
                <span className="font-semibold max-w-[72px] truncate">{a.value}</span>
                {a.confidence !== undefined && (
                  <span className={`opacity-50 ml-0.5 ${a.confidence < 0.7 ? 'text-amber-500 opacity-100' : ''}`}>
                    {(a.confidence * 100).toFixed(0)}%
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
