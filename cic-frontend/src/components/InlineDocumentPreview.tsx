import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Loader2, AlertTriangle, Download, ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import api from '@/services/api'

export interface InlineDocument {
  id?: string
  name: string
  mimetype?: string
  documentType?: string
}

interface Props {
  documents: InlineDocument[]
  /** Optional demo fallback to show when no real document IDs are available. */
  emptyHint?: string
  className?: string
}

/**
 * Fetches a document via `/api/documents/:id/preview` (authed) and renders it
 * inline — PDFs in an <iframe>, images in an <img>. A tab strip across the top
 * allows quick switching between documents attached to the same claim.
 */
export default function InlineDocumentPreview({ documents, emptyHint, className }: Props) {
  const usable = useMemo(() => documents.filter((d) => !!d.id), [documents])
  const [activeIdx, setActiveIdx] = useState(0)
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [mime, setMime] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Revoke object URLs when swapping to avoid leaks.
  const lastUrlRef = useRef<string | null>(null)

  useEffect(() => {
    setActiveIdx(0)
  }, [documents])

  useEffect(() => {
    const current = usable[activeIdx]
    if (!current?.id) {
      setObjectUrl(null)
      setMime(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    ;(async () => {
      try {
        const res = await api.get(`/documents/${current.id}/preview`, { responseType: 'blob' })
        const blob = res.data as Blob
        if (cancelled) return
        const url = URL.createObjectURL(blob)
        if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current)
        lastUrlRef.current = url
        setObjectUrl(url)
        setMime(blob.type || current.mimetype || null)
      } catch (err: any) {
        if (!cancelled) setError(err?.response?.data?.message || err?.message || 'Failed to load document')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [activeIdx, usable])

  useEffect(() => {
    return () => {
      if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current)
    }
  }, [])

  const current = usable[activeIdx]
  const isPdf = mime?.includes('pdf') || current?.mimetype?.includes('pdf') || current?.name?.toLowerCase().endsWith('.pdf')
  const isImage = mime?.startsWith('image/') || (current?.mimetype || '').startsWith('image/')

  const download = async () => {
    if (!current?.id) return
    try {
      const res = await api.get(`/documents/${current.id}/download`, { responseType: 'blob' })
      const blob = res.data as Blob
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = current.name || 'document'
      a.click()
      URL.revokeObjectURL(url)
    } catch { /* ignored */ }
  }

  const openInNewTab = () => {
    if (objectUrl) window.open(objectUrl, '_blank')
  }

  if (usable.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center h-full rounded-lg border border-dashed bg-muted/30 p-6 text-center ${className || ''}`}>
        <FileText className="h-10 w-10 text-muted-foreground/60 mb-2" />
        <p className="text-sm font-medium text-muted-foreground">No documents attached</p>
        {emptyHint && <p className="text-xs text-muted-foreground/70 mt-1">{emptyHint}</p>}
      </div>
    )
  }

  return (
    <div className={`flex flex-col h-full min-h-0 rounded-lg border bg-muted/10 ${className || ''}`}>
      {/* Tab strip */}
      <div className="flex items-center gap-1 border-b bg-background/50 p-1.5 overflow-x-auto">
        {usable.map((d, i) => (
          <button
            key={(d.id || '') + i}
            type="button"
            onClick={() => setActiveIdx(i)}
            className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
              i === activeIdx
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-muted text-muted-foreground hover:text-foreground'
            }`}
            title={d.name}
          >
            <FileText className="h-3 w-3" />
            <span className="max-w-[180px] truncate">{d.name}</span>
            {d.documentType && (
              <Badge
                variant={i === activeIdx ? 'secondary' : 'outline'}
                className="text-[9px] h-4 px-1 ml-1"
              >
                {d.documentType.replace(/_/g, ' ')}
              </Badge>
            )}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1 pr-1">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={openInNewTab} disabled={!objectUrl} title="Open in new tab">
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={download} disabled={!current?.id} title="Download">
            <Download className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Viewer */}
      <div className="flex-1 min-h-0 relative bg-neutral-100 dark:bg-neutral-900">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-muted-foreground bg-background/60 z-10">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading document…</span>
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center p-6">
            <AlertTriangle className="h-8 w-8 text-amber-500" />
            <p className="text-sm font-medium">Could not load preview</p>
            <p className="text-xs text-muted-foreground">{error}</p>
            {current?.id && (
              <Button size="sm" variant="outline" onClick={download}>
                <Download className="h-3.5 w-3.5 mr-1.5" /> Download instead
              </Button>
            )}
          </div>
        )}
        {!loading && !error && objectUrl && (
          isPdf ? (
            <iframe
              key={objectUrl}
              src={objectUrl}
              title={current?.name || 'document'}
              className="absolute inset-0 w-full h-full border-0"
            />
          ) : isImage ? (
            <div className="absolute inset-0 overflow-auto flex items-center justify-center p-4">
              <img src={objectUrl} alt={current?.name || 'document'} className="max-w-full max-h-full object-contain" />
            </div>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center p-6">
              <FileText className="h-10 w-10 text-muted-foreground/60" />
              <p className="text-sm">Preview not available for this file type.</p>
              <Button size="sm" variant="outline" onClick={download}>
                <Download className="h-3.5 w-3.5 mr-1.5" /> Download
              </Button>
            </div>
          )
        )}
      </div>
    </div>
  )
}
