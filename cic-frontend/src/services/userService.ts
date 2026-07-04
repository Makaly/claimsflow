import api from './api'
import type { User, ActivityLog } from '@/types'

export const userService = {
  getAll: async (params?: Record<string, string>) => {
    const { data } = await api.get<User[]>('/users', { params })
    return data
  },

  getById: async (id: string) => {
    const { data } = await api.get<User>(`/users/${id}`)
    return data
  },

  create: async (user: Partial<User> & { password: string }) => {
    const { data } = await api.post<User>('/users', user)
    return data
  },

  update: async (id: string, updates: Partial<User>) => {
    const { data } = await api.patch<User>(`/users/${id}`, updates)
    return data
  },

  delete: async (id: string) => {
    await api.delete(`/users/${id}`)
  },

  getActivityLogs: async (params?: Record<string, string>) => {
    const { data } = await api.get<ActivityLog[]>('/activity-logs', { params })
    return data
  },
}
