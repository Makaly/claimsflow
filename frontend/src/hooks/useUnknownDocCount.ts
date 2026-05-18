import { useState, useEffect } from 'react'
import api from '@/services/api'
import { useAuthStore } from '@/store/authStore'

let cachedCount = 0
let listeners: Array<(n: number) => void> = []
let polling = false
let timer: ReturnType<typeof setTimeout> | null = null

const BASE_INTERVAL  = 30_000   // 30 s — normal polling cadence
const MAX_BACKOFF    = 300_000  // 5 min — cap after repeated 429s
const HIDDEN_PAUSE   = 120_000  // 2 min — slower cadence when tab is hidden
let currentInterval  = BASE_INTERVAL

function notifyAll(n: number) {
  cachedCount = n
  listeners.forEach((fn) => fn(n))
}

async function fetchCount() {
  // Pause entirely when the tab is hidden — multi-tab users are the main
  // source of rate-limit pressure (each tab independently polls).
  if (typeof document !== 'undefined' && document.hidden) {
    scheduleNext(HIDDEN_PAUSE)
    return
  }

  try {
    const { data } = await api.get<{ count: number }>('/unknown-documents/count')
    notifyAll(data.count)
    currentInterval = BASE_INTERVAL  // reset on success
  } catch (err: any) {
    // Back off exponentially on 429 (rate-limited) up to MAX_BACKOFF.
    // Any other error: keep the current interval.
    if (err?.response?.status === 429) {
      currentInterval = Math.min(currentInterval * 2, MAX_BACKOFF)
    }
  } finally {
    scheduleNext(currentInterval)
  }
}

function scheduleNext(delay: number) {
  if (timer) clearTimeout(timer)
  timer = setTimeout(fetchCount, delay)
}

function startPolling() {
  if (polling) return
  polling = true
  fetchCount()
  // Resume immediately when the user returns to the tab.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        currentInterval = BASE_INTERVAL
        scheduleNext(0)
      }
    })
  }
}

export function useUnknownDocCount() {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin' || user?.role === 'maker_checker'
  const [count, setCount] = useState(cachedCount)

  useEffect(() => {
    if (!isAdmin) return
    listeners.push(setCount)
    startPolling()
    return () => { listeners = listeners.filter((fn) => fn !== setCount) }
  }, [isAdmin])

  return isAdmin ? count : 0
}
