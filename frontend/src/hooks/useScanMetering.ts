import { useEffect, useState, useCallback } from 'react'
import api from '@/services/api'
import { getDeviceInfo, type DeviceClass } from '@/lib/deviceInfo'

interface ScanMeteringCheck {
  enabled: boolean
  providerId: string | null
  costPerScan: number
  currency: string
}

export interface RecordScanInput {
  deviceClass: DeviceClass
  /** Physical-scanner hostname (from the local scan-agent /health). */
  machineHostname?: string
  /** Override OS (e.g. when the local agent reports the host OS). */
  os?: string
  scannerName?: string
  resolution?: number
  mode?: string
  pages?: number
  success?: boolean
  errorMessage?: string
}

/**
 * Frontend metering hook.
 *
 * - On mount, calls /scan-metering/check so the UI can disable the scan
 *   button when the user's organization is switched off.
 * - Exposes recordScan(meta) which the scan flow calls after a successful
 *   (or failed) camera capture / agent scan. The desktop physical-scanner
 *   path is *also* counted server-side inside ScannerController, so for
 *   that path the caller can skip recordScan — it would double-count.
 *   recordScan is the right hook for the camera/mobile paths.
 */
export function useScanMetering() {
  const [state, setState] = useState<ScanMeteringCheck | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.get<ScanMeteringCheck>('/scan-metering/check')
      setState(data)
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Failed to check scan metering')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const recordScan = useCallback(async (input: RecordScanInput) => {
    const di = getDeviceInfo()
    try {
      await api.post('/scan-metering/events', {
        deviceClass: input.deviceClass,
        os: input.os ?? di.os,
        machineHostname: input.machineHostname,
        scannerName: input.scannerName,
        resolution: input.resolution,
        mode: input.mode,
        pages: input.pages,
        success: input.success ?? true,
        errorMessage: input.errorMessage,
      })
    } catch {
      // Metering failures must never block the user's actual scan flow.
      // We swallow here — the server-side desktop path also records, so
      // the only thing lost on a failure is a camera/mobile event.
    }
  }, [])

  return {
    enabled: state?.enabled ?? true,    // default true until /check responds — avoid false negative on slow first paint
    loading,
    error,
    costPerScan: state?.costPerScan ?? 0,
    currency: state?.currency ?? 'KES',
    providerId: state?.providerId ?? null,
    refresh,
    recordScan,
  }
}
