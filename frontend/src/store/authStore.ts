import { create } from 'zustand'
import api from '@/services/api'
import type { User } from '@/types'

// The JWT is now stored in an HttpOnly cookie managed by the browser.
// localStorage only keeps non-sensitive cached user profile data.

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  login: (user: User, token?: string) => void
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
  isAuthenticated: !!readUser(),

  login: (user, token) => {
    // Token is set as HttpOnly cookie by the server on login response.
    // Also persist in localStorage so non-cookie fetch calls (claimsStore,
    // document fetches) can attach it as a Bearer header.
    if (token) localStorage.setItem('token', token)
    // Wipe the claims cache from any previous session before caching new profile.
    localStorage.removeItem('cic-claims-storage')
    localStorage.setItem('user', JSON.stringify(user))
    set({ user, isAuthenticated: true })
  },

  logout: () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    localStorage.removeItem('cic-claims-storage')
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
        localStorage.removeItem('user')
        set({ user: null, isAuthenticated: false })
      }
    }
  },
}))
