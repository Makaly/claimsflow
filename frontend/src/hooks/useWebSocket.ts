import { useEffect, useRef, useState, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'

export interface Notification {
  id: string
  type: 'claim:assigned' | 'claim:status' | 'sla:breach' | 'appeal:new' | 'batch:complete'
  message: string
  timestamp: number
  read: boolean
  payload?: unknown
}

const LISTENED_EVENTS: Notification['type'][] = [
  'claim:assigned',
  'claim:status',
  'sla:breach',
  'appeal:new',
  'batch:complete',
]

function buildMessage(event: Notification['type'], payload: unknown): string {
  const p = payload as Record<string, unknown> | null | undefined
  switch (event) {
    case 'claim:assigned':
      return p?.claimNumber
        ? `Claim #${p.claimNumber} has been assigned to you.`
        : 'A new claim has been assigned to you.'
    case 'claim:status':
      return p?.claimNumber && p?.status
        ? `Claim #${p.claimNumber} status changed to ${p.status}.`
        : 'A claim status was updated.'
    case 'sla:breach':
      return p?.claimNumber
        ? `SLA breach alert for claim #${p.claimNumber}.`
        : 'An SLA breach has been detected.'
    case 'appeal:new':
      return p?.claimNumber
        ? `New appeal submitted for claim #${p.claimNumber}.`
        : 'A new appeal has been submitted.'
    case 'batch:complete':
      return p?.batchId
        ? `Batch job ${p.batchId} has completed.`
        : 'A batch job has completed.'
    default:
      return 'You have a new notification.'
  }
}

export function useWebSocket() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const socketRef = useRef<Socket | null>(null)

  const markRead = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    )
  }, [])

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
  }, [])

  useEffect(() => {
    // Auth is delivered via the HttpOnly cookie set by /api/auth/login.
    // socket.io must use withCredentials so the browser attaches it during
    // the handshake. We also keep auth.token as a fallback for the rare
    // dev flow where a token was stashed in localStorage manually.
    const fallbackToken = localStorage.getItem('token') || undefined

    // VITE_API_URL points at the REST API (e.g. https://host.tld/api), but
    // socket.io needs the *origin* (host without /api) and a namespace.
    // Stripping a trailing /api keeps the gateway namespace /events instead
    // of accidentally becoming /api/events on the server.
    const rawApiBase =
      (import.meta as unknown as { env: Record<string, string> }).env.VITE_API_URL ||
      window.location.origin
    const origin = rawApiBase.replace(/\/api\/?$/, '')

    // When VITE_API_URL is a relative path (e.g. "/api") the origin strip
    // produces an empty string. io("") / io("/events") both connect to the
    // current window origin, which is correct when a same-origin proxy is
    // in place (Render static-site rewrites or Vite dev proxy).
    const socketUrl = origin || window.location.origin

    const socket = io(`${socketUrl}/events`, {
      auth: fallbackToken ? { token: fallbackToken } : undefined,
      withCredentials: true,
      // Start with polling (works through every proxy / free-tier edge) and
      // upgrade to websocket once the session is established. Reversing the
      // order means a single WS upgrade failure breaks the entire socket
      // instead of silently degrading.
      transports: ['polling', 'websocket'],
      // Render free-tier cold-start takes up to 60 s — use exponential
      // backoff so a sleeping backend doesn't flood the console with 502s.
      // Factor 1.5: 3 s → 4.5 s → 6.75 s … capped at 30 s.
      reconnectionAttempts: 10,
      reconnectionDelay: 3000,
      reconnectionDelayMax: 30000,
      randomizationFactor: 0.3,
      timeout: 20000,
    })

    socketRef.current = socket

    LISTENED_EVENTS.forEach((event) => {
      socket.on(event, (payload: unknown) => {
        const notification: Notification = {
          id: Date.now().toString() + Math.random().toString(36).slice(2),
          type: event,
          message: buildMessage(event, payload),
          timestamp: Date.now(),
          read: false,
          payload,
        }
        setNotifications((prev) => [notification, ...prev].slice(0, 20))
      })
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [])

  const unreadCount = notifications.filter((n) => !n.read).length

  return { notifications, unreadCount, markRead, markAllRead }
}
