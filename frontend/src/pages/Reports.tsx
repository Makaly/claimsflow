import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { downloadXlsx } from '@/lib/xlsx-export'
import {
  BarChart3, Download, FileText, Calendar, TrendingUp,
  PieChart, Filter, FileSpreadsheet, FileCode, Printer,
  Building2, DollarSign, CheckCircle, XCircle, Clock,
  ChevronDown, Users, Package, AlertTriangle, Eye,
  ScanLine, ShieldAlert, Flame, TrendingDown, ExternalLink, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart as RechartsPie, Pie, Cell, Legend,
  AreaChart, Area, LineChart, Line, ComposedChart,
} from 'recharts'
import { useClaimsStore } from '@/store/claimsStore'
import { Pagination } from '@/components/Pagination'
import { formatCurrency, formatDate, getStatusColor } from '@/lib/utils'
import { useReportData } from '@/hooks/useReportData'

const COLORS = ['hsl(160,60%,45%)', 'hsl(30,80%,55%)', 'hsl(340,75%,55%)', 'hsl(220,70%,50%)', 'hsl(280,65%,60%)', 'hsl(170,60%,45%)']

function fmtAmount(n: number) {
  return `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function Reports() {
  const { claims } = useClaimsStore()
  const navigate = useNavigate()

  // Filter state
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Live API data (server-accurate)
  const liveData = useReportData({ dateFrom: dateFrom || undefined, dateTo: dateTo || undefined })
  const [providerFilter, setProviderFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [amountMin, setAmountMin] = useState('')
  const [amountMax, setAmountMax] = useState('')
  const [exportFormat, setExportFormat] = useState('excel')
  const [fraudFlags, setFraudFlags] = useState<Map<string, 'confirmed_fraud' | 'under_investigation' | 'cleared'>>(new Map())

  const [fraudDetailClaim, setFraudDetailClaim] = useState<typeof claims[0] | null>(null)
  const [reportPage, setReportPage] = useState(1)
  const [reportPageSize, setReportPageSize] = useState(20)

  const setFraudFlag = (claimId: string, flag: 'confirmed_fraud' | 'under_investigation' | 'cleared' | '') => {
    setFraudFlags(prev => {
      const next = new Map(prev)
      if (flag === '') next.delete(claimId)
      else next.set(claimId, flag as any)
      return next
    })
  }

  const uniqueProviders = useMemo(
    () => Array.from(new Set(claims.map(c => c.provider?.name).filter(Boolean))).sort() as string[],
    [claims]
  )

  // Apply filters
  const filtered = useMemo(() => {
    return claims.filter(c => {
      const dt = new Date(c.submittedAt)
      if (dateFrom && dt < new Date(dateFrom)) return false
      if (dateTo && dt > new Date(dateTo + 'T23:59:59')) return false
      if (providerFilter !== 'all' && c.provider?.name !== providerFilter) return false
      if (statusFilter !== 'all' && c.status !== statusFilter) return false
      const amt = c.invoiceAmount || 0
      if (amountMin && amt < parseFloat(amountMin)) return false
      if (amountMax && amt > parseFloat(amountMax)) return false
      return true
    })
  }, [claims, dateFrom, dateTo, providerFilter, statusFilter, amountMin, amountMax])

  // Summary stats
  const stats = useMemo(() => ({
    total: filtered.length,
    approved: filtered.filter(c => c.status === 'approved' || c.status === 'paid').length,
    pending: filtered.filter(c => ['submitted', 'under_review', 'incomplete'].includes(c.status)).length,
    rejected: filtered.filter(c => c.status === 'rejected').length,
    totalAmount: filtered.reduce((s, c) => s + (c.invoiceAmount || 0), 0),
    approvedAmount: filtered.filter(c => c.status === 'approved' || c.status === 'paid').reduce((s, c) => s + (c.invoiceAmount || 0), 0),
    batchCount: new Set(filtered.filter(c => c.batchId).map(c => c.batchId)).size,
    aiExtracted: filtered.filter(c => c.aiExtracted).length,
  }), [filtered])

  // Provider breakdown
  const providerData = useMemo(() => {
    const map = new Map<string, { name: string; total: number; approved: number; rejected: number; pending: number; amount: number }>()
    filtered.forEach(c => {
      const name = c.provider?.name || 'Unknown'
      if (!map.has(name)) map.set(name, { name, total: 0, approved: 0, rejected: 0, pending: 0, amount: 0 })
      const m = map.get(name)!
      m.total++
      m.amount += c.invoiceAmount || 0
      if (c.status === 'approved' || c.status === 'paid') m.approved++
      else if (c.status === 'rejected') m.rejected++
      else m.pending++
    })
    return Array.from(map.values()).sort((a, b) => b.total - a.total)
  }, [filtered])

  // Status pie data
  const pieData = [
    { name: 'Approved', value: stats.approved },
    { name: 'Pending', value: stats.pending },
    { name: 'Rejected', value: stats.rejected },
  ].filter(d => d.value > 0)

  // Batch breakdown
  const batchData = useMemo(() => {
    const map = new Map<string, { batchNumber: string; uploadedBy: string; count: number; amount: number; date: string; providers: Set<string> }>()
    filtered.filter(c => c.batchId).forEach(c => {
      const id = c.batchId!
      if (!map.has(id)) map.set(id, {
        batchNumber: c.batchNumber || id,
        uploadedBy: c.uploadedBy || 'Unknown',
        count: 0, amount: 0,
        date: c.submittedAt,
        providers: new Set(),
      })
      const m = map.get(id)!
      m.count++
      m.amount += c.invoiceAmount || 0
      if (c.provider?.name) m.providers.add(c.provider.name)
    })
    return Array.from(map.values()).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  }, [filtered])

  // Monthly trend data
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const monthlyTrend = useMemo(() => {
    const map = new Map<string, { month: string; sortKey: string; submitted: number; approved: number; rejected: number; amount: number }>()
    filtered.forEach(c => {
      const d = new Date(c.submittedAt)
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2,'0')}`
      const label = `${monthNames[d.getMonth()]} ${d.getFullYear()}`
      if (!map.has(key)) map.set(key, { month: label, sortKey: key, submitted: 0, approved: 0, rejected: 0, amount: 0 })
      const m = map.get(key)!
      m.submitted++
      m.amount += c.invoiceAmount || 0
      if (c.status === 'approved' || c.status === 'paid') m.approved++
      if (c.status === 'rejected') m.rejected++
    })
    return Array.from(map.values()).sort((a, b) => a.sortKey.localeCompare(b.sortKey))
  }, [filtered])

  // Linear regression for predictions
  const predictions = useMemo(() => {
    if (monthlyTrend.length < 2) return []
    const n = monthlyTrend.length
    const xs = monthlyTrend.map((_, i) => i)
    const ys = monthlyTrend.map(m => m.submitted)
    const sumX = xs.reduce((a, b) => a + b, 0)
    const sumY = ys.reduce((a, b) => a + b, 0)
    const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0)
    const sumX2 = xs.reduce((s, x) => s + x * x, 0)
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
    const intercept = (sumY - slope * sumX) / n

    const last = monthlyTrend[n - 1]
    const [baseYear, baseMon] = last.sortKey.split('-').map(Number)
    return [1, 2, 3].map(offset => {
      const mon = (baseMon + offset) % 12
      const year = baseYear + Math.floor((baseMon + offset) / 12)
      const predicted = Math.max(0, Math.round(intercept + slope * (n - 1 + offset)))
      return {
        month: `${monthNames[mon]} ${year}`,
        sortKey: `${year}-${String(mon).padStart(2,'0')}`,
        submitted: 0, approved: 0, rejected: 0, amount: 0,
        predicted,
        isPrediction: true,
      }
    })
  }, [monthlyTrend])

  const trendWithPredictions = [
    ...monthlyTrend.map(m => ({ ...m, predicted: m.submitted, isPrediction: false })),
    ...predictions,
  ]

  const clearFilters = () => {
    setDateFrom(''); setDateTo(''); setProviderFilter('all')
    setStatusFilter('all'); setAmountMin(''); setAmountMax('')
  }

  const hasFilters = dateFrom || dateTo || providerFilter !== 'all' || statusFilter !== 'all' || amountMin || amountMax

  // Export functions
  const buildExportRows = () => filtered.map(c => ({
    'Claim Number': c.claimNumber,
    'Barcode': c.barcode,
    'Batch Number': c.batchNumber || '',
    'Uploaded By': c.uploadedBy || '',
    'Member Name': c.memberName,
    'Member Number': c.memberNumber,
    'Patient ID': c.patientId || '',
    'Provider': c.provider?.name || '',
    'Invoice Amount (KES)': c.invoiceAmount || 0,
    'Invoice Number': c.invoiceNumber || '',
    'Invoice Date': c.invoiceDate || '',
    'Service Date': c.serviceDate || '',
    'Status': c.status,
    'Priority': c.priority,
    'Diagnosis': c.diagnosis || '',
    'Diagnosis Code': c.diagnosisCode || '',
    'Procedure Code': c.procedureCode || '',
    'Treatment': c.treatment || '',
    'AI Extracted': c.aiExtracted ? 'Yes' : 'No',
    'AI Confidence': c.aiConfidence ? `${(c.aiConfidence * 100).toFixed(0)}%` : '',
    'Submitted At': c.submittedAt,
  }))

  const exportExcel = async () => {
    await downloadXlsx(
      [
        { name: 'Claims', rows: buildExportRows() },
        {
          name: 'Provider Summary',
          rows: providerData.map((p) => ({
            'Provider': p.name, 'Total Claims': p.total, 'Approved': p.approved,
            'Pending': p.pending, 'Rejected': p.rejected, 'Total Amount (KES)': p.amount,
          })),
        },
        {
          name: 'Batch Summary',
          rows: batchData.map((b) => ({
            'Batch Number': b.batchNumber, 'Uploaded By': b.uploadedBy,
            'Date': formatDate(b.date), 'Claims': b.count,
            'Total Amount (KES)': b.amount, 'Providers': Array.from(b.providers).join('; '),
          })),
        },
      ],
      `CIC_Claims_Report_${new Date().toISOString().split('T')[0]}.xlsx`,
    )
  }

  const exportCsv = () => {
    const rows = buildExportRows()
    const headers = Object.keys(rows[0] || {})
    const csvContent = [headers.join(','), ...rows.map(r =>
      headers.map(h => {
        const val = String((r as any)[h]).replace(/"/g, '""')
        return val.includes(',') || val.includes('"') || val.includes('\n') ? `"${val}"` : val
      }).join(',')
    )].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `CIC_Claims_Report_${new Date().toISOString().split('T')[0]}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  const exportPdf = () => {
    // Open a print-ready window with the report
    const rows = buildExportRows()
    const html = `
      <!DOCTYPE html><html><head><title>CIC Claims Report</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 11px; margin: 20px; }
        h1 { font-size: 18px; margin-bottom: 4px; }
        .meta { color: #666; font-size: 10px; margin-bottom: 16px; }
        .stats { display: flex; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
        .stat { background: #f5f5f5; padding: 8px 12px; border-radius: 6px; }
        .stat-label { font-size: 9px; text-transform: uppercase; color: #888; }
        .stat-value { font-size: 16px; font-weight: bold; }
        table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        th { background: #1a1a2e; color: white; padding: 6px 8px; text-align: left; font-size: 9px; text-transform: uppercase; }
        td { padding: 5px 8px; border-bottom: 1px solid #eee; font-size: 10px; }
        tr:nth-child(even) td { background: #f9f9f9; }
        @media print { body { margin: 0; } }
      </style></head><body>
      <h1>CIC Medical Claims Report</h1>
      <p class="meta">Generated: ${new Date().toLocaleString()} &nbsp;|&nbsp; Filters: ${hasFilters ? 'Applied' : 'None'} &nbsp;|&nbsp; Records: ${rows.length}</p>
      <div class="stats">
        <div class="stat"><div class="stat-label">Total Claims</div><div class="stat-value">${stats.total}</div></div>
        <div class="stat"><div class="stat-label">Approved</div><div class="stat-value">${stats.approved}</div></div>
        <div class="stat"><div class="stat-label">Pending</div><div class="stat-value">${stats.pending}</div></div>
        <div class="stat"><div class="stat-label">Rejected</div><div class="stat-value">${stats.rejected}</div></div>
        <div class="stat"><div class="stat-label">Total Amount</div><div class="stat-value">${fmtAmount(stats.totalAmount)}</div></div>
      </div>
      <table>
        <tr>${['Claim #','Member','Provider','Amount','Status','Invoice #','Date'].map(h => `<th>${h}</th>`).join('')}</tr>
        ${rows.map(r => `<tr>
          <td>${r['Claim Number']}</td>
          <td>${r['Member Name']}</td>
          <td>${r['Provider']}</td>
          <td>${fmtAmount(r['Invoice Amount (KES)'] as number)}</td>
          <td>${r['Status']}</td>
          <td>${r['Invoice Number']}</td>
          <td>${formatDate(r['Submitted At'])}</td>
        </tr>`).join('')}
      </table>
      </body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close(); w.print() }
  }

  const handleExport = () => {
    if (exportFormat === 'excel') exportExcel()
    else if (exportFormat === 'csv') exportCsv()
    else if (exportFormat === 'pdf') exportPdf()
  }

  const exportFraudReport = () => {
    // Recompute fraud signals inline for the export
    const invoiceMap = new Map<string, string[]>()
    const memberHighFreq = new Map<string, number>()
    filtered.forEach(c => {
      if (c.invoiceNumber) {
        if (!invoiceMap.has(c.invoiceNumber)) invoiceMap.set(c.invoiceNumber, [])
        invoiceMap.get(c.invoiceNumber)!.push(c.claimNumber)
      }
      const mKey = c.memberNumber || c.memberName || ''
      memberHighFreq.set(mKey, (memberHighFreq.get(mKey) || 0) + 1)
    })
    const dupInvoiceNums = new Set(Array.from(invoiceMap.entries()).filter(([, ids]) => ids.length > 1).map(([inv]) => inv))
    const dupInvoices = Array.from(invoiceMap.entries()).filter(([, ids]) => ids.length > 1)
    const highFreq = Array.from(memberHighFreq.entries()).filter(([, n]) => n >= 5).sort((a,b) => b[1]-a[1])
    const roundAmt = filtered.filter(c => { const a = c.invoiceAmount||0; return a > 0 && a%1000===0 && a>=10000 })
    const highVal = filtered.filter(c => (c.invoiceAmount||0) > 200000)
    const unknownPat = filtered.filter(c => !c.memberNumber || c.memberName?.toLowerCase().includes('unknown'))
    const fraudScore = Math.min(100, dupInvoices.length*20 + highFreq.length*5 + Math.min(roundAmt.length*2,30) + Math.min(unknownPat.length*3,15))
    const riskLevel = fraudScore>=60?'HIGH':fraudScore>=30?'MEDIUM':'LOW'

    // Per-claim anomaly flags (for detailed section)
    const claimAnomalies = new Map<string, { claim: typeof filtered[0]; flags: string[]; fraudFlag?: string }>()
    const addFlag = (c: typeof filtered[0], msg: string) => {
      if (!claimAnomalies.has(c.id)) claimAnomalies.set(c.id, { claim: c, flags: [] })
      claimAnomalies.get(c.id)!.flags.push(msg)
    }
    filtered.forEach(c => {
      const amt = c.invoiceAmount || 0
      if (amt > 0 && amt % 1000 === 0 && amt >= 10000)
        addFlag(c, `Round-amount billing: KES ${amt.toLocaleString()} is an exact round number — statistically improbable for genuine itemised billing`)
      if (c.invoiceNumber && dupInvoiceNums.has(c.invoiceNumber))
        addFlag(c, `Duplicate invoice number: "${c.invoiceNumber}" appears on multiple claims — potential double-billing`)
      if (!c.memberNumber || c.memberName?.toLowerCase().includes('unknown'))
        addFlag(c, `Unknown/missing patient identity: claim cannot be verified against policy eligibility or prior claim history`)
      if (amt > 200000)
        addFlag(c, `High-value claim: KES ${amt.toLocaleString()} exceeds KES 200,000 threshold — requires enhanced review and pre-authorisation match`)
      const ff = fraudFlags.get(c.id)
      if (ff) claimAnomalies.get(c.id)!.fraudFlag = ff
    })
    // Also assign flag status to claims that were flagged by user but may not have other anomalies
    fraudFlags.forEach((ff, id) => {
      const c = filtered.find(x => x.id === id)
      if (c && !claimAnomalies.has(id)) claimAnomalies.set(id, { claim: c, flags: [`Manually flagged by investigator`], fraudFlag: ff })
      else if (claimAnomalies.has(id)) claimAnomalies.get(id)!.fraudFlag = ff
    })

    const flagBg = (f?: string) => f==='confirmed_fraud'?'background:#fee2e2;color:#b91c1c':f==='under_investigation'?'background:#fef3c7;color:#92400e':f==='cleared'?'background:#d1fae5;color:#065f46':'background:#f5f5f5;color:#666'
    const flagLabel = (f?: string) => f==='confirmed_fraud'?'CONFIRMED FRAUD':f==='under_investigation'?'UNDER INVESTIGATION':f==='cleared'?'CLEARED / FALSE POSITIVE':'NOT FLAGGED'

    const html = `<!DOCTYPE html><html><head><title>CIC Fraud Risk Report</title>
<style>
  body{font-family:Arial,sans-serif;font-size:11px;margin:24px;color:#222}
  h1{font-size:20px;color:#1a1a2e;margin-bottom:2px}
  h2{font-size:13px;color:#1a1a2e;margin-top:22px;margin-bottom:6px;border-bottom:2px solid #1a1a2e;padding-bottom:4px}
  h3{font-size:11px;color:#374151;margin:12px 0 4px;font-weight:bold}
  .meta{color:#666;font-size:10px;margin-bottom:16px}
  .risk-badge{display:inline-block;padding:4px 12px;border-radius:4px;font-weight:bold;font-size:14px;margin:8px 0;
    background:${riskLevel==='HIGH'?'#fee2e2':riskLevel==='MEDIUM'?'#fef3c7':'#d1fae5'};
    color:${riskLevel==='HIGH'?'#b91c1c':riskLevel==='MEDIUM'?'#92400e':'#065f46'}}
  .stats{display:flex;gap:12px;margin:12px 0;flex-wrap:wrap}
  .stat{background:#f5f5f5;padding:8px 12px;border-radius:6px;min-width:120px}
  .stat-label{font-size:9px;text-transform:uppercase;color:#888}
  .stat-value{font-size:18px;font-weight:bold}
  table{width:100%;border-collapse:collapse;margin:8px 0;font-size:10px}
  th{background:#1a1a2e;color:white;padding:5px 8px;text-align:left;font-size:9px;text-transform:uppercase}
  td{padding:5px 8px;border-bottom:1px solid #eee;vertical-align:top}
  tr:nth-child(even) td{background:#f9f9f9}
  .flag-cell{font-weight:bold;color:#b91c1c}
  .loophole{background:#fff7ed;border-left:4px solid #f59e0b;padding:8px 12px;margin:6px 0;border-radius:0 4px 4px 0}
  .loophole-title{font-weight:bold;color:#92400e;margin-bottom:2px}
  .loophole-fix{color:#065f46;margin-top:4px;font-size:10px}
  .anomaly-card{border:1px solid #e5e7eb;border-radius:6px;margin:10px 0;padding:10px 12px;page-break-inside:avoid}
  .anomaly-card-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px}
  .anomaly-claim-num{font-family:monospace;font-weight:bold;font-size:12px;color:#1a1a2e}
  .anomaly-provider{color:#6b7280;font-size:10px}
  .anomaly-amount{font-weight:bold;color:#b91c1c;font-size:12px}
  .anomaly-flag-badge{padding:2px 8px;border-radius:3px;font-size:9px;font-weight:bold;text-transform:uppercase}
  .anomaly-signals{margin-top:6px}
  .signal-item{display:flex;gap:6px;margin:3px 0;font-size:10px;color:#374151}
  .signal-bullet{color:#f59e0b;font-size:12px;line-height:1.4}
  .pg-break{page-break-before:always}
  @media print{body{margin:0}.pg-break{page-break-before:always}}
</style></head><body>
<h1>CIC Medical Claims — Fraud Risk Investigation Report</h1>
<p class="meta">Generated: ${new Date().toLocaleString()} &nbsp;|&nbsp; Prepared by: CIC Claims Fraud Unit &nbsp;|&nbsp; Analysed: ${filtered.length} claims &nbsp;|&nbsp; Filters: ${hasFilters?'Applied':'None'}</p>
<div class="risk-badge">Overall Risk Level: ${riskLevel} &nbsp;(${fraudScore}/100)</div>
<div class="stats">
  <div class="stat"><div class="stat-label">Duplicate Invoices</div><div class="stat-value" style="color:#b91c1c">${dupInvoices.length}</div></div>
  <div class="stat"><div class="stat-label">High-Freq Members</div><div class="stat-value" style="color:#b45309">${highFreq.length}</div></div>
  <div class="stat"><div class="stat-label">Round-Amount Claims</div><div class="stat-value" style="color:#c2410c">${roundAmt.length}</div></div>
  <div class="stat"><div class="stat-label">Unknown Patients</div><div class="stat-value" style="color:#7c3aed">${unknownPat.length}</div></div>
  <div class="stat"><div class="stat-label">High-Value (&gt;200K)</div><div class="stat-value" style="color:#b91c1c">${highVal.length}</div></div>
  <div class="stat"><div class="stat-label">Claims Flagged</div><div class="stat-value" style="color:#b91c1c">${fraudFlags.size}</div></div>
</div>

<h2>Section 1 — Identified Fraud Loopholes &amp; Recommended Controls</h2>
<div class="loophole">
  <div class="loophole-title">1. Duplicate Invoice Numbers — ${dupInvoices.length} instance(s) detected</div>
  <div>Multiple claims share the same provider invoice number. This enables double-billing: submitting the same invoice twice under different claim numbers to receive payment twice.</div>
  <div class="loophole-fix">▶ CONTROL: Enforce unique-per-provider invoice number constraint at submission. Auto-reject any claim whose invoice number already exists for that provider within 12 months.</div>
</div>
<div class="loophole">
  <div class="loophole-title">2. Round-Amount Billing Anomalies — ${roundAmt.length} claim(s)</div>
  <div>Claims with exact round amounts (e.g. KES 50,000, KES 500,000 exactly) are statistically improbable in genuine itemised medical billing. Real bills aggregate line items with irregular pricing, producing non-round totals. Round amounts indicate the figure was manually estimated or inflated.</div>
  <div class="loophole-fix">▶ CONTROL: Flag all round-amount claims ≥ KES 10,000 for mandatory itemised invoice verification before maker approval. Require the provider to submit line-item breakdowns.</div>
</div>
<div class="loophole">
  <div class="loophole-title">3. Unknown / Missing Patient Identity — ${unknownPat.length} claim(s)</div>
  <div>Claims without a verified member number or with "Unknown" as the patient name cannot be cross-checked against policy eligibility, benefit limits, or prior claim history. This is the primary indicator of ghost claims — billing for services never rendered.</div>
  <div class="loophole-fix">▶ CONTROL: Reject any claim at submission if memberNumber is null/empty. Require a valid policy member number and patient name to be confirmed by OCR or manual entry before the claim enters the workflow.</div>
</div>
<div class="loophole">
  <div class="loophole-title">4. High-Frequency Members — ${highFreq.length} member(s) with ≥5 claims</div>
  <div>Members submitting an unusually high number of claims in a short period may indicate identity fraud (member number shared/sold) or benefit abuse.</div>
  <div class="loophole-fix">▶ CONTROL: Implement per-member frequency limits. Auto-flag and route to supervisor when a single member exceeds 5 claims in a rolling 90-day window.</div>
</div>
<div class="loophole">
  <div class="loophole-title">5. High-Value Claims Without Enhanced Review — ${highVal.length} claim(s) &gt; KES 200,000</div>
  <div>Claims above KES 200,000 currently pass through the standard 2-level maker-checker without additional scrutiny. High-value fraud causes the most financial damage per incident.</div>
  <div class="loophole-fix">▶ CONTROL: Route all claims &gt; KES 200,000 to mandatory 3rd-level supervisor approval. Require matching pre-authorisation letter before processing.</div>
</div>
<div class="loophole">
  <div class="loophole-title">6. OCR Low-Confidence Pass-Through</div>
  <div>Claims where OCR confidence &lt; 70% pass into the maker queue without requiring manual field verification. Fraudulent documents with altered figures may pass if OCR reads them with low confidence without triggering a hold.</div>
  <div class="loophole-fix">▶ CONTROL: Block maker approval for OCR confidence &lt; 70% until a human officer manually confirms and signs off every extracted field.</div>
</div>

<h2 class="pg-break">Section 2 — Per-Claim Detailed Anomaly Breakdown</h2>
<p style="color:#666;font-size:10px;margin-bottom:12px">The following ${claimAnomalies.size} claim(s) triggered one or more fraud signals. Each entry lists the specific anomalies detected and the investigator's classification where applied.</p>
${Array.from(claimAnomalies.values()).map(({ claim: c, flags, fraudFlag }) => `
<div class="anomaly-card">
  <div class="anomaly-card-header">
    <div>
      <span class="anomaly-claim-num">${c.claimNumber}</span>
      <span class="anomaly-provider">&nbsp;·&nbsp;${c.provider?.name || 'Unknown Provider'}&nbsp;·&nbsp;Member: ${c.memberName || c.memberNumber || 'Unknown'}</span>
    </div>
    <div style="text-align:right">
      <div class="anomaly-amount">KES ${(c.invoiceAmount||0).toLocaleString()}</div>
      <div style="margin-top:3px"><span class="anomaly-flag-badge" style="${flagBg(fraudFlag)}">${flagLabel(fraudFlag)}</span></div>
    </div>
  </div>
  <div style="font-size:9px;color:#9ca3af;margin-bottom:6px">Status: ${c.status?.replace(/_/g,' ').toUpperCase()} &nbsp;·&nbsp; Date: ${formatDate(c.submittedAt)} &nbsp;·&nbsp; Invoice: ${c.invoiceNumber||'—'}</div>
  <div class="anomaly-signals">
    <div style="font-size:9px;font-weight:bold;text-transform:uppercase;color:#6b7280;margin-bottom:4px">Anomaly Signals Detected (${flags.length}):</div>
    ${flags.map((f,i) => `<div class="signal-item"><span class="signal-bullet">⚠</span><span><strong>${i+1}.</strong> ${f}</span></div>`).join('')}
  </div>
</div>`).join('')}

${dupInvoices.length > 0 ? `
<h2>Section 3 — Duplicate Invoice Reference Table</h2>
<table><tr><th>Invoice Number</th><th>Occurrences</th><th>Claim Numbers Affected</th><th>Investigator Status</th></tr>
${dupInvoices.map(([inv,claimNums]) => `<tr><td class="flag-cell">${inv}</td><td style="text-align:center">${claimNums.length}×</td><td>${claimNums.slice(0,5).join(', ')}${claimNums.length>5?'…':''}</td><td>${(() => { const c = filtered.find(x=>x.invoiceNumber===inv); const ff = c ? fraudFlags.get(c.id) : undefined; return `<span style="padding:1px 6px;border-radius:3px;font-size:9px;${flagBg(ff)}">${flagLabel(ff)}</span>` })()}</td></tr>`).join('')}
</table>` : ''}

<h2>Section 4 — Round-Amount Claims Reference Table</h2>
<table><tr><th>Claim #</th><th>Member</th><th>Provider</th><th>Amount</th><th>Status</th><th>Date</th><th>Investigator Status</th></tr>
${roundAmt.slice(0,50).map(c => `<tr><td class="flag-cell">${c.claimNumber}</td><td>${c.memberName||'—'}</td><td>${c.provider?.name||'—'}</td><td style="color:#b91c1c;font-weight:bold">KES ${(c.invoiceAmount||0).toLocaleString()}</td><td>${c.status?.replace(/_/g,' ')}</td><td>${formatDate(c.submittedAt)}</td><td><span style="padding:1px 6px;border-radius:3px;font-size:9px;${flagBg(fraudFlags.get(c.id))}">${flagLabel(fraudFlags.get(c.id))}</span></td></tr>`).join('')}
</table>

${unknownPat.length > 0 ? `
<h2>Section 5 — Unknown / Unverified Patient Claims</h2>
<table><tr><th>Claim #</th><th>Member Name</th><th>Member #</th><th>Provider</th><th>Amount</th><th>Status</th><th>Investigator Status</th></tr>
${unknownPat.slice(0,30).map(c => `<tr><td class="flag-cell">${c.claimNumber}</td><td style="color:#7c3aed;font-weight:bold">${c.memberName||'—'}</td><td style="color:#b91c1c">${c.memberNumber||'MISSING'}</td><td>${c.provider?.name||'—'}</td><td>KES ${(c.invoiceAmount||0).toLocaleString()}</td><td>${c.status?.replace(/_/g,' ')}</td><td><span style="padding:1px 6px;border-radius:3px;font-size:9px;${flagBg(fraudFlags.get(c.id))}">${flagLabel(fraudFlags.get(c.id))}</span></td></tr>`).join('')}
</table>` : ''}

<div style="margin-top:32px;padding-top:12px;border-top:1px solid #ddd;font-size:9px;color:#9ca3af">
  <strong>CIC Insurance Group — Fraud Investigation Report</strong> &nbsp;|&nbsp; Confidential &nbsp;|&nbsp; Generated ${new Date().toLocaleString()} &nbsp;|&nbsp; This report is for internal use only.
</div>
</body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close(); w.print() }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
          <p className="text-muted-foreground">Analyse and export claims data</p>
        </div>
      </div>

      {/* Live Server-Side Summary */}
      {liveData.approvalsRejections && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Total Claims', value: liveData.approvalsRejections.total, color: 'text-blue-700' },
            { label: 'Approved', value: liveData.approvalsRejections.approved, color: 'text-green-700' },
            { label: 'Rejected', value: liveData.approvalsRejections.rejected, color: 'text-red-700' },
            { label: 'Approval Rate', value: `${liveData.approvalsRejections.approvalRate}%`, color: 'text-purple-700' },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className="p-4">
                <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-xs text-gray-500">{s.label}</div>
                <div className="text-xs text-green-600 mt-1">● Live from server</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── G22: Cross-Provider Duplicates summary ── */}
      {liveData.crossDuplicates && (
        <Card className={`border ${liveData.crossDuplicates.total > 0 ? 'border-amber-400 dark:border-amber-700' : 'border-border'}`}>
          <CardContent className="flex items-center justify-between gap-4 p-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className={`h-5 w-5 shrink-0 ${liveData.crossDuplicates.total > 0 ? 'text-amber-500' : 'text-muted-foreground'}`} />
              <div>
                <p className="text-sm font-semibold">
                  {liveData.crossDuplicates.total > 0
                    ? `${liveData.crossDuplicates.total} cross-provider duplicate invoice group${liveData.crossDuplicates.total !== 1 ? 's' : ''} found`
                    : 'No cross-provider duplicate invoices detected'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Same invoice number submitted by multiple providers — potential double-billing across facilities
                </p>
              </div>
            </div>
            {liveData.crossDuplicates.total > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 gap-1.5 text-amber-700 border-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                onClick={() => navigate('/workflow/fraud')}
              >
                <ShieldAlert className="h-3.5 w-3.5" /> Review in Fraud Queue →
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Filter Panel */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Filter className="h-4 w-4" /> Filters & Export</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
            <div className="space-y-1.5">
              <Label className="text-xs">Date From</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Date To</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Provider</Label>
              <Select value={providerFilter} onValueChange={setProviderFilter}>
                <SelectTrigger><SelectValue placeholder="All Providers" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Providers</SelectItem>
                  {uniqueProviders.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><SelectValue placeholder="All Status" /></SelectTrigger>
                <SelectContent>
                  {['all', 'submitted', 'under_review', 'approved', 'rejected', 'incomplete', 'paid'].map(s => (
                    <SelectItem key={s} value={s}>{s === 'all' ? 'All Status' : s.replace('_', ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Min Amount (KES)</Label>
              <Input type="number" placeholder="0" value={amountMin} onChange={(e) => setAmountMin(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Max Amount (KES)</Label>
              <Input type="number" placeholder="∞" value={amountMax} onChange={(e) => setAmountMax(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              {hasFilters && (
                <Badge variant="secondary" className="gap-1 cursor-pointer" onClick={clearFilters}>
                  {filtered.length} of {claims.length} records &times; Clear filters
                </Badge>
              )}
              {!hasFilters && <p className="text-sm text-muted-foreground">Showing all {claims.length} claims</p>}
            </div>
            <div className="flex gap-2 items-center">
              <Select value={exportFormat} onValueChange={setExportFormat}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="excel"><div className="flex items-center gap-2"><FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" /> Excel (.xlsx)</div></SelectItem>
                  <SelectItem value="csv"><div className="flex items-center gap-2"><FileCode className="h-3.5 w-3.5 text-blue-600" /> CSV</div></SelectItem>
                  <SelectItem value="pdf"><div className="flex items-center gap-2"><Printer className="h-3.5 w-3.5 text-red-600" /> PDF (Print)</div></SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={handleExport} className="gap-2">
                <Download className="h-4 w-4" /> Export {filtered.length} Records
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: 'Total Claims', value: stats.total, icon: FileText, color: 'text-blue-500', sub: `${stats.aiExtracted} AI extracted` },
          { label: 'Approved / Paid', value: stats.approved, icon: CheckCircle, color: 'text-emerald-500', sub: formatCurrency(stats.approvedAmount) },
          { label: 'Pending', value: stats.pending, icon: Clock, color: 'text-amber-500', sub: 'Awaiting review' },
          { label: 'Rejected', value: stats.rejected, icon: XCircle, color: 'text-red-500', sub: `${stats.total > 0 ? ((stats.rejected / stats.total) * 100).toFixed(0) : 0}% rejection rate` },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="pt-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{s.label}</p>
                  <p className="text-3xl font-bold mt-0.5">{s.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{s.sub}</p>
                </div>
                <s.icon className={`h-8 w-8 ${s.color} opacity-80`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">Total Invoice Value</p>
            <p className="text-3xl font-bold mt-0.5">{formatCurrency(stats.totalAmount)}</p>
            <p className="text-xs text-muted-foreground mt-1">{stats.batchCount} batches &middot; {uniqueProviders.length} providers</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">Approval Rate</p>
            <p className="text-3xl font-bold mt-0.5">{stats.total > 0 ? ((stats.approved / stats.total) * 100).toFixed(0) : 0}%</p>
            <Progress value={stats.total > 0 ? (stats.approved / stats.total) * 100 : 0} className="h-2 mt-2" />
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="providers">
        <TabsList>
          <TabsTrigger value="providers"><Building2 className="mr-1 h-3.5 w-3.5" /> By Provider</TabsTrigger>
          <TabsTrigger value="batches"><Package className="mr-1 h-3.5 w-3.5" /> By Batch</TabsTrigger>
          <TabsTrigger value="trends"><TrendingUp className="mr-1 h-3.5 w-3.5" /> Trends &amp; Forecast</TabsTrigger>
          <TabsTrigger value="data"><FileText className="mr-1 h-3.5 w-3.5" /> All Claims</TabsTrigger>
          <TabsTrigger value="ocr"><ScanLine className="mr-1 h-3.5 w-3.5" /> OCR Quality</TabsTrigger>
          <TabsTrigger value="fraud"><ShieldAlert className="mr-1 h-3.5 w-3.5" /> Fraud Scoring</TabsTrigger>
        </TabsList>

        {/* ── PROVIDER TAB ── */}
        <TabsContent value="providers" className="space-y-4 mt-4">
          {providerData.length > 0 ? (
            <>
              {/* Bar chart */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Claims by Provider</CardTitle>
                  <CardDescription>Claim volume and status breakdown per provider</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {(() => {
                    const rows = providerData.slice(0, 10)
                    const totals = {
                      approved: rows.reduce((s, r) => s + (r.approved || 0), 0),
                      pending:  rows.reduce((s, r) => s + (r.pending  || 0), 0),
                      rejected: rows.reduce((s, r) => s + (r.rejected || 0), 0),
                    }
                    const legendItems = [
                      { key: 'approved', label: 'Approved', color: COLORS[0], total: totals.approved },
                      { key: 'pending',  label: 'Pending',  color: COLORS[1], total: totals.pending  },
                      { key: 'rejected', label: 'Rejected', color: COLORS[2], total: totals.rejected },
                    ]
                    return (
                      <>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-muted/30 px-3 py-2">
                          {legendItems.map(item => (
                            <div key={item.key} className="flex items-center gap-2 text-xs">
                              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: item.color }} />
                              <span className="font-medium text-foreground">{item.label}</span>
                              <span className="text-muted-foreground">{item.total}</span>
                            </div>
                          ))}
                        </div>

                        <ResponsiveContainer width="100%" height={Math.max(220, rows.length * 40 + 40)}>
                          <BarChart
                            data={rows}
                            layout="vertical"
                            margin={{ left: 8, right: 24, top: 4, bottom: 4 }}
                            barCategoryGap={10}
                          >
                            <CartesianGrid horizontal={false} strokeDasharray="3 3" className="stroke-muted" />
                            <XAxis type="number" allowDecimals={false} className="text-xs" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                            <YAxis
                              type="category"
                              dataKey="name"
                              width={180}
                              className="text-xs"
                              tick={{ fontSize: 12 }}
                              axisLine={false}
                              tickLine={false}
                              interval={0}
                            />
                            <Tooltip
                              cursor={{ fill: 'hsl(var(--muted) / 0.4)' }}
                              contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }}
                            />
                            <Bar dataKey="approved" name="Approved" stackId="a" fill={COLORS[0]} radius={[6, 0, 0, 6]} />
                            <Bar dataKey="pending"  name="Pending"  stackId="a" fill={COLORS[1]} />
                            <Bar dataKey="rejected" name="Rejected" stackId="a" fill={COLORS[2]} radius={[0, 6, 6, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </>
                    )
                  })()}
                </CardContent>
              </Card>

              {/* Provider table */}
              <Card>
                <CardHeader><CardTitle className="text-base">Provider Summary</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Provider</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Approved</TableHead>
                        <TableHead className="text-right">Pending</TableHead>
                        <TableHead className="text-right">Rejected</TableHead>
                        <TableHead className="text-right">Total Amount</TableHead>
                        <TableHead>Approval Rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {providerData.map(p => (
                        <TableRow key={p.name}>
                          <TableCell className="font-medium">{p.name}</TableCell>
                          <TableCell className="text-right">{p.total}</TableCell>
                          <TableCell className="text-right text-emerald-600">{p.approved}</TableCell>
                          <TableCell className="text-right text-amber-600">{p.pending}</TableCell>
                          <TableCell className="text-right text-red-600">{p.rejected}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(p.amount)}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Progress value={p.total > 0 ? (p.approved / p.total) * 100 : 0} className="h-1.5 w-16" />
                              <span className="text-xs">{p.total > 0 ? ((p.approved / p.total) * 100).toFixed(0) : 0}%</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* ── G22: Provider Performance Drill-Down (live server data) ── */}
              {liveData.providerPerformance?.data && liveData.providerPerformance.data.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-blue-500" /> Provider Performance — Live Detail
                    </CardTitle>
                    <CardDescription>Server-computed metrics per provider. Click "View Claims" to drill into that provider's claims list.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Provider</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                          <TableHead className="text-right">Approved</TableHead>
                          <TableHead className="text-right">Rejected</TableHead>
                          <TableHead className="text-right">Approval Rate</TableHead>
                          <TableHead className="text-right">Total Amount</TableHead>
                          <TableHead className="text-right">Avg OCR Conf.</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {liveData.providerPerformance.data.map((p: any) => (
                          <TableRow key={p.providerId}>
                            <TableCell className="font-medium">{p.providerName}</TableCell>
                            <TableCell className="text-xs text-muted-foreground capitalize">{p.providerType ?? '—'}</TableCell>
                            <TableCell className="text-right">{p.totalClaims}</TableCell>
                            <TableCell className="text-right text-emerald-600">{p.approved}</TableCell>
                            <TableCell className="text-right text-red-600">{p.rejected}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                <Progress value={p.approvalRate} className="h-1.5 w-14" />
                                <span className="text-xs w-8 text-right">{p.approvalRate}%</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(p.totalAmount)}</TableCell>
                            <TableCell className="text-right text-xs">
                              {p.avgOcrConfidence > 0 ? `${(p.avgOcrConfidence * 100).toFixed(0)}%` : '—'}
                            </TableCell>
                            <TableCell>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs gap-1 whitespace-nowrap"
                                onClick={() => navigate(`/claims?provider=${encodeURIComponent(p.providerName)}`)}
                              >
                                View Claims →
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Card><CardContent className="flex items-center justify-center h-32 text-muted-foreground">No data matching current filters</CardContent></Card>
          )}
        </TabsContent>

        {/* ── BATCH TAB ── */}
        <TabsContent value="batches" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Batch Upload Summary</CardTitle>
              <CardDescription>{batchData.length} batches in current filter range</CardDescription>
            </CardHeader>
            <CardContent>
              {batchData.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-muted-foreground">No batch uploads in this range</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Batch Number</TableHead>
                      <TableHead>Uploaded By</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Claims</TableHead>
                      <TableHead className="text-right">Total Amount</TableHead>
                      <TableHead>Providers</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batchData.map(b => (
                      <TableRow key={b.batchNumber}>
                        <TableCell className="font-mono font-medium">{b.batchNumber}</TableCell>
                        <TableCell>{b.uploadedBy}</TableCell>
                        <TableCell className="text-muted-foreground">{formatDate(b.date)}</TableCell>
                        <TableCell className="text-right">{b.count}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(b.amount)}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {b.providers.size > 1 && <Badge className="text-[9px] px-1.5 py-0 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Mixed ({b.providers.size})</Badge>}
                            {Array.from(b.providers).slice(0, 2).map(p => (
                              <Badge key={p} variant="outline" className="text-[9px] px-1.5 py-0 max-w-[120px] truncate">{p}</Badge>
                            ))}
                            {b.providers.size > 2 && <Badge variant="secondary" className="text-[9px] px-1.5 py-0">+{b.providers.size - 2}</Badge>}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── TRENDS & PREDICTIONS TAB ── */}
        <TabsContent value="trends" className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { label: 'Avg Monthly Submissions', value: monthlyTrend.length > 0 ? Math.round(monthlyTrend.reduce((s,m)=>s+m.submitted,0)/monthlyTrend.length) : 0, icon: TrendingUp, color: 'text-blue-500' },
              { label: 'Avg Monthly Amount', value: monthlyTrend.length > 0 ? formatCurrency(monthlyTrend.reduce((s,m)=>s+m.amount,0)/monthlyTrend.length) : '—', icon: DollarSign, color: 'text-emerald-500' },
              { label: 'Next Month Forecast', value: predictions[0] ? `~${predictions[0].predicted} claims` : '—', icon: Eye, color: 'text-violet-500' },
            ].map(s => (
              <Card key={s.label}>
                <CardContent className="pt-5 flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{s.label}</p>
                    <p className="text-2xl font-bold mt-0.5">{s.value}</p>
                  </div>
                  <s.icon className={`h-7 w-7 ${s.color} opacity-75`} />
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-blue-500" /> Monthly Claim Volume with 3-Month Forecast
              </CardTitle>
              <CardDescription>
                Historical submissions (solid) and linear regression predictions (dashed) for the next 3 months
              </CardDescription>
            </CardHeader>
            <CardContent>
              {trendWithPredictions.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={trendWithPredictions}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="month" className="text-xs" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={50} />
                    <YAxis className="text-xs" tick={{ fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }}
                      formatter={(val: any, name: string) => [val, name === 'predicted' ? (trendWithPredictions.find(d => d.predicted === val)?.isPrediction ? 'Forecast' : 'Submitted') : name]}
                    />
                    <Legend />
                    <Bar
                      dataKey="submitted"
                      name="Submitted"
                      fill={COLORS[3]}
                      fillOpacity={0.7}
                      radius={[3,3,0,0]}
                      cursor="pointer"
                      onClick={() => navigate('/claims?status=submitted')}
                    />
                    <Bar
                      dataKey="approved"
                      name="Approved"
                      fill={COLORS[0]}
                      fillOpacity={0.7}
                      radius={[3,3,0,0]}
                      cursor="pointer"
                      onClick={() => navigate('/claims?status=approved')}
                    />
                    <Line type="monotone" dataKey="predicted" name="Forecast" stroke={COLORS[4]} strokeWidth={2} strokeDasharray="5 5" dot={{ fill: COLORS[4], r: 4 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[300px] text-muted-foreground">Submit more claims to generate trend data</div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Monthly Amount Trend</CardTitle>
                <CardDescription>Total invoice value per month</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={monthlyTrend}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="month" className="text-xs" tick={{ fontSize: 9 }} angle={-30} textAnchor="end" height={40} />
                    <YAxis className="text-xs" tick={{ fontSize: 9 }} tickFormatter={v => v>=1e6?`${(v/1e6).toFixed(1)}M`:v>=1000?`${(v/1000).toFixed(0)}K`:String(v)} />
                    <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }} formatter={(v: number) => formatCurrency(v)} />
                    <Area type="monotone" dataKey="amount" name="Amount" stroke={COLORS[0]} fill={COLORS[0]} fillOpacity={0.15} strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Approval vs Rejection Trend</CardTitle>
                <CardDescription>Monthly approved vs rejected count</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={monthlyTrend}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="month" className="text-xs" tick={{ fontSize: 9 }} angle={-30} textAnchor="end" height={40} />
                    <YAxis className="text-xs" tick={{ fontSize: 9 }} />
                    <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }} />
                    <Legend />
                    <Line type="monotone" dataKey="approved" name="Approved" stroke={COLORS[0]} strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="rejected" name="Rejected" stroke={COLORS[2]} strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Monthly tabulation */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Monthly Breakdown Table</CardTitle>
              <CardDescription>Detailed month-by-month statistics</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Submitted</TableHead>
                    <TableHead className="text-right">Approved</TableHead>
                    <TableHead className="text-right">Rejected</TableHead>
                    <TableHead className="text-right">Pending</TableHead>
                    <TableHead className="text-right">Total Amount</TableHead>
                    <TableHead>Approval Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monthlyTrend.map(m => {
                    const pending = m.submitted - m.approved - m.rejected
                    const rate = m.submitted > 0 ? (m.approved / m.submitted) * 100 : 0
                    return (
                      <TableRow key={m.sortKey}>
                        <TableCell className="font-medium">{m.month}</TableCell>
                        <TableCell className="text-right">{m.submitted}</TableCell>
                        <TableCell className="text-right text-emerald-600">{m.approved}</TableCell>
                        <TableCell className="text-right text-red-600">{m.rejected}</TableCell>
                        <TableCell className="text-right text-amber-600">{Math.max(0, pending)}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(m.amount)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress value={rate} className="h-1.5 w-16" />
                            <span className="text-xs w-8">{rate.toFixed(0)}%</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                  {monthlyTrend.length > 0 && (
                    <TableRow className="bg-muted/30 font-semibold">
                      <TableCell>Forecast</TableCell>
                      {predictions.slice(0, 1).map(p => (
                        <>
                          <TableCell key="sub" className="text-right text-violet-600">~{p.predicted}</TableCell>
                          <TableCell className="text-right text-muted-foreground" colSpan={5}>3-month linear projection</TableCell>
                        </>
                      ))}
                      {predictions.length === 0 && <TableCell colSpan={6} className="text-muted-foreground">Need more data</TableCell>}
                    </TableRow>
                  )}
                  {monthlyTrend.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No data in current filter range</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── ALL CLAIMS DATA TAB ── */}
        <TabsContent value="data" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Claims Data</CardTitle>
                  <CardDescription>{filtered.length} records matching current filters</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={exportCsv}><FileCode className="mr-1 h-3.5 w-3.5 text-blue-600" /> CSV</Button>
                  <Button variant="outline" size="sm" onClick={exportExcel}><FileSpreadsheet className="mr-1 h-3.5 w-3.5 text-emerald-600" /> Excel</Button>
                  <Button variant="outline" size="sm" onClick={exportPdf}><Printer className="mr-1 h-3.5 w-3.5 text-red-600" /> PDF</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Claim #</TableHead>
                    <TableHead>Batch</TableHead>
                    <TableHead>Member</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">No claims matching current filters</TableCell></TableRow>
                  ) : filtered.slice((reportPage - 1) * reportPageSize, reportPage * reportPageSize).map(c => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">
                        <div>
                          {c.claimNumber}
                          {c.barcode && <p className="font-mono text-[9px] text-red-500">{c.barcode}</p>}
                        </div>
                      </TableCell>
                      <TableCell>
                        {c.batchNumber ? (
                          <div>
                            <p className="font-mono text-xs">{c.batchNumber}</p>
                            <p className="text-[10px] text-muted-foreground">{c.uploadedBy}</p>
                          </div>
                        ) : <span className="text-muted-foreground text-xs">Single</span>}
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{c.memberName}</p>
                        <p className="text-xs text-muted-foreground">{c.memberNumber}</p>
                      </TableCell>
                      <TableCell>{c.provider?.name}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(c.invoiceAmount)}</TableCell>
                      <TableCell className="font-mono text-xs">{c.invoiceNumber || '—'}</TableCell>
                      <TableCell><Badge className={getStatusColor(c.status)} variant="secondary">{c.status.replace(/_/g, ' ')}</Badge></TableCell>
                      <TableCell className="text-muted-foreground text-xs">{formatDate(c.submittedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination
                page={reportPage}
                pageSize={reportPageSize}
                total={filtered.length}
                onPageChange={setReportPage}
                onPageSizeChange={(size) => { setReportPageSize(size); setReportPage(1) }}
              />
            </CardContent>
          </Card>
        </TabsContent>
        {/* ── OCR QUALITY TAB ── */}
        <TabsContent value="ocr" className="mt-4 space-y-4">
          {/* OCR Stats row */}
          {(() => {
            const ocrDone = filtered.filter(c => c.aiExtracted)
            const highConf = ocrDone.filter(c => (c.aiConfidence || 0) >= 0.85)
            const medConf = ocrDone.filter(c => (c.aiConfidence || 0) >= 0.70 && (c.aiConfidence || 0) < 0.85)
            const lowConf = ocrDone.filter(c => (c.aiConfidence || 0) < 0.70)
            const missing = filtered.filter(c => !c.aiExtracted)
            const avgConf = ocrDone.length > 0
              ? ocrDone.reduce((s, c) => s + (c.aiConfidence || 0), 0) / ocrDone.length
              : 0
            const omissionRate = filtered.length > 0 ? (missing.length / filtered.length) * 100 : 0

            const confBands = [
              { label: '≥ 85% (High)', count: highConf.length, color: 'bg-emerald-500' },
              { label: '70–84% (Medium)', count: medConf.length, color: 'bg-amber-500' },
              { label: '< 70% (Low / Manual Review)', count: lowConf.length, color: 'bg-red-500' },
              { label: 'Not OCR-extracted', count: missing.length, color: 'bg-gray-400' },
            ]

            const fieldCoverage = [
              { field: 'Member Name', rate: ocrDone.filter(c => c.memberName).length },
              { field: 'Member Number', rate: ocrDone.filter(c => c.memberNumber).length },
              { field: 'Invoice Amount', rate: ocrDone.filter(c => c.invoiceAmount).length },
              { field: 'Invoice Number', rate: ocrDone.filter(c => c.invoiceNumber).length },
              { field: 'Provider Name', rate: ocrDone.filter(c => c.provider?.name).length },
              { field: 'Diagnosis / ICD Code', rate: ocrDone.filter(c => c.diagnosis || c.diagnosisCode).length },
            ]

            return (
              <>
                <div className="grid gap-4 sm:grid-cols-4">
                  {[
                    { label: 'Total OCR Processed', value: ocrDone.length, icon: ScanLine, color: 'text-blue-500' },
                    { label: 'Avg Confidence', value: `${(avgConf * 100).toFixed(1)}%`, icon: TrendingUp, color: 'text-emerald-500' },
                    { label: 'Manual Review Needed', value: lowConf.length, icon: AlertTriangle, color: 'text-amber-500' },
                    { label: 'OCR Omission Rate', value: `${omissionRate.toFixed(1)}%`, icon: TrendingDown, color: 'text-red-500' },
                  ].map(s => (
                    <Card key={s.label}>
                      <CardContent className="pt-4 pb-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs text-muted-foreground">{s.label}</p>
                            <p className="text-2xl font-bold mt-0.5">{s.value}</p>
                          </div>
                          <s.icon className={`h-6 w-6 ${s.color} opacity-75`} />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  {/* Confidence distribution */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">OCR Confidence Distribution</CardTitle>
                      <CardDescription>Breakdown of extraction quality bands</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {confBands.map(b => (
                        <div key={b.label} className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <span>{b.label}</span>
                            <span className="font-medium">{b.count}</span>
                          </div>
                          <div className="h-2 rounded-full bg-muted overflow-hidden">
                            <div
                              className={`h-full rounded-full ${b.color}`}
                              style={{ width: `${filtered.length > 0 ? (b.count / filtered.length) * 100 : 0}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>

                  {/* Field coverage */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Field Extraction Coverage</CardTitle>
                      <CardDescription>% of OCR-extracted claims where each field was found</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {fieldCoverage.map(f => {
                        const pct = ocrDone.length > 0 ? (f.rate / ocrDone.length) * 100 : 0
                        return (
                          <div key={f.field} className="space-y-1">
                            <div className="flex items-center justify-between text-sm">
                              <span>{f.field}</span>
                              <span className={`font-medium ${pct >= 90 ? 'text-emerald-600' : pct >= 70 ? 'text-amber-600' : 'text-red-600'}`}>
                                {pct.toFixed(0)}%
                              </span>
                            </div>
                            <Progress
                              value={pct}
                              className={`h-1.5 ${pct < 70 ? '[&>div]:bg-red-500' : pct < 90 ? '[&>div]:bg-amber-500' : '[&>div]:bg-emerald-500'}`}
                            />
                          </div>
                        )
                      })}
                    </CardContent>
                  </Card>
                </div>

                {/* Low-confidence claims table */}
                {lowConf.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-500" />
                        Claims Requiring Manual Review (Confidence &lt; 70%)
                      </CardTitle>
                      <CardDescription>{lowConf.length} claims flagged for manual data verification</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Claim #</TableHead>
                            <TableHead>Member</TableHead>
                            <TableHead>Provider</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                            <TableHead>Confidence</TableHead>
                            <TableHead>Missing Fields</TableHead>
                            <TableHead>Date</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {lowConf.map(c => {
                            const missing: string[] = []
                            if (!c.memberNumber) missing.push('Member #')
                            if (!c.invoiceNumber) missing.push('Invoice #')
                            if (!c.diagnosis && !c.diagnosisCode) missing.push('Diagnosis')
                            if (!c.invoiceDate) missing.push('Invoice Date')
                            return (
                              <TableRow key={c.id}>
                                <TableCell className="font-medium font-mono text-xs">{c.claimNumber}</TableCell>
                                <TableCell>{c.memberName}</TableCell>
                                <TableCell>{c.provider?.name}</TableCell>
                                <TableCell className="text-right">{formatCurrency(c.invoiceAmount)}</TableCell>
                                <TableCell>
                                  <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                                    {c.aiConfidence ? `${(c.aiConfidence * 100).toFixed(0)}%` : 'N/A'}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <div className="flex flex-wrap gap-1">
                                    {missing.length === 0
                                      ? <span className="text-xs text-muted-foreground">—</span>
                                      : missing.map(m => <Badge key={m} variant="outline" className="text-[10px] text-amber-600 border-amber-300">{m}</Badge>)
                                    }
                                  </div>
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">{formatDate(c.submittedAt)}</TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )}
              </>
            )
          })()}
        </TabsContent>

        {/* ── FRAUD SCORING TAB ── */}
        <TabsContent value="fraud" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={exportFraudReport}>
              <Printer className="mr-1.5 h-3.5 w-3.5 text-red-600" /> Export Fraud Report (PDF)
            </Button>
          </div>
          {(() => {
            // Fraud signals
            const amountMap = new Map<string, number[]>()
            const invoiceMap = new Map<string, string[]>()
            const memberHighFreq = new Map<string, number>()

            filtered.forEach(c => {
              // Duplicate invoice detection
              if (c.invoiceNumber) {
                if (!invoiceMap.has(c.invoiceNumber)) invoiceMap.set(c.invoiceNumber, [])
                invoiceMap.get(c.invoiceNumber)!.push(c.id)
              }
              // Amount clustering per provider
              const key = c.provider?.name || 'Unknown'
              if (!amountMap.has(key)) amountMap.set(key, [])
              amountMap.get(key)!.push(c.invoiceAmount || 0)
              // High-frequency member
              const mKey = c.memberNumber || c.memberName
              memberHighFreq.set(mKey, (memberHighFreq.get(mKey) || 0) + 1)
            })

            const duplicateInvoiceNums = new Set(
              Array.from(invoiceMap.entries())
                .filter(([, ids]) => ids.length > 1)
                .map(([inv]) => inv)
            )
            const duplicateInvoices = Array.from(invoiceMap.entries())
              .filter(([, ids]) => ids.length > 1)
              .map(([inv, ids]) => ({ invoiceNumber: inv, count: ids.length, claims: ids }))

            const highFreqMembers = Array.from(memberHighFreq.entries())
              .filter(([, count]) => count >= 5)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 10)

            const roundAmountClaims = filtered.filter(c => {
              const amt = c.invoiceAmount || 0
              return amt > 0 && amt % 1000 === 0 && amt >= 10000
            })

            const highValueClaims = filtered.filter(c => (c.invoiceAmount || 0) > 200000)

            const unknownPatientClaims = filtered.filter(c =>
              !c.memberNumber || c.memberName?.toLowerCase().includes('unknown')
            )

            const fraudScore = (
              duplicateInvoices.length * 20 +
              highFreqMembers.length * 5 +
              Math.min(roundAmountClaims.length * 2, 30)
            )
            const riskLevel = fraudScore >= 60 ? 'High' : fraudScore >= 30 ? 'Medium' : 'Low'
            const riskColor = riskLevel === 'High' ? 'text-red-600' : riskLevel === 'Medium' ? 'text-amber-600' : 'text-emerald-600'

            return (
              <>
                {/* Risk summary */}
                <div className="grid gap-4 sm:grid-cols-5">
                  {[
                    { label: 'Overall Risk Score', value: `${fraudScore}/100`, icon: ShieldAlert, color: riskColor },
                    { label: 'Duplicate Invoices', value: duplicateInvoices.length, icon: AlertTriangle, color: 'text-red-500' },
                    { label: 'High-Freq Members', value: highFreqMembers.length, icon: Users, color: 'text-amber-500' },
                    { label: 'High-Value Claims', value: highValueClaims.length, icon: Flame, color: 'text-orange-500' },
                    { label: 'Unknown Patients', value: unknownPatientClaims.length, icon: AlertTriangle, color: unknownPatientClaims.length > 0 ? 'text-purple-500' : 'text-muted-foreground' },
                  ].map(s => (
                    <Card key={s.label}>
                      <CardContent className="pt-4 pb-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs text-muted-foreground">{s.label}</p>
                            <p className={`text-2xl font-bold mt-0.5 ${s.color}`}>{s.value}</p>
                          </div>
                          <s.icon className={`h-6 w-6 ${s.color} opacity-75`} />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <Card className={`border-2 ${riskLevel === 'High' ? 'border-red-300 dark:border-red-800' : riskLevel === 'Medium' ? 'border-amber-300 dark:border-amber-800' : 'border-emerald-300 dark:border-emerald-800'}`}>
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center gap-3">
                      <ShieldAlert className={`h-8 w-8 ${riskColor}`} />
                      <div>
                        <p className="text-sm text-muted-foreground">Fraud Risk Level</p>
                        <p className={`text-xl font-bold ${riskColor}`}>{riskLevel} Risk</p>
                      </div>
                      <div className="flex-1 ml-4">
                        <Progress value={Math.min(fraudScore, 100)} className="h-3" />
                        <p className="text-xs text-muted-foreground mt-1">
                          Score based on duplicate invoices, high-frequency patterns, and round-number anomalies
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Duplicate invoices */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-red-500" />
                      Duplicate Invoice Numbers
                    </CardTitle>
                    <CardDescription>
                      {duplicateInvoices.length > 0
                        ? `${duplicateInvoices.length} invoice number(s) appear on multiple claims — potential double-billing`
                        : 'No duplicate invoice numbers detected in current filter range'}
                    </CardDescription>
                  </CardHeader>
                  {duplicateInvoices.length > 0 && (
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Invoice Number</TableHead>
                            <TableHead className="text-right">Occurrences</TableHead>
                            <TableHead>Claims</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {duplicateInvoices.map(d => (
                            <TableRow key={d.invoiceNumber}>
                              <TableCell className="font-mono font-medium text-red-600">{d.invoiceNumber}</TableCell>
                              <TableCell className="text-right">
                                <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">{d.count}×</Badge>
                              </TableCell>
                              <TableCell>
                                {d.claims.slice(0, 3).map(id => {
                                  const c = filtered.find(c => c.id === id)
                                  return c
                                    ? (
                                      <button
                                        key={id}
                                        onClick={() => setFraudDetailClaim(c)}
                                        className="mr-1 inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[10px] hover:bg-primary hover:text-primary-foreground transition-colors cursor-pointer"
                                        title="Open claim detail"
                                      >
                                        {c.claimNumber}
                                      </button>
                                    )
                                    : null
                                })}
                                {d.claims.length > 3 && <Badge variant="secondary" className="text-[10px]">+{d.claims.length - 3}</Badge>}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  )}
                </Card>

                {/* High-frequency members */}
                {highFreqMembers.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Users className="h-4 w-4 text-amber-500" />
                        High-Frequency Members (≥5 claims)
                      </CardTitle>
                      <CardDescription>Members with unusually high claim frequency — may warrant investigation</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Member</TableHead>
                            <TableHead className="text-right">Claims</TableHead>
                            <TableHead>Total Amount</TableHead>
                            <TableHead>Risk Signal</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {highFreqMembers.map(([memberKey, count]) => {
                            const memberClaims = filtered.filter(c => (c.memberNumber || c.memberName) === memberKey)
                            const total = memberClaims.reduce((s, c) => s + (c.invoiceAmount || 0), 0)
                            return (
                              <TableRow key={memberKey}>
                                <TableCell className="font-medium">{memberKey}</TableCell>
                                <TableCell className="text-right">
                                  <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">{count}</Badge>
                                </TableCell>
                                <TableCell className="font-medium">{formatCurrency(total)}</TableCell>
                                <TableCell>
                                  <Badge
                                    className={count >= 10
                                      ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                                      : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                                    }
                                  >
                                    {count >= 10 ? 'High' : 'Medium'}
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )}

                {/* Round-amount anomalies */}
                {roundAmountClaims.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Flame className="h-4 w-4 text-orange-500" />
                        Round-Amount Anomalies
                      </CardTitle>
                      <CardDescription>
                        Claims with exact round invoice amounts (multiples of KES 1,000 ≥ KES 10,000) — often indicative of inflated billing.
                        Use the dropdown to flag each claim as you investigate.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Claim #</TableHead>
                            <TableHead>Member</TableHead>
                            <TableHead>Provider</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                            <TableHead>Signals</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead>Fraud Flag</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {roundAmountClaims.slice(0, 20).map(c => {
                            const isUnknown = !c.memberNumber || c.memberName?.toLowerCase().includes('unknown')
                            const isDup = c.invoiceNumber && duplicateInvoiceNums.has(c.invoiceNumber)
                            const isHighVal = (c.invoiceAmount || 0) > 200000
                            const currentFlag = fraudFlags.get(c.id)
                            return (
                              <TableRow key={c.id} className={currentFlag === 'confirmed_fraud' ? 'bg-red-50 dark:bg-red-950/20' : currentFlag === 'under_investigation' ? 'bg-amber-50 dark:bg-amber-950/20' : currentFlag === 'cleared' ? 'bg-emerald-50 dark:bg-emerald-950/20' : ''}>
                                <TableCell>
                                  <button
                                    onClick={() => setFraudDetailClaim(c)}
                                    className="font-mono font-medium text-xs text-primary hover:underline underline-offset-2 cursor-pointer"
                                    title="Open claim detail"
                                  >
                                    {c.claimNumber}
                                  </button>
                                </TableCell>
                                <TableCell className={isUnknown ? 'text-purple-600 font-medium' : ''}>{c.memberName || '—'}</TableCell>
                                <TableCell className="text-xs">{c.provider?.name}</TableCell>
                                <TableCell className="text-right font-medium text-orange-600">{formatCurrency(c.invoiceAmount)}</TableCell>
                                <TableCell>
                                  <div className="flex flex-wrap gap-1">
                                    <Badge variant="outline" className="text-[9px] border-orange-300 text-orange-700 bg-orange-50">Round Amt</Badge>
                                    {isUnknown && <Badge variant="outline" className="text-[9px] border-purple-300 text-purple-700 bg-purple-50">Unknown Pt.</Badge>}
                                    {isDup && <Badge variant="outline" className="text-[9px] border-red-300 text-red-700 bg-red-50">Dup. Invoice</Badge>}
                                    {isHighVal && <Badge variant="outline" className="text-[9px] border-red-300 text-red-700 bg-red-50">High Value</Badge>}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Badge className={getStatusColor(c.status)} variant="secondary">
                                    {c.status.replace(/_/g, ' ')}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">{formatDate(c.submittedAt)}</TableCell>
                                <TableCell>
                                  <Select
                                    value={currentFlag || ''}
                                    onValueChange={(val) => setFraudFlag(c.id, val as any)}
                                  >
                                    <SelectTrigger className={`h-7 text-[11px] w-[160px] ${currentFlag === 'confirmed_fraud' ? 'border-red-400 text-red-700' : currentFlag === 'under_investigation' ? 'border-amber-400 text-amber-700' : currentFlag === 'cleared' ? 'border-emerald-400 text-emerald-700' : ''}`}>
                                      <SelectValue placeholder="Not flagged" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="">Not flagged</SelectItem>
                                      <SelectItem value="under_investigation">Under Investigation</SelectItem>
                                      <SelectItem value="confirmed_fraud">Confirmed Fraud</SelectItem>
                                      <SelectItem value="cleared">Cleared / False Positive</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )}

                {/* Unknown patient claims */}
                {unknownPatientClaims.length > 0 && (
                  <Card className="border-purple-200 dark:border-purple-800">
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-purple-500" />
                        Unknown / Unverified Patient Claims
                      </CardTitle>
                      <CardDescription>
                        Claims with no member number or "Unknown" patient name — cannot be verified against policy eligibility. Primary indicator of ghost claims.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Claim #</TableHead>
                            <TableHead>Member Name</TableHead>
                            <TableHead>Member #</TableHead>
                            <TableHead>Provider</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Fraud Flag</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {unknownPatientClaims.slice(0, 20).map(c => {
                            const currentFlag = fraudFlags.get(c.id)
                            return (
                              <TableRow key={c.id} className={currentFlag === 'confirmed_fraud' ? 'bg-red-50 dark:bg-red-950/20' : currentFlag === 'under_investigation' ? 'bg-amber-50 dark:bg-amber-950/20' : currentFlag === 'cleared' ? 'bg-emerald-50 dark:bg-emerald-950/20' : ''}>
                                <TableCell>
                                  <button
                                    onClick={() => setFraudDetailClaim(c)}
                                    className="font-mono font-medium text-xs text-primary hover:underline underline-offset-2 cursor-pointer"
                                    title="Open claim detail"
                                  >
                                    {c.claimNumber}
                                  </button>
                                </TableCell>
                                <TableCell className="text-purple-600 font-medium">{c.memberName || '—'}</TableCell>
                                <TableCell className="text-red-600 font-mono text-xs">{c.memberNumber || 'MISSING'}</TableCell>
                                <TableCell className="text-xs">{c.provider?.name}</TableCell>
                                <TableCell className="text-right font-medium">{formatCurrency(c.invoiceAmount)}</TableCell>
                                <TableCell>
                                  <Badge className={getStatusColor(c.status)} variant="secondary">
                                    {c.status.replace(/_/g, ' ')}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <Select
                                    value={currentFlag || ''}
                                    onValueChange={(val) => setFraudFlag(c.id, val as any)}
                                  >
                                    <SelectTrigger className={`h-7 text-[11px] w-[160px] ${currentFlag === 'confirmed_fraud' ? 'border-red-400 text-red-700' : currentFlag === 'under_investigation' ? 'border-amber-400 text-amber-700' : currentFlag === 'cleared' ? 'border-emerald-400 text-emerald-700' : ''}`}>
                                      <SelectValue placeholder="Not flagged" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="">Not flagged</SelectItem>
                                      <SelectItem value="under_investigation">Under Investigation</SelectItem>
                                      <SelectItem value="confirmed_fraud">Confirmed Fraud</SelectItem>
                                      <SelectItem value="cleared">Cleared / False Positive</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )}
              </>
            )
          })()}
        </TabsContent>

      </Tabs>

      {/* ── Fraud Claim Detail Dialog ── */}
      <Dialog open={!!fraudDetailClaim} onOpenChange={(open) => { if (!open) setFraudDetailClaim(null) }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-0">
          {fraudDetailClaim && (() => {
            const c = fraudDetailClaim
            const amt = c.invoiceAmount || 0

            // ── Fraud signals ──────────────────────────────────────────────
            type Signal = { level: 'critical' | 'warning'; title: string; what: string; rules: string[]; exposure: string; action: string }
            const signals: Signal[] = []

            if (amt >= 10000 && amt % 1000 === 0) {
              signals.push({
                level: amt >= 100000 ? 'critical' : 'warning',
                title: 'Round-Amount Billing',
                what: `Invoice amount is exactly ${fmtAmount(amt)} — a perfect round number with zero cents. In genuine hospital billing, individual service lines (consultation, ward days, drugs, lab tests, theatre time, consumables) are priced independently and their sum virtually never resolves to a round figure. A perfectly round total indicates the figure was manually typed or estimated rather than system-generated from an itemised bill.`,
                rules: [
                  'CIC Claims Rule §4.2 — Invoice Integrity: All submitted invoices must reflect actual itemised charges with individual service codes and unit prices. Lump-sum or estimated amounts are not accepted.',
                  'IRA Provider Claims Guidelines §7 — Itemised Billing: Medical providers are required to submit HIS-generated itemised invoices. Manual override of system totals constitutes a billing irregularity.',
                  'CIC Fraud Policy §2.1(b) — Inflated Invoicing: Submission of inflated or fabricated amounts is classified as provider fraud regardless of whether services were rendered.',
                ],
                exposure: fmtAmount(amt) + ' at risk — no itemised breakdown exists to verify what services were charged for.',
                action: 'Request original itemised invoice from provider breaking down every service code, quantity, and unit price. Cross-reference against the patient\'s clinical notes and admission record.',
              })
            }

            const isUnknownPatient = !c.memberNumber || c.memberName?.toLowerCase().includes('unknown') || !c.memberName?.trim()
            if (isUnknownPatient) {
              signals.push({
                level: 'critical',
                title: 'Unknown / Missing Patient Identity',
                what: `Patient name is recorded as "${c.memberName || 'blank'}" and member number is ${c.memberNumber ? `"${c.memberNumber}"` : 'completely absent'}. A real hospital admission captures patient identity at registration — before any invoice is raised. The absence of a verified patient name means this claim cannot be cross-checked against policy eligibility, benefit limits, active cover status, or the member's prior claim history. This is the primary structural indicator of a ghost claim: an invoice raised for a service rendered to no one.`,
                rules: [
                  'CIC Policy Terms §11.1 — Eligibility Verification: Every claim must be linked to an active, identified policyholder or named dependant. Claims with unverified beneficiary identity cannot be processed.',
                  'Insurance Act Cap 487 §209 — Provider Fraud: Submission of a claim for services not rendered to an identifiable insured person constitutes insurance fraud carrying criminal liability.',
                  'CIC Claims SLA §3 — Mandatory Fields: Member name and member number are mandatory fields. Any claim missing these must be returned at intake — it should not progress past the submission stage.',
                  'AML/KYC Obligations: Payment of ' + fmtAmount(amt) + ' to a provider without a verified beneficiary identity violates CIC\'s AML obligations under the Proceeds of Crime Act.',
                ],
                exposure: fmtAmount(amt) + ' would be paid with zero ability to verify the service was rendered to an actual insured person.',
                action: 'Contact Aga Khan University Hospital billing department. Request the original admission record for invoice ' + (c.invoiceNumber || 'this invoice') + ' — including patient ID, admission date, and discharge summary. If no admission record exists, escalate immediately to CIC Fraud Unit.',
              })
            }

            if (amt > 200000) {
              const providerClaims = claims.filter(x => x.provider?.name === c.provider?.name)
              const providerAvg = providerClaims.length > 1
                ? providerClaims.reduce((s, x) => s + (x.invoiceAmount || 0), 0) / providerClaims.length
                : 0
              const multiple = providerAvg > 0 ? (amt / providerAvg).toFixed(1) : null
              signals.push({
                level: 'warning',
                title: 'High-Value Claim — Enhanced Review Required',
                what: `${fmtAmount(amt)} exceeds the KES 200,000 enhanced-review threshold by ${fmtAmount(amt - 200000)} (${((amt / 200000 - 1) * 100).toFixed(0)}% above threshold).${multiple ? ` This is ${multiple}× the average claim value for ${c.provider?.name || 'this provider'} (${fmtAmount(Math.round(providerAvg))}).` : ''} Claims at this value level require pre-authorisation documentation and mandatory 3rd-level supervisor sign-off before any payment is processed.`,
                rules: [
                  'CIC Underwriting Rule §8.3 — Pre-Authorisation: Any planned procedure or treatment expected to exceed KES 200,000 must be pre-authorised by CIC before the service is rendered. No pre-authorisation letter has been attached to this claim.',
                  'CIC Workflow Policy §5.2 — High-Value Escalation: Claims above KES 200,000 must be automatically routed to supervisor queue and require 3-level approval (maker + checker + supervisor). This claim is currently at initial_review — the escalation was not triggered.',
                  'CIC Payment Authority §9.1: No single claim payment above KES 200,000 may be processed without a supervisor\'s digital approval stamp on file.',
                ],
                exposure: fmtAmount(amt) + ' — if approved without pre-authorisation, CIC has no contractual basis to demand a refund from the provider.',
                action: 'Verify whether a pre-authorisation letter exists for this case. If none was issued, the claim is automatically ineligible for payment under CIC policy terms. Route to supervisor queue immediately.',
              })
            }

            const dupClaims = claims.filter(x => x.id !== c.id && x.invoiceNumber && x.invoiceNumber === c.invoiceNumber)
            if (dupClaims.length > 0) {
              signals.push({
                level: 'critical',
                title: 'Duplicate Invoice Number',
                what: `Invoice number "${c.invoiceNumber}" already appears on ${dupClaims.length} other claim(s): ${dupClaims.map(x => x.claimNumber).join(', ')}. A provider invoice number is a unique identifier — the same number cannot legitimately appear on two separate claims. This is a double-billing attempt: submitting the same invoice twice hoping one payment slips through.`,
                rules: [
                  'CIC Claims Rule §4.1 — Invoice Uniqueness: Each invoice number may only appear once per provider per policy year. Duplicate submission is grounds for immediate claim rejection and provider suspension.',
                  'CIC Fraud Policy §2.1(a) — Double Billing: Deliberate re-submission of a paid or pending invoice is a Class A provider fraud offence.',
                  'CIC Provider Agreement §12 — Penalty: Confirmed double-billing triggers a KES 100,000 penalty per occurrence plus recovery of any amounts paid.',
                ],
                exposure: fmtAmount(amt) + ' in duplicate payment risk. If the original claim was already paid, this represents a direct ' + fmtAmount(amt) + ' loss.',
                action: 'Immediately check payment status of ' + dupClaims.map(x => x.claimNumber).join(', ') + '. If paid, raise a recovery request against the provider. Reject this claim and log the duplicate attempt in the provider\'s fraud record.',
              })
            }

            if (c.aiExtracted && c.aiConfidence && c.aiConfidence < 0.70) {
              signals.push({
                level: 'warning',
                title: 'Low OCR Confidence',
                what: `AI extracted the claim fields with only ${(c.aiConfidence * 100).toFixed(0)}% confidence. At this confidence level, critical values — invoice amount, member number, invoice number — have a statistically significant probability of being misread. A misread amount could mean the actual invoice shows a different (possibly lower) figure than what was submitted.`,
                rules: [
                  'CIC Claims SLA §6.4 — OCR Threshold: Claims with OCR confidence below 70% must be held for full manual verification of all extracted fields before entering the maker queue.',
                  'CIC Data Quality Policy §3 — Field Validation: All financial figures on claims submitted via OCR must be manually confirmed by a claims officer before approval.',
                ],
                exposure: 'Potential over-payment if the amount ' + fmtAmount(amt) + ' was misread from a lower figure on the original document.',
                action: 'Pull the original uploaded document and manually verify every extracted field against the physical document. Do not approve until all fields are confirmed correct.',
              })
            }

            // ── Provider statistics ────────────────────────────────────────
            const provClaims = claims.filter(x => x.provider?.name === c.provider?.name)
            const provTotal = provClaims.reduce((s, x) => s + (x.invoiceAmount || 0), 0)
            const provAvg = provClaims.length > 0 ? provTotal / provClaims.length : 0
            const provRoundAmt = provClaims.filter(x => { const a = x.invoiceAmount||0; return a >= 10000 && a % 1000 === 0 }).length
            const provUnknown = provClaims.filter(x => !x.memberNumber || x.memberName?.toLowerCase().includes('unknown')).length

            // ── Risk score ─────────────────────────────────────────────────
            const riskScore = Math.min(100,
              signals.filter(s => s.level === 'critical').length * 30 +
              signals.filter(s => s.level === 'warning').length * 15
            )
            const riskLabel = riskScore >= 60 ? 'HIGH' : riskScore >= 30 ? 'MEDIUM' : 'LOW'
            const riskBarColor = riskScore >= 60 ? 'bg-red-500' : riskScore >= 30 ? 'bg-amber-500' : 'bg-emerald-500'
            const riskTextColor = riskScore >= 60 ? 'text-red-600' : riskScore >= 30 ? 'text-amber-600' : 'text-emerald-600'

            const currentFlag = fraudFlags.get(c.id)
            const flagLabel = currentFlag === 'confirmed_fraud' ? 'CONFIRMED FRAUD' : currentFlag === 'under_investigation' ? 'UNDER INVESTIGATION' : currentFlag === 'cleared' ? 'CLEARED' : null

            return (
              <>
                {/* ── Header ── */}
                <div className="sticky top-0 z-10 bg-background border-b px-5 py-3">
                  <DialogTitle className="sr-only">Fraud Detail — {c.claimNumber}</DialogTitle>
                  <div className="flex items-center gap-3 flex-wrap">
                    <ShieldAlert className="h-5 w-5 text-red-500 shrink-0" />
                    <span className="font-mono font-bold text-sm">{c.claimNumber}</span>
                    <Badge className={getStatusColor(c.status)} variant="secondary">{c.status.replace(/_/g,' ')}</Badge>
                    {c.priority && c.priority !== 'normal' && (
                      <Badge variant="outline" className="text-[10px]">{c.priority}</Badge>
                    )}
                    {flagLabel && (
                      <Badge className={currentFlag === 'confirmed_fraud' ? 'bg-red-100 text-red-700' : currentFlag === 'under_investigation' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}>
                        {flagLabel}
                      </Badge>
                    )}
                    <span className="ml-auto text-lg font-extrabold text-orange-600 tabular-nums">{fmtAmount(amt)}</span>
                  </div>

                  {/* Risk score bar */}
                  <div className="flex items-center gap-3 mt-2.5">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wide w-20 shrink-0">Fraud Risk</span>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${riskBarColor}`} style={{ width: `${riskScore}%` }} />
                    </div>
                    <span className={`text-xs font-bold w-20 ${riskTextColor}`}>{riskLabel} ({riskScore}/100)</span>
                    <span className="text-[10px] text-muted-foreground">{signals.filter(s=>s.level==='critical').length} critical · {signals.filter(s=>s.level==='warning').length} warning</span>
                  </div>
                </div>

                <div className="px-5 pb-5 space-y-5 pt-4">

                  {/* ── Claim details ── */}
                  <section>
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Claim Details</h3>
                    <div className="grid grid-cols-3 gap-x-4 gap-y-3 rounded-lg border bg-muted/20 p-3 text-sm">
                      <div><p className="text-[10px] text-muted-foreground">Provider</p><p className="font-semibold text-xs leading-tight">{c.provider?.name || '—'}</p></div>
                      <div><p className="text-[10px] text-muted-foreground">Invoice Number</p><p className="font-mono font-semibold text-xs">{c.invoiceNumber || '—'}</p></div>
                      <div><p className="text-[10px] text-muted-foreground">Invoice Amount</p><p className="font-bold text-xs text-orange-600">{fmtAmount(amt)}</p></div>
                      <div><p className="text-[10px] text-muted-foreground">Member / Patient</p><p className={`font-semibold text-xs ${isUnknownPatient ? 'text-purple-600' : ''}`}>{c.memberName || '—'}</p></div>
                      <div><p className="text-[10px] text-muted-foreground">Member Number</p><p className={`font-mono font-semibold text-xs ${!c.memberNumber ? 'text-red-600' : ''}`}>{c.memberNumber || 'MISSING'}</p></div>
                      <div><p className="text-[10px] text-muted-foreground">Barcode</p><p className="font-mono text-xs text-muted-foreground">{c.barcode || '—'}</p></div>
                      <div><p className="text-[10px] text-muted-foreground">Invoice Date</p><p className="font-semibold text-xs">{c.invoiceDate ? formatDate(c.invoiceDate) : '—'}</p></div>
                      <div><p className="text-[10px] text-muted-foreground">Service Date</p><p className="font-semibold text-xs">{c.serviceDate ? formatDate(c.serviceDate) : '—'}</p></div>
                      <div><p className="text-[10px] text-muted-foreground">Date Submitted</p><p className="font-semibold text-xs">{formatDate(c.submittedAt)}</p></div>
                      {c.diagnosis && <div className="col-span-2"><p className="text-[10px] text-muted-foreground">Diagnosis</p><p className="font-semibold text-xs">{c.diagnosis}</p></div>}
                      {c.treatment && <div className="col-span-2"><p className="text-[10px] text-muted-foreground">Treatment</p><p className="font-semibold text-xs">{c.treatment}</p></div>}
                      {(c.diagnosisCode || c.procedureCode) && (
                        <div><p className="text-[10px] text-muted-foreground">Codes</p>
                          <p className="font-mono text-xs">{[c.diagnosisCode, c.procedureCode].filter(Boolean).join(' · ')}</p>
                        </div>
                      )}
                      <div><p className="text-[10px] text-muted-foreground">Workflow Stage</p><p className="font-semibold text-xs">{c.workflowStage?.replace(/_/g,' ') || '—'}</p></div>
                      <div><p className="text-[10px] text-muted-foreground">OCR Status</p>
                        <p className="font-semibold text-xs">
                          {c.ocrStatus}{c.aiConfidence ? ` (${(c.aiConfidence*100).toFixed(0)}% conf.)` : ''}
                          {c.aiExtracted && <span className="ml-1 text-violet-600 text-[10px]">AI</span>}
                        </p>
                      </div>
                      {c.batchNumber && <div><p className="text-[10px] text-muted-foreground">Batch</p><p className="font-mono text-xs">{c.batchNumber}</p></div>}
                      {c.uploadedBy && <div><p className="text-[10px] text-muted-foreground">Uploaded By</p><p className="text-xs">{c.uploadedBy}</p></div>}
                      {c.documents.length > 0 && (
                        <div className="col-span-3"><p className="text-[10px] text-muted-foreground mb-1">Attached Documents ({c.documents.length})</p>
                          <div className="flex flex-wrap gap-1">
                            {c.documents.map((d,i) => (
                              <span key={i} className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] bg-background">
                                <FileText className="h-2.5 w-2.5" />{d.name}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </section>

                  {/* ── Provider context ── */}
                  {provClaims.length > 1 && (
                    <section>
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Provider Pattern — {c.provider?.name}</h3>
                      <div className="grid grid-cols-4 gap-3">
                        {[
                          { label: 'Total Claims', value: provClaims.length, note: 'in current filter' },
                          { label: 'Average Claim', value: fmtAmount(Math.round(provAvg)), note: `this claim is ${provAvg > 0 ? (amt/provAvg).toFixed(1)+'×' : 'N/A'}` },
                          { label: 'Round-Amount', value: provRoundAmt, note: `${provClaims.length > 0 ? ((provRoundAmt/provClaims.length)*100).toFixed(0) : 0}% of claims`, alert: provRoundAmt > 2 },
                          { label: 'Unknown Patients', value: provUnknown, note: `${provClaims.length > 0 ? ((provUnknown/provClaims.length)*100).toFixed(0) : 0}% of claims`, alert: provUnknown > 0 },
                        ].map(s => (
                          <div key={s.label} className={`rounded border p-2.5 text-center ${(s as any).alert ? 'border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800' : 'bg-muted/20'}`}>
                            <p className={`text-lg font-bold ${(s as any).alert ? 'text-red-600' : ''}`}>{s.value}</p>
                            <p className="text-[10px] text-muted-foreground font-medium">{s.label}</p>
                            <p className="text-[9px] text-muted-foreground mt-0.5">{s.note}</p>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* ── Fraud signals ── */}
                  {signals.length > 0 && (
                    <section>
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                        Fraud Signal Analysis — {signals.length} Signal{signals.length !== 1 ? 's' : ''} Detected
                      </h3>
                      <div className="space-y-3">
                        {signals.map((s, i) => (
                          <div key={i} className={`rounded-lg border overflow-hidden ${s.level === 'critical' ? 'border-red-200 dark:border-red-800' : 'border-amber-200 dark:border-amber-800'}`}>
                            {/* Signal header */}
                            <div className={`flex items-center gap-2 px-3 py-2 ${s.level === 'critical' ? 'bg-red-100 dark:bg-red-950/40' : 'bg-amber-100 dark:bg-amber-950/40'}`}>
                              <span className={`h-2 w-2 rounded-full shrink-0 ${s.level === 'critical' ? 'bg-red-500' : 'bg-amber-500'}`} />
                              <span className={`text-xs font-bold uppercase tracking-wide ${s.level === 'critical' ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'}`}>
                                {s.level === 'critical' ? '⚠ CRITICAL' : '⚡ WARNING'} — {s.title}
                              </span>
                            </div>
                            {/* Signal body */}
                            <div className="px-3 py-3 space-y-3 text-xs">
                              <div>
                                <p className="font-semibold text-[10px] uppercase tracking-wide text-muted-foreground mb-1">What Was Detected</p>
                                <p className="leading-relaxed">{s.what}</p>
                              </div>
                              <div>
                                <p className="font-semibold text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Rules / Policies Violated</p>
                                <ul className="space-y-1">
                                  {s.rules.map((r, j) => (
                                    <li key={j} className="flex gap-2 leading-relaxed">
                                      <span className="shrink-0 text-muted-foreground">§</span>
                                      <span>{r}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                <div className={`rounded p-2 ${s.level === 'critical' ? 'bg-red-50 dark:bg-red-950/20' : 'bg-amber-50 dark:bg-amber-950/20'}`}>
                                  <p className="font-semibold text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Financial Exposure</p>
                                  <p className={`leading-relaxed ${s.level === 'critical' ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'}`}>{s.exposure}</p>
                                </div>
                                <div className="rounded p-2 bg-emerald-50 dark:bg-emerald-950/20">
                                  <p className="font-semibold text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Required Action</p>
                                  <p className="leading-relaxed text-emerald-700 dark:text-emerald-300">{s.action}</p>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* ── Investigator classification ── */}
                  <section>
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Investigator Classification</h3>
                    <div className="flex items-center gap-3 rounded-lg border bg-muted/20 p-3">
                      <Select value={currentFlag || ''} onValueChange={(val) => setFraudFlag(c.id, val as any)}>
                        <SelectTrigger className={`h-8 text-xs w-[220px] font-medium ${currentFlag === 'confirmed_fraud' ? 'border-red-400 text-red-700 bg-red-50' : currentFlag === 'under_investigation' ? 'border-amber-400 text-amber-700 bg-amber-50' : currentFlag === 'cleared' ? 'border-emerald-400 text-emerald-700 bg-emerald-50' : ''}`}>
                          <SelectValue placeholder="Set investigation status…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">Not flagged</SelectItem>
                          <SelectItem value="under_investigation">Under Investigation</SelectItem>
                          <SelectItem value="confirmed_fraud">Confirmed Fraud</SelectItem>
                          <SelectItem value="cleared">Cleared / False Positive</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">Your classification is included in the exported Fraud Report PDF.</p>
                    </div>
                  </section>

                </div>

                {/* ── Footer ── */}
                <div className="sticky bottom-0 bg-background border-t px-5 py-3 flex justify-between items-center">
                  <p className="text-[10px] text-muted-foreground">CIC Fraud Investigation · {new Date().toLocaleDateString('en-KE', { day:'numeric', month:'short', year:'numeric' })}</p>
                  <Button variant="outline" size="sm" onClick={() => { setFraudDetailClaim(null); navigate(`/claims?open=${c.claimNumber}`) }}>
                    <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open Full Claim Detail
                  </Button>
                </div>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>
    </div>
  )
}
