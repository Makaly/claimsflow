import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import {
  GitBranch, UserCheck, UserCog, CheckCircle, Clock,
  AlertTriangle, ArrowRight, Users, Loader2, RefreshCw,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { formatCurrency } from '@/lib/utils'

interface WorkflowStats {
  initial_review: number
  maker_review: number
  checker_review: number
  final_approval: number
  completed: number
  total: number
  totalValue?: number
  flagged?: number
}

interface ReviewerWorkload {
  name: string
  assigned: number
  completed: number
}

interface RecentAction {
  id: string
  action: string
  performedBy?: string
  createdAt: string
  type: string
}

const DEMO_STATS: WorkflowStats = {
  initial_review: 45, maker_review: 120, checker_review: 85,
  final_approval: 52, completed: 40, total: 342,
  totalValue: 18750000, flagged: 18,
}

const DEMO_WORKLOAD: ReviewerWorkload[] = [
  { name: 'Jane Mwangi', assigned: 28, completed: 22 },
  { name: 'Peter Omondi', assigned: 35, completed: 18 },
  { name: 'Sarah Wambui', assigned: 22, completed: 20 },
  { name: 'James Kimani', assigned: 30, completed: 25 },
  { name: 'Grace Njeri', assigned: 18, completed: 15 },
]

const DEMO_ACTIVITY: RecentAction[] = [
  { id: '1', action: 'Claim CLM-2026-00142 assigned to maker', performedBy: 'System', createdAt: new Date(Date.now() - 120000).toISOString(), type: 'assign' },
  { id: '2', action: 'Claim CLM-2026-00138 approved by checker', performedBy: 'Jane Mwangi', createdAt: new Date(Date.now() - 900000).toISOString(), type: 'approve' },
  { id: '3', action: 'Claim CLM-2026-00139 rejected by maker', performedBy: 'Peter Omondi', createdAt: new Date(Date.now() - 1800000).toISOString(), type: 'reject' },
  { id: '4', action: 'Claim CLM-2026-00135 returned to maker', performedBy: 'Sarah Wambui', createdAt: new Date(Date.now() - 3600000).toISOString(), type: 'return' },
  { id: '5', action: 'Batch BTH-2026-0045 submitted (12 claims)', performedBy: 'Provider Admin', createdAt: new Date(Date.now() - 7200000).toISOString(), type: 'submit' },
  { id: '6', action: 'Claim CLM-2026-00131 EDMS sync completed', performedBy: 'System', createdAt: new Date(Date.now() - 10800000).toISOString(), type: 'edms' },
  { id: '7', action: 'Claim CLM-2026-00128 transferred to eOxegen', performedBy: 'System', createdAt: new Date(Date.now() - 14400000).toISOString(), type: 'eoxegen' },
]

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`
  return `${Math.floor(hrs / 24)} day${Math.floor(hrs / 24) > 1 ? 's' : ''} ago`
}

export default function WorkflowDashboard() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const canManageProviders = user?.role === 'admin' || user?.role === 'supervisor'
  const [stats, setStats] = useState<WorkflowStats | null>(null)
  const [workload, setWorkload] = useState<ReviewerWorkload[]>([])
  const [activity, setActivity] = useState<RecentAction[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchData = async () => {
    const token = localStorage.getItem('token')
    const headers = { Authorization: `Bearer ${token}` }
    try {
      const [statsRes, workloadRes, activityRes] = await Promise.all([
        fetch('/api/workflow/statistics', { headers }),
        fetch('/api/workflow/reviewer-workload', { headers }),
        fetch('/api/activity-logs?limit=10', { headers }),
      ])
      if (statsRes.ok) {
        const raw = await statsRes.json()
        // Backend returns camelCase; normalise to the shape the component expects
        setStats({
          initial_review:  raw.initialReview  ?? raw.initial_review  ?? 0,
          maker_review:    raw.makerReview    ?? raw.maker_review    ?? 0,
          checker_review:  raw.checkerReview  ?? raw.checker_review  ?? 0,
          final_approval:  raw.finalApproval  ?? raw.final_approval  ?? 0,
          completed:       raw.completed      ?? 0,
          total:           raw.total          ?? 0,
          totalValue:      raw.totalValue,
          flagged:         raw.flagged,
        })
      }
      if (workloadRes.ok) {
        const w = await workloadRes.json()
        const list: ReviewerWorkload[] = (Array.isArray(w) ? w : []).map((r: any) => ({
          name:      r.name || r.userName || r.assignedTo || 'Unknown',
          assigned:  r.assigned ?? r._count?.id ?? r.assignedCount ?? 0,
          completed: r.completed ?? r.completedCount ?? 0,
        }))
        setWorkload(list)
      }
      if (activityRes.ok) {
        const data = await activityRes.json()
        const raw: any[] = Array.isArray(data) ? data : Array.isArray(data?.logs) ? data.logs : []
        const deriveType = (action: string = ''): string => {
          const a = action.toLowerCase()
          if (a.includes('approv')) return 'approve'
          if (a.includes('reject')) return 'reject'
          if (a.includes('assign')) return 'assign'
          if (a.includes('return')) return 'return'
          if (a.includes('submit') || a.includes('batch')) return 'submit'
          if (a.includes('edms')) return 'edms'
          if (a.includes('eoxeg') || a.includes('transfer')) return 'eoxegen'
          return 'assign'
        }
        setActivity(raw.slice(0, 10).map((log: any) => ({
          id:          log.id,
          action:      log.action || log.description || '',
          performedBy: log.user?.name || log.username || log.performedBy || 'System',
          createdAt:   log.createdAt,
          type:        deriveType(log.action || log.description),
        })))
      }
    } catch { /* keep empty state */ }
  }

  useEffect(() => {
    fetchData().finally(() => setLoading(false))
  }, [])

  const refresh = async () => {
    setRefreshing(true)
    await fetchData()
    setRefreshing(false)
  }

  const stages = [
    { key: 'initial_review', label: 'Initial Review', icon: Clock, count: stats?.initial_review ?? 0, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950/40' },
    { key: 'maker_review', label: 'Maker Review', icon: UserCheck, count: stats?.maker_review ?? 0, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950/40', action: () => navigate('/workflow/maker') },
    { key: 'checker_review', label: 'Checker Review', icon: UserCog, count: stats?.checker_review ?? 0, color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-950/40', action: () => navigate('/workflow/checker') },
    { key: 'final_approval', label: 'Final Approval', icon: CheckCircle, count: stats?.final_approval ?? 0, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/40' },
    { key: 'completed', label: 'Completed Today', icon: CheckCircle, count: stats?.completed ?? 0, color: 'text-teal-600', bg: 'bg-teal-50 dark:bg-teal-950/40' },
  ]

  const stageData = stages.map(s => ({ stage: s.label.split(' ')[0], claims: s.count }))

  const activityDotColor: Record<string, string> = {
    approve: 'bg-emerald-500', reject: 'bg-red-500', assign: 'bg-blue-500',
    return: 'bg-amber-500', submit: 'bg-violet-500',
    edms: 'bg-sky-500', eoxegen: 'bg-indigo-500',
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Workflow Dashboard</h1>
          <p className="text-muted-foreground">Monitor claims processing pipeline and reviewer workload</p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
          <RefreshCw className={`mr-2 h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Pipeline Stages */}
      <div className="grid gap-3 md:grid-cols-5">
        {stages.map((stage, i) => (
          <Card
            key={stage.key}
            className={`transition-shadow ${stage.action ? 'cursor-pointer hover:shadow-md hover:ring-1 hover:ring-ring' : ''} ${stage.bg}`}
            onClick={stage.action}
          >
            <CardContent className="p-4 text-center">
              <stage.icon className={`mx-auto h-7 w-7 ${stage.color}`} />
              <p className="mt-2 text-3xl font-bold">{loading ? '…' : stage.count}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{stage.label}</p>
              {stage.action && (
                <p className="text-[10px] text-muted-foreground mt-1 flex items-center justify-center gap-0.5">
                  Click to review <ArrowRight className="h-2.5 w-2.5" />
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Summary bar */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <GitBranch className="h-8 w-8 text-blue-500 opacity-75" />
            <div>
              <p className="text-xs text-muted-foreground">Total In Pipeline</p>
              <p className="text-2xl font-bold">{stats?.total ?? 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="h-8 w-8 text-red-500 opacity-75" />
            <div>
              <p className="text-xs text-muted-foreground">Flagged / Fraud Risk</p>
              <p className="text-2xl font-bold text-red-600">{stats?.flagged ?? 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <CheckCircle className="h-8 w-8 text-emerald-500 opacity-75" />
            <div>
              <p className="text-xs text-muted-foreground">Total Pipeline Value</p>
              <p className="text-xl font-bold">{stats?.totalValue ? formatCurrency(stats.totalValue) : '—'}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Stage Distribution Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Pipeline Distribution</CardTitle>
            <CardDescription>Claims at each workflow stage</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={stageData} margin={{ left: 0, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="stage" className="text-xs" />
                <YAxis className="text-xs" />
                <Tooltip
                  contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }}
                />
                <Bar dataKey="claims" fill="hsl(220,70%,50%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Reviewer Workload */}
        <Card>
          <CardHeader>
            <CardTitle>Reviewer Workload</CardTitle>
            <CardDescription>Claims completed vs. assigned per reviewer</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {workload.map((r, i) => (
                <div key={r.name ?? i} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{r.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {r.completed}/{r.assigned}
                      <span className={`ml-2 font-medium ${
                        r.assigned > 0 && (r.completed / r.assigned) >= 0.8 ? 'text-emerald-600' : 'text-amber-600'
                      }`}>
                        {r.assigned > 0 ? `${Math.round((r.completed / r.assigned) * 100)}%` : '—'}
                      </span>
                    </span>
                  </div>
                  <Progress value={r.assigned > 0 ? (r.completed / r.assigned) * 100 : 0} className="h-1.5" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions & Recent Activity */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button variant="outline" className="w-full justify-start" onClick={() => navigate('/workflow/maker')}>
              <UserCheck className="mr-2 h-4 w-4" /> Maker Queue
              <Badge className="ml-auto" variant="secondary">{stats?.maker_review ?? 0}</Badge>
            </Button>
            <Button variant="outline" className="w-full justify-start" onClick={() => navigate('/workflow/checker')}>
              <UserCog className="mr-2 h-4 w-4" /> Checker Queue
              <Badge className="ml-auto" variant="secondary">{stats?.checker_review ?? 0}</Badge>
            </Button>
            {canManageProviders && (
              <Button variant="outline" className="w-full justify-start" onClick={() => navigate('/provider-approvals')}>
                <Users className="mr-2 h-4 w-4" /> Provider Approvals
              </Button>
            )}
            <Button variant="outline" className="w-full justify-start" onClick={() => navigate('/workflow/aging')}>
              <Clock className="mr-2 h-4 w-4" /> Claims Aging
            </Button>
            <Button variant="outline" className="w-full justify-start" onClick={() => navigate('/appeals')}>
              <AlertTriangle className="mr-2 h-4 w-4" /> Appeals Queue
            </Button>
            <Button variant="outline" className="w-full justify-start" onClick={() => navigate('/branches')}>
              <GitBranch className="mr-2 h-4 w-4" /> Branch Network
            </Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Recent Activity</CardTitle>
            <CardDescription>Latest workflow events across all stages</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {activity.map(action => (
                <div key={action.id} className="flex items-start gap-3 rounded-lg p-2 hover:bg-muted/50 transition-colors">
                  <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${activityDotColor[action.type] ?? 'bg-gray-400'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{action.action}</p>
                    <p className="text-xs text-muted-foreground">
                      {action.performedBy ?? 'System'} &middot; {timeAgo(action.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
