/**
 * DocumentViewer — full-screen portal PDF/image viewer with annotations.
 *
 * Annotation tools: Pointer · Highlight · Sticky Note · Stamp · Redaction ·
 * Whiteout · Freehand Draw · E-Signature
 *
 * Comments panel: add comments, assign to users, threaded replies, audit trail.
 */
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import * as pdfjsLib from 'pdfjs-dist'
import { PDFDocument } from 'pdf-lib'

import {
  X, Download, Loader2, AlertCircle, MessageSquare, Trash2,
  ChevronRight, ChevronLeft, Plus, Send, AtSign,
  MousePointer, Highlighter, StickyNote, Stamp, EraserIcon,
  PenLine, Signature, ZoomIn, ZoomOut, RotateCcw,
  ChevronUp, ChevronDown, Square, Save, CheckCheck,
  Underline, Strikethrough, ScanBarcode, ArrowRight, ScanLine,
} from 'lucide-react'

import { userService } from '@/services/userService'
import api from '@/services/api'
import type { User } from '@/types'

// Use absolute URL so pdfjs uses it directly and never falls back to creating
// its own blob-URL worker (which Firefox security policy then also blocks).
// Worker configured globally in main.tsx

// ── Types ─────────────────────────────────────────────────────────────────────
import {
  Annotation,
  ToolType,
  STAMP_COLORS as SHARED_STAMP_COLORS,
  loadSigImage as sharedLoadSigImage,
  renderAnnotations as sharedRenderAnnotations,
} from './annotations/renderer'

const OCR_FIELD_OPTIONS = [
  { value: 'patientName',   label: 'Patient Name' },
  { value: 'patientId',     label: 'Patient ID' },
  { value: 'memberNumber',  label: 'Member / AK No.' },
  { value: 'providerName',  label: 'Provider' },
  { value: 'invoiceNumber', label: 'Invoice Number' },
  { value: 'invoiceDate',   label: 'Invoice Date' },
  { value: 'invoiceAmount', label: 'Amount' },
  { value: 'serviceDate',   label: 'Service Date' },
  { value: 'diagnosis',     label: 'Diagnosis' },
  { value: 'diagnosisCode', label: 'Diagnosis Code' },
  { value: 'procedureCode', label: 'Procedure Code' },
  { value: 'treatment',     label: 'Treatment' },
] as const


interface NoteComment {
  id: string; authorName: string; text: string; createdAt: string
}
interface Note {
  id: string; text: string
  assignedTo: string[]; assignedNames: string[]
  pageRef?: number
  authorId: string; authorName: string
  createdAt: string; comments: NoteComment[]
}

interface OcrField {
  page: number; label: string; value: string; confidence?: number; anomaly?: boolean
  bbox?: { x: number; y: number; w: number; h: number }
}

interface DocumentViewerProps {
  bytes?: Uint8Array | null; url?: string | null; ready?: boolean
  filename?: string; mimeType?: string; onClose: () => void
  claimId?: string   // when set: annotations are loaded from + saved to the DB
  barcode?: string   // claim barcode — used as primary annotation storage key
  ocrFields?: OcrField[]  // extracted field chips shown in the bottom strip
}

// Module-level sets that persist across React Strict Mode double-mounts.
// _missingClaimIds: claimIds that returned 404 — never retry these.
// _inflight: claimIds with an annotation request currently in-flight — skip duplicates.
const _missingClaimIds = new Set<string>()
const _inflight = new Set<string>()

// Re-export the shared signature preloader so existing call sites keep working.
const loadSigImage = sharedLoadSigImage

interface SavedSig { id: string; dataUrl: string; createdAt: string }

// ── Constants ─────────────────────────────────────────────────────────────────
const STAMP_COLORS = SHARED_STAMP_COLORS
const STAMPS = Object.keys(STAMP_COLORS)
const HIGHLIGHT_COLORS = [
  { label: 'Yellow',  fill: 'rgba(251,191,36,0.35)',  stroke: '#fbbf24' },
  { label: 'Green',   fill: 'rgba(52,211,153,0.35)',  stroke: '#34d399' },
  { label: 'Pink',    fill: 'rgba(244,114,182,0.35)', stroke: '#f472b6' },
  { label: 'Blue',    fill: 'rgba(96,165,250,0.35)',  stroke: '#60a5fa' },
]

const uid = () => `a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

// Alias the shared renderer so local call sites stay unchanged.
const renderAnnotations = sharedRenderAnnotations

// ── SignaturePad modal (modern, per-user saved sigs) ──────────────────────────
function SignModal({ userId, currentUser, onDone, onCancel }: {
  userId: string; currentUser: string
  onDone: (dataUrl: string) => void; onCancel: () => void
}) {
  const sigKey = `sigs:${userId || 'anon'}`
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const drawing     = useRef(false)
  const hasStrokes  = useRef(false)
  const [tab, setTab]       = useState<'draw'|'saved'>('draw')
  const [doSave, setDoSave] = useState(true)
  const [isEmpty, setIsEmpty] = useState(true)
  const [savedSigs, setSavedSigs] = useState<SavedSig[]>(() => {
    try { return JSON.parse(localStorage.getItem(sigKey) || '[]') } catch { return [] }
  })

  // Resize canvas pixel buffer to match CSS size, preserving DPR sharpness
  const initCanvas = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = window.devicePixelRatio || 1
    const rect  = canvas.getBoundingClientRect()
    if (rect.width === 0) return
    canvas.width  = Math.round(rect.width  * ratio)
    canvas.height = Math.round(rect.height * ratio)
    const ctx = canvas.getContext('2d')!
    ctx.scale(ratio, ratio)
    ctx.strokeStyle = '#1e3a5f'
    ctx.lineWidth   = 2.5
    ctx.lineCap     = 'round'
    ctx.lineJoin    = 'round'
  }

  useEffect(() => {
    if (tab !== 'draw') return
    // rAF ensures the canvas is fully laid out before we read its size
    const id = requestAnimationFrame(() => { initCanvas(); hasStrokes.current = false; setIsEmpty(true) })
    return () => cancelAnimationFrame(id)
  }, [tab])

  // Load saved sigs from DB
  useEffect(() => {
    if (!userId) return
    api.get(`/users/${userId}/signatures`)
      .then(({ data }) => {
        const dbList: SavedSig[] = Array.isArray(data?.signatures) ? data.signatures : []
        if (dbList.length > 0) { setSavedSigs(dbList); localStorage.setItem(sigKey, JSON.stringify(dbList)) }
      }).catch(() => {})
  }, [userId])

  const getPos = (canvas: HTMLCanvasElement, clientX: number, clientY: number) => {
    const r = canvas.getBoundingClientRect()
    return { x: clientX - r.left, y: clientY - r.top }
  }

  const onDown = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current; if (!canvas) return
    drawing.current = true
    const ctx = canvas.getContext('2d')!
    const p = getPos(canvas, clientX, clientY)
    ctx.beginPath(); ctx.moveTo(p.x, p.y)
  }
  const onMove = (clientX: number, clientY: number) => {
    if (!drawing.current) return
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const p = getPos(canvas, clientX, clientY)
    ctx.lineTo(p.x, p.y); ctx.stroke()
    if (!hasStrokes.current) { hasStrokes.current = true; setIsEmpty(false) }
  }
  const onUp = () => { drawing.current = false }

  const clearCanvas = () => {
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    hasStrokes.current = false; setIsEmpty(true)
  }

  const persist = (list: SavedSig[]) => {
    setSavedSigs(list)
    localStorage.setItem(sigKey, JSON.stringify(list))
    if (userId) api.patch(`/users/${userId}/signatures`, { signatures: list }).catch(() => {})
  }

  const handleUse = () => {
    const canvas = canvasRef.current
    if (!canvas || !hasStrokes.current) return
    const dataUrl = canvas.toDataURL('image/png')
    if (doSave) {
      const next = [{ id: uid(), dataUrl, createdAt: new Date().toISOString() }, ...savedSigs].slice(0, 6)
      persist(next)
    }
    onDone(dataUrl)
  }

  const deleteSig = (id: string) => persist(savedSigs.filter(s => s.id !== id))

  return (
    <div style={{ position:'fixed', inset:0, zIndex:200000, background:'rgba(15,23,42,0.7)', display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(6px)' }}
      onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
      <div style={{ background:'white', borderRadius:20, width:520, boxShadow:'0 40px 100px rgba(0,0,0,0.4)', overflow:'hidden' }}>

        {/* Header */}
        <div style={{ background:'linear-gradient(135deg,#1e3a5f,#2563eb)', padding:'20px 24px 0' }}>
          <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:16 }}>
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <div style={{ background:'rgba(255,255,255,0.2)', borderRadius:8, padding:6, display:'flex' }}>
                  <Signature size={16} color="white" />
                </div>
                <h3 style={{ margin:0, fontSize:16, fontWeight:700, color:'white' }}>E-Signature</h3>
              </div>
              <p style={{ margin:'4px 0 0', fontSize:11, color:'rgba(255,255,255,0.65)', paddingLeft:40 }}>{currentUser}</p>
            </div>
            <button onClick={onCancel} style={{ background:'rgba(255,255,255,0.15)', border:'none', borderRadius:8, width:32, height:32, cursor:'pointer', color:'white', fontSize:18, lineHeight:1, display:'flex', alignItems:'center', justifyContent:'center' }}>×</button>
          </div>
          {/* Tabs */}
          <div style={{ display:'flex', gap:2 }}>
            {(['draw','saved'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                style={{ padding:'8px 18px', fontSize:12, fontWeight:600, border:'none', cursor:'pointer', borderRadius:'8px 8px 0 0', background:tab===t?'white':'transparent', color:tab===t?'#1e3a5f':'rgba(255,255,255,0.75)', transition:'all 0.15s' }}>
                {t==='draw' ? '✏️  Draw New' : `🗂  Saved${savedSigs.length ? ` (${savedSigs.length})` : ''}`}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding:24 }}>
          {tab==='draw' && (
            <>
              <p style={{ margin:'0 0 10px', fontSize:12, color:'#64748b' }}>Draw your signature below using mouse or touch</p>
              <div style={{ position:'relative', borderRadius:12, overflow:'hidden', border:'2px dashed #cbd5e1', background:'#f8fafc' }}>
                <canvas ref={canvasRef}
                  style={{ display:'block', touchAction:'none', cursor:'crosshair', width:'100%', height:160, userSelect:'none' }}
                  onMouseDown={e => { e.preventDefault(); onDown(e.clientX, e.clientY) }}
                  onMouseMove={e => onMove(e.clientX, e.clientY)}
                  onMouseUp={onUp}
                  onMouseLeave={onUp}
                  onTouchStart={e => { e.preventDefault(); const t = e.touches[0]; onDown(t.clientX, t.clientY) }}
                  onTouchMove={e => { e.preventDefault(); const t = e.touches[0]; onMove(t.clientX, t.clientY) }}
                  onTouchEnd={e => { e.preventDefault(); onUp() }}
                />
                {isEmpty && (
                  <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', pointerEvents:'none' }}>
                    <span style={{ fontSize:12, color:'#cbd5e1', fontStyle:'italic' }}>Sign here</span>
                  </div>
                )}
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:10 }}>
                <input type="checkbox" id="doSave" checked={doSave} onChange={e => setDoSave(e.target.checked)}
                  style={{ width:14, height:14, accentColor:'#2563eb', cursor:'pointer' }} />
                <label htmlFor="doSave" style={{ fontSize:12, color:'#64748b', cursor:'pointer', userSelect:'none' }}>
                  Save for future use
                </label>
              </div>
              <div style={{ display:'flex', gap:8, marginTop:14, justifyContent:'flex-end' }}>
                <button onClick={clearCanvas}
                  style={{ fontSize:12, border:'1px solid #e2e8f0', background:'none', borderRadius:9, padding:'7px 16px', cursor:'pointer', color:'#64748b' }}>
                  Clear
                </button>
                <button onClick={handleUse} disabled={isEmpty}
                  style={{ fontSize:12, border:'none', background: isEmpty ? '#94a3b8' : 'linear-gradient(135deg,#1e3a5f,#2563eb)', color:'white', borderRadius:9, padding:'7px 20px', cursor: isEmpty ? 'not-allowed' : 'pointer', fontWeight:700, boxShadow: isEmpty ? 'none' : '0 4px 12px rgba(37,99,235,0.4)', transition:'all 0.15s' }}>
                  Place Signature
                </button>
              </div>
            </>
          )}

          {tab==='saved' && (
            savedSigs.length === 0
              ? (
                <div style={{ textAlign:'center', padding:'28px 0', color:'#94a3b8' }}>
                  <Signature size={36} style={{ margin:'0 auto 10px', display:'block', opacity:0.25 }} />
                  <p style={{ fontSize:13, fontWeight:600, margin:'0 0 4px' }}>No saved signatures</p>
                  <p style={{ fontSize:12, margin:0 }}>Draw a signature and check "Save for future use"</p>
                  <button onClick={() => setTab('draw')}
                    style={{ marginTop:14, fontSize:12, border:'1px solid #2563eb', color:'#2563eb', background:'none', borderRadius:9, padding:'6px 16px', cursor:'pointer' }}>
                    Draw New
                  </button>
                </div>
              )
              : (
                <div style={{ display:'flex', flexDirection:'column', gap:8, maxHeight:280, overflowY:'auto' }}>
                  {savedSigs.map((sig, i) => (
                    <div key={sig.id} style={{ border:'1px solid #e2e8f0', borderRadius:10, display:'flex', alignItems:'center', overflow:'hidden', background:'#fafafa', cursor:'pointer' }}
                      onClick={() => onDone(sig.dataUrl)}>
                      <div style={{ flex:1, padding:'10px 14px' }}>
                        <div style={{ background:'white', borderRadius:6, border:'1px solid #e2e8f0', padding:'4px 8px', marginBottom:5, display:'inline-block' }}>
                          <img src={sig.dataUrl} alt="" style={{ maxHeight:40, maxWidth:260, objectFit:'contain', display:'block' }} />
                        </div>
                        <p style={{ margin:0, fontSize:10, color:'#94a3b8' }}>
                          Signature {i+1} · Saved {new Date(sig.createdAt).toLocaleDateString()} · <strong style={{ color:'#2563eb' }}>click to use</strong>
                        </p>
                      </div>
                      <button onClick={e => { e.stopPropagation(); deleteSig(sig.id) }}
                        style={{ background:'none', border:'none', padding:'0 14px', cursor:'pointer', color:'#cbd5e1', alignSelf:'stretch', display:'flex', alignItems:'center', fontSize:16 }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )
          )}
        </div>

        {/* Footer — verification note */}
        <div style={{ borderTop:'1px solid #f1f5f9', padding:'10px 24px', background:'#f8fafc', display:'flex', alignItems:'center', gap:6 }}>
          <div style={{ width:18, height:18, borderRadius:'50%', background:'#dcfce7', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            <span style={{ fontSize:10, color:'#16a34a' }}>✓</span>
          </div>
          <p style={{ margin:0, fontSize:10, color:'#64748b' }}>
            Signatures are recorded with signer name, timestamp, and document context for verification.
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Stamp picker ──────────────────────────────────────────────────────────────

function StampPreview({ label }: { label: string }) {
  const col = STAMP_COLORS[label] || '#0369a1'
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      position: 'relative', transform: 'rotate(-8deg)',
      padding: '4px 10px', opacity: 0.88,
    }}>
      {/* outer oval */}
      <span style={{
        position: 'absolute', inset: 0,
        border: `2.5px solid ${col}`, borderRadius: '50%',
      }}/>
      {/* inner oval */}
      <span style={{
        position: 'absolute', inset: 3,
        border: `1.2px solid ${col}`, borderRadius: '50%',
        background: col + '12',
      }}/>
      <span style={{
        position: 'relative', fontSize: 9, fontWeight: 900,
        letterSpacing: '0.12em', color: col,
        fontFamily: '"Arial Black", Arial, sans-serif',
        whiteSpace: 'nowrap',
      }}>{label}</span>
    </div>
  )
}

function StampPicker({ onPick }: { onPick: (label: string) => void }) {
  return (
    <div style={{ position: 'absolute', top: '110%', left: 0, zIndex: 100, background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: 10, width: 240, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
      {STAMPS.map(s => (
        <button key={s} onClick={() => onPick(s)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 2px' }}
          title={s}>
          <StampPreview label={s} />
        </button>
      ))}
    </div>
  )
}

// ── Add-comment form ──────────────────────────────────────────────────────────
function AddCommentForm({ users, currentUser, onAdd, onCancel }: {
  users: User[]; currentUser: string
  onAdd: (note: Omit<Note,'id'|'createdAt'|'comments'>) => void
  onCancel: () => void
}) {
  const [assigned, setAssigned] = useState<string[]>([])
  const [search, setSearch]     = useState('')
  const [open, setOpen]         = useState(false)
  const pageRefRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const me = Array.isArray(users) ? users.find(u => u.name === currentUser) : undefined

  useEffect(() => { setTimeout(() => textareaRef.current?.focus(), 0) }, [])

  // Close dropdown on outside click (but NOT when clicking inside it)
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const filtered = (Array.isArray(users) ? users : []).filter(u =>
    u.name?.toLowerCase().includes(search.toLowerCase()) || u.email?.toLowerCase().includes(search.toLowerCase())
  )

  const toggleUser = (id: string) => {
    setAssigned(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
    // Keep dropdown open — do NOT call setOpen(false)
  }

  const handlePost = () => {
    const trimmed = (textareaRef.current?.value || '').trim()
    if (!trimmed) return
    onAdd({
      text: trimmed,
      assignedTo: assigned,
      assignedNames: assigned.map(id => users.find(u => u.id === id)?.name || id),
      pageRef: pageRefRef.current?.value ? parseInt(pageRefRef.current.value) : undefined,
      authorId: me?.id || '',
      authorName: currentUser,
    })
    if (textareaRef.current) textareaRef.current.value = ''
    setAssigned([]); onCancel()
  }

  return (
    <div
      style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', padding: 16, marginBottom: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.10)' }}
      onPointerDown={e => e.stopPropagation()}
    >
      {/* Textarea — uncontrolled so portal doesn't break synthetic onChange */}
      <textarea
        ref={textareaRef}
        rows={3}
        placeholder="Write a comment…"
        defaultValue=""
        onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handlePost() }}
        style={{
          width: '100%', resize: 'none', fontSize: 13,
          border: '1.5px solid #e2e8f0', borderRadius: 10,
          padding: '9px 12px', fontFamily: 'inherit', outline: 'none',
          boxSizing: 'border-box', lineHeight: 1.6, color: '#1e293b',
          background: '#f8fafc',
        }}
        onFocus={e => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.background = '#fff' }}
        onBlur={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.background = '#f8fafc' }}
      />

      {/* Assign multi-select dropdown */}
      <div ref={dropdownRef} style={{ position: 'relative', marginTop: 10 }}>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
            background: assigned.length ? '#eff6ff' : '#f8fafc',
            border: `1.5px solid ${assigned.length ? '#93c5fd' : '#e2e8f0'}`,
            borderRadius: 8, padding: '5px 12px', cursor: 'pointer',
            color: assigned.length ? '#1d4ed8' : '#64748b', fontWeight: 500,
            transition: 'all 0.15s',
          }}
        >
          <AtSign size={13} />
          {assigned.length
            ? `${assigned.length} person${assigned.length > 1 ? 's' : ''} assigned`
            : 'Assign to someone'}
          <span style={{ marginLeft: 2, opacity: 0.6, fontSize: 10 }}>{open ? '▲' : '▼'}</span>
        </button>

        {/* Assigned chips */}
        {assigned.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
            {assigned.map(id => {
              const u = users.find(x => x.id === id)
              return (
                <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, background: '#dbeafe', color: '#1d4ed8', borderRadius: 20, padding: '2px 8px 2px 6px', border: '1px solid #bfdbfe' }}>
                  <span style={{ width: 16, height: 16, borderRadius: '50%', background: '#6366f1', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: 'white' }}>
                    {(u?.name || u?.email || '?')[0].toUpperCase()}
                  </span>
                  {u?.name || u?.email}
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); toggleUser(id) }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#93c5fd', padding: 0, lineHeight: 1, fontSize: 13, marginLeft: 1 }}
                  >×</button>
                </span>
              )
            })}
          </div>
        )}

        {open && (
          <div style={{
            position: 'absolute', top: '110%', left: 0, zIndex: 9999,
            background: 'white', borderRadius: 12,
            border: '1px solid #e2e8f0', boxShadow: '0 12px 32px rgba(0,0,0,0.15)',
            width: 260, overflow: 'hidden',
          }}>
            <div style={{ padding: '8px 10px', borderBottom: '1px solid #f1f5f9', background: '#f8fafc' }}>
              <input
                autoFocus
                placeholder="Search users…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onPointerDown={e => e.stopPropagation()}
                style={{ width: '100%', fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 7, padding: '5px 9px', outline: 'none', boxSizing: 'border-box', background: 'white' }}
              />
            </div>
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              {filtered.length === 0 && (
                <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: '12px 0', margin: 0 }}>No users found</p>
              )}
              {filtered.map(u => (
                <button
                  key={u.id}
                  type="button"
                  onPointerDown={e => e.stopPropagation()}
                  onClick={() => toggleUser(u.id)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 9,
                    padding: '8px 12px', border: 'none',
                    background: assigned.includes(u.id) ? '#eff6ff' : 'transparent',
                    cursor: 'pointer', textAlign: 'left', transition: 'background 0.1s',
                  }}
                >
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: assigned.includes(u.id) ? '#3b82f6' : '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'white', flexShrink: 0, transition: 'background 0.15s' }}>
                    {(u.name || u.email || '?')[0].toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 12, fontWeight: 600, color: '#1e293b', margin: 0 }}>{u.name || u.email}</p>
                    {u.email && u.name && <p style={{ fontSize: 10, color: '#94a3b8', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</p>}
                  </div>
                  <div style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${assigned.includes(u.id) ? '#3b82f6' : '#cbd5e1'}`, background: assigned.includes(u.id) ? '#3b82f6' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' }}>
                    {assigned.includes(u.id) && <span style={{ color: 'white', fontSize: 10, fontWeight: 700 }}>✓</span>}
                  </div>
                </button>
              ))}
            </div>
            {assigned.length > 0 && (
              <div style={{ padding: '8px 12px', borderTop: '1px solid #f1f5f9', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>{assigned.length} selected</span>
                <button type="button" onClick={() => setOpen(false)} style={{ fontSize: 11, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Done</button>
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: '#64748b' }}>Page ref:</span>
        <input
          ref={pageRefRef}
          type="number" min="1" placeholder="optional"
          style={{ width: 72, fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 7, padding: '4px 8px', outline: 'none' }}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={{ fontSize: 12, border: '1px solid #e2e8f0', background: 'none', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', color: '#64748b' }}>Cancel</button>
        <button
          type="button"
          onClick={handlePost}
          style={{ fontSize: 12, border: 'none', borderRadius: 8, padding: '6px 16px', cursor: 'pointer', background: '#3b82f6', color: 'white', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}
        >
          <Send size={11} /> Post
        </button>
      </div>
    </div>
  )
}

// ── Decode base64 data URL to Uint8Array ──────────────────────────────────────
function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1]
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// ── Main component ────────────────────────────────────────────────────────────
export function DocumentViewer({ bytes, url, ready = true, filename = 'document', mimeType, onClose, claimId, barcode, ocrFields = [] }: DocumentViewerProps) {
  // PDF state
  const [pdfDoc, setPdfDoc]   = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [pageNum, setPageNum] = useState(1)
  const [numPages, setNumPages] = useState(0)
  const [zoom, setZoom]       = useState(1.0)
  const [rotation, setRotation] = useState(0)
  const [loading, setLoading] = useState(true)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [thumbs, setThumbs]   = useState<string[]>([])

  // Annotation state
  const [tool, setTool]           = useState<ToolType>('pointer')
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [drawing, setDrawing]     = useState(false)
  const [drawStart, setDrawStart] = useState<{x:number;y:number}|null>(null)
  const [currentStroke, setCurrentStroke] = useState<{x:number;y:number}[]>([])
  const [highlightColor, setHighlightColor] = useState(HIGHLIGHT_COLORS[0])
  const [drawColor, setDrawColor] = useState('#ef4444')
  const [showStamps, setShowStamps] = useState(false)
  const [activeStamp, setActiveStamp] = useState('APPROVED')
  const [showSignModal, setShowSignModal] = useState(false)
  const [pendingSignature, setPendingSignature] = useState<string|null>(null)
  const [notePopup, setNotePopup] = useState<{x:number;y:number;cssX:number;cssY:number;page:number}|null>(null)
  const [showSidebar, setShowSidebar] = useState(true)
  const [showDownload, setShowDownload] = useState(false)
  const [fieldFlash, setFieldFlash] = useState<{page:number;x:number;y:number;w:number;h:number}|null>(null)
  const [activeOcrFieldIdx, setActiveOcrFieldIdx] = useState(-1)

  // Comments/notes state
  const [notes, setNotes]             = useState<Note[]>([])
  const [activeNote, setActiveNote]   = useState<string|null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newReply, setNewReply]       = useState<Record<string,string>>({})
  const [users, setUsers]             = useState<User[]>([])
  const [tab, setTab]                 = useState<'annotations'|'comments'>('annotations')

  // Field chip click — locate value in PDF text layer and flash-highlight it
  const jumpToFieldChip = useCallback(async (field: OcrField, idx: number) => {
    setActiveOcrFieldIdx(idx)
    if (!pdfDoc) return
    const MONTHS_SHORT = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
    const MONTHS_LONG  = ['january','february','march','april','may','june','july','august','september','october','november','december']
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
    const buildCandidates = (raw: string): string[] => {
      const v = raw.trim(); if (!v) return []
      const out = new Set<string>([v])
      const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
      if (iso) {
        const [, y, m, d] = iso; const mi = parseInt(m, 10) - 1
        if (mi >= 0 && mi < 12) {
          const ms = MONTHS_SHORT[mi]; const ml = MONTHS_LONG[mi]
          const dd = d; const ddN = String(parseInt(d, 10))
          ;[`${dd}-${ms}-${y}`,`${ddN}-${ms}-${y}`,`${dd} ${ms} ${y}`,`${ddN} ${ms} ${y}`,
            `${dd}/${m}/${y}`,`${m}/${dd}/${y}`,`${dd}-${m}-${y}`,`${ms} ${dd}, ${y}`,`${ml} ${dd}, ${y}`,
            `${dd}${ms}${y}`,`${ms}${dd}${y}`,`${dd}${m}${y}`,`${m}${dd}${y}`].forEach(s => out.add(s))
        }
      }
      const nums = v.match(/[\d.,]+/g)
      if (nums) nums.forEach(n => { out.add(n); out.add(n.replace(/,/g,'')); const w = n.split('.')[0].replace(/,/g,''); if (w.length >= 3) out.add(w) })
      const alnum = v.replace(/[^a-zA-Z0-9]/g, ''); if (alnum && alnum !== v) out.add(alnum)
      return [...out].filter(Boolean)
    }
    const findOnPage = async (pageNum: number, candidates: string[]) => {
      const pg = await pdfDoc.getPage(pageNum)
      const vp = pg.getViewport({ scale: 1 })
      const tc = await pg.getTextContent()
      const items = (tc.items as any[]).filter(it => it.str?.trim())
      let big = ''; const offsets: {start:number;end:number;item:any}[] = []
      for (const item of items) { const n = norm(item.str); if (!n) continue; offsets.push({start:big.length,end:big.length+n.length,item}); big += n }
      for (const cand of candidates) {
        const nc = norm(cand); if (!nc || nc.length < 2) continue
        const idx = big.indexOf(nc); if (idx < 0) continue
        const endIdx = idx + nc.length
        const first = offsets.find(o => o.end > idx); const last = [...offsets].reverse().find(o => o.start < endIdx)
        if (!first || !last) continue
        const [,,,,fx,fy] = first.item.transform as number[]; const [,,,,lx,ly] = last.item.transform as number[]
        const h = Math.max(first.item.height || 12, last.item.height || 12)
        const topY = Math.min(fy,ly); const botY = Math.max(fy,ly) + h
        return { page: pageNum, x: fx-2, y: vp.height-botY-2, w: Math.max(lx+(last.item.width||40)-fx,20)+4, h: (botY-topY)+4 }
      }
      return null
    }
    const candidates = buildCandidates(field.value || ''); if (!candidates.length) return
    try {
      const preferred = field.page || 1
      const order = [preferred, ...Array.from({length:numPages},(_,i)=>i+1).filter(p=>p!==preferred)]
      let hit = null
      for (const p of order) { hit = await findOnPage(p, candidates); if (hit) break }
      if (!hit) {
        setPageNum(preferred)
        const pg = await pdfDoc.getPage(preferred); const tc = await pg.getTextContent()
        const hasText = (tc.items as any[]).some(it => it.str?.trim())
        if (!hasText) { import('sonner').then(m => m.toast.info(`"${field.label}" — location unavailable (scanned document)`, {duration:3000})) }
        else { import('sonner').then(m => m.toast.info(`"${field.label}: ${field.value}" not found on this page`, {duration:3000})) }
        return
      }
      setPageNum(hit.page)
      requestAnimationFrame(() => {
        const c = mainRef.current; if (!c) return
        setFieldFlash({ page: hit!.page, x: hit!.x * zoom, y: hit!.y * zoom, w: hit!.w * zoom, h: hit!.h * zoom })
        setTimeout(() => setFieldFlash(null), 4000)
      })
    } catch { /* best effort */ }
  }, [pdfDoc, numPages, zoom])

  // OCR zone state
  const [ocrZoneResult, setOcrZoneResult] = useState<{
    text: string; x: number; y: number; w: number; h: number; processing: boolean
  } | null>(null)
  const [ocrZoneField, setOcrZoneField] = useState<string>('patientName')
  const [ocrFieldValues, setOcrFieldValues] = useState<Record<string, string>>({})

  // Refs
  const mainRef        = useRef<HTMLCanvasElement>(null)
  const overlayRef     = useRef<HTMLCanvasElement>(null)
  const noteTextRef    = useRef<HTMLTextAreaElement | null>(null)
  const renderRef      = useRef<pdfjsLib.RenderTask|null>(null)

  const renderIdRef    = useRef(0)
  const notesListRef   = useRef<HTMLDivElement>(null)
  const scaleRef       = useRef({ x: 1, y: 1 })
  // Stable blob URL created from bytes BEFORE pdfjs transfers/detaches the ArrayBuffer.
  // Reused for download renders so we never touch the (now-detached) bytes again.
  const pdfBlobRef     = useRef<string | null>(null)

  // Revoke the blob URL when the component unmounts
  useEffect(() => () => {
    if (pdfBlobRef.current) { URL.revokeObjectURL(pdfBlobRef.current); pdfBlobRef.current = null }
  }, [])

  const currentUser = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('user') || '{}').name || 'You' } catch { return 'You' }
  }, [])
  const currentUserId = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('user') || '{}').id || '' } catch { return '' }
  }, [])
  const currentUserEmail = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('user') || '{}').email || '' } catch { return '' }
  }, [])

  // Persistence key — scoped by barcode (most unique), then claimId, then filename.
  // Barcode is stamped on every document and is globally unique per claim,
  // so it prevents annotations bleeding between documents with the same filename.
  const annotKey = useMemo(() => {
    if (barcode) return `docview:barcode:${barcode}`
    if (claimId) return `docview:claim:${claimId}`
    // Fallback: filename + URL fragment to add some uniqueness
    const urlFrag = url ? url.replace(/[^a-z0-9]/gi, '').slice(-12) : ''
    return `docview:${filename.replace(/[^a-z0-9._-]/gi, '_')}${urlFrag ? '_' + urlFrag : ''}`
  }, [barcode, claimId, filename, url])
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [justSaved, setJustSaved] = useState(false)
  const loadedRef = useRef(false)      // prevents auto-save firing on initial load
  // Use module-level set so 404 state survives React Strict Mode double-mount
  const claimIsMissing = claimId ? _missingClaimIds.has(claimId) : false

  const isPdf   = mimeType === 'application/pdf' || (!mimeType && filename.toLowerCase().endsWith('.pdf'))
  const isImage = (mimeType?.startsWith('image/') ?? false) || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(filename)
  const pdfSrc  = bytes ?? url ?? null
  const isLoading     = !ready
  const isUnavailable = ready && isPdf && !pdfSrc

  // Fetch users
  useEffect(() => {
    userService.getAll({ limit: '500' })
      .then(res => { const list = Array.isArray(res) ? res : (res as any)?.users ?? (res as any)?.data ?? []; setUsers(Array.isArray(list) ? list : []) })
      .catch(() => {})
  }, [])

  // Load saved annotations on mount — DB first, localStorage fallback
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const loadFromLocalStorage = () => {
        const raw = localStorage.getItem(annotKey)
        if (raw) {
          try {
            const parsed = JSON.parse(raw)
            if (Array.isArray(parsed.annotations)) setAnnotations(parsed.annotations)
            if (Array.isArray(parsed.notes))       setNotes(parsed.notes)
            if (parsed.savedAt) setSavedAt(new Date(parsed.savedAt))
          } catch { /* ignore corrupt cache */ }
        }
      }

      const isUuid = claimId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claimId)
      if (isUuid && !_missingClaimIds.has(claimId) && !_inflight.has(claimId)) {
        _inflight.add(claimId)
        try {
          const { data } = await api.get(`/claims/${claimId}/annotations`)
          if (cancelled) return
          const dbAnnotations = Array.isArray(data?.annotations) ? data.annotations : []
          if (dbAnnotations.length > 0) {
            setAnnotations(dbAnnotations)
            localStorage.setItem(annotKey, JSON.stringify({ annotations: dbAnnotations, notes: [], savedAt: new Date().toISOString() }))
          } else {
            loadFromLocalStorage()
          }
        } catch (err: any) {
          if (err?.response?.status === 404 || err?.status === 404) {
            if (claimId) _missingClaimIds.add(claimId)
          }
          if (!cancelled) loadFromLocalStorage()
        } finally {
          if (claimId) _inflight.delete(claimId)
        }
      } else {
        loadFromLocalStorage()
      }

      setTimeout(() => { loadedRef.current = true }, 0)
    })()
    return () => { cancelled = true; if (claimId) _inflight.delete(claimId) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimId, annotKey])

  // Auto-save whenever annotations or notes change (debounced 800ms)
  // DB save when claimId present, localStorage fallback always
  useEffect(() => {
    if (!loadedRef.current) return
    const t = setTimeout(async () => {
      try {
        const now = new Date()
        // Always write to localStorage as fast local cache
        localStorage.setItem(annotKey, JSON.stringify({ annotations, notes, savedAt: now.toISOString() }))
        // Also persist to DB if we have a valid claim ID (skip if previously 404'd)
        if (claimId && !claimIsMissing) {
          await api.patch(`/claims/${claimId}/annotations`, { annotations }).catch((err: any) => {
            if (err?.response?.status === 404 || err?.status === 404) {
              if (claimId) _missingClaimIds.add(claimId)  // stop retrying on 404
            }
          })
        }
        setSavedAt(now)
        setJustSaved(true)
        setTimeout(() => setJustSaved(false), 2000)
      } catch { /* ignore */ }
    }, 800)
    return () => clearTimeout(t)
  }, [annotations, notes, annotKey, claimId])

  // Escape
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !showSignModal && !notePopup) onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose, showSignModal, notePopup])

  // Load PDF
  useEffect(() => {
    if (!isPdf || !pdfSrc) { setLoading(false); return }
    setLoading(true); setPdfError(null)
    let dead = false
    ;(async () => {
      try {
        // Pass bytes directly to pdfjs as { data: Uint8Array } — never create a blob URL.
        // Firefox (XrayWrapper) blocks loading blob: URLs as sub-resources, causing the
        // "Content at http://localhost:3000/... may not load data from blob:..." errors.
        // pdfjs accepts { data: Uint8Array } natively; we give it a copy so the original
        // bytes remain usable for download after pdfjs transfers the ArrayBuffer.
        let loadSrc: string | { data: Uint8Array }
        if (pdfSrc instanceof Uint8Array) {
          loadSrc = { data: pdfSrc.slice(0) }  // slice(0) = copy; pdfjs transfers this, not the original
        } else {
          loadSrc = pdfSrc as string
        }
        const pdf = await pdfjsLib.getDocument(loadSrc as any).promise
        if (dead) { pdf.destroy(); return }
        setPdfDoc(pdf); setNumPages(pdf.numPages)
        // thumbnails in background
        const t: string[] = []
        for (let i = 1; i <= pdf.numPages; i++) {
          const pg = await pdf.getPage(i)
          const vp = pg.getViewport({ scale: 0.14 })
          const c = document.createElement('canvas')
          c.width = vp.width; c.height = vp.height
          await pg.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise
          t.push(c.toDataURL())
          if (!dead) setThumbs([...t])
        }
      } catch (e: any) {
        if (!dead) setPdfError(e?.message || 'Failed to load PDF')
      } finally {
        if (!dead) setLoading(false)
      }
    })()
    return () => { dead = true }
  }, [isPdf, pdfSrc])

  // Render page
  const redraw = useCallback(() => {
    if (!overlayRef.current) return
    const c = overlayRef.current
    const ctx = c.getContext('2d')!
    renderAnnotations(ctx, annotations, pageNum, scaleRef.current.x, scaleRef.current.y)
  }, [annotations, pageNum])

  useEffect(() => {
    if (!pdfDoc || !mainRef.current) return
    const myId = ++renderIdRef.current
    if (renderRef.current) renderRef.current.cancel()
    ;(async () => {
      try {
        const pg = await pdfDoc.getPage(pageNum)
        if (myId !== renderIdRef.current) return
        const vp = pg.getViewport({ scale: zoom, rotation })
        const c = mainRef.current!; if (!c || myId !== renderIdRef.current) return
        c.width = vp.width; c.height = vp.height
        if (overlayRef.current) { overlayRef.current.width = vp.width; overlayRef.current.height = vp.height }
        scaleRef.current = { x: 1, y: 1 }  // 1:1 since we render at target scale
        const task = pg.render({ canvasContext: c.getContext('2d')!, viewport: vp })
        renderRef.current = task
        await task.promise
        if (myId === renderIdRef.current) redraw()
      } catch (e: any) { if (e?.name !== 'RenderingCancelledException') console.error(e) }
    })()
  }, [pdfDoc, pageNum, zoom, rotation])

  useEffect(() => { redraw() }, [annotations, pageNum, redraw])

  // Pre-load signature images so canvas can draw them synchronously.
  // loadSigImage is idempotent (internal cache) — safe to call on every render.
  useEffect(() => {
    annotations.forEach(a => {
      if (a.type === 'sign' && a.signatureDataUrl) {
        loadSigImage(a.signatureDataUrl, () => redraw())
      }
    })
  }, [annotations, redraw])

  // Canvas coordinate helper
  const canvasXY = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = overlayRef.current!; const r = c.getBoundingClientRect()
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) }
  }

  const me = { id: currentUserId, name: currentUser, email: currentUserEmail }

  // Manual save
  const saveNow = useCallback(async () => {
    try {
      const now = new Date()
      localStorage.setItem(annotKey, JSON.stringify({ annotations, notes, savedAt: now.toISOString() }))
      if (claimId && !claimIsMissing) {
        await api.patch(`/claims/${claimId}/annotations`, { annotations }).catch((err: any) => {
          if (err?.response?.status === 404 || err?.status === 404) if (claimId) _missingClaimIds.add(claimId)
        })
      }
      setSavedAt(now)
      setJustSaved(true)
      setTimeout(() => setJustSaved(false), 2500)
    } catch { /* ignore */ }
  }, [annotations, notes, annotKey, claimId])

  // ── Download helpers ──────────────────────────────────────────────────────────
  const [downloading, setDownloading] = useState(false)

  // Download original (no annotations) — works from bytes or URL
  const downloadOriginal = useCallback(async () => {
    setDownloading(true)
    try {
      let blob: Blob
      if (bytes) {
        blob = new Blob([new Uint8Array(bytes)], { type: mimeType || 'application/octet-stream' })
      } else if (url) {
        const r = await fetch(url, { credentials: 'include' })
        blob = await r.blob()
      } else return
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
      a.download = filename; document.body.appendChild(a); a.click()
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000)
    } finally { setDownloading(false) }
  }, [bytes, url, mimeType, filename])

  // Download with annotations — reuses the viewer's mainRef canvas (which is proven
  // to render correctly) rather than creating new off-screen canvases (which silently
  // produce blank output in Firefox due to pdfjs worker rendering behaviour).
  // Each page is rendered to mainRef at 2× scale, annotations are drawn on top,
  // the result is captured as PNG and embedded in a pdf-lib document.
  // After all pages are captured the current page is restored.
  const downloadWithAnnotations = useCallback(async () => {
    if (!pdfDoc || !mainRef.current) return
    setDownloading(true)
    try {
      const DL_SCALE = 2
      const outDoc   = await PDFDocument.create()
      const canvas   = mainRef.current

      for (let p = 1; p <= numPages; p++) {
        const pg  = await pdfDoc.getPage(p)
        const vp  = pg.getViewport({ scale: DL_SCALE, rotation: 0 })

        // Resize the viewer canvas to the download dimensions
        canvas.width  = vp.width
        canvas.height = vp.height
        if (overlayRef.current) {
          overlayRef.current.width  = vp.width
          overlayRef.current.height = vp.height
        }

        // Cancel any in-flight render so the page proxy is free
        renderRef.current?.cancel()

        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)

        // Render using the same canvas/context the viewer uses — guaranteed to work
        const task = pg.render({ canvasContext: ctx, viewport: vp })
        renderRef.current = task
        await task.promise

        // Draw annotations on top of the PDF — noClear=true so we don't wipe the PDF content
        renderAnnotations(ctx, annotations, p, DL_SCALE / zoom, DL_SCALE / zoom, true)

        const pngBytes = dataUrlToBytes(canvas.toDataURL('image/png'))
        const pngImage = await outDoc.embedPng(pngBytes)
        const ptW = vp.width  / DL_SCALE   // canvas px → 72-dpi pts
        const ptH = vp.height / DL_SCALE
        const pdfPage = outDoc.addPage([ptW, ptH])
        pdfPage.drawImage(pngImage, { x: 0, y: 0, width: ptW, height: ptH })
      }

      const pdfBytes = await outDoc.save()
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
      a.download = filename.replace(/\.pdf$/i, '') + '_annotated.pdf'
      document.body.appendChild(a); a.click()
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000)
    } finally {
      setDownloading(false)
      // Restore the current page in the viewer
      if (pdfDoc && mainRef.current) {
        const pg  = await pdfDoc.getPage(pageNum)
        const vp  = pg.getViewport({ scale: zoom, rotation })
        const c   = mainRef.current
        c.width   = vp.width; c.height = vp.height
        if (overlayRef.current) { overlayRef.current.width = vp.width; overlayRef.current.height = vp.height }
        renderRef.current?.cancel()
        const task = pg.render({ canvasContext: c.getContext('2d')!, viewport: vp })
        renderRef.current = task
        try { await task.promise; redraw() } catch { /* harmless if cancelled */ }
      }
    }
  }, [pdfDoc, numPages, annotations, zoom, rotation, pageNum, filename, redraw])

  // Mouse handlers
  // OCR zone: run OCR on a cropped region of the PDF canvas
  const runOcrOnZone = async (sx: number, sy: number, sw: number, sh: number) => {
    const pdfCanvas = mainRef.current
    if (!pdfCanvas) return
    setOcrZoneResult({ text: '', x: sx, y: sy, w: sw, h: sh, processing: true })
    try {
      // Upscale small zones so Tesseract has enough pixels to work with
      const upscale = sw < 200 || sh < 60 ? 3 : sw < 400 || sh < 120 ? 2 : 1
      const cropCanvas = document.createElement('canvas')
      cropCanvas.width = sw * upscale; cropCanvas.height = sh * upscale
      const cropCtx = cropCanvas.getContext('2d')!
      cropCtx.imageSmoothingEnabled = true
      cropCtx.imageSmoothingQuality = 'high'
      cropCtx.drawImage(pdfCanvas, sx, sy, sw, sh, 0, 0, sw * upscale, sh * upscale)

      let extractedText = ''

      // Use the dedicated zone-text endpoint — returns raw Tesseract output without invoice parsing
      try {
        const blob = await new Promise<Blob>((res, rej) =>
          cropCanvas.toBlob(b => b ? res(b) : rej(new Error('crop failed')), 'image/png'))
        const formData = new FormData()
        formData.append('file', new File([blob], 'ocr-zone.png', { type: 'image/png' }))
        const { data } = await api.post('/ocr/zone-text', formData, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 30000 } as any)
        if (data.success && data.text) extractedText = data.text
      } catch { /* fall through to client-side Tesseract */ }

      // Client-side Tesseract fallback if backend is unavailable
      if (!extractedText) {
        try {
          const Tesseract = await import('tesseract.js')
          const { data: { text } } = await Tesseract.recognize(cropCanvas, 'eng', {})
          extractedText = text.trim()
        } catch { /* ignore */ }
      }

      setOcrZoneResult(prev => prev ? { ...prev, text: extractedText || '(No text detected)', processing: false } : null)
    } catch {
      setOcrZoneResult(prev => prev ? { ...prev, text: '(OCR failed)', processing: false } : null)
    }
  }

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool === 'pointer') return
    const p = canvasXY(e)

    if (tool === 'note') {
      const r = overlayRef.current!.getBoundingClientRect()
      setNotePopup({ ...p, cssX: e.clientX - r.left, cssY: e.clientY - r.top, page: pageNum })
      return
    }
    if (tool === 'stamp') {
      setAnnotations(prev => [...prev, { id: uid(), type: 'stamp', page: pageNum, x: p.x, y: p.y, stampLabel: activeStamp, authorId: me.id, authorName: me.name, createdAt: new Date().toISOString() }])
      return
    }
    if (tool === 'sign') {
      if (pendingSignature) {
        setAnnotations(prev => [...prev, { id: uid(), type: 'sign', page: pageNum, x: p.x, y: p.y, w: 160, h: 60, signatureDataUrl: pendingSignature, authorId: me.id, authorName: me.name, authorEmail: me.email, createdAt: new Date().toISOString() }])
      } else {
        setShowSignModal(true)
      }
      return
    }

    setDrawing(true); setDrawStart(p)
    if (tool === 'draw') setCurrentStroke([p])
  }

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawing || !drawStart) return
    const p = canvasXY(e)
    const c = overlayRef.current!; const ctx = c.getContext('2d')!
    renderAnnotations(ctx, annotations, pageNum, 1, 1)

    if (tool === 'ocr_zone') {
      const w = p.x - drawStart.x; const h = p.y - drawStart.y
      ctx.fillStyle = 'rgba(6,182,212,0.10)'; ctx.strokeStyle = 'rgba(6,182,212,0.85)'
      ctx.lineWidth = 2; ctx.setLineDash([6, 3])
      ctx.fillRect(drawStart.x, drawStart.y, w, h); ctx.strokeRect(drawStart.x, drawStart.y, w, h)
      ctx.setLineDash([])
      ctx.fillStyle = 'rgba(6,182,212,0.9)'; ctx.font = 'bold 11px sans-serif'
      ctx.fillText('OCR Zone', drawStart.x + 4, drawStart.y + 14)
      return
    }

    if (tool === 'highlight' || tool === 'redact' || tool === 'whiteout' || tool === 'underline' || tool === 'strikethrough') {
      const fill = tool === 'highlight' ? highlightColor.fill : tool === 'redact' ? 'rgba(0,0,0,0.85)' : tool === 'whiteout' ? 'rgba(255,255,255,0.9)' : 'rgba(59,130,246,0.15)'
      ctx.fillStyle = fill; ctx.fillRect(drawStart.x, drawStart.y, p.x - drawStart.x, p.y - drawStart.y)
      if (tool === 'highlight') { ctx.strokeStyle = highlightColor.stroke; ctx.lineWidth = 1; ctx.strokeRect(drawStart.x, drawStart.y, p.x - drawStart.x, p.y - drawStart.y) }
      if (tool === 'underline') { ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2.5; const y2 = drawStart.y + Math.abs(p.y - drawStart.y); ctx.beginPath(); ctx.moveTo(drawStart.x, y2); ctx.lineTo(p.x, y2); ctx.stroke() }
      if (tool === 'strikethrough') { ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2.5; const y2 = drawStart.y + Math.abs(p.y - drawStart.y)/2; ctx.beginPath(); ctx.moveTo(drawStart.x, y2); ctx.lineTo(p.x, y2); ctx.stroke() }
    }
    if (tool === 'draw') {
      const stroke = [...currentStroke, p]; setCurrentStroke(stroke)
      ctx.strokeStyle = drawColor; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(stroke[0].x, stroke[0].y)
      stroke.slice(1).forEach(pt => ctx.lineTo(pt.x, pt.y)); ctx.stroke()
    }
  }

  const onMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawing || !drawStart) return
    const p = canvasXY(e); const w = p.x - drawStart.x; const h = p.y - drawStart.y

    if (tool === 'ocr_zone') {
      setDrawing(false); setDrawStart(null)
      const sx = w < 0 ? drawStart.x + w : drawStart.x
      const sy = h < 0 ? drawStart.y + h : drawStart.y
      const sw = Math.abs(w); const sh = Math.abs(h)
      if (sw > 10 && sh > 10) runOcrOnZone(sx, sy, sw, sh)
      else { renderAnnotations(overlayRef.current!.getContext('2d')!, annotations, pageNum, 1, 1) }
      return
    }

    if ((tool === 'highlight' || tool === 'redact' || tool === 'whiteout' || tool === 'underline' || tool === 'strikethrough') && Math.abs(w) > 4) {
      setAnnotations(prev => [...prev, {
        id: uid(), type: tool, page: pageNum,
        x: drawStart.x, y: drawStart.y, w, h,
        color: tool === 'highlight' ? highlightColor.fill : undefined,
        authorId: me.id, authorName: me.name, createdAt: new Date().toISOString(),
      }])
    }
    if (tool === 'draw' && currentStroke.length > 1) {
      setAnnotations(prev => [...prev, { id: uid(), type: 'draw', page: pageNum, x: 0, y: 0, color: drawColor, paths: [currentStroke], authorId: me.id, authorName: me.name, createdAt: new Date().toISOString() }])
      setCurrentStroke([])
    }
    setDrawing(false); setDrawStart(null)
  }

  const cursor = tool === 'pointer' ? 'default' : tool === 'highlight' || tool === 'redact' || tool === 'whiteout' ? 'crosshair' : tool === 'note' ? 'cell' : tool === 'stamp' ? 'copy' : tool === 'draw' ? 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\' viewBox=\'0 0 24 24\'%3E%3Ccircle cx=\'4\' cy=\'20\' r=\'2\' fill=\'%23ef4444\'/%3E%3Cline x1=\'4\' y1=\'20\' x2=\'20\' y2=\'4\' stroke=\'%23ef4444\' stroke-width=\'2\'/%3E%3C/svg%3E") 4 20, crosshair' : tool === 'sign' ? 'copy' : tool === 'ocr_zone' ? 'crosshair' : 'default'

  const pageAnnotations = annotations.filter(a => a.page === pageNum)

  // ── Render ──────────────────────────────────────────────────────────────────
  const overlay = (
    <div
      className="fixed inset-0 flex flex-col bg-background"
      style={{ zIndex: 99999, pointerEvents: 'auto' }}
      ref={el => {
        if (!el) return
        // Radix Dialog detects outside clicks via a native `pointerdown` listener on
        // the document. React's synthetic stopPropagation doesn't stop native listeners,
        // so we must intercept at the DOM level.
        el.addEventListener('pointerdown', e => {
          e.stopPropagation()
          // Do NOT call preventDefault — that would block browser focus on inputs/textareas
        }, { capture: true })
      }}
    >
      {/* ── Signature modal ── */}
      {showSignModal && (
        <SignModal
          userId={currentUserId}
          currentUser={currentUser}
          onDone={dataUrl => { setPendingSignature(dataUrl); setShowSignModal(false); setTool('sign') }}
          onCancel={() => { setShowSignModal(false); setTool('pointer') }}
        />
      )}

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-card shrink-0 gap-2">
        <span className="text-sm font-medium truncate max-w-[40vw]">{filename}</span>

        {/* PDF nav */}
        {isPdf && pdfDoc && (
          <div className="flex items-center gap-1 bg-muted rounded-lg px-2 py-1 text-xs">
            <button disabled={pageNum <= 1} onClick={() => setPageNum(p => p-1)} className="px-1 disabled:opacity-30 hover:text-primary">‹</button>
            <span className="tabular-nums min-w-[48px] text-center">{pageNum} / {numPages}</span>
            <button disabled={pageNum >= numPages} onClick={() => setPageNum(p => p+1)} className="px-1 disabled:opacity-30 hover:text-primary">›</button>
            <div className="w-px h-3 bg-border mx-1" />
            <button onClick={() => setZoom(z => Math.max(0.5, +(z-0.25).toFixed(2)))} className="px-1 hover:text-primary" title="Zoom out"><ZoomOut className="h-3 w-3" /></button>
            <span className="tabular-nums w-10 text-center">{Math.round(zoom*100)}%</span>
            <button onClick={() => setZoom(z => Math.min(4, +(z+0.25).toFixed(2)))} className="px-1 hover:text-primary" title="Zoom in"><ZoomIn className="h-3 w-3" /></button>
            <div className="w-px h-3 bg-border mx-1" />
            <button onClick={() => setRotation(r => (r+90)%360)} className="px-1 hover:text-primary" title="Rotate"><RotateCcw className="h-3 w-3" /></button>
          </div>
        )}

        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={() => setShowSidebar(o=>!o)} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent transition-colors">
            <MessageSquare className="h-3.5 w-3.5" />
            {showSidebar ? 'Hide Panel' : 'Show Panel'}
            {!showSidebar && (annotations.length + notes.length) > 0 && <span className="ml-1 bg-blue-500 text-white rounded-full text-[9px] px-1">{annotations.length + notes.length}</span>}
          </button>
          {/* Download dropdown — click to open, click outside to close */}
          {(bytes || url) && (
            <div className="relative">
              <button
                disabled={downloading}
                onClick={() => setShowDownload(o => !o)}
                className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50"
              >
                {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                Download ▾
              </button>
              {showDownload && (
                <>
                  {/* backdrop to close on outside click */}
                  <div className="fixed inset-0 z-40" onClick={() => setShowDownload(false)} />
                  <div className="absolute right-0 top-full mt-1 w-56 rounded-md border bg-popover shadow-xl z-50 flex flex-col py-1 text-xs">
                    <button
                      onClick={() => { setShowDownload(false); downloadOriginal() }}
                      className="flex items-center gap-2 px-3 py-2.5 hover:bg-accent text-left w-full"
                    >
                      <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span>
                        <span className="font-medium block">Without annotations</span>
                        <span className="text-muted-foreground">Original document only</span>
                      </span>
                    </button>
                    {isPdf && pdfDoc && (
                      <button
                        onClick={() => { setShowDownload(false); downloadWithAnnotations() }}
                        className="flex items-center gap-2 px-3 py-2.5 hover:bg-accent text-left w-full"
                      >
                        <Stamp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span>
                          <span className="font-medium block">With annotations</span>
                          <span className="text-muted-foreground">Stamps, highlights &amp; notes baked in</span>
                        </span>
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
          <button type="button" onClick={onClose} className="rounded-md p-1.5 hover:bg-accent transition-colors"><X className="h-4 w-4" /></button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-hidden flex" style={{ minHeight: 0 }}>

        {/* Thumbnail strip */}
        {isPdf && numPages > 1 && (
          <div className="w-[88px] shrink-0 bg-muted/40 border-r overflow-y-auto py-2 space-y-2">
            {Array.from({ length: numPages }).map((_, i) => (
              <button key={i} onClick={() => setPageNum(i+1)} className="w-full px-2 flex flex-col items-center gap-1 group">
                <div className={`w-full rounded overflow-hidden ring-2 transition-all ${pageNum===i+1 ? 'ring-primary' : 'ring-transparent group-hover:ring-muted-foreground/30'}`}>
                  {thumbs[i]
                    ? <img src={thumbs[i]} alt={`p${i+1}`} className="w-full block" />
                    : <div className="aspect-[3/4] bg-muted flex items-center justify-center"><Loader2 className="h-3 w-3 animate-spin text-muted-foreground" /></div>}
                </div>
                <span className={`text-[9px] tabular-nums ${pageNum===i+1 ? 'text-primary font-bold' : 'text-muted-foreground'}`}>{i+1}</span>
              </button>
            ))}
          </div>
        )}

        {/* Center: canvas + toolbar */}
        <div className="flex-1 flex flex-col overflow-hidden" style={{ minWidth: 0 }}>

          {/* Annotation toolbar */}
          {isPdf && pdfDoc && (
            <div className="flex items-center gap-1 px-3 py-1.5 border-b bg-card shrink-0 flex-wrap">
              {/* Tool buttons */}
              {([
                { key:'pointer',       icon:<MousePointer  className="h-3.5 w-3.5"/>, label:'Select'        },
                { key:'highlight',     icon:<Highlighter   className="h-3.5 w-3.5"/>, label:'Highlight'     },
                { key:'underline',     icon:<Underline     className="h-3.5 w-3.5"/>, label:'Underline'     },
                { key:'strikethrough', icon:<Strikethrough className="h-3.5 w-3.5"/>, label:'Strikethrough' },
                { key:'note',          icon:<StickyNote    className="h-3.5 w-3.5"/>, label:'Sticky Note'   },
                { key:'redact',        icon:<Square        className="h-3.5 w-3.5"/>, label:'Redact'        },
                { key:'whiteout',      icon:<EraserIcon    className="h-3.5 w-3.5"/>, label:'Whiteout'      },
                { key:'draw',          icon:<PenLine       className="h-3.5 w-3.5"/>, label:'Draw'          },
              ] as const).map(t => (
                <button key={t.key} onClick={() => setTool(t.key as ToolType)} title={t.label}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium border transition-all ${tool===t.key ? 'bg-primary text-primary-foreground border-primary' : 'border-transparent hover:bg-accent hover:border-border text-muted-foreground'}`}>
                  {t.icon} {t.label}
                </button>
              ))}

              {/* Stamp */}
              <div className="relative">
                <button onClick={() => { setShowStamps(s=>!s); setTool('stamp') }} title="Stamp"
                  className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium border transition-all ${tool==='stamp' ? 'bg-primary text-primary-foreground border-primary' : 'border-transparent hover:bg-accent hover:border-border text-muted-foreground'}`}>
                  <Stamp className="h-3.5 w-3.5" /> Stamp ▾
                </button>
                {showStamps && <StampPicker onPick={l => { setActiveStamp(l); setShowStamps(false); setTool('stamp') }} />}
              </div>

              {/* E-Sign */}
              <button onClick={() => { setTool('sign'); if (!pendingSignature) setShowSignModal(true) }} title="E-Signature"
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium border transition-all ${tool==='sign' ? 'bg-primary text-primary-foreground border-primary' : 'border-transparent hover:bg-accent hover:border-border text-muted-foreground'}`}>
                <Signature className="h-3.5 w-3.5" /> Sign {pendingSignature && <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />}
              </button>

              {/* OCR Zone */}
              <button
                onClick={() => { setTool('ocr_zone'); setOcrZoneResult(null) }}
                title="Drag to select a region and extract text via OCR"
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium border transition-all ${tool==='ocr_zone' ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' : 'border-transparent hover:bg-accent hover:border-border text-muted-foreground'}`}>
                <ScanBarcode className="h-3.5 w-3.5" /> OCR Zone
              </button>

              {/* Color pickers */}
              {tool === 'highlight' && (
                <div className="flex gap-1 ml-1 items-center">
                  {HIGHLIGHT_COLORS.map(c => (
                    <button key={c.label} onClick={() => setHighlightColor(c)} title={c.label}
                      style={{ width:16, height:16, borderRadius:'50%', background: c.stroke, border: highlightColor.label===c.label ? '2px solid currentColor' : '2px solid transparent' }} />
                  ))}
                </div>
              )}
              {tool === 'draw' && (
                <div className="flex gap-1 ml-1 items-center">
                  {['#ef4444','#3b82f6','#22c55e','#f59e0b','#8b5cf6','#000000'].map(c => (
                    <button key={c} onClick={() => setDrawColor(c)}
                      style={{ width:16, height:16, borderRadius:'50%', background:c, border: drawColor===c ? '2px solid currentColor' : '2px solid transparent' }} />
                  ))}
                </div>
              )}

              {/* Active stamp badge */}
              {tool === 'stamp' && (
                <span className="text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-200 rounded px-2 py-0.5">{activeStamp}</span>
              )}

              <div className="ml-auto flex items-center gap-2">
                {/* Clear page */}
                {pageAnnotations.length > 0 && (
                  <button onClick={() => setAnnotations(prev => prev.filter(a => a.page !== pageNum))}
                    className="flex items-center gap-1 text-[10px] text-destructive/70 hover:text-destructive transition-colors">
                    <X className="h-3 w-3" /> Clear page ({pageAnnotations.length})
                  </button>
                )}

                {/* Save indicator + button */}
                {savedAt && !justSaved && (
                  <span className="text-[10px] text-muted-foreground">
                    Saved {fmt(savedAt.toISOString())}
                  </span>
                )}
                {justSaved && (
                  <span className="flex items-center gap-1 text-[10px] text-green-600 font-medium">
                    <CheckCheck className="h-3 w-3" /> Saved
                  </span>
                )}
                <button onClick={saveNow}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-semibold border border-primary/40 bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition-all">
                  <Save className="h-3.5 w-3.5" /> Save
                </button>
              </div>
            </div>
          )}

          {/* Canvas */}
          <div className="flex-1 overflow-auto flex items-start justify-center p-6 bg-muted/30">
            {isLoading && <div className="flex flex-col items-center justify-center h-full gap-3"><Loader2 className="h-10 w-10 animate-spin text-primary" /><p className="text-sm text-muted-foreground">Loading…</p></div>}
            {isUnavailable && (
              <div className="flex flex-col items-center justify-center h-full gap-3 p-6">
                <AlertCircle className="h-12 w-12 text-muted-foreground/40" />
                <p className="text-sm font-medium">Document not available for preview</p>
                <p className="text-xs text-muted-foreground text-center max-w-sm">This file was uploaded in a previous browser session.</p>
              </div>
            )}
            {pdfError && <div className="flex flex-col items-center justify-center h-full gap-3"><AlertCircle className="h-10 w-10 text-destructive"/><p className="text-sm text-destructive">{pdfError}</p></div>}

            {isPdf && (
              <div className={`relative shadow-2xl rounded ${loading || pdfError ? 'hidden' : ''}`}>
                <canvas ref={mainRef} className="block" />
                <canvas ref={overlayRef} className="absolute inset-0"
                  style={{ cursor, pointerEvents: (notePopup || ocrZoneResult) ? 'none' : undefined }}
                  onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} />

                {/* Field chip flash highlight */}
                {fieldFlash && fieldFlash.page === pageNum && mainRef.current && (
                  <svg className="absolute inset-0 pointer-events-none" style={{ width: mainRef.current.width, height: mainRef.current.height }}>
                    <rect x={fieldFlash.x - 4} y={fieldFlash.y - 4} width={fieldFlash.w + 8} height={fieldFlash.h + 8}
                      fill="#f59e0b" fillOpacity="0.25" stroke="#f59e0b" strokeWidth="2" rx="3">
                      <animate attributeName="fill-opacity" values="0.25;0.45;0.25;0.45;0.25" dur="1.6s" repeatCount="indefinite" />
                    </rect>
                    <g transform={`translate(${Math.max(2, fieldFlash.x - 26)}, ${fieldFlash.y + fieldFlash.h / 2})`}>
                      <polygon points="0,-6 16,0 0,6" fill="#f59e0b" opacity="0.85">
                        <animateTransform attributeName="transform" type="translate" values="-4 0;0 0;-4 0" dur="1.4s" repeatCount="indefinite" />
                      </polygon>
                    </g>
                  </svg>
                )}

                {/* Sticky note popup — positioned in CSS-space so it tracks the click correctly */}
                {notePopup && (
                  <div
                    className="absolute"
                    style={{
                      left: Math.min(notePopup.cssX + 4, (mainRef.current?.clientWidth ?? 600) - 260),
                      top:  Math.min(notePopup.cssY + 4, (mainRef.current?.clientHeight ?? 800) - 200),
                      zIndex: 9999,
                      pointerEvents: 'all',
                      width: 264,
                    }}
                    onPointerDown={e => e.stopPropagation()}
                  >
                    {/* Card */}
                    <div style={{
                      background: 'linear-gradient(145deg, #fffde7, #fff9c4)',
                      border: '1.5px solid #f59e0b',
                      borderRadius: 14,
                      boxShadow: '0 8px 32px rgba(245,158,11,0.25), 0 2px 8px rgba(0,0,0,0.12)',
                      overflow: 'hidden',
                    }}>
                      {/* Header */}
                      <div style={{ background: 'linear-gradient(90deg, #f59e0b, #fbbf24)', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 14 }}>📌</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'white', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                          Sticky Note — Page {notePopup.page}
                        </span>
                      </div>
                      {/* Body */}
                      <div style={{ padding: '10px 12px 12px' }}>
                        <textarea
                          ref={el => { if (el) { noteTextRef.current = el; setTimeout(() => el.focus(), 0) } }}
                          placeholder="Type note…"
                          defaultValue=""
                          onKeyDown={e => {
                            e.stopPropagation()
                            if (e.key === 'Escape') { setNotePopup(null) }
                            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                              const trimmed = (noteTextRef.current?.value || '').trim()
                              if (trimmed) {
                                setAnnotations(prev => [...prev, { id: uid(), type: 'note', page: notePopup.page, x: notePopup.x, y: notePopup.y, text: trimmed, authorId: me.id, authorName: me.name, createdAt: new Date().toISOString() }])
                              }
                              setNotePopup(null)
                            }
                          }}
                          onPointerDown={e => e.stopPropagation()}
                          style={{
                            width: '100%', height: 88, resize: 'none',
                            background: 'rgba(255,255,255,0.7)',
                            border: '1.5px solid #fbbf24', borderRadius: 9,
                            padding: '8px 10px', fontSize: 13,
                            fontFamily: 'inherit', outline: 'none',
                            color: '#1c1917', boxSizing: 'border-box',
                            lineHeight: 1.5,
                          }}
                        />
                        <p style={{ fontSize: 10, color: '#a16207', margin: '4px 0 8px', opacity: 0.7 }}>Ctrl+Enter to save quickly</p>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            type="button"
                            onPointerDown={e => e.stopPropagation()}
                            onClick={() => {
                              const trimmed = (noteTextRef.current?.value || '').trim()
                              if (trimmed) {
                                setAnnotations(prev => [...prev, { id: uid(), type: 'note', page: notePopup.page, x: notePopup.x, y: notePopup.y, text: trimmed, authorId: me.id, authorName: me.name, createdAt: new Date().toISOString() }])
                              }
                              setNotePopup(null)
                            }}
                            style={{ flex: 1, background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: 'white', border: 'none', borderRadius: 9, padding: '7px 0', fontSize: 12, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 8px rgba(245,158,11,0.4)' }}
                          >
                            Save Note
                          </button>
                          <button
                            type="button"
                            onPointerDown={e => e.stopPropagation()}
                            onClick={() => setNotePopup(null)}
                            style={{ flex: 1, background: 'rgba(255,255,255,0.6)', border: '1.5px solid #fbbf24', borderRadius: 9, padding: '7px 0', fontSize: 12, color: '#92400e', cursor: 'pointer', fontWeight: 500 }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* OCR Zone result popup */}
                {ocrZoneResult && (() => {
                  const canvasW = mainRef.current?.clientWidth || 800
                  const popupW = 256
                  const rawLeft = ocrZoneResult.x + ocrZoneResult.w / 2 - popupW / 2
                  const left = Math.max(4, Math.min(rawLeft, canvasW - popupW - 4))
                  const top = ocrZoneResult.y + ocrZoneResult.h + 8
                  return (
                    <div
                      className="absolute z-30 rounded-xl shadow-2xl"
                      style={{ left, top, width: popupW, background: '#0f172a', border: '1px solid rgba(6,182,212,0.5)', pointerEvents: 'all' }}
                      onPointerDown={e => e.stopPropagation()}
                    >
                      {/* Header */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px 6px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                        <ScanBarcode style={{ width: 13, height: 13, color: '#22d3ee', flexShrink: 0 }} />
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#22d3ee', textTransform: 'uppercase', letterSpacing: '0.07em', flex: 1 }}>OCR Zone Result</span>
                        <button onClick={() => { setOcrZoneResult(null); renderAnnotations(overlayRef.current!.getContext('2d')!, annotations, pageNum, 1, 1) }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', padding: 2, lineHeight: 1 }}>
                          <X style={{ width: 12, height: 12 }} />
                        </button>
                      </div>

                      <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {/* Extracted text preview */}
                        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '6px 8px', minHeight: 40, display: 'flex', alignItems: 'center' }}>
                          {ocrZoneResult.processing ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', justifyContent: 'center' }}>
                              <Loader2 style={{ width: 13, height: 13, color: '#22d3ee', animation: 'spin 1s linear infinite' }} />
                              <span style={{ fontSize: 11, color: '#94a3b8' }}>Reading zone…</span>
                            </div>
                          ) : (
                            <p style={{ fontSize: 11, color: '#e2e8f0', lineHeight: 1.5, wordBreak: 'break-word', margin: 0, maxHeight: 64, overflow: 'hidden' }}>
                              {ocrZoneResult.text || '(No text detected)'}
                            </p>
                          )}
                        </div>

                        {/* Field selector + apply */}
                        {!ocrZoneResult.processing && ocrZoneResult.text && !ocrZoneResult.text.startsWith('(') && (
                          <>
                            <div>
                              <p style={{ fontSize: 10, color: '#64748b', margin: '0 0 3px' }}>Assign to field</p>
                              <select
                                value={ocrZoneField}
                                onChange={e => setOcrZoneField(e.target.value)}
                                style={{ width: '100%', background: '#1e293b', border: '1px solid rgba(255,255,255,0.12)', color: 'white', fontSize: 11, borderRadius: 7, padding: '5px 8px', outline: 'none' }}
                              >
                                {OCR_FIELD_OPTIONS.map(opt => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                            </div>
                            <button
                              onClick={() => {
                                const value = ocrZoneResult.text.replace(/\n/g, ' ').trim()
                                setOcrFieldValues(prev => ({ ...prev, [ocrZoneField]: value }))
                                setOcrZoneResult(null)
                                renderAnnotations(overlayRef.current!.getContext('2d')!, annotations, pageNum, 1, 1)
                              }}
                              style={{ background: 'rgba(6,182,212,0.15)', border: '1px solid rgba(6,182,212,0.4)', color: '#22d3ee', fontSize: 11, fontWeight: 600, borderRadius: 8, padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
                            >
                              <ArrowRight style={{ width: 12, height: 12 }} />
                              Apply to {OCR_FIELD_OPTIONS.find(o => o.value === ocrZoneField)?.label}
                            </button>
                          </>
                        )}

                        {!ocrZoneResult.processing && (
                          <button
                            onClick={() => { setOcrZoneResult(null); renderAnnotations(overlayRef.current!.getContext('2d')!, annotations, pageNum, 1, 1) }}
                            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#64748b', fontSize: 11, borderRadius: 8, padding: '5px 10px', cursor: 'pointer' }}
                          >
                            Dismiss
                          </button>
                        )}
                      </div>

                      {/* Show extracted values if any were saved */}
                      {Object.keys(ocrFieldValues).length > 0 && (
                        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '6px 10px 8px' }}>
                          <p style={{ fontSize: 10, color: '#475569', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Extracted Fields</p>
                          {Object.entries(ocrFieldValues).map(([k, v]) => (
                            <div key={k} style={{ display: 'flex', gap: 4, fontSize: 10, marginBottom: 2 }}>
                              <span style={{ color: '#64748b', flexShrink: 0 }}>{OCR_FIELD_OPTIONS.find(o => o.value === k)?.label ?? k}:</span>
                              <span style={{ color: '#94a3b8', wordBreak: 'break-word' }}>{v}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>
            )}

            {ready && isImage && url && (
              <div className="flex items-center justify-center h-full p-4"><img src={url} alt={filename} className="max-w-full max-h-full object-contain rounded shadow-lg" /></div>
            )}
            {ready && !isPdf && !isImage && url && (
              <div className="flex flex-col items-center justify-center h-full gap-3 p-6">
                <AlertCircle className="h-12 w-12 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">Preview not available.</p>
                <a href={url} download={filename} className="text-sm underline text-blue-600">Download to view</a>
              </div>
            )}
          </div>
        </div>

        {/* Right panel */}
        {showSidebar && (
          <div style={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', borderLeft: '1px solid', borderColor: 'var(--border)', height: '100%' }}>
            {/* Tab bar */}
            <div style={{ display: 'flex', borderBottom: '1px solid', borderColor: 'var(--border)', background: 'var(--card)', flexShrink: 0 }}>
              {(['annotations','comments'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)}
                  style={{ flex: 1, padding: '9px 0', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', background: tab===t ? 'var(--background)' : 'var(--card)', borderBottom: tab===t ? '2px solid #3b82f6' : '2px solid transparent', color: tab===t ? '#3b82f6' : 'var(--muted-foreground)', transition: 'all 0.15s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                  {t === 'annotations' ? <Highlighter size={12}/> : <MessageSquare size={12}/>}
                  {t.charAt(0).toUpperCase()+t.slice(1)}
                  {t==='annotations' && annotations.length>0 && <span style={{ background:'#6366f1',color:'white',borderRadius:10,fontSize:9,padding:'0 5px' }}>{annotations.length}</span>}
                  {t==='comments' && notes.length>0 && <span style={{ background:'#3b82f6',color:'white',borderRadius:10,fontSize:9,padding:'0 5px' }}>{notes.length}</span>}
                </button>
              ))}
            </div>

            {/* Annotations tab */}
            {tab==='annotations' && (
              <div style={{ flex:1, overflowY:'auto', padding:10, background:'var(--background)' }}>
                {annotations.length===0 && (
                  <div style={{ textAlign:'center', padding:'32px 16px', color:'#94a3b8' }}>
                    <Highlighter size={28} style={{ margin:'0 auto 10px', display:'block', opacity:0.35 }}/>
                    <p style={{ fontSize:13, fontWeight:600, marginBottom:4 }}>No annotations yet</p>
                    <p style={{ fontSize:12 }}>Use the toolbar above to highlight, stamp, draw, or sign</p>
                  </div>
                )}
                {annotations.map(a => (
                  <div key={a.id} style={{ borderRadius:8, marginBottom:8, border:'1px solid',borderColor:'var(--border)', padding:'8px 10px', background:'var(--card)', display:'flex', alignItems:'center', gap:8 }}>
                    <div style={{ width:28, height:28, borderRadius:6, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, background: a.type==='highlight'?'#fbbf2420': a.type==='redact'?'#00000020': a.type==='stamp'?'transparent': a.type==='draw'?'#ef444420': a.type==='sign'?'#22c55e20': '#f59e0b20' }}>
                      {a.type==='highlight' && <Highlighter size={13} color="#fbbf24"/>}
                      {a.type==='redact'    && <Square      size={13} color="#000"/>}
                      {a.type==='whiteout'  && <EraserIcon  size={13} color="#64748b"/>}
                      {a.type==='note'      && <StickyNote  size={13} color="#f59e0b"/>}
                      {a.type==='stamp'     && <StampPreview label={a.stampLabel||a.text||'STAMP'} />}
                      {a.type==='draw'      && <PenLine     size={13} color="#ef4444"/>}
                      {a.type==='sign'      && <Signature   size={13} color="#22c55e"/>}
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <p style={{ fontSize:11, fontWeight:600, color:'var(--foreground)', margin:0, textTransform:'capitalize' }}>
                        {a.type==='stamp' ? (a.stampLabel || a.text) : a.type}
                        <span style={{ fontWeight:400, color:'#94a3b8', marginLeft:4 }}>p{a.page}</span>
                      </p>
                      {a.text && <p style={{ fontSize:10, color:'#64748b', margin:'2px 0 0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{a.text}</p>}
                      <p style={{ fontSize:10, color:'#94a3b8', margin:'1px 0 0' }}>{a.authorName} · {fmt(a.createdAt)}</p>
                    </div>
                    <button onClick={() => setAnnotations(prev=>prev.filter(x=>x.id!==a.id))} style={{ background:'none',border:'none',cursor:'pointer',color:'#cbd5e1',padding:2 }} title="Delete"><Trash2 size={12}/></button>
                  </div>
                ))}
              </div>
            )}

            {/* Comments tab */}
            {tab==='comments' && (
              <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background:'var(--background)' }}>
                <div style={{ padding:'10px 12px', borderBottom:'1px solid', borderColor:'var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
                  <span style={{ fontSize:12, fontWeight:700 }}>Comments</span>
                  <button onClick={() => { setShowAddForm(true); setActiveNote(null) }}
                    style={{ display:'flex', alignItems:'center', gap:4, background:'#3b82f6', color:'white', border:'none', borderRadius:7, padding:'4px 10px', cursor:'pointer', fontSize:11, fontWeight:700 }}>
                    <Plus size={12}/> Add
                  </button>
                </div>
                <div ref={notesListRef} style={{ flex:1, overflowY:'auto', padding:10 }}>
                  {showAddForm && (
                    <AddCommentForm users={users} currentUser={currentUser} onAdd={note => { const n: Note = {...note, id:uid(), createdAt:new Date().toISOString(), comments:[]}; setNotes(prev=>[n,...prev]); setActiveNote(n.id) }} onCancel={() => setShowAddForm(false)} />
                  )}
                  {notes.length===0 && !showAddForm && (
                    <div style={{ textAlign:'center', padding:'32px 16px', color:'#94a3b8' }}>
                      <MessageSquare size={28} style={{ margin:'0 auto 10px', display:'block', opacity:0.35 }}/>
                      <p style={{ fontSize:13, fontWeight:600, marginBottom:4 }}>No comments yet</p>
                      <p style={{ fontSize:12 }}>Click <strong>+ Add</strong> to comment or assign a task</p>
                    </div>
                  )}
                  {notes.map(note => (
                    <div key={note.id} data-note-id={note.id} onClick={() => setActiveNote(id=>id===note.id?null:note.id)}
                      style={{ borderRadius:10, marginBottom:10, border:`1px solid ${note.id===activeNote?'#3b82f6':'var(--border)'}`, borderLeft:'4px solid #6366f1', background:'var(--card)', cursor:'pointer', overflow:'hidden', boxShadow: note.id===activeNote ? '0 2px 12px rgba(99,102,241,0.15)' : 'none' }}>
                      <div style={{ padding:'10px 12px' }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                            <div style={{ width:22, height:22, borderRadius:'50%', background:'#6366f1', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700, color:'white' }}>{(note.authorName||'?')[0].toUpperCase()}</div>
                            <span style={{ fontSize:11, fontWeight:600 }}>{note.authorName}</span>
                          </div>
                          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                            <span style={{ fontSize:10, color:'#94a3b8' }}>{fmt(note.createdAt)}</span>
                            <button onClick={e=>{e.stopPropagation();setNotes(prev=>prev.filter(n=>n.id!==note.id));if(activeNote===note.id)setActiveNote(null)}} style={{ background:'none',border:'none',cursor:'pointer',color:'#cbd5e1',padding:2 }}><Trash2 size={11}/></button>
                          </div>
                        </div>
                        <p style={{ fontSize:13, color:'var(--foreground)', margin:'0 0 6px', lineHeight:1.5 }}>{note.text}</p>
                        <div style={{ display:'flex', flexWrap:'wrap', gap:5, alignItems:'center' }}>
                          {note.pageRef && <span style={{ fontSize:10, background:'var(--muted)', color:'var(--muted-foreground)', borderRadius:5, padding:'1px 6px', border:'1px solid var(--border)' }}>Page {note.pageRef}</span>}
                          {note.assignedNames.map((n,i) => <span key={i} style={{ fontSize:10, background:'#eff6ff', color:'#1d4ed8', borderRadius:5, padding:'1px 6px', border:'1px solid #bfdbfe', display:'flex', alignItems:'center', gap:2 }}><AtSign size={8}/>{n}</span>)}
                          {note.comments.length>0 && <span style={{ fontSize:10, color:'#6366f1', marginLeft:'auto' }}>{note.comments.length} repl{note.comments.length===1?'y':'ies'}</span>}
                        </div>
                      </div>
                      {note.id===activeNote && (
                        <div style={{ borderTop:'1px solid var(--border)', padding:'10px 12px', background:'var(--muted)' }} onClick={e=>e.stopPropagation()}>
                          {note.comments.map(c=>(
                            <div key={c.id} style={{ marginBottom:8, paddingBottom:8, borderBottom:'1px solid var(--border)' }}>
                              <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:2 }}>
                                <div style={{ width:18,height:18,borderRadius:'50%',background:'#6366f1',display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:700,color:'white' }}>{(c.authorName||'?')[0].toUpperCase()}</div>
                                <span style={{ fontSize:11, fontWeight:600, color:'#3b82f6' }}>{c.authorName}</span>
                                <span style={{ fontSize:10, color:'#94a3b8', marginLeft:'auto' }}>{fmt(c.createdAt)}</span>
                              </div>
                              <p style={{ fontSize:12, margin:'0 0 0 23px' }}>{c.text}</p>
                            </div>
                          ))}
                          <div style={{ display:'flex', gap:6 }}>
                            <input placeholder="Reply… (Enter)" value={newReply[note.id]||''} onChange={e=>setNewReply(prev=>({...prev,[note.id]:e.target.value}))}
                              onKeyDown={e=>{if(e.key==='Enter'){const t=(newReply[note.id]||'').trim();if(!t)return;const c:NoteComment={id:uid(),authorName:currentUser,text:t,createdAt:new Date().toISOString()};setNotes(prev=>prev.map(n=>n.id===note.id?{...n,comments:[...n.comments,c]}:n));setNewReply(prev=>({...prev,[note.id]:''}))}}}
                              style={{ flex:1,fontSize:12,border:'1px solid var(--border)',borderRadius:7,padding:'5px 8px',fontFamily:'inherit',outline:'none',background:'var(--background)' }}
                            />
                            <button onClick={()=>{const t=(newReply[note.id]||'').trim();if(!t)return;const c:NoteComment={id:uid(),authorName:currentUser,text:t,createdAt:new Date().toISOString()};setNotes(prev=>prev.map(n=>n.id===note.id?{...n,comments:[...n.comments,c]}:n));setNewReply(prev=>({...prev,[note.id]:''}))}}
                              style={{ background:'#3b82f6',color:'white',border:'none',borderRadius:7,padding:'5px 10px',cursor:'pointer',display:'flex',alignItems:'center' }}>
                              <Send size={12}/>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Collapsed tab */}
        {!showSidebar && (annotations.length+notes.length)>0 && (
          <button onClick={()=>setShowSidebar(true)} style={{ width:28,flexShrink:0,background:'var(--muted)',border:'none',borderLeft:'1px solid var(--border)',cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:5,color:'var(--muted-foreground)',fontSize:10 }}>
            <ChevronLeft size={12}/><MessageSquare size={12}/><span style={{ writingMode:'vertical-rl',transform:'rotate(180deg)' }}>{annotations.length+notes.length}</span>
          </button>
        )}
      </div>

      {/* ── OCR field chips strip ── */}
      {ocrFields.length > 0 && (
        <div className="shrink-0 border-t bg-card">
          <div className="flex items-center gap-0.5 px-3 py-1.5 overflow-x-auto">
            <ScanLine className="h-3.5 w-3.5 text-muted-foreground shrink-0 mr-1.5" />
            {ocrFields.map((f, i) => (
              <button
                key={i}
                type="button"
                title={`${f.label}: ${f.value}${f.confidence !== undefined ? ` — ${(f.confidence * 100).toFixed(0)}% confidence` : ''} — click to locate in document`}
                onClick={() => jumpToFieldChip(f, i)}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium border whitespace-nowrap shrink-0 transition-colors ${
                  i === activeOcrFieldIdx
                    ? 'bg-amber-500 text-white border-amber-500'
                    : f.anomaly
                    ? 'bg-red-50 dark:bg-red-950/20 border-red-300 dark:border-red-700 text-red-700 dark:text-red-400 hover:bg-red-100'
                    : 'bg-muted/60 border-border text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <span className="opacity-70 mr-0.5">{f.label}:</span>
                <span className="font-semibold max-w-[120px] truncate">{f.value}</span>
                {f.confidence !== undefined && (
                  <span className={`opacity-50 ml-0.5 text-[9px] ${f.confidence < 0.7 ? 'text-amber-200 opacity-100' : ''}`}>
                    {(f.confidence * 100).toFixed(0)}%
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )

  // Render via a portal attached to document.body so the viewer survives React Router
  // navigation. Route changes unmount <Claims>, which would destroy the viewer if it
  // were in the normal tree. createPortal keeps React event delegation intact (unlike
  // manually appending DOM nodes), so onChange/onClick etc. all fire correctly.
  return createPortal(overlay, document.body)
}
