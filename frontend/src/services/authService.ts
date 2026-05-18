import api from './api'
import type { User } from '@/types'

export interface LoginCredentials {
  email: string
  password: string
  rememberMe?: boolean
}

export interface RegisterData {
  name: string
  email: string
  password: string
  role?: string
  acceptTerms: true
  policyVersion?: string
}

export const authService = {
  login: async (credentials: LoginCredentials) => {
    const { data } = await api.post<{ access_token: string; user: User }>('/auth/login', credentials)
    return data
  },

  register: async (userData: RegisterData) => {
    const { data } = await api.post<{ access_token: string; user: User }>('/auth/register', userData)
    return data
  },

  getProfile: async () => {
    const { data } = await api.get<User>('/auth/profile')
    return data
  },

  logout: async () => {
    await api.post('/auth/logout')
  },
}
