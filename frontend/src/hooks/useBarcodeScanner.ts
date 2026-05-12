import { useEffect, useState, useRef } from 'react'

interface UseBarcodeScannerOpts {
  enabled?: boolean
  minLength?: number
  onScan?: (barcode: string) => void
  // Max ms between keystrokes to be considered "from a scanner"
  burstWindowMs?: number
}

export function useBarcodeScanner(opts: UseBarcodeScannerOpts = {}) {
  const { enabled = true, minLength = 4, onScan, burstWindowMs = 50 } = opts
  const [lastScan, setLastScan] = useState<string | null>(null)
  const bufferRef = useRef<string>('')
  const lastKeyTimeRef = useRef<number>(0)
  const callbackRef = useRef(onScan)

  useEffect(() => { callbackRef.current = onScan }, [onScan])

  useEffect(() => {
    if (!enabled) return

    const handler = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input/textarea (except marked scan inputs)
      const target = e.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      const isInput = (tag === 'input' || tag === 'textarea') && !target?.dataset?.scanZone
      if (isInput) return

      const now = Date.now()
      const elapsed = now - lastKeyTimeRef.current
      lastKeyTimeRef.current = now

      if (e.key === 'Enter') {
        const candidate = bufferRef.current
        bufferRef.current = ''
        if (candidate.length >= minLength) {
          setLastScan(candidate)
          callbackRef.current?.(candidate)
        }
        return
      }

      // If too much time elapsed since last keystroke, this is human typing — reset
      if (elapsed > burstWindowMs * 4) {
        bufferRef.current = ''
      }

      if (e.key.length === 1) {
        bufferRef.current += e.key
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [enabled, minLength, burstWindowMs])

  return { lastScan, reset: () => setLastScan(null) }
}
