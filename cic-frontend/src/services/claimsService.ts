import api from './api'
import type { Claim, DashboardStats } from '@/types'

export interface ClaimsFilter {
  status?: string
  providerId?: string
  batchId?: string
  branchId?: string
  assignedTo?: string
  dateFrom?: string
  dateTo?: string
  search?: string
  limit?: number
  offset?: number
}

export interface ClaimsResponse {
  claims: Claim[]
  total: number
}

export const claimsService = {
  getAll: async (params?: ClaimsFilter) => {
    const { data } = await api.get<ClaimsResponse | Claim[]>('/claims', { params: params as any })
    // Handle both old array response and new paginated response
    if (Array.isArray(data)) return { claims: data, total: data.length }
    return data
  },

  getById: async (id: string) => {
    const { data } = await api.get<Claim>(`/claims/${id}`)
    return data
  },

  create: async (formData: FormData) => {
    const { data } = await api.post<Claim>('/claims', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  },

  update: async (id: string, updates: Partial<Claim>) => {
    const { data } = await api.patch<Claim>(`/claims/${id}`, updates)
    return data
  },

  delete: async (id: string) => {
    await api.delete(`/claims/${id}`)
  },

  uploadDocument: async (claimId: string, file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    const { data } = await api.post(`/claims/${claimId}/documents`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  },

  getStatistics: async () => {
    const { data } = await api.get<DashboardStats>('/claims/statistics')
    return data
  },
}
