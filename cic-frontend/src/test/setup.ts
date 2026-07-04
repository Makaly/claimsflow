import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})

// jsdom does not implement matchMedia; Radix UI primitives query it.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// IntersectionObserver shim — needed for any lazy-loading / scroll components.
class IO {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
}
;(global as any).IntersectionObserver = IO

// ResizeObserver shim — Radix uses it for popover/tooltip positioning.
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(global as any).ResizeObserver = RO
