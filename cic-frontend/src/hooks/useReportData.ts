import { useState, useEffect, useCallback } from 'react'
import api from '@/services/api'

export interface ReportFilters {
  dateFrom?: string
  dateTo?: string
  groupBy?: string
}

export function useReportData(filters: ReportFilters = {}) {
  const [loading, setLoading] = useState(false)
  const [claimsVolume, setClaimsVolume] = useState<any>(null)
  const [approvalsRejections, setApprovalsRejections] = useState<any>(null)
  const [providerPerformance, setProviderPerformance] = useState<any>(null)
  const [fraudSummary, setFraudSummary] = useState<any>(null)
  const [errorRates, setErrorRates] = useState<any>(null)
  const [crossDuplicates, setCrossDuplicates] = useState<any>(null)
  const [providerScorecard, setProviderScorecard] = useState<any>(null)

  const params = new URLSearchParams()
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
  if (filters.dateTo) params.set('dateTo', filters.dateTo)
  if (filters.groupBy) params.set('groupBy', filters.groupBy)
  const qs = params.toString() ? `?${params}` : ''

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [vol, apr, perf, fraud, err, dup, score] = await Promise.allSettled([
        api.get(`/reports/claims-volume${qs}`),
        api.get(`/reports/approvals-rejections${qs}`),
        api.get(`/reports/provider-performance${qs}`),
        api.get(`/reports/fraud-summary${qs}`),
        api.get(`/reports/error-omission-rates${qs}`),
        api.get(`/reports/cross-provider-duplicates${qs}`),
        api.get(`/reports/provider-scorecard${qs}`),
      ])
      if (vol.status === 'fulfilled') setClaimsVolume(vol.value.data)
      if (apr.status === 'fulfilled') setApprovalsRejections(apr.value.data)
      if (perf.status === 'fulfilled') setProviderPerformance(perf.value.data)
      if (fraud.status === 'fulfilled') setFraudSummary(fraud.value.data)
      if (err.status === 'fulfilled') setErrorRates(err.value.data)
      if (dup.status === 'fulfilled') setCrossDuplicates(dup.value.data)
      if (score.status === 'fulfilled') setProviderScorecard(score.value.data)
    } finally {
      setLoading(false)
    }
  }, [qs])

  useEffect(() => { load() }, [load])

  return {
    loading,
    claimsVolume,
    approvalsRejections,
    providerPerformance,
    fraudSummary,
    errorRates,
    crossDuplicates,
    providerScorecard,
    reload: load,
  }
}
