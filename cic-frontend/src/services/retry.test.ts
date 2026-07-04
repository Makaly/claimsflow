import { describe, it, expect, vi } from 'vitest'
import type { AxiosError, AxiosInstance } from 'axios'
import { shouldRetry, attachRetryInterceptor } from './retry'

function makeError(overrides: Partial<AxiosError> & { status?: number }): AxiosError {
  const { status, ...rest } = overrides
  return {
    config: {} as AxiosError['config'],
    isAxiosError: true,
    name: 'AxiosError',
    message: 'boom',
    toJSON: () => ({}),
    ...(status !== undefined
      ? { response: { status, data: null, statusText: '', headers: {}, config: {} as any } }
      : {}),
    ...rest,
  } as AxiosError
}

describe('shouldRetry', () => {
  it('retries when the request never received a response', () => {
    expect(shouldRetry(makeError({}))).toBe(true)
  })

  it('retries on 502, 503, and 504', () => {
    expect(shouldRetry(makeError({ status: 502 }))).toBe(true)
    expect(shouldRetry(makeError({ status: 503 }))).toBe(true)
    expect(shouldRetry(makeError({ status: 504 }))).toBe(true)
  })

  it('does not retry on auth or client errors', () => {
    expect(shouldRetry(makeError({ status: 400 }))).toBe(false)
    expect(shouldRetry(makeError({ status: 401 }))).toBe(false)
    expect(shouldRetry(makeError({ status: 403 }))).toBe(false)
    expect(shouldRetry(makeError({ status: 404 }))).toBe(false)
    expect(shouldRetry(makeError({ status: 422 }))).toBe(false)
  })

  it('does not retry on 500 (genuine application errors)', () => {
    expect(shouldRetry(makeError({ status: 500 }))).toBe(false)
  })

  it('does not retry when error has no config (unrecoverable)', () => {
    expect(shouldRetry(makeError({ config: undefined as any }))).toBe(false)
  })
})

describe('attachRetryInterceptor', () => {
  function makeFakeInstance(): {
    instance: AxiosInstance
    onError: (handler: (err: AxiosError) => any) => void
    request: ReturnType<typeof vi.fn>
  } {
    let handler: ((err: AxiosError) => any) | undefined
    const request = vi.fn()
    const instance = {
      interceptors: {
        response: {
          use: (_: unknown, errFn: (err: AxiosError) => any) => {
            handler = errFn
          },
        },
      },
      request,
    } as unknown as AxiosInstance
    return {
      instance,
      onError: (h: (err: AxiosError) => any) => {
        handler = h
      },
      // expose a trigger via the instance: simulate axios invoking the error handler
      request: request as any,
      // attach a helper for tests
      ...({} as Record<string, never>),
      _trigger: async (err: AxiosError) => handler?.(err),
    } as any
  }

  it('retries once on network error, then surfaces the second failure', async () => {
    const helper = makeFakeInstance() as any
    attachRetryInterceptor(helper.instance, { maxRetries: 1, delayMs: 0 })

    // First retry resolves to the request being re-issued, but for this unit
    // test we make the re-request reject again. The interceptor should
    // give up after the single configured retry.
    const err: AxiosError = {
      config: {} as any,
      isAxiosError: true,
      name: 'AxiosError',
      message: 'network',
      toJSON: () => ({}),
    } as AxiosError
    helper.request.mockRejectedValueOnce(err)

    await expect(helper._trigger(err)).rejects.toBeDefined()
    expect(helper.request).toHaveBeenCalledTimes(1)
  })

  it('does not retry on non-retriable status codes', async () => {
    const helper = makeFakeInstance() as any
    attachRetryInterceptor(helper.instance, { maxRetries: 1, delayMs: 0 })

    const err = makeError({ status: 401 })
    await expect(helper._trigger(err)).rejects.toBe(err)
    expect(helper.request).not.toHaveBeenCalled()
  })
})
