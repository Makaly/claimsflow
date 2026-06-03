import api from '@/services/api'

export type AssignmentStrategy = 'workload' | 'fifo'

export interface AssignableUser {
  id: string
  name: string
  email: string
  isOnLeave: boolean
}

export interface ProviderRuleRow {
  id: string
  name: string
  assignmentRule: {
    makerCheckerId: string | null
    claimsOfficerId: string | null
    makerChecker: { id: string; name: string; isOnLeave: boolean } | null
    claimsOfficer: { id: string; name: string; isOnLeave: boolean } | null
    updatedAt: string
  } | null
}

export const assignmentRulesService = {
  list: (): Promise<{ providers: ProviderRuleRow[] }> =>
    api.get('/assignment-rules').then((r) => r.data),

  assignable: (role: 'maker_checker' | 'claims_officer'): Promise<{ users: AssignableUser[] }> =>
    api.get('/assignment-rules/assignable', { params: { role } }).then((r) => r.data),

  getStrategy: (): Promise<{ strategy: AssignmentStrategy }> =>
    api.get('/assignment-rules/strategy').then((r) => r.data),

  setStrategy: (strategy: AssignmentStrategy): Promise<{ strategy: AssignmentStrategy }> =>
    api.put('/assignment-rules/strategy', { strategy }).then((r) => r.data),

  upsert: (
    providerId: string,
    body: { makerCheckerId?: string | null; claimsOfficerId?: string | null },
  ): Promise<any> => api.put(`/assignment-rules/${providerId}`, body).then((r) => r.data),

  clear: (providerId: string): Promise<any> =>
    api.delete(`/assignment-rules/${providerId}`).then((r) => r.data),
}
