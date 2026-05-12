// Shared annotation types + renderer used by DocumentViewer (full-screen edit)
// and InlinePdfViewer (claim-detail preview). Keep these in sync — DocumentViewer
// writes the Annotation[] blob to Claim.annotations, InlinePdfViewer reads it back.

export type ToolType =
  | 'pointer'
  | 'highlight'
  | 'underline'
  | 'strikethrough'
  | 'note'
  | 'stamp'
  | 'redact'
  | 'whiteout'
  | 'draw'
  | 'sign'
  | 'ocr_zone'

export interface Annotation {
  id: string
  type: ToolType
  page: number
  x: number
  y: number
  w?: number
  h?: number
  text?: string
  stampLabel?: string
  color?: string
  paths?: { x: number; y: number }[][]
  signatureDataUrl?: string
  authorId: string
  authorName: string
  authorEmail?: string
  createdAt: string
}

export const STAMP_COLORS: Record<string, string> = {
  APPROVED: '#16a34a',
  REJECTED: '#dc2626',
  CONFIDENTIAL: '#7c3aed',
  VERIFIED: '#0d9488',
  REVIEWED: '#0369a1',
  PENDING: '#d97706',
  VOID: '#64748b',
  DRAFT: '#78716c',
  RECEIVED: '#0891b2',
}

// Loaded HTMLImageElements keyed by dataUrl so renderAnnotations can draw them
// synchronously (img.onload is async and fires after the canvas is cleared).
const _sigCache = new Map<string, HTMLImageElement>()

export function loadSigImage(dataUrl: string, onReady?: () => void) {
  if (_sigCache.has(dataUrl)) {
    onReady?.()
    return
  }
  const img = new Image()
  img.onload = () => {
    _sigCache.set(dataUrl, img)
    onReady?.()
  }
  img.src = dataUrl
}

export function renderAnnotations(
  ctx: CanvasRenderingContext2D,
  annotations: Annotation[],
  page: number,
  scaleX: number,
  scaleY: number,
  noClear = false,
) {
  if (!noClear) ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  const s = (v: number, axis: 'x' | 'y') => v * (axis === 'x' ? scaleX : scaleY)
  const sw = (v?: number) => (v !== undefined ? v * scaleX : 0)
  const sh = (v?: number) => (v !== undefined ? v * scaleY : 0)

  annotations
    .filter(a => a.page === page)
    .forEach(a => {
      switch (a.type) {
        case 'highlight':
          ctx.fillStyle = a.color || 'rgba(251,191,36,0.35)'
          ctx.strokeStyle = '#fbbf24'
          ctx.lineWidth = 1
          ctx.fillRect(s(a.x, 'x'), s(a.y, 'y'), sw(a.w), sh(a.h))
          ctx.strokeRect(s(a.x, 'x'), s(a.y, 'y'), sw(a.w), sh(a.h))
          break
        case 'redact':
          ctx.fillStyle = '#000'
          ctx.fillRect(s(a.x, 'x'), s(a.y, 'y'), sw(a.w), sh(a.h))
          break
        case 'underline':
          if (!a.w || !a.h) break
          ctx.strokeStyle = '#3b82f6'
          ctx.lineWidth = 2.5 * scaleX
          {
            const y = s(a.y, 'y') + Math.abs(sh(a.h))
            ctx.beginPath()
            ctx.moveTo(s(a.x, 'x'), y)
            ctx.lineTo(s(a.x, 'x') + sw(a.w), y)
            ctx.stroke()
          }
          break
        case 'strikethrough':
          if (!a.w || !a.h) break
          ctx.strokeStyle = '#ef4444'
          ctx.lineWidth = 2.5 * scaleX
          {
            const y = s(a.y, 'y') + Math.abs(sh(a.h)) / 2
            ctx.beginPath()
            ctx.moveTo(s(a.x, 'x'), y)
            ctx.lineTo(s(a.x, 'x') + sw(a.w), y)
            ctx.stroke()
          }
          break
        case 'whiteout':
          ctx.fillStyle = '#fff'
          ctx.fillRect(s(a.x, 'x'), s(a.y, 'y'), sw(a.w), sh(a.h))
          ctx.strokeStyle = '#e2e8f0'
          ctx.lineWidth = 1
          ctx.strokeRect(s(a.x, 'x'), s(a.y, 'y'), sw(a.w), sh(a.h))
          break
        case 'note': {
          const sx = s(a.x, 'x'),
            sy = s(a.y, 'y')
          ctx.fillStyle = '#fbbf24'
          ctx.beginPath()
          ctx.moveTo(sx, sy)
          ctx.lineTo(sx + 18 * scaleX, sy)
          ctx.lineTo(sx + 18 * scaleX, sy + 18 * scaleY)
          ctx.lineTo(sx + 10 * scaleX, sy + 18 * scaleY)
          ctx.lineTo(sx, sy + 10 * scaleY)
          ctx.closePath()
          ctx.fill()
          ctx.fillStyle = '#92400e'
          ctx.font = `bold ${Math.max(9, 11 * scaleX)}px sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText('N', sx + 11 * scaleX, sy + 10 * scaleY)
          if (a.text) {
            const fontSize = Math.max(9, 11 * scaleX)
            ctx.font = `${fontSize}px sans-serif`
            const maxBubbleW = 160 * scaleX
            const lineH = fontSize + 3
            const words = a.text.split(' ')
            const lines: string[] = []
            let line = ''
            for (const word of words) {
              const test = line ? `${line} ${word}` : word
              if (ctx.measureText(test).width > maxBubbleW - 8 && line) {
                lines.push(line)
                line = word
              } else line = test
            }
            if (line) lines.push(line)
            if (lines.length > 3) {
              lines.length = 3
              lines[2] = lines[2].slice(0, -1) + '…'
            }
            const bw = Math.min(
              maxBubbleW,
              Math.max(...lines.map(l => ctx.measureText(l).width)) + 12,
            )
            const bh = lines.length * lineH + 8 * scaleY
            const bx = sx + 22 * scaleX
            const by = sy - 2 * scaleY
            ctx.fillStyle = '#fffde7'
            ctx.strokeStyle = '#fbbf24'
            ctx.lineWidth = 1.5
            ctx.beginPath()
            ctx.rect(bx, by, bw, bh)
            ctx.fill()
            ctx.stroke()
            ctx.fillStyle = '#1c1917'
            ctx.textAlign = 'left'
            ctx.textBaseline = 'top'
            lines.forEach((l, i) =>
              ctx.fillText(l, bx + 5 * scaleX, by + 4 * scaleY + i * lineH),
            )
          }
          break
        }
        case 'stamp': {
          const sx = s(a.x, 'x'),
            sy = s(a.y, 'y')
          const label = a.stampLabel || a.text || 'STAMP'
          const col = STAMP_COLORS[label] || '#0369a1'
          const fs = Math.max(11, 13 * scaleX)
          ctx.save()
          ctx.translate(sx, sy)
          ctx.rotate(-0.22)
          ctx.globalAlpha = 0.82

          const rw = Math.max(44, label.length * 6.2 * scaleX) + 10 * scaleX
          const rh = 22 * scaleY
          ctx.strokeStyle = col
          ctx.lineWidth = 2.2 * scaleX
          ctx.setLineDash([])
          ctx.beginPath()
          ctx.ellipse(0, 0, rw, rh, 0, 0, Math.PI * 2)
          ctx.stroke()
          ctx.lineWidth = 1.2 * scaleX
          ctx.beginPath()
          ctx.ellipse(0, 0, rw - 4 * scaleX, rh - 4 * scaleY, 0, 0, Math.PI * 2)
          ctx.stroke()
          ctx.fillStyle = col + '18'
          ctx.beginPath()
          ctx.ellipse(0, 0, rw - 4 * scaleX, rh - 4 * scaleY, 0, 0, Math.PI * 2)
          ctx.fill()
          ctx.fillStyle = col
          ctx.font = `900 ${fs}px Arial, sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(label, 0, 0)

          ctx.restore()
          break
        }
        case 'draw':
          if (!a.paths) break
          ctx.strokeStyle = a.color || '#ef4444'
          ctx.lineWidth = 2 * scaleX
          ctx.lineJoin = 'round'
          ctx.lineCap = 'round'
          a.paths.forEach(stroke => {
            if (stroke.length < 2) return
            ctx.beginPath()
            ctx.moveTo(s(stroke[0].x, 'x'), s(stroke[0].y, 'y'))
            stroke.slice(1).forEach(p => ctx.lineTo(s(p.x, 'x'), s(p.y, 'y')))
            ctx.stroke()
          })
          break
        case 'sign': {
          if (!a.signatureDataUrl) break
          const sigImg = _sigCache.get(a.signatureDataUrl)
          if (!sigImg) break

          const sx2 = s(a.x, 'x'),
            sy2 = s(a.y, 'y')
          const sigW = sw(a.w || 180),
            sigH = sh(a.h || 65)

          const fs8 = Math.max(6.5, 8 * scaleX)
          const fs9 = Math.max(7, 9 * scaleX)
          const pad = 6 * scaleX
          const lineH = fs8 * 1.55
          const verifyId = a.id.slice(-8).toUpperCase()
          const signedAt = new Date(a.createdAt).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
          const panelLines = [
            `Digitally signed by: ${a.authorName}`,
            ...(a.authorEmail ? [`Email: ${a.authorEmail}`] : []),
            `Date/Time: ${signedAt}`,
            `Verification ID: ${verifyId}`,
          ]
          const panelH = pad * 2 + lineH * panelLines.length + 4 * scaleY
          const panelW = Math.max(sigW, 200 * scaleX)
          const panelY = sy2 + sigH + 4 * scaleY

          ctx.save()
          ctx.fillStyle = '#eff6ff'
          ctx.strokeStyle = '#2563eb'
          ctx.lineWidth = 0.8 * scaleX
          ctx.setLineDash([])
          ctx.beginPath()
          const r = 3 * scaleX
          ctx.moveTo(sx2 + r, panelY)
          ctx.lineTo(sx2 + panelW - r, panelY)
          ctx.quadraticCurveTo(sx2 + panelW, panelY, sx2 + panelW, panelY + r)
          ctx.lineTo(sx2 + panelW, panelY + panelH - r)
          ctx.quadraticCurveTo(
            sx2 + panelW,
            panelY + panelH,
            sx2 + panelW - r,
            panelY + panelH,
          )
          ctx.lineTo(sx2 + r, panelY + panelH)
          ctx.quadraticCurveTo(sx2, panelY + panelH, sx2, panelY + panelH - r)
          ctx.lineTo(sx2, panelY + r)
          ctx.quadraticCurveTo(sx2, panelY, sx2 + r, panelY)
          ctx.closePath()
          ctx.fill()
          ctx.stroke()

          ctx.fillStyle = '#2563eb'
          ctx.fillRect(sx2, panelY, 3 * scaleX, panelH)

          ctx.fillStyle = '#16a34a'
          ctx.beginPath()
          ctx.arc(
            sx2 + pad + 6 * scaleX,
            panelY + pad + 5 * scaleY,
            5 * scaleX,
            0,
            Math.PI * 2,
          )
          ctx.fill()
          ctx.fillStyle = 'white'
          ctx.font = `bold ${fs8}px Arial`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText('✓', sx2 + pad + 6 * scaleX, panelY + pad + 5 * scaleY)

          ctx.fillStyle = '#1d4ed8'
          ctx.font = `bold ${fs9}px Arial`
          ctx.textAlign = 'left'
          ctx.textBaseline = 'top'
          ctx.fillText('Digitally Verified', sx2 + pad + 14 * scaleX, panelY + pad)

          ctx.fillStyle = '#1e3a5f'
          ctx.font = `${fs8}px Arial`
          panelLines.forEach((line, i) => {
            ctx.fillText(
              line,
              sx2 + pad + 4 * scaleX,
              panelY + pad + lineH * (i + 1) + 2 * scaleY,
            )
          })
          ctx.restore()

          ctx.save()
          ctx.fillStyle = 'white'
          ctx.fillRect(sx2, sy2, sigW, sigH)
          ctx.strokeStyle = '#cbd5e1'
          ctx.lineWidth = 0.8
          ctx.setLineDash([2, 2])
          ctx.strokeRect(sx2, sy2, sigW, sigH)
          ctx.setLineDash([])
          ctx.restore()
          ctx.drawImage(sigImg, sx2 + 4, sy2 + 4, sigW - 8, sigH - 8)

          break
        }
      }
    })
}
