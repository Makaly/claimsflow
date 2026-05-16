import { useState, useEffect } from 'react'
import api from '@/services/api'
import { useAuthStore } from '@/store/authStore'

let cachedCount = 0
let listeners: Array<(n: number) => void> = []
let polling = false

function notifyAll(n: number) {
  cachedCount = n
  listeners.forEach((fn) => fn(n))
}

async function fetchCount() {
  try {
    const { data } = await api.get<{ count: number }>('/unknown-documents/count')
    notifyAll(data.count)
  } catch {}
}

function startPolling() {
  if (polling) return
  polling = true
  fetchCount()
  setInterval(fetchCount, 30_000)
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
