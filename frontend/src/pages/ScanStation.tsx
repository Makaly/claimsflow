import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ScanLine, CheckCircle, XCircle, RefreshCw, Keyboard, Volume2, History, Camera, CameraOff, AlertTriangle, Smartphone } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner'
import api from '@/services/api'
import { formatDate, formatCurrency } from '@/lib/utils'

interface ScanHistoryItem {
  barcode: string
  timestamp: Date
  found: boolean
  claim?: any
}

const BARCODE_FORMATS = [
  'code_128', 'code_39', 'ean_13', 'ean_8',
  'qr_code', 'data_matrix', 'pdf417', 'codabar', 'itf',
]

export default function ScanStation() {
  const navigate = useNavigate()
  const [scanEnabled, setScanEnabled] = useState(true)
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [manualInput, setManualInput] = useState('')
  const [currentClaim, setCurrentClaim] = useState<any | null>(null)
  const [notFoundBarcode, setNotFoundBarcode] = useState<string | null>(null)
  const [history, setHistory] = useState<ScanHistoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const lookupRef = useRef<((barcode: string) => void) | null>(null)

  // ── Camera scanner ──────────────────────────────────────────────────────────
  const videoRef = useRef<HTMLVideoElement>(null)
  const scanLoopRef = useRef<number | null>(null)
  const lastDetectedRef = useRef<{ code: string; time: number } | null>(null)
  const [cameraMode, setCameraMode] = useState(false)
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const barcodeDetectorSupported = 'BarcodeDetector' in window

  // Attach stream to video element whenever it changes
  useEffect(() => {
    if (cameraStream && videoRef.current) {
      videoRef.current.srcObject = cameraStream
    }
  }, [cameraStream])

  // Stop stream on unmount
  useEffect(() => {
    return () => { cameraStream?.getTracks().forEach(t => t.stop()) }
  }, [cameraStream])

  const stopCamera = useCallback(() => {
    if (scanLoopRef.current !== null) {
      cancelAnimationFrame(scanLoopRef.current)
      scanLoopRef.current = null
    }
    cameraStream?.getTracks().forEach(t => t.stop())
    setCameraStream(null)
    setCameraMode(false)
    setCameraError(null)
  }, [cameraStream])

  const startCamera = useCallback(async () => {
    setCameraError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      setCameraStream(stream)
      setCameraMode(true)
    } catch (err: any) {
      setCameraError(
        err.name === 'NotAllowedError'
          ? 'Camera access denied. Allow camera permission in your browser and try again.'
          : 'Could not access camera. Make sure a camera is connected and not in use by another app.',
      )
    }
  }, [])

  // BarcodeDetector scan loop — runs while cameraMode is active
  useEffect(() => {
    if (!cameraMode || !barcodeDetectorSupported) return

    let active = true
    let detecting = false
    const detector = new (window as any).BarcodeDetector({ formats: BARCODE_FORMATS })

    const loop = async () => {
      if (!active) return
      const video = videoRef.current
      // readyState 4 = HAVE_ENOUGH_DATA — video is streaming
      if (video && video.readyState === 4 && !detecting) {
        detecting = true
        try {
          const barcodes: Array<{ rawValue: string }> = await detector.detect(video)
          if (barcodes.length > 0) {
            const code = barcodes[0].rawValue
            const now = Date.now()
            const last = lastDetectedRef.current
            // Debounce: ignore the same barcode for 3 s to prevent repeated triggers
            if (!last || last.code !== code || now - last.time > 3000) {
              lastDetectedRef.current = { code, time: now }
              lookupRef.current?.(code)
            }
          }
        } catch {}
        detecting = false
      }
      if (active) scanLoopRef.current = requestAnimationFrame(loop)
    }

    scanLoopRef.current = requestAnimationFrame(loop)
    return () => {
      active = false
      if (scanLoopRef.current !== null) {
        cancelAnimationFrame(scanLoopRef.current)
        scanLoopRef.current = null
      }
    }
  }, [cameraMode, barcodeDetectorSupported])

  // ── Barcode lookup ──────────────────────────────────────────────────────────
  const playBeep = (success: boolean) => {
    if (!soundEnabled) return
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = success ? 880 : 220
      gain.gain.value = 0.1
      osc.start()
      osc.stop(ctx.currentTime + (success ? 0.15 : 0.35))
    } catch {}
  }

  const lookupBarcode = async (barcode: string) => {
    if (!barcode.trim()) return
    setLoading(true)
    setNotFoundBarcode(null)
    setCurrentClaim(null)
    try {
      const { data } = await api.get(`/claims/by-barcode/${encodeURIComponent(barcode.trim())}`)
      if (data.found && data.claim) {
        setCurrentClaim(data.claim)
        playBeep(true)
        setHistory(h => [{ barcode, timestamp: new Date(), found: true, claim: data.claim }, ...h].slice(0, 20))
      } else {
        setNotFoundBarcode(barcode)
        playBeep(false)
        setHistory(h => [{ barcode, timestamp: new Date(), found: false }, ...h].slice(0, 20))
      }
    } catch {
      setNotFoundBarcode(barcode)
      playBeep(false)
    } finally {
      setLoading(false)
    }
  }

  lookupRef.current = lookupBarcode

  useBarcodeScanner({
    enabled: scanEnabled,
    onScan: (barcode) => lookupRef.current?.(barcode),
  })

  const onManualSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (manualInput.trim()) {
      lookupBarcode(manualInput.trim())
      setManualInput('')
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header + toggles */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ScanLine className="h-6 w-6 text-blue-600" /> Scan Station
          </h1>
          <p className="text-gray-500 text-sm mt-1">Scan a claim barcode to instantly retrieve and review the claim</p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <Switch checked={scanEnabled} onCheckedChange={setScanEnabled} />
            <span className="text-gray-600">Scanner {scanEnabled ? 'active' : 'paused'}</span>
          </label>
          <label className="flex items-center gap-2">
            <Switch checked={soundEnabled} onCheckedChange={setSoundEnabled} />
            <Volume2 className="h-4 w-4 text-gray-500" />
          </label>
          {/* Camera toggle */}
          <label className="flex items-center gap-2">
            <Switch
              checked={cameraMode}
              onCheckedChange={(on) => on ? startCamera() : stopCamera()}
            />
            {cameraMode
              ? <Camera className="h-4 w-4 text-blue-600" />
              : <Camera className="h-4 w-4 text-gray-400" />
            }
            <span className="text-gray-600">Camera {cameraMode ? 'on' : 'off'}</span>
          </label>
        </div>
      </div>

      {/* Hardware scanner status banner */}
      <Card className={scanEnabled ? 'border-green-200 bg-green-50' : 'border-gray-200'}>
        <CardContent className="p-4 flex items-center gap-3">
          <ScanLine className={`h-8 w-8 ${scanEnabled ? 'text-green-600 animate-pulse' : 'text-gray-400'}`} />
          <div className="flex-1">
            <div className="font-medium text-sm">
              {scanEnabled ? 'Ready to scan' : 'Scanner paused'}
            </div>
            <div className="text-xs text-gray-600">
              {scanEnabled
                ? 'Hold the scanner over a barcode. Manual entry also accepted below.'
                : 'Enable the scanner switch to start auto-detecting barcodes.'}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Camera scanner section — visible when cameraMode is on */}
      {cameraMode && (
        <Card className="border-blue-200 bg-blue-50/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Camera className="h-4 w-4 text-blue-600" /> Camera Scanner
              <Badge variant="secondary" className="text-[10px] ml-1">
                <Smartphone className="h-3 w-3 mr-1" />phone / webcam
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!barcodeDetectorSupported ? (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  Your browser does not support the Camera Barcode Scanner. Use <strong>Chrome</strong> or <strong>Edge</strong> for automatic barcode detection, or enter the barcode manually below.
                </span>
              </div>
            ) : cameraStream ? (
              <>
                <div className="relative rounded-xl overflow-hidden bg-black aspect-video max-h-72">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                  {/* Scan-line animation overlay */}
                  <div className="pointer-events-none absolute inset-0">
                    <div className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-blue-400 to-transparent animate-[scan_2s_ease-in-out_infinite]" />
                    <div className="absolute inset-0 border-2 border-blue-400/30 rounded-xl" />
                  </div>
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-[11px] text-white">
                    {loading ? 'Looking up…' : 'Point camera at barcode'}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={stopCamera}
                  className="gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-100"
                >
                  <CameraOff className="h-3.5 w-3.5" />
                  Close Camera
                </Button>
              </>
            ) : (
              <div className="text-xs text-gray-500">Opening camera…</div>
            )}
            {cameraError && (
              <p className="flex items-center gap-1.5 text-xs text-red-600">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {cameraError}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Manual entry */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2"><Keyboard className="h-4 w-4" /> Manual Entry</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onManualSubmit} className="flex gap-2">
            <Input
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="Enter barcode and press Enter"
              autoFocus
              data-scan-zone="true"
              className="flex-1 font-mono"
            />
            <Button type="submit" disabled={loading || !manualInput.trim()}>
              {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Look Up'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Current scan result */}
      {currentClaim && (
        <Card className="border-green-300 bg-green-50/40">
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2"><CheckCircle className="h-5 w-5 text-green-600" /> Claim Found</CardTitle>
                <CardDescription className="font-mono text-xs mt-1">Barcode: {currentClaim.barcode}</CardDescription>
              </div>
              <Button onClick={() => navigate(`/claims?id=${currentClaim.id}`)}>Open Claim →</Button>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div><span className="text-gray-500">Claim #:</span> <span className="font-mono font-medium">{currentClaim.claimNumber}</span></div>
            <div><span className="text-gray-500">Status:</span> <Badge>{currentClaim.status}</Badge></div>
            <div><span className="text-gray-500">Provider:</span> <span className="font-medium">{currentClaim.provider?.name ?? '—'}</span></div>
            <div><span className="text-gray-500">Workflow:</span> {currentClaim.workflowStage}</div>
            <div><span className="text-gray-500">Member:</span> {currentClaim.memberName ?? '—'} {currentClaim.memberNumber && <span className="text-gray-400">({currentClaim.memberNumber})</span>}</div>
            <div><span className="text-gray-500">Amount:</span> <span className="font-medium">{formatCurrency(currentClaim.invoiceAmount ?? 0)}</span></div>
            <div><span className="text-gray-500">Submitted:</span> {formatDate(currentClaim.submittedAt)}</div>
            <div><span className="text-gray-500">Assigned to:</span> {currentClaim.assignedUser?.name ?? 'Unassigned'}</div>
            <div className="col-span-2"><span className="text-gray-500">Documents:</span> {currentClaim.documents?.length ?? 0} file(s) attached</div>
          </CardContent>
        </Card>
      )}

      {notFoundBarcode && (
        <Card className="border-red-300 bg-red-50/40">
          <CardContent className="p-4 flex items-center gap-3">
            <XCircle className="h-8 w-8 text-red-500" />
            <div>
              <div className="font-medium text-sm">No claim found</div>
              <div className="text-xs text-gray-600 font-mono">Barcode "{notFoundBarcode}" is not in the system</div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Scan history */}
      {history.length > 0 && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><History className="h-4 w-4" /> Recent Scans</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {history.map((h, i) => (
              <div key={i} className="flex items-center gap-3 text-sm py-1.5 border-b last:border-0">
                {h.found ? <CheckCircle className="h-4 w-4 text-green-600 shrink-0" /> : <XCircle className="h-4 w-4 text-red-500 shrink-0" />}
                <span className="font-mono text-xs text-gray-600 w-32 truncate">{h.barcode}</span>
                {h.found && h.claim ? (
                  <>
                    <span className="font-medium">{h.claim.claimNumber}</span>
                    <span className="text-gray-500 text-xs">{h.claim.provider?.name}</span>
                    <Button size="sm" variant="ghost" className="ml-auto h-6 text-xs" onClick={() => navigate(`/claims?id=${h.claim.id}`)}>Open</Button>
                  </>
                ) : (
                  <span className="text-red-600 text-xs">Not found</span>
                )}
                <span className="text-gray-400 text-xs ml-auto">{h.timestamp.toLocaleTimeString()}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
