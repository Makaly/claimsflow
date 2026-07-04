import * as pdfjsLib from 'pdfjs-dist'

type PdfSource =
  | string
  | Uint8Array
  | ArrayBuffer
  | { url: string }
  | { data: Uint8Array | ArrayBuffer }
  | Record<string, unknown>

/**
 * Hardened wrapper around `pdfjsLib.getDocument`.
 *
 * pdfjs-dist < 4.2.67 (this project pins the 3.x line) can execute arbitrary
 * JavaScript from a crafted PDF when `isEvalSupported` is true — the default
 * (GHSA-wgrm-67xf-hhpq). Claim PDFs can be attacker-supplied, so every load
 * path must force `isEvalSupported: false`. Routing all getDocument calls
 * through this helper guarantees the flag is never forgotten.
 */
export function getDocumentSafe(src: PdfSource) {
  let params: Record<string, unknown>
  if (typeof src === 'string') params = { url: src }
  else if (src instanceof Uint8Array || src instanceof ArrayBuffer) params = { data: src }
  else params = { ...(src as Record<string, unknown>) }
  params.isEvalSupported = false
  return pdfjsLib.getDocument(params as any)
}
