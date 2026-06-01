/**
 * Human-readable label for the backend `sourcePlatform` value recorded on a
 * claim/batch (android | ios | web | scan_station). Mirrors the mobile app's
 * `platformLabel` so both clients describe the upload channel the same way.
 */
export function platformLabel(raw?: string | null): string {
  switch ((raw || '').toLowerCase()) {
    case '':
      return '—'
    case 'android':
      return 'Android app'
    case 'ios':
      return 'iOS app'
    case 'web':
      return 'Web portal'
    case 'scan_station':
      return 'Scan station'
    default:
      return raw!.charAt(0).toUpperCase() + raw!.slice(1)
  }
}
