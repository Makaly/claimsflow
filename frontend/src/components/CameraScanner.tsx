/**
 * CameraScanner — fullscreen document-scanning overlay.
 *
 * Phases:
 *  'live'   — live video feed with document-guide rectangle
 *  'review' — captured photo with 4-corner drag handles,
 *             auto-edge detection, enhance, rotate, and live OCR preview
 *
 * Calls onCapture(File) when the user confirms.
 * Calls onClose() when the user cancels without capturing.
 */
import { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react'
import {
  X, Camera, RotateCw, Sparkles, Crop, Check,
  RefreshCw, ScanText, ChevronDown, ChevronUp, Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Phase = 'live' | 'review'
// [x, y] as fractions 0–1 of the displayed image area. Order: TL, TR, BR, BL.
type Corner = [number, number]

const DEFAULT_CORNERS: Corner[] = [
  [0.05, 0.05],
  [0.95, 0.05],
  [0.95, 0.95],
  [0.05, 0.95],
]

interface Props {
  onCapture: (file: File) => void
  onClose: () => void
  meterEnabled?: boolean
}

// ── Canvas helpers ─────────────────────────────────────────────────────────────

function rotateCanvas(src: HTMLCanvasElement, deg: number): HTMLCanvasElement {
  const rad = (deg * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  const w = Math.round(src.width * cos + src.height * sin)
  const h = Math.round(src.width * sin + src.height * cos)
  const dst = document.createElement('canvas')
  dst.width = w; dst.height = h
  const ctx = dst.getContext('2d')!
  ctx.translate(w / 2, h / 2)
  ctx.rotate(rad)
  ctx.drawImage(src, -src.width / 2, -src.height / 2)
  return dst
}

/**
 * Bilinear quad→rectangle warp (handles mild perspective).
 * corners = [TL, TR, BR, BL] in full-resolution pixel coords.
 */
function bilinearWarp(
  src: HTMLCanvasElement,
  corners: [number, number][],
  enhance: boolean,
): HTMLCanvasElement {
  const [TL, TR, BR, BL] = corners.map(([cx, cy]) => ({ x: cx, y: cy }))

  // Output size = max of opposing edge lengths
  const outW = Math.round(Math.max(
    Math.hypot(TR.x - TL.x, TR.y - TL.y),
    Math.hypot(BR.x - BL.x, BR.y - BL.y),
  ))
  const outH = Math.round(Math.max(
    Math.hypot(BL.x - TL.x, BL.y - TL.y),
    Math.hypot(BR.x - TR.x, BR.y - TR.y),
  ))

  const dst = document.createElement('canvas')
  dst.width = outW; dst.height = outH
  const dstCtx = dst.getContext('2d')!
  const srcData = src.getContext('2d')!.getImageData(0, 0, src.width, src.height).data
  const dstImg = dstCtx.createImageData(outW, outH)
  const d = dstImg.data

  for (let py = 0; py < outH; py++) {
    const v = py / outH
    for (let px = 0; px < outW; px++) {
      const u = px / outW
      const topX = TL.x + u * (TR.x - TL.x)
      const topY = TL.y + u * (TR.y - TL.y)
      const botX = BL.x + u * (BR.x - BL.x)
      const botY = BL.y + u * (BR.y - BL.y)
      const sx = Math.round(topX + v * (botX - topX))
      const sy = Math.round(topY + v * (botY - topY))
      if (sx < 0 || sx >= src.width || sy < 0 || sy >= src.height) continue
      const si = (sy * src.width + sx) * 4
      const di = (py * outW + px) * 4
      if (enhance) {
        // Desaturate slightly + boost contrast for document readability
        const r = srcData[si], g = srcData[si + 1], b = srcData[si + 2]
        const luma = 0.299 * r + 0.587 * g + 0.114 * b
        const mix = 0.25 // desaturation blend
        const clamp = (v: number) => Math.min(255, Math.max(0, v))
        const contrast = (v: number) => clamp((v - 128) * 1.55 + 128)
        d[di]     = contrast(luma * mix + r * (1 - mix))
        d[di + 1] = contrast(luma * mix + g * (1 - mix))
        d[di + 2] = contrast(luma * mix + b * (1 - mix))
      } else {
        d[di]     = srcData[si]
        d[di + 1] = srcData[si + 1]
        d[di + 2] = srcData[si + 2]
      }
      d[di + 3] = 255
    }
  }
  dstCtx.putImageData(dstImg, 0, 0)
  return dst
}

/**
 * Scans the canvas pixels to find the tight bounding box of content
 * that differs from the image's corner background colour.
 * Returns 4 corners as fractions [0,1].
 */
function detectEdges(cvs: HTMLCanvasElement): Corner[] {
  const ctx = cvs.getContext('2d')!
  const { width: W, height: H } = cvs
  const { data } = ctx.getImageData(0, 0, W, H)

  const sample = Math.min(50, Math.floor(Math.min(W, H) * 0.04))
  let bgSum = 0, bgCount = 0
  const addCorner = (ox: number, oy: number) => {
    for (let dy = 0; dy < sample; dy++) {
      for (let dx = 0; dx < sample; dx++) {
        const i = ((oy + dy) * W + (ox + dx)) * 4
        bgSum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
        bgCount++
      }
    }
  }
  addCorner(0, 0); addCorner(W - sample, 0)
  addCorner(0, H - sample); addCorner(W - sample, H - sample)
  const bgLuma = bgSum / bgCount
  const thr = 32

  let minX = W, maxX = 0, minY = H, maxY = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      if (Math.abs(luma - bgLuma) > thr) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  if (maxX <= minX || maxY <= minY) return DEFAULT_CORNERS

  const pad = 0.012
  return [
    [Math.max(0, minX / W - pad), Math.max(0, minY / H - pad)],
    [Math.min(1, maxX / W + pad), Math.max(0, minY / H - pad)],
    [Math.min(1, maxX / W + pad), Math.min(1, maxY / H + pad)],
    [Math.max(0, minX / W - pad), Math.min(1, maxY / H + pad)],
  ]
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function CameraScanner({ onCapture, onClose, meterEnabled = true }: Props) {
  const videoRef   = useRef<HTMLVideoElement>(null)
  const imgElRef   = useRef<HTMLImageElement>(null)
  const streamRef  = useRef<MediaStream | null>(null)
  const draggingRef = useRef<number | null>(null)
  const capturedCvsRef = useRef<HTMLCanvasElement | null>(null)

  const [phase, setPhase]           = useState<Phase>('live')
  const [capturedSrc, setCapturedSrc] = useState<string | null>(null)
  const [corners, setCorners]       = useState<Corner[]>(DEFAULT_CORNERS)
  const [imgBounds, setImgBounds]   = useState({ x: 0, y: 0, w: 1, h: 1 })
  const [enhanced, setEnhanced]     = useState(false)
  const [rotation, setRotation]     = useState(0)
  const [ocrText, setOcrText]       = useState<string | null>(null)
  const [ocrPct, setOcrPct]         = useState(0)
  const [ocrRunning, setOcrRunning] = useState(false)
  const [ocrOpen, setOcrOpen]       = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)

  // Start rear camera on mount
  useEffect(() => {
    let cancelled = false
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    }).then(stream => {
      if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
    }).catch(err => {
      if (!cancelled) setCameraError(
        err.name === 'NotAllowedError'
          ? 'Camera access denied — please allow camera permission and try again.'
          : 'Could not open camera. Make sure no other app is using it.',
      )
    })
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [])

  // Keep imgBounds in sync with the displayed image position
  const updateImgBounds = useCallback(() => {
    const el = imgElRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setImgBounds({ x: r.left, y: r.top, w: r.width, h: r.height })
  }, [])

  useLayoutEffect(() => {
    if (phase !== 'review') return
    const el = imgElRef.current
    if (!el) return
    if (el.complete) updateImgBounds()
    el.addEventListener('load', updateImgBounds)
    window.addEventListener('resize', updateImgBounds)
    return () => {
      el.removeEventListener('load', updateImgBounds)
      window.removeEventListener('resize', updateImgBounds)
    }
  }, [phase, updateImgBounds])

  // Capture frame from live video
  const capture = useCallback(() => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    streamRef.current?.getTracks().forEach(t => t.stop())

    const cvs = document.createElement('canvas')
    cvs.width = video.videoWidth
    cvs.height = video.videoHeight
    cvs.getContext('2d')!.drawImage(video, 0, 0)
    capturedCvsRef.current = cvs

    setCorners(DEFAULT_CORNERS)
    setEnhanced(false)
    setRotation(0)
    setOcrText(null)
    setOcrPct(0)
    setCapturedSrc(cvs.toDataURL('image/jpeg', 0.95))
    setPhase('review')

    // Auto-detect edges after the image has rendered (slight delay)
    setTimeout(() => {
      const detected = detectEdges(cvs)
      setCorners(detected)
      updateImgBounds()
    }, 150)

    // Start background OCR preview
    startOcr(cvs)
  }, [updateImgBounds]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-detect edges on demand
  const handleAutoDetect = useCallback(() => {
    const cvs = capturedCvsRef.current
    if (!cvs) return
    setCorners(detectEdges(cvs))
  }, [])

  // OCR preview — lazy-loads Tesseract.js, runs on a downscaled copy for speed
  const startOcr = useCallback(async (cvs: HTMLCanvasElement) => {
    setOcrRunning(true)
    setOcrPct(0)
    setOcrText(null)
    try {
      const { createWorker } = await import('tesseract.js')
      const scale = Math.min(1, 900 / Math.max(cvs.width, cvs.height))
      const small = document.createElement('canvas')
      small.width = Math.round(cvs.width * scale)
      small.height = Math.round(cvs.height * scale)
      small.getContext('2d')!.drawImage(cvs, 0, 0, small.width, small.height)

      const worker = await createWorker('eng', 1, {
        logger: (m: { status: string; progress: number }) => {
          if (m.status === 'recognizing text') setOcrPct(Math.round(m.progress * 100))
        },
      })
      const { data: { text } } = await worker.recognize(small)
      await worker.terminate()
      setOcrText(text.trim().slice(0, 500) || '(no readable text found)')
    } catch {
      setOcrText('(OCR preview unavailable)')
    } finally {
      setOcrRunning(false)
      setOcrPct(100)
    }
  }, [])

  // Corner drag handlers
  const onCornerPointerDown = useCallback((idx: number) => (e: React.PointerEvent) => {
    e.preventDefault()
    draggingRef.current = idx
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const idx = draggingRef.current
    if (idx === null) return
    const x = Math.max(0, Math.min(1, (e.clientX - imgBounds.x) / imgBounds.w))
    const y = Math.max(0, Math.min(1, (e.clientY - imgBounds.y) / imgBounds.h))
    setCorners(prev => prev.map((c, i) => (i === idx ? [x, y] : c)) as Corner[])
  }, [imgBounds])

  const onPointerUp = useCallback(() => { draggingRef.current = null }, [])

  // Build SVG path for overlay: full rect minus the crop quad (evenodd = cutout)
  const svgOverlayPath = (() => {
    const pts = corners.map(([cx, cy]) => `${cx} ${cy}`).join(' L ')
    return `M0 0 H1 V1 H0 Z M${pts} Z`
  })()

  // Confirm: warp + enhance + rotate → File
  const handleConfirm = useCallback(async () => {
    const cvs = capturedCvsRef.current
    if (!cvs) return
    setProcessing(true)
    try {
      const pixelCorners = corners.map(([cx, cy]) => [cx * cvs.width, cy * cvs.height] as [number, number])
      let result = bilinearWarp(cvs, pixelCorners, enhanced)
      if (rotation !== 0) result = rotateCanvas(result, rotation)

      await new Promise<void>((resolve, reject) => {
        result.toBlob(blob => {
          if (!blob) { reject(new Error('toBlob failed')); return }
          const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
          onCapture(new File([blob], `camera-scan-${ts}.jpg`, { type: 'image/jpeg' }))
          resolve()
        }, 'image/jpeg', 0.92)
      })
    } finally {
      setProcessing(false)
    }
  }, [corners, enhanced, rotation, onCapture])

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col select-none" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>

      {/* ── LIVE PHASE ── */}
      {phase === 'live' && (
        <>
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 z-10 rounded-full bg-black/50 p-2 text-white"
          >
            <X className="h-5 w-5" />
          </button>

          {/* Video */}
          <div className="flex-1 relative overflow-hidden flex items-center justify-center">
            {cameraError ? (
              <div className="text-center px-8 space-y-4">
                <Camera className="h-12 w-12 text-gray-500 mx-auto" />
                <p className="text-white text-sm">{cameraError}</p>
                <Button variant="outline" onClick={onClose}>Close</Button>
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  autoPlay playsInline muted
                  className="absolute inset-0 w-full h-full object-cover"
                />
                {/* Document guide overlay */}
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <svg
                    className="w-4/5 h-4/5 max-w-lg max-h-[70vh]"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                  >
                    {/* Dim areas outside guide */}
                    <path
                      fillRule="evenodd"
                      fill="rgba(0,0,0,0.45)"
                      d="M-10 -10 H110 V110 H-10 Z M5 5 H95 V95 H5 Z"
                    />
                    {/* Guide rectangle */}
                    <rect x="5" y="5" width="90" height="90" fill="none" stroke="white" strokeWidth="0.8" strokeDasharray="4 2" />
                    {/* Corner markers */}
                    {[[5,5],[95,5],[95,95],[5,95]].map(([cx, cy], i) => (
                      <g key={i} transform={`translate(${cx},${cy})`}>
                        <line x1={i===0||i===3?2:0} y1="0" x2={i===0||i===3?8:-8} y2="0" stroke="white" strokeWidth="1.5" />
                        <line x1="0" y1={i===0||i===1?2:0} x2="0" y2={i===0||i===1?8:-8} stroke="white" strokeWidth="1.5" />
                      </g>
                    ))}
                  </svg>
                </div>
                <p className="absolute bottom-28 left-0 right-0 text-center text-white/80 text-sm">
                  Align document within the guide
                </p>
              </>
            )}
          </div>

          {/* Capture button */}
          {!cameraError && (
            <div className="flex items-center justify-center pb-10 pt-4">
              <button
                onClick={capture}
                className="w-20 h-20 rounded-full border-4 border-white bg-white/20 hover:bg-white/30 active:scale-95 transition-transform flex items-center justify-center"
              >
                <Camera className="h-8 w-8 text-white" />
              </button>
            </div>
          )}
        </>
      )}

      {/* ── REVIEW PHASE ── */}
      {phase === 'review' && capturedSrc && (
        <>
          {/* Image + corner handles */}
          <div
            className="flex-1 relative overflow-hidden flex items-center justify-center bg-black"
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          >
            {/* Captured image */}
            <img
              ref={imgElRef}
              src={capturedSrc}
              alt="Captured"
              className="max-h-full max-w-full object-contain"
              draggable={false}
              style={rotation ? { transform: `rotate(${rotation}deg)` } : undefined}
            />

            {/* SVG crop overlay — positioned exactly over the image */}
            <svg
              className="absolute pointer-events-none"
              style={{
                left: imgBounds.x,
                top: imgBounds.y,
                width: imgBounds.w,
                height: imgBounds.h,
                position: 'fixed',
              }}
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
            >
              {/* Dark mask outside crop area */}
              <path fillRule="evenodd" fill="rgba(0,0,0,0.50)" d={svgOverlayPath} />
              {/* Crop border */}
              <polygon
                points={corners.map(([cx, cy]) => `${cx},${cy}`).join(' ')}
                fill="none"
                stroke="#60a5fa"
                strokeWidth="0.004"
              />
              {/* Thirds grid inside crop area */}
              {corners.length === 4 && (() => {
                const [TL, TR, BR, BL] = corners
                const lerp = (a: Corner, b: Corner, t: number): Corner =>
                  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
                const lines = [1/3, 2/3].flatMap(t => [
                  [lerp(TL, TR, t), lerp(BL, BR, t)],
                  [lerp(TL, BL, t), lerp(TR, BR, t)],
                ])
                return lines.map(([a, b], i) => (
                  <line key={i}
                    x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}
                    stroke="white" strokeWidth="0.002" strokeOpacity="0.3"
                  />
                ))
              })()}
            </svg>

            {/* Draggable corner handles */}
            {corners.map(([cx, cy], idx) => (
              <div
                key={idx}
                className="fixed w-10 h-10 rounded-full border-[3px] border-blue-400 bg-white/25 cursor-move touch-none z-10 flex items-center justify-center"
                style={{
                  left: imgBounds.x + cx * imgBounds.w - 20,
                  top:  imgBounds.y + cy * imgBounds.h - 20,
                }}
                onPointerDown={onCornerPointerDown(idx)}
              >
                <div className="w-2 h-2 rounded-full bg-blue-400" />
              </div>
            ))}
          </div>

          {/* OCR preview panel */}
          <div className="bg-gray-900 border-t border-gray-700">
            <button
              className="w-full flex items-center justify-between px-4 py-2 text-xs text-gray-300"
              onClick={() => setOcrOpen(o => !o)}
            >
              <span className="flex items-center gap-2">
                <ScanText className="h-3.5 w-3.5 text-blue-400" />
                {ocrRunning
                  ? `Reading text… ${ocrPct}%`
                  : ocrText
                  ? 'OCR preview — tap to expand'
                  : 'OCR not started'}
              </span>
              {ocrRunning
                ? <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
                : ocrOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />
              }
            </button>
            {/* Progress bar */}
            {ocrRunning && (
              <div className="h-0.5 bg-gray-800">
                <div className="h-full bg-blue-500 transition-all" style={{ width: `${ocrPct}%` }} />
              </div>
            )}
            {ocrOpen && ocrText && (
              <div className="px-4 pb-3 max-h-32 overflow-y-auto">
                <pre className="text-[11px] text-gray-400 whitespace-pre-wrap font-mono leading-relaxed">
                  {ocrText}
                </pre>
              </div>
            )}
          </div>

          {/* Toolbar */}
          <div className="bg-gray-950 border-t border-gray-800 px-3 py-3 flex items-center gap-2 flex-wrap">
            {/* Left tools */}
            <div className="flex gap-2 flex-1">
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5 text-gray-300 hover:text-white hover:bg-gray-800 h-9 text-xs"
                onClick={handleAutoDetect}
              >
                <Crop className="h-3.5 w-3.5" />
                Auto-crop
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className={cn(
                  'gap-1.5 h-9 text-xs',
                  enhanced
                    ? 'text-yellow-300 bg-yellow-950/40 hover:bg-yellow-900/40'
                    : 'text-gray-300 hover:text-white hover:bg-gray-800',
                )}
                onClick={() => setEnhanced(e => !e)}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {enhanced ? 'Enhanced' : 'Enhance'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5 text-gray-300 hover:text-white hover:bg-gray-800 h-9 text-xs"
                onClick={() => setRotation(r => (r + 90) % 360)}
              >
                <RotateCw className="h-3.5 w-3.5" />
                Rotate
              </Button>
            </div>

            {/* Right actions */}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="text-gray-400 hover:text-white h-9"
                onClick={() => {
                  // Restart camera for retake
                  setCapturedSrc(null)
                  capturedCvsRef.current = null
                  setOcrText(null)
                  setPhase('live')
                  navigator.mediaDevices.getUserMedia({
                    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
                  }).then(stream => {
                    streamRef.current = stream
                    if (videoRef.current) videoRef.current.srcObject = stream
                  }).catch(() => {})
                }}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                className="bg-blue-600 hover:bg-blue-700 text-white gap-2 h-9 px-4"
                onClick={handleConfirm}
                disabled={processing}
              >
                {processing
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Check className="h-4 w-4" />}
                {processing ? 'Processing…' : 'Use Document'}
              </Button>
            </div>
          </div>

          {/* Close button overlay */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 z-20 rounded-full bg-black/60 p-2 text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </>
      )}
    </div>
  )
}
