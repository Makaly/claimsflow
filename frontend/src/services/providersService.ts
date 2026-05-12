import api from './api'
import type { Provider } from '@/types'

export const providersService = {
  getAll: async (params?: Record<string, string>) => {
    const { data } = await api.get<Provider[]>('/providers', { params })
    return data
  },

  getById: async (id: string) => {
    const { data } = await api.get<Provider>(`/providers/${id}`)
    return data
  },

  create: async (provider: Partial<Provider>) => {
    const { data } = await api.post<Provider>('/providers', provider)
    return data
  },

  update: async (id: string, updates: Partial<Provider>) => {
    const { data } = await api.patch<Provider>(`/providers/${id}`, updates)
    return data
  },

  approve: async (id: string) => {
    const { data } = await api.post(`/providers/${id}/approve`)
    return data
  },

  reject: async (id: string, reason: string) => {
    const { data } = await api.post(`/providers/${id}/reject`, { reason })
    return data
  },

  suspend: async (id: string, reason: string) => {
    const { data } = await api.post(`/providers/${id}/suspend`, { reason })
    return data
  },
}
