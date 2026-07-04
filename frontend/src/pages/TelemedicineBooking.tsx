import { useState, useEffect } from 'react'
import { Video, Calendar, User, Loader2, CheckCircle, Clock } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import api from '@/services/api'
import { useAuthStore } from '@/store/authStore'

interface Session {
  id: string
  memberNumber: string
  adapterName: string
  sessionRef: string
  scheduledAt: string
  status: string
  consultationNote?: string
  claimId?: string
}

const STATUS_COLORS: Record<string, string> = {
  booked: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
}

export default function TelemedicineBooking() {
  const { user } = useAuthStore()
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(false)
  const [booking, setBooking] = useState(false)
  const [joinUrl, setJoinUrl] = useState<string | null>(null)

  const [memberNumber, setMemberNumber] = useState('')
  const [providerId, setProviderId] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [adapter, setAdapter] = useState('mock')

  useEffect(() => {
    loadSessions()
  }, [])

  async function loadSessions() {
    setLoading(true)
    try {
      const res = await api.get('/telemedicine/sessions')
      setSessions(res.data)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  async function book() {
    if (!memberNumber || !scheduledAt) return
    setBooking(true)
    setJoinUrl(null)
    try {
      const res = await api.post('/telemedicine/sessions', {
        memberNumber,
        providerId: providerId || user?.providerId || 'unknown',
        scheduledAt,
        adapter,
      })
      if (res.data.joinUrl) setJoinUrl(res.data.joinUrl)
      await loadSessions()
    } catch (e: any) {
      alert(e?.response?.data?.message ?? 'Booking failed')
    } finally {
      setBooking(false)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Video className="h-6 w-6 text-blue-500" />
        <div>
          <h1 className="text-2xl font-bold">Telemedicine Booking</h1>
          <p className="text-muted-foreground text-sm">Book a virtual consultation session</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Booking form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New Booking</CardTitle>
            <CardDescription>Subject to outpatient benefit eligibility</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Member Number</Label>
              <Input
                value={memberNumber}
                onChange={(e) => setMemberNumber(e.target.value)}
                placeholder="e.g. MEM-001234"
              />
            </div>
            <div>
              <Label>Provider ID</Label>
              <Input
                value={providerId}
                onChange={(e) => setProviderId(e.target.value)}
                placeholder="Leave blank to use your provider"
              />
            </div>
            <div>
              <Label>Scheduled Date & Time</Label>
              <Input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </div>
            <div>
              <Label>Adapter</Label>
              <Select value={adapter} onValueChange={setAdapter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mock">Mock (Test)</SelectItem>
                  <SelectItem value="doctolib">Doctolib</SelectItem>
                  <SelectItem value="teladoc">Teladoc</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full" onClick={book} disabled={booking || !memberNumber || !scheduledAt}>
              {booking ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Booking...</> : 'Book Session'}
            </Button>
            {joinUrl && (
              <div className="flex items-center gap-2 p-3 bg-emerald-50 rounded-lg text-sm">
                <CheckCircle className="h-4 w-4 text-emerald-600" />
                <a href={joinUrl} target="_blank" rel="noreferrer" className="text-emerald-700 underline truncate">
                  {joinUrl}
                </a>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Session list */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Recent Sessions</CardTitle>
              <Button variant="outline" size="sm" onClick={loadSessions} disabled={loading}>
                {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Refresh'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {sessions.length === 0 && !loading && (
              <p className="text-sm text-muted-foreground">No sessions found.</p>
            )}
            {sessions.map((s) => (
              <div key={s.id} className="flex items-start justify-between p-3 border rounded-lg">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{s.memberNumber}</span>
                    <span className="text-xs text-muted-foreground">via {s.adapterName}</span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {new Date(s.scheduledAt).toLocaleString()}
                  </div>
                  {s.claimId && (
                    <div className="text-xs text-blue-600">Claim created: {s.claimId.slice(0, 8)}...</div>
                  )}
                </div>
                <Badge className={STATUS_COLORS[s.status] ?? 'bg-gray-100 text-gray-700'}>
                  {s.status}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
