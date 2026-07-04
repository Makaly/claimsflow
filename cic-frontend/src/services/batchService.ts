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

  /**
   * Download the export bundle (CSV/XML/JSON index + optional searchable PDFs,
   * per the Job Setup's output targets) for a batch. Accepts a BatchSubmission
   * id or a batchNumber. Triggers a browser download of the returned zip.
   */
  exportBatch: async (idOrNumber: string) => {
    const { data, headers } = await api.get(`/batch-submissions/${encodeURIComponent(idOrNumber)}/export`, {
      responseType: 'blob',
    })
    const blob = new Blob([data], { type: 'application/zip' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const disp = String(headers?.['content-disposition'] ?? '')
    const match = disp.match(/filename="?([^"]+)"?/)
    a.download = match?.[1] ?? `${idOrNumber}-export.zip`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  },
}
