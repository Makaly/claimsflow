import { useState, useEffect, useRef, useCallback } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import {
  X, ZoomIn, ZoomOut, RotateCw, ChevronLeft, ChevronRight,
  Search, Download, Maximize2, Minimize2, SplitSquareHorizontal,
  Sun, Moon, Printer, Columns,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

// Worker configured globally in main.tsx

interface PdfTab {
  id: string
  label: string
  url: string
  pdfDoc: pdfjsLib.PDFDocumentProxy | null
  pageCount: number
  currentPage: number
}

interface PdfViewerModalProps {
  open: boolean
  onClose: () => void
  url: string
  filename?: string
  allowDownload?: boolean
}

export function PdfViewerModal({ open, onClose, url, filename = 'document.pdf', allowDownload = true }: PdfViewerModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const [tabs, setTabs] = useState<PdfTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1.0)
  const [rotation, setRotation] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<string[]>([])
  const [currentSearchIdx, setCurrentSearchIdx] = useState(0)
  const [darkMode, setDarkMode] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [splitScreen, setSplitScreen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isRendering, setIsRendering] = useState(false)
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null)

  const activeTab = tabs.find(t => t.id === activeTabId) || null

  // Load initial document
  useEffect(() => {
    if (!open || !url) return
    loadDocument(url, filename)
  }, [open, url])

  const loadDocument = useCallback(async (docUrl: string, label: string) => {
    setLoading(true)
    setError(null)
    try {
      // Blob URLs are created in the main thread context and can't be fetched
      // from the pdf.js Web Worker. Fetch the bytes here and pass them directly
      // to avoid all cross-origin / XRay-wrapper security errors.
      let docSource: string | { data: Uint8Array } = docUrl
      if (docUrl.startsWith('blob:') || docUrl.startsWith('data:')) {
        try {
          const resp = await fetch(docUrl)
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
          const buf = await resp.arrayBuffer()
          docSource = { data: new Uint8Array(buf) }
        } catch {
          throw new Error(
            'File preview is unavailable. This file was uploaded in a previous session and cannot be displayed. Please re-upload to view it.'
          )
        }
      }
      const loadingTask = pdfjsLib.getDocument(docSource)
      const pdfDoc = await loadingTask.promise
      const tabId = `tab-${Date.now()}`
      const newTab: PdfTab = {
        id: tabId,
        label,
        url: docUrl,
        pdfDoc,
        pageCount: pdfDoc.numPages,
        currentPage: 1,
      }
      setTabs(prev => [...prev, newTab])
      setActiveTabId(tabId)
    } catch (err: any) {
      setError(`Failed to load PDF: ${err?.message || String(err)}`)
    } finally {
      setLoading(false)
    }
  }, [])

  // Render page whenever active tab / page / zoom / rotation changes
  useEffect(() => {
    if (!activeTab?.pdfDoc || !canvasRef.current) return
    renderPage(activeTab.pdfDoc, activeTab.currentPage)
  }, [activeTabId, activeTab?.currentPage, zoom, rotation])

  const renderPage = useCallback(async (pdfDoc: pdfjsLib.PDFDocumentProxy, pageNum: number) => {
    if (!canvasRef.current || isRendering) return

    // Cancel previous render
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel()
    }

    setIsRendering(true)
    try {
      const page = await pdfDoc.getPage(pageNum)
      const viewport = page.getViewport({ scale: zoom, rotation })
      const canvas = canvasRef.current
      const ctx = canvas.getContext('2d')!

      canvas.width = viewport.width
      canvas.height = viewport.height

      if (darkMode) {
        ctx.filter = 'invert(1) hue-rotate(180deg)'
      } else {
        ctx.filter = 'none'
      }

      const renderCtx = {
        canvasContext: ctx,
        viewport,
      }
      renderTaskRef.current = page.render(renderCtx as any)
      await renderTaskRef.current.promise
    } catch (err: any) {
      if (err?.name !== 'RenderingCancelledException') {
        console.error('Render error:', err)
      }
    } finally {
      setIsRendering(false)
    }
  }, [zoom, rotation, darkMode, isRendering])

  // Search
  const performSearch = useCallback(async () => {
    if (!activeTab?.pdfDoc || !searchQuery.trim()) {
      setSearchResults([])
      return
    }

    const results: string[] = []
    const query = searchQuery.toLowerCase()

    for (let i = 1; i <= activeTab.pdfDoc.numPages; i++) {
      const page = await activeTab.pdfDoc.getPage(i)
      const textContent = await page.getTextContent()
      const text = textContent.items.map((item: any) => item.str).join(' ').toLowerCase()
      if (text.includes(query)) {
        results.push(`Page ${i}`)
      }
    }

    setSearchResults(results)
    setCurrentSearchIdx(0)

    // Navigate to first result
    if (results.length > 0) {
      const pageNum = parseInt(results[0].replace('Page ', ''))
      updateCurrentPage(pageNum)
    }
  }, [activeTab, searchQuery])

  const navigateSearch = (direction: 'next' | 'prev') => {
    if (searchResults.length === 0) return
    const newIdx = direction === 'next'
      ? (currentSearchIdx + 1) % searchResults.length
      : (currentSearchIdx - 1 + searchResults.length) % searchResults.length
    setCurrentSearchIdx(newIdx)
    const pageNum = parseInt(searchResults[newIdx].replace('Page ', ''))
    updateCurrentPage(pageNum)
  }

  const updateCurrentPage = (pageNum: number) => {
    setTabs(prev => prev.map(t =>
      t.id === activeTabId ? { ...t, currentPage: pageNum } : t
    ))
  }

  const closeTab = (tabId: string) => {
    setTabs(prev => {
      const remaining = prev.filter(t => t.id !== tabId)
      if (remaining.length === 0) {
        onClose()
      } else if (tabId === activeTabId) {
        setActiveTabId(remaining[remaining.length - 1].id)
      }
      return remaining
    })
  }

  const handleDownload = () => {
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
  }

  const handlePrint = () => {
    if (!canvasRef.current) return
    const win = window.open('', '_blank')!
    win.document.write(`<img src="${canvasRef.current.toDataURL()}" style="max-width:100%" />`)
    win.document.close()
    win.print()
  }

  if (!open) return null

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col ${darkMode ? 'bg-gray-950 text-gray-100' : 'bg-white text-gray-900'} ${fullscreen ? '' : 'rounded-lg shadow-2xl m-4'}`}
      style={fullscreen ? {} : { maxHeight: 'calc(100vh - 2rem)' }}
    >
      {/* ── Header ── */}
      <div className={`flex items-center gap-2 px-3 py-2 border-b ${darkMode ? 'border-gray-700 bg-gray-900' : 'border-gray-200 bg-gray-50'}`}>
        {/* Tabs */}
        <div className="flex items-center gap-1 flex-1 overflow-x-auto min-w-0">
          {tabs.map(tab => (
            <div
              key={tab.id}
              className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs cursor-pointer whitespace-nowrap ${
                tab.id === activeTabId
                  ? 'bg-blue-600 text-white'
                  : darkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
              onClick={() => setActiveTabId(tab.id)}
            >
              {tab.label.length > 20 ? tab.label.slice(0, 20) + '…' : tab.label}
              <button
                className="ml-1 opacity-60 hover:opacity-100"
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDarkMode(d => !d)} title="Toggle dark mode">
            {darkMode ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSplitScreen(s => !s)} title="Split screen">
            <Columns className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setFullscreen(f => !f)} title="Fullscreen">
            {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
          {allowDownload && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleDownload} title="Download">
              <Download className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handlePrint} title="Print">
            <Printer className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className={`flex items-center gap-2 px-3 py-1.5 border-b ${darkMode ? 'border-gray-700 bg-gray-900' : 'border-gray-100 bg-gray-50'}`}>
        {/* Navigation */}
        <Button variant="ghost" size="icon" className="h-7 w-7"
          disabled={!activeTab || activeTab.currentPage <= 1}
          onClick={() => updateCurrentPage((activeTab?.currentPage || 1) - 1)}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="text-xs whitespace-nowrap">
          {activeTab ? `${activeTab.currentPage} / ${activeTab.pageCount}` : '— / —'}
        </span>
        <Button variant="ghost" size="icon" className="h-7 w-7"
          disabled={!activeTab || activeTab.currentPage >= activeTab.pageCount}
          onClick={() => updateCurrentPage((activeTab?.currentPage || 1) + 1)}>
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>

        <div className={`w-px h-5 mx-1 ${darkMode ? 'bg-gray-600' : 'bg-gray-200'}`} />

        {/* Zoom */}
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom(z => Math.max(0.25, z - 0.25))}>
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <span className="text-xs w-12 text-center">{Math.round(zoom * 100)}%</span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom(z => Math.min(4, z + 0.25))}>
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>

        {/* Preset zooms */}
        {[0.5, 0.75, 1, 1.5, 2].map(z => (
          <button key={z}
            className={`px-1.5 py-0.5 text-xs rounded ${zoom === z ? 'bg-blue-600 text-white' : darkMode ? 'text-gray-400 hover:text-gray-100' : 'text-gray-500 hover:text-gray-900'}`}
            onClick={() => setZoom(z)}>
            {z * 100}%
          </button>
        ))}

        <div className={`w-px h-5 mx-1 ${darkMode ? 'bg-gray-600' : 'bg-gray-200'}`} />

        {/* Rotation */}
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setRotation(r => (r + 90) % 360)} title="Rotate 90°">
          <RotateCw className="h-3.5 w-3.5" />
        </Button>

        <div className={`w-px h-5 mx-1 ${darkMode ? 'bg-gray-600' : 'bg-gray-200'}`} />

        {/* Search */}
        <div className="flex items-center gap-1">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && performSearch()}
            placeholder="Search in document…"
            className="h-6 text-xs w-44"
          />
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={performSearch}>Find</Button>
          {searchResults.length > 0 && (
            <>
              <Badge variant="secondary" className="text-[10px] h-5">{currentSearchIdx + 1}/{searchResults.length}</Badge>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => navigateSearch('prev')}><ChevronLeft className="h-3 w-3" /></Button>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => navigateSearch('next')}><ChevronRight className="h-3 w-3" /></Button>
            </>
          )}
        </div>
      </div>

      {/* ── Canvas area ── */}
      <div className={`flex-1 overflow-auto flex ${splitScreen ? 'gap-0' : ''} ${darkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
        <div className={`flex-1 flex items-start justify-center p-4 overflow-auto`}>
          {loading && (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-blue-600" />
              <p className="text-sm text-muted-foreground">Loading PDF…</p>
            </div>
          )}
          {error && (
            <div className="flex flex-col items-center justify-center h-full gap-2">
              <p className="text-red-500 text-sm">{error}</p>
              <Button variant="outline" size="sm" onClick={() => loadDocument(url, filename)}>Retry</Button>
            </div>
          )}
          {!loading && !error && (
            <canvas
              ref={canvasRef}
              className={`shadow-lg ${darkMode ? 'shadow-black/50' : 'shadow-gray-400/50'}`}
              style={{ maxWidth: '100%' }}
            />
          )}
        </div>

        {/* Split second pane */}
        {splitScreen && activeTab && (
          <div className={`flex-1 flex items-start justify-center p-4 overflow-auto border-l ${darkMode ? 'border-gray-600' : 'border-gray-300'}`}>
            <p className={`text-xs mt-8 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              Use tabs to open another document in split view
            </p>
          </div>
        )}
      </div>

      {/* ── Status bar ── */}
      <div className={`flex items-center justify-between px-3 py-1 text-xs border-t ${darkMode ? 'border-gray-700 bg-gray-900 text-gray-400' : 'border-gray-200 bg-gray-50 text-gray-500'}`}>
        <span>{activeTab ? `${activeTab.label} — ${activeTab.pageCount} pages` : 'No document'}</span>
        <span>Zoom: {Math.round(zoom * 100)}% | Rotation: {rotation}°{isRendering ? ' | Rendering…' : ''}</span>
        {searchResults.length > 0 && (
          <span>{searchResults.length} result(s) for "{searchQuery}"</span>
        )}
      </div>
    </div>
  )
}
