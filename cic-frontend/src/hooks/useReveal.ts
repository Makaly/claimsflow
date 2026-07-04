import { useEffect, useRef, useState } from 'react'

/**
 * Scroll-reveal hook. Attach the returned `ref` to an element that carries the
 * `.reveal` utility class; once it scrolls into view the hook adds `is-visible`
 * (via the returned boolean) so the CSS transition runs exactly once.
 *
 * Falls back to immediately visible when IntersectionObserver is unavailable
 * (older browsers, SSR) so content is never trapped at opacity 0.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(options?: {
  /** Fraction of the element that must be visible before revealing. */
  threshold?: number
  /** Margin around the root — negative bottom triggers slightly before in view. */
  rootMargin?: string
}) {
  const ref = useRef<T | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true)
            observer.disconnect() // reveal once, then stop observing
            break
          }
        }
      },
      {
        threshold: options?.threshold ?? 0.15,
        rootMargin: options?.rootMargin ?? '0px 0px -10% 0px',
      },
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [options?.threshold, options?.rootMargin])

  return { ref, visible }
}
