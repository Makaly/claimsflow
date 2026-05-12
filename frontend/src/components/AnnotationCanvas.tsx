/**
 * AnnotationCanvas – PDF annotation overlay component.
 *
 * Renders on top of the PDF viewer canvas and allows the user to place:
 *   Stamps, Whiteout, Redaction, Notes/Comments, Text Highlight/Underline/Strikethrough,
 *   Electronic Signatures (signature-pad), Drawing tools.
 *
 * Annotations are persisted via REST API and overlaid client-side.
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Stamp, Eraser, Highlighter, MessageSquare, PenLine,
  Signature, Type, Square, Trash2, Check, X, ChevronDown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import api from '@/services/api'

// ─── Types ───────────────────────────────────────────────────────────────────

type AnnotationType = 'stamp' | 'whiteout' | 'redaction' | 'highlight' | 'underline'
  | 'strikethrough' | 'note' | 'drawing' | 'signature'

interface Annotation {
  id?: string
  type: AnnotationType
  pageNumber: number
  x: number
  y: number
  width?: number
  height?: number
  content?: string
  color?: string
  signatureData?: string
  signerName?: string
  signedAt?: string
  createdBy?: string
}

interface AnnotationCanvasProps {
  documentId: string
  pageNumber: number
  canvasWidth: number
  canvasHeight: number
  userRole?: string
  userName?: string
  readOnly?: boolean
  onAnnotationChange?: () => void
}

// ─── Stamp definitions ───────────────────────────────────────────────────────

const STAMPS = [
  { id: 'approved', label: 'APPROVED', color: '#16a34a', bg: '#dcfce7' },
  { id: 'rejected', label: 'REJECTED', color: '#dc2626', bg: '#fee2e2' },
  { id: 'reviewed', label: 'REVIEWED', color: '#2563eb', bg: '#dbeafe' },
  { id: 'confidential', label: 'CONFIDENTIAL', color: '#7c3aed', bg: '#ede9fe' },
  { id: 'copy', label: 'COPY', color: '#d97706', bg: '#fef3c7' },
  { id: 'paid', label: 'PAID', color: '#059669', bg: '#d1fae5' },
]

// ─── Component ───────────────────────────────────────────────────────────────

export function AnnotationCanvas({
  documentId,
  pageNumber,
  canvasWidth,
  canvasHeight,
  userRole,
  userName = 'User',
  readOnly = false,
  onAnnotationChange,
}: AnnotationCanvasProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const signatureCanvasRef = useRef<HTMLCanvasElement>(null)
  const drawingCanvasRef = useRef<HTMLCanvasElement>(null)

  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [activeTool, setActiveTool] = useState<AnnotationType | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [drawStart, setDrawStart] = useState({ x: 0, y: 0 })
  const [showStampPicker, setShowStampPicker] = useState(false)
  const [selectedStamp, setSelectedStamp] = useState(STAMPS[0])
  const [noteText, setNoteText] = useState('')
  const [showNoteInput, setShowNoteInput] = useState(false)
  const [pendingNote, setPendingNote] = useState<{ x: number; y: number } | null>(null)
  const [showSignaturePad, setShowSignaturePad] = useState(false)
  const [isSigningActive, setIsSigningActive] = useState(false)
  const [sigPadDrawing, setSigPadDrawing] = useState(false)
  const [highlightColor, setHighlightColor] = useState('#facc15')
  const [selectedAnnotation, setSelectedAnnotation] = useState<string | null>(null)

  // Load existing annotations
  useEffect(() => {
    loadAnnotations()
  }, [documentId, pageNumber])

  const loadAnnotations = async () => {
    try {
      const res = await api.get(`/documents/${documentId}/annotations`)
      setAnnotations(res.data.filter((a: Annotation) => a.pageNumber === pageNumber))
    } catch {
      // Silently fail if not connected
    }
  }

  // ─── Canvas coordinate helpers ───────────────────────────────

  const getRelativePos = (e: React.MouseEvent) => {
    const rect = overlayRef.current!.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * 100,  // as percentage
      y: ((e.clientY - rect.top) / rect.height) * 100,
    }
  }

  // ─── Annotation creation ─────────────────────────────────────

  const handleOverlayClick = async (e: React.MouseEvent) => {
    if (readOnly || !activeTool) return
    if (activeTool === 'drawing') return  // handled by mouse events
    if (activeTool === 'note') {
      const pos = getRelativePos(e)
      setPendingNote(pos)
      setShowNoteInput(true)
      return
    }
    if (activeTool === 'signature') {
      setShowSignaturePad(true)
      return
    }

    const pos = getRelativePos(e)
    await saveAnnotation({
      type: activeTool,
      pageNumber,
      x: pos.x,
      y: pos.y,
      width: activeTool === 'stamp' ? 18 : activeTool === 'whiteout' || activeTool === 'redaction' ? 20 : 30,
      height: activeTool === 'stamp' ? 8 : activeTool === 'whiteout' || activeTool === 'redaction' ? 6 : 4,
      content: activeTool === 'stamp' ? selectedStamp.label : undefined,
      color: activeTool === 'stamp' ? selectedStamp.color : highlightColor,
    })
  }

  const handleNoteSubmit = async () => {
    if (!pendingNote || !noteText.trim()) {
      setShowNoteInput(false)
      setPendingNote(null)
      return
    }
    await saveAnnotation({
      type: 'note',
      pageNumber,
      x: pendingNote.x,
      y: pendingNote.y,
      content: noteText,
      color: '#fef08a',
    })
    setNoteText('')
    setShowNoteInput(false)
    setPendingNote(null)
  }

  const saveAnnotation = async (ann: Annotation) => {
    try {
      const res = await api.post(`/documents/${documentId}/annotations`, ann)
      setAnnotations(prev => [...prev, res.data])
      onAnnotationChange?.()
      toast.success('Annotation saved')
    } catch (err: any) {
      // Optimistic local add if API not available
      const local = { ...ann, id: `local-${Date.now()}` }
      setAnnotations(prev => [...prev, local])
      toast.warning('Saved locally (API unavailable)')
    }
  }

  const deleteAnnotation = async (annotationId: string) => {
    try {
      await api.delete(`/documents/${documentId}/annotations/${annotationId}`)
      setAnnotations(prev => prev.filter(a => a.id !== annotationId))
      setSelectedAnnotation(null)
      onAnnotationChange?.()
      toast.success('Annotation removed')
    } catch (err: any) {
      toast.error(`Failed to delete: ${err?.message}`)
    }
  }

  // ─── Drawing ──────────────────────────────────────────────────

  const handleDrawStart = (e: React.MouseEvent) => {
    if (activeTool !== 'drawing' || readOnly) return
    const pos = getRelativePos(e)
    setDrawStart(pos)
    setIsDrawing(true)

    const canvas = drawingCanvasRef.current
    if (canvas) {
      const ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.beginPath()
      ctx.moveTo((pos.x / 100) * canvas.width, (pos.y / 100) * canvas.height)
      ctx.strokeStyle = highlightColor
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
    }
  }

  const handleDrawMove = (e: React.MouseEvent) => {
    if (!isDrawing || activeTool !== 'drawing') return
    const pos = getRelativePos(e)
    const canvas = drawingCanvasRef.current
    if (canvas) {
      const ctx = canvas.getContext('2d')!
      ctx.lineTo((pos.x / 100) * canvas.width, (pos.y / 100) * canvas.height)
      ctx.stroke()
    }
  }

  const handleDrawEnd = async (e: React.MouseEvent) => {
    if (!isDrawing) return
    setIsDrawing(false)
    const canvas = drawingCanvasRef.current
    if (canvas) {
      const dataUrl = canvas.toDataURL()
      await saveAnnotation({
        type: 'drawing',
        pageNumber,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        signatureData: dataUrl,
        color: highlightColor,
      })
    }
  }

  // ─── Signature pad ────────────────────────────────────────────

  const startSignatureDraw = (e: React.MouseEvent) => {
    setSigPadDrawing(true)
    const canvas = signatureCanvasRef.current!
    const ctx = canvas.getContext('2d')!
    const rect = canvas.getBoundingClientRect()
    ctx.beginPath()
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top)
    ctx.strokeStyle = '#1e40af'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
  }

  const continueSignatureDraw = (e: React.MouseEvent) => {
    if (!sigPadDrawing) return
    const canvas = signatureCanvasRef.current!
    const ctx = canvas.getContext('2d')!
    const rect = canvas.getBoundingClientRect()
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top)
    ctx.stroke()
  }

  const clearSignaturePad = () => {
    const canvas = signatureCanvasRef.current!
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }

  const submitSignature = async () => {
    const canvas = signatureCanvasRef.current!
    const dataUrl = canvas.toDataURL()
    await saveAnnotation({
      type: 'signature',
      pageNumber,
      x: 30,
      y: 80,
      width: 40,
      height: 10,
      signatureData: dataUrl,
      signerName: userName,
      content: `Signed by ${userName}`,
      color: '#2563eb',
    })
    setShowSignaturePad(false)
    clearSignaturePad()
  }

  // ─── Render ───────────────────────────────────────────────────

  const tools: Array<{ id: AnnotationType; icon: React.ElementType; label: string; color?: string }> = [
    { id: 'stamp', icon: Stamp, label: 'Stamp' },
    { id: 'whiteout', icon: Square, label: 'Whiteout', color: '#ffffff' },
    { id: 'redaction', icon: Eraser, label: 'Redact', color: '#000000' },
    { id: 'highlight', icon: Highlighter, label: 'Highlight' },
    { id: 'underline', icon: Type, label: 'Underline', color: '#2563eb' },
    { id: 'strikethrough', icon: Type, label: 'Strike', color: '#dc2626' },
    { id: 'note', icon: MessageSquare, label: 'Note' },
    { id: 'drawing', icon: PenLine, label: 'Draw' },
    { id: 'signature', icon: Signature, label: 'Sign' },
  ]

  return (
    <div className="relative" style={{ width: canvasWidth, height: canvasHeight }}>

      {/* Annotation overlay */}
      <div
        ref={overlayRef}
        className={`absolute inset-0 ${activeTool ? 'cursor-crosshair' : 'cursor-default'}`}
        style={{ zIndex: 10 }}
        onClick={handleOverlayClick}
        onMouseDown={handleDrawStart}
        onMouseMove={handleDrawMove}
        onMouseUp={handleDrawEnd}
      >
        {/* Drawing canvas */}
        <canvas
          ref={drawingCanvasRef}
          width={canvasWidth}
          height={canvasHeight}
          className="absolute inset-0 pointer-events-none"
        />

        {/* Render annotations */}
        {annotations.map((ann) => (
          <AnnotationOverlay
            key={ann.id}
            annotation={ann}
            isSelected={selectedAnnotation === ann.id}
            onSelect={() => setSelectedAnnotation(ann.id === selectedAnnotation ? null : (ann.id || null))}
            onDelete={() => ann.id && deleteAnnotation(ann.id)}
            readOnly={readOnly}
          />
        ))}
      </div>

      {/* Toolbar */}
      {!readOnly && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 bg-white/95 dark:bg-gray-900/95 backdrop-blur rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 px-2 py-1">
          {tools.map(tool => (
            <div key={tool.id} className="relative">
              <Button
                size="icon"
                variant={activeTool === tool.id ? 'default' : 'ghost'}
                className="h-7 w-7"
                title={tool.label}
                onClick={(e) => {
                  e.stopPropagation()
                  if (tool.id === 'stamp') setShowStampPicker(p => !p)
                  setActiveTool(prev => prev === tool.id ? null : tool.id)
                }}
              >
                <tool.icon className="h-3.5 w-3.5" />
              </Button>

              {/* Stamp picker dropdown */}
              {tool.id === 'stamp' && showStampPicker && (
                <div className="absolute bottom-9 left-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-2 z-30 w-36">
                  {STAMPS.map(s => (
                    <button
                      key={s.id}
                      className="w-full text-left px-2 py-1 text-xs rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedStamp(s)
                        setShowStampPicker(false)
                      }}
                    >
                      <span style={{ color: s.color, fontWeight: 700 }}>{s.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* Color picker for highlight/drawing */}
          {(activeTool === 'highlight' || activeTool === 'drawing') && (
            <input
              type="color"
              value={highlightColor}
              onChange={(e) => setHighlightColor(e.target.value)}
              className="h-7 w-7 rounded cursor-pointer border-0 p-0"
              title="Pick color"
            />
          )}

          {activeTool && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground"
              onClick={() => setActiveTool(null)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      )}

      {/* Note input popup */}
      {showNoteInput && pendingNote && (
        <div
          className="absolute z-30 bg-yellow-50 border border-yellow-300 rounded shadow-lg p-2 w-56"
          style={{
            left: `${pendingNote.x}%`,
            top: `${pendingNote.y}%`,
            transform: 'translate(-50%, -110%)',
          }}
        >
          <textarea
            autoFocus
            className="w-full text-xs border border-yellow-300 rounded p-1 resize-none bg-yellow-50"
            rows={3}
            placeholder="Add note…"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
          />
          <div className="flex gap-1 mt-1 justify-end">
            <Button size="icon" className="h-6 w-6 bg-green-600 hover:bg-green-700" onClick={handleNoteSubmit}>
              <Check className="h-3 w-3" />
            </Button>
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => { setShowNoteInput(false); setPendingNote(null) }}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}

      {/* Signature pad */}
      {showSignaturePad && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl p-4 w-80">
            <h3 className="text-sm font-semibold mb-2">Electronic Signature</h3>
            <p className="text-xs text-muted-foreground mb-3">Draw your signature below</p>
            <canvas
              ref={signatureCanvasRef}
              width={280}
              height={100}
              className="border border-gray-200 rounded bg-white cursor-crosshair w-full"
              onMouseDown={startSignatureDraw}
              onMouseMove={continueSignatureDraw}
              onMouseUp={() => setSigPadDrawing(false)}
              onMouseLeave={() => setSigPadDrawing(false)}
            />
            <div className="flex gap-2 mt-3 justify-end">
              <Button variant="outline" size="sm" onClick={clearSignaturePad}>Clear</Button>
              <Button variant="ghost" size="sm" onClick={() => setShowSignaturePad(false)}>Cancel</Button>
              <Button size="sm" onClick={submitSignature}>Apply Signature</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Individual annotation overlay ───────────────────────────────────────────

function AnnotationOverlay({
  annotation,
  isSelected,
  onSelect,
  onDelete,
  readOnly,
}: {
  annotation: Annotation
  isSelected: boolean
  onSelect: () => void
  onDelete: () => void
  readOnly: boolean
}) {
  const stamp = STAMPS.find(s => s.label === annotation.content)

  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${annotation.x}%`,
    top: `${annotation.y}%`,
    width: annotation.width ? `${annotation.width}%` : 'auto',
    height: annotation.height ? `${annotation.height}%` : 'auto',
    zIndex: isSelected ? 15 : 12,
    cursor: readOnly ? 'default' : 'pointer',
  }

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onSelect()
  }

  return (
    <div style={style} onClick={handleClick}>
      {annotation.type === 'stamp' && (
        <div
          className="flex items-center justify-center text-[10px] font-bold rounded border-2 px-1"
          style={{
            color: stamp?.color || annotation.color || '#16a34a',
            borderColor: stamp?.color || annotation.color || '#16a34a',
            backgroundColor: stamp?.bg || '#dcfce7',
            height: '100%',
          }}
        >
          {annotation.content}
        </div>
      )}

      {annotation.type === 'whiteout' && (
        <div className="w-full h-full bg-white border border-gray-200" />
      )}

      {annotation.type === 'redaction' && (
        <div className="w-full h-full bg-black" />
      )}

      {annotation.type === 'highlight' && (
        <div
          className="w-full h-full opacity-40"
          style={{ backgroundColor: annotation.color || '#facc15' }}
        />
      )}

      {annotation.type === 'underline' && (
        <div
          className="absolute bottom-0 left-0 right-0 h-0.5"
          style={{ backgroundColor: annotation.color || '#2563eb' }}
        />
      )}

      {annotation.type === 'strikethrough' && (
        <div
          className="absolute top-1/2 left-0 right-0 h-0.5"
          style={{ backgroundColor: annotation.color || '#dc2626' }}
        />
      )}

      {annotation.type === 'note' && (
        <div
          className="w-5 h-5 bg-yellow-300 border border-yellow-500 rounded-sm shadow text-[8px] flex items-center justify-center overflow-hidden"
          title={annotation.content}
        >
          💬
        </div>
      )}

      {annotation.type === 'signature' && annotation.signatureData && (
        <img
          src={annotation.signatureData}
          className="w-full h-full object-contain"
          alt="Signature"
          title={`Signed by ${annotation.signerName}`}
        />
      )}

      {annotation.type === 'drawing' && annotation.signatureData && (
        <img src={annotation.signatureData} className="w-full h-full object-contain pointer-events-none" alt="Drawing" />
      )}

      {/* Delete handle when selected */}
      {isSelected && !readOnly && (
        <button
          className="absolute -top-3 -right-3 bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center z-20 hover:bg-red-700"
          onClick={(e) => { e.stopPropagation(); onDelete() }}
        >
          <Trash2 className="h-2.5 w-2.5" />
        </button>
      )}
    </div>
  )
}
