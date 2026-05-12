import { useState, useEffect } from 'react'
import { Settings, Save, RefreshCw, CheckCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import api from '@/services/api'

const CATEGORIES: Record<string, { label: string; color: string }> = {
  sla:         { label: 'SLA Thresholds', color: 'bg-blue-50 border-blue-200' },
  fraud:       { label: 'Fraud Detection', color: 'bg-red-50 border-red-200' },
  compliance:  { label: 'Compliance & Retention', color: 'bg-purple-50 border-purple-200' },
  submissions: { label: 'Submission Limits', color: 'bg-amber-50 border-amber-200' },
  workflow:    { label: 'Workflow', color: 'bg-green-50 border-green-200' },
}

export default function SystemConfigPage() {
  const [configs, setConfigs] = useState<any[]>([])
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    try {
      const [existingRes, defaultsRes] = await Promise.all([
        api.get('/system-config'),
        api.get('/system-config/defaults'),
      ])
      const existing: any[] = existingRes.data || []
      const defaults: any[] = defaultsRes.data || []

      const merged = defaults.map(d => {
        const found = existing.find((e: any) => e.key === d.key)
        return found || d
      })
      // Also include any custom configs not in defaults
      for (const e of existing) {
        if (!merged.find(m => m.key === e.key)) merged.push(e)
      }
      setConfigs(merged)
      const initialEdits: Record<string, string> = {}
      merged.forEach(c => { initialEdits[c.key] = c.value })
      setEdits(initialEdits)
    } finally {
      setLoading(false)
    }
  }

  const save = async () => {
    setSaving(true)
    setSaved(false)
    try {
      const configsToSave = configs.map(c => ({
        key: c.key,
        value: edits[c.key] ?? c.value,
        description: c.description,
        category: c.category,
      }))
      await api.put('/system-config', { configs: configsToSave })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      load()
    } catch (e: any) {
      alert(e.response?.data?.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const byCategory = configs.reduce<Record<string, any[]>>((acc, c) => {
    const cat = c.category || 'general'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(c)
    return acc
  }, {})

  const hasChanges = configs.some(c => edits[c.key] !== c.value)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Settings className="h-6 w-6 text-blue-600" /> System Configuration</h1>
          <p className="text-gray-500 text-sm mt-1">Configure SLA thresholds, fraud detection sensitivity, and compliance settings</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Reset
          </Button>
          <Button size="sm" onClick={save} disabled={saving || !hasChanges} className={saved ? 'bg-green-600 hover:bg-green-700' : ''}>
            {saved ? <CheckCircle className="h-4 w-4 mr-1" /> : <Save className="h-4 w-4 mr-1" />}
            {saved ? 'Saved!' : saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </div>

      {Object.entries(byCategory).map(([cat, catConfigs]) => {
        const meta = CATEGORIES[cat] || { label: cat, color: 'bg-gray-50 border-gray-200' }
        return (
          <Card key={cat} className={`border ${meta.color}`}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{meta.label}</CardTitle>
              <CardDescription className="text-xs">Changes apply on the next scheduled run of background jobs</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {catConfigs.map(c => (
                <div key={c.key} className="grid grid-cols-[1fr_200px] gap-4 items-start">
                  <div>
                    <Label className="text-sm font-medium font-mono">{c.key}</Label>
                    {c.description && <p className="text-xs text-gray-500 mt-0.5">{c.description}</p>}
                  </div>
                  <div className="space-y-1">
                    <Input
                      value={edits[c.key] ?? c.value ?? ''}
                      onChange={e => setEdits(prev => ({ ...prev, [c.key]: e.target.value }))}
                      className={`h-8 text-sm font-mono ${edits[c.key] !== c.value ? 'border-amber-400 bg-amber-50' : ''}`}
                    />
                    {edits[c.key] !== c.value && (
                      <p className="text-xs text-amber-600">Changed (original: {c.value})</p>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )
      })}

      {configs.length === 0 && !loading && (
        <div className="text-center py-12 text-gray-400">No configuration found. Click Refresh to load defaults.</div>
      )}
    </div>
  )
}
