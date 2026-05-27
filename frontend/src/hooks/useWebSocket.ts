import { useEffect, useRef, useState, useCallback } from 'react'
import { io, Socket, ManagerOptions, SocketOptions } from 'socket.io-client'

// Exponential backoff sequence (ms): 1s, 2s, 4s, 8s, 16s, then capped at 30s.
// socket.io implements this via reconnectionDelay + reconnectionDelayMax + randomizationFactor.
// Starting from 1 s (not 3 s) makes recovery snappy after a brief server restart.
const RECONNECT_DELAY_MS     = 1_000
const RECONNECT_DELAY_MAX_MS = 30_000
const RECONNECT_ATTEMPTS     = 12

export interface Notification {
  id: string
  type:
    | 'claim:assigned' | 'claim:status' | 'sla:breach' | 'appeal:new' | 'batch:complete'
    // PR3 — provider + user approval workflow events.
    | 'provider:pending' | 'provider:decision'
    | 'user:pending'     | 'user:decision'
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
  'provider:pending',
  'provider:decision',
  'user:pending',
  'user:decision',
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
    case 'provider:pending':
      return p?.providerName
        ? `New provider awaiting approval: ${p.providerName}.`
        : 'A new provider is awaiting approval.'
    case 'provider:decision': {
      const name = p?.providerName ?? 'Your provider'
      return p?.decision === 'approved'
        ? `${name} has been approved by CIC. You can start submitting claims.`
        : `${name} was not approved. Reason: ${p?.reason ?? p?.comment ?? '—'}`
    }
    case 'user:pending':
      return p?.userName && p?.userEmail
        ? `${p.userName} (${p.userEmail}) requested access to your provider.`
        : 'A new user wants to join your provider.'
    case 'user:decision': {
      const provider = p?.providerName ?? 'your provider'
      return p?.decision === 'approved'
        ? `Your access to ${provider} has been approved. You can sign in now.`
        : `Your access to ${provider} was not approved. Reason: ${p?.reason ?? p?.comment ?? '—'}`
    }
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
      // upgrade to websocket once the session is established.
      transports: ['polling', 'websocket'],
      // Exponential backoff: 1s → 2s → 4s → 8s → 16s → 30s (capped).
      // randomizationFactor 0.3 adds jitter to avoid thundering-herd after
      // a server restart when many clients reconnect simultaneously.
      reconnectionAttempts: RECONNECT_ATTEMPTS,
      reconnectionDelay: RECONNECT_DELAY_MS,
      reconnectionDelayMax: RECONNECT_DELAY_MAX_MS,
      randomizationFactor: 0.3,
      timeout: 20_000,
    } as Partial<ManagerOptions & SocketOptions>)

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
