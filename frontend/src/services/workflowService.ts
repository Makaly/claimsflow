import api from './api'
import type { Claim, ClaimApproval, WorkflowStatistics } from '@/types'

export interface ReviewerWorkload {
  assignedTo: string
  name: string
  count: number
}

export const workflowService = {
  getStatistics: async () => {
    const { data } = await api.get<WorkflowStatistics>('/workflow/statistics')
    return data
  },

  getClaimsByStage: async (stage: string, assignedTo?: string) => {
    const { data } = await api.get<Claim[]>(`/workflow/claims/${stage}`, {
      params: { assignedTo },
    })
    return data
  },

  getPendingAssignment: async () => {
    const { data } = await api.get<Claim[]>('/workflow/pending-assignment')
    return data
  },

  assignToMaker: async (claimId: string, makerId: string) => {
    const { data } = await api.post('/workflow/maker/assign', { claimId, makerId })
    return data
  },

  makerApprove: async (claimId: string, comments?: string) => {
    const { data } = await api.post('/workflow/maker/approve', { claimId, comments })
    return data
  },

  makerReject: async (claimId: string, reason: string) => {
    const { data } = await api.post('/workflow/maker/reject', { claimId, reason })
    return data
  },

  checkerApprove: async (claimId: string, comments?: string) => {
    const { data } = await api.post('/workflow/checker/approve', { claimId, comments })
    return data
  },

  checkerReject: async (claimId: string, reason: string) => {
    const { data } = await api.post('/workflow/checker/reject', { claimId, reason })
    return data
  },

  returnToMaker: async (claimId: string, reason: string) => {
    const { data } = await api.post('/workflow/checker/return', { claimId, reason })
    return data
  },

  getApprovalHistory: async (claimId: string) => {
    const { data } = await api.get<ClaimApproval[]>(`/workflow/approval-history/${claimId}`)
    return data
  },

  validateCompleteness: async (claimId: string) => {
    const { data } = await api.post(`/workflow/validate-completeness/${claimId}`)
    return data
  },

  assignClaims: async (claimIds: string[], reviewerIds: string[], strategy = 'fifo') => {
    const { data } = await api.post('/workflow/assign-claims', { claimIds, reviewerIds, strategy })
    return data
  },

  getReviewerWorkload: async () => {
    const { data } = await api.get<ReviewerWorkload[]>('/workflow/reviewer-workload')
    return data
  },
}
