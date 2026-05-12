import { create } from 'zustand'
import api from '@/services/api'
import type { User } from '@/types'

interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  login: (token: string, user: User) => void
  logout: () => void
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

export const useAuthStore = create<AuthState>((set) => ({
  user: readUser(),
  token: localStorage.getItem('token'),
  isAuthenticated: !!localStorage.getItem('token'),

  login: (token, user) => {
    localStorage.setItem('token', token)
    localStorage.setItem('user', JSON.stringify(user))
    set({ token, user, isAuthenticated: true })
  },

  logout: () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    // Clear per-user cached data so the next user on this browser doesn't inherit it.
    localStorage.removeItem('cic-claims-storage')
    set({ token: null, user: null, isAuthenticated: false })
  },

  setUser: (user) => {
    localStorage.setItem('user', JSON.stringify(user))
    set({ user })
  },

  fetchProfile: async () => {
    try {
      const { data } = await api.get<User>('/auth/profile')
      localStorage.setItem('user', JSON.stringify(data))
      set({ user: data })
    } catch (err: any) {
      // Only invalidate the session when the server explicitly rejects the token.
      // Network errors and 5xx (e.g. Render cold-start) must NOT clear the
      // token — the user would be silently logged out every time the backend
      // is sleeping.
      if (err.response?.status === 401) {
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        set({ token: null, user: null, isAuthenticated: false })
      }
    }
  },
}))
