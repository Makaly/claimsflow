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
    const token = localStorage.getItem('token')
    if (!token) return

    const apiBase =
      (import.meta as unknown as { env: Record<string, string> }).env.VITE_API_URL ||
      window.location.origin

    const socket = io(`${apiBase}/events`, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
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
