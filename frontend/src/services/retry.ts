import type { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios'

// Retries are only useful for transient infrastructure failures, not for
// authentication errors or input validation problems.
//
// 502/503/504 come from Render's edge while the free-tier backend is
// cold-booting. A response-less error (`error.response` undefined) is
// either a connection refusal or a CORS rejection of a 502 page — both
// equivalent to "the server never processed this request", so retrying
// is safe even for POSTs like /auth/login.
const RETRIABLE_STATUSES = new Set([502, 503, 504])

export function shouldRetry(error: AxiosError): boolean {
  if (!error.config) return false
  const status = error.response?.status
  if (status === undefined) return true
  return RETRIABLE_STATUSES.has(status)
}

type RetryConfig = InternalAxiosRequestConfig & { __retryCount?: number }

export interface RetryOptions {
  maxRetries?: number
  delayMs?: number
}

export function attachRetryInterceptor(
  instance: AxiosInstance,
  { maxRetries = 1, delayMs = 1500 }: RetryOptions = {},
): void {
  instance.interceptors.response.use(undefined, async (error: AxiosError) => {
    const config = error.config as RetryConfig | undefined
    if (!config) return Promise.reject(error)
    config.__retryCount = config.__retryCount ?? 0
    if (config.__retryCount >= maxRetries || !shouldRetry(error)) {
      return Promise.reject(error)
    }
    config.__retryCount += 1
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    return instance.request(config)
  })
}
