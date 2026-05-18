import { create } from 'zustand'
import api from '@/services/api'
import type { User } from '@/types'

// Auth token is stored in an HttpOnly cookie managed by the server.
// localStorage holds the cached user profile (non-sensitive) and the raw
// token string so legacy raw-fetch call sites can attach a Bearer header.
// Both are cleared on logout.

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  login: (user: User, token?: string) => void
  logout: () => Promise<void>
  setUser: (user: User) => void
  fetchProfile: () => Promise<void>
}

function readUser(): User | null {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null')
  } catch {
    localStorage.removeItem('user')
    return null
  }
}

function clearLocalAuth() {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
  localStorage.removeItem('cic-claims-storage')
}

const cachedUser = readUser()

export const useAuthStore = create<AuthState>((set) => ({
  user: cachedUser,
  // Start unauthenticated if no user profile is cached. The profile may
  // still be stale — fetchProfile() validates it against the live cookie
  // on every app boot (see AppRoutes).
  isAuthenticated: !!cachedUser,

  login: (user, token) => {
    if (token) localStorage.setItem('token', token)
    localStorage.removeItem('cic-claims-storage')
    localStorage.setItem('user', JSON.stringify(user))
    // Mark this tab as having gone through an explicit login flow.
    // sessionStorage is tab-specific — new tabs start without this flag,
    // forcing re-authentication even when the HttpOnly cookie is still valid.
    sessionStorage.setItem('tab_auth', '1')
    set({ user, isAuthenticated: true })
  },

  logout: async () => {
    // Clear the HttpOnly cookie on the server first, then wipe local state.
    // Fire-and-forget: if the server is unreachable the cookie will expire on
    // its own; we still clear local state so the UI reflects logged-out.
    try { await api.post('/auth/logout') } catch { /* best-effort */ }
    clearLocalAuth()
    sessionStorage.removeItem('tab_auth')
    set({ user: null, isAuthenticated: false })
  },

  setUser: (user) => {
    localStorage.setItem('user', JSON.stringify(user))
    set({ user })
  },

  fetchProfile: async () => {
    try {
      const { data } = await api.get<User>('/auth/profile')
      localStorage.setItem('user', JSON.stringify(data))
      set({ user: data, isAuthenticated: true })
    } catch (err: any) {
      if (err.response?.status === 401) {
        clearLocalAuth()
        set({ user: null, isAuthenticated: false })
      }
    }
  },
}))
