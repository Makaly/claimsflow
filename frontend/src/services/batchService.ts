import api from './api'
import type { BatchSubmission } from '@/types'

export const batchService = {
  getAll: async () => {
    const { data } = await api.get<BatchSubmission[]>('/batch-submissions')
    return data
  },

  getById: async (id: string) => {
    const { data } = await api.get<BatchSubmission>(`/batch-submissions/${id}`)
    return data
  },

  upload: async (files: File[], providerId: string) => {
    const formData = new FormData()
    files.forEach((file) => formData.append('files', file))
    formData.append('providerId', providerId)
    const { data } = await api.post<BatchSubmission>('/batch-submissions/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  },
}
