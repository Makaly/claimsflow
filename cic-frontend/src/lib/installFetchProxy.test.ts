import { describe, it, expect, beforeEach, vi } from 'vitest'
import { installFetchProxy } from './installFetchProxy'

describe('installFetchProxy', () => {
  let original: typeof fetch
  let mock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    original = window.fetch
    mock = vi.fn().mockResolvedValue(new Response('{}'))
    window.fetch = mock as unknown as typeof fetch
  })

  afterEach(() => {
    window.fetch = original
  })

  it('rewrites /api/* URLs to the absolute backend origin', async () => {
    installFetchProxy({ apiUrl: 'https://backend.example.com/api' })
    await window.fetch('/api/claims')
    expect(mock).toHaveBeenCalledOnce()
    expect(mock.mock.calls[0][0]).toBe('https://backend.example.com/api/claims')
  })

  it('rewrites /socket.io/* URLs the same way', async () => {
    installFetchProxy({ apiUrl: 'https://backend.example.com/api' })
    await window.fetch('/socket.io/?EIO=4&transport=polling')
    expect(mock.mock.calls[0][0]).toBe('https://backend.example.com/socket.io/?EIO=4&transport=polling')
  })

  it('adds credentials: include to API calls', async () => {
    installFetchProxy({ apiUrl: 'https://backend.example.com/api' })
    await window.fetch('/api/claims')
    expect(mock.mock.calls[0][1]).toMatchObject({ credentials: 'include' })
  })

  it('does not override an explicit credentials option', async () => {
    installFetchProxy({ apiUrl: 'https://backend.example.com/api' })
    await window.fetch('/api/claims', { credentials: 'omit' })
    expect(mock.mock.calls[0][1]).toMatchObject({ credentials: 'omit' })
  })

  it('does not touch absolute URLs', async () => {
    installFetchProxy({ apiUrl: 'https://backend.example.com/api' })
    await window.fetch('https://other.example.com/foo')
    expect(mock.mock.calls[0][0]).toBe('https://other.example.com/foo')
    expect(mock.mock.calls[0][1]).toBeUndefined()
  })

  it('does not touch non-api relative URLs', async () => {
    installFetchProxy({ apiUrl: 'https://backend.example.com/api' })
    await window.fetch('/static/logo.svg')
    expect(mock.mock.calls[0][0]).toBe('/static/logo.svg')
  })

  it('is idempotent — installing twice does not double-wrap', async () => {
    installFetchProxy({ apiUrl: 'https://backend.example.com/api' })
    const first = window.fetch
    installFetchProxy({ apiUrl: 'https://backend.example.com/api' })
    expect(window.fetch).toBe(first)
  })

  it('falls back to credentials-only behaviour when no apiUrl is configured', async () => {
    installFetchProxy({ apiUrl: '' })
    await window.fetch('/api/claims')
    expect(mock.mock.calls[0][0]).toBe('/api/claims')
    expect(mock.mock.calls[0][1]).toMatchObject({ credentials: 'include' })
  })
})
