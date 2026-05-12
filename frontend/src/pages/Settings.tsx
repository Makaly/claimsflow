import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Save, Mail, RefreshCw, CheckCircle, AlertTriangle, ExternalLink, ScanSearch } from 'lucide-react'
import DocumentClassifiersTab from '@/components/DocumentClassifiersTab'

export default function Settings() {
  const [searchParams] = useSearchParams()
  const defaultTab = searchParams.get('tab') || 'general'

  // Email ingestion state
  const [emailEnabled, setEmailEnabled] = useState(false)
  const [emailProvider, setEmailProvider] = useState('gmail')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [refreshToken, setRefreshToken] = useState('')
  const [inboxUser, setInboxUser] = useState('')
  const [subjectFilter, setSubjectFilter] = useState('medical claim')
  const [pollInterval, setPollInterval] = useState('5')
  const [oauthStatus, setOauthStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [pollStatus, setPollStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [lastPollResult, setLastPollResult] = useState<string | null>(null)

  const getAuthUrl = async () => {
    setOauthStatus('loading')
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(
        `/api/email-ingestion/oauth/authorize?redirect_uri=${encodeURIComponent(window.location.origin + '/settings')}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      const data = await res.json()
      if (data.authorizationUrl) {
        window.open(data.authorizationUrl, '_blank')
        setOauthStatus('success')
      } else {
        setOauthStatus('error')
      }
    } catch {
      setOauthStatus('error')
    }
  }

  const triggerPoll = async () => {
    setPollStatus('loading')
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/email-ingestion/trigger-poll', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      setLastPollResult(`Processed ${data.processed ?? 0} email(s), found ${data.attachments ?? 0} attachment(s)`)
      setPollStatus('success')
    } catch {
      setLastPollResult('Poll failed — check server logs')
      setPollStatus('error')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">System configuration and preferences</p>
      </div>

      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="workflow">Workflow</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="email-ingestion"><Mail className="mr-1 h-3.5 w-3.5" /> Email Ingestion</TabsTrigger>
          <TabsTrigger value="document-classifiers"><ScanSearch className="mr-1 h-3.5 w-3.5" /> Document Classifiers</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>System Settings</CardTitle>
              <CardDescription>General system configuration</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>System Name</Label>
                  <Input defaultValue="CIC Medical Claims" />
                </div>
                <div className="space-y-2">
                  <Label>Max Batch Size</Label>
                  <Input type="number" defaultValue="100" />
                </div>
                <div className="space-y-2">
                  <Label>Max File Size (MB)</Label>
                  <Input type="number" defaultValue="10" />
                </div>
                <div className="space-y-2">
                  <Label>Default Currency</Label>
                  <Select defaultValue="KES">
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="KES">KES - Kenya Shilling</SelectItem>
                      <SelectItem value="USD">USD - US Dollar</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Separator />
              <div className="space-y-4">
                {[
                  { label: 'Require 2FA for all users', description: 'Force two-factor authentication for all accounts', checked: false },
                  { label: 'Auto-assign claims', description: 'Automatically assign new claims to available officers', checked: true },
                  { label: 'OCR auto-processing', description: 'Automatically start OCR when documents are uploaded', checked: true },
                  { label: 'Maintenance mode', description: 'Show maintenance page to non-admin users', checked: false },
                ].map((setting, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">{setting.label}</p>
                      <p className="text-xs text-muted-foreground">{setting.description}</p>
                    </div>
                    <Switch defaultChecked={setting.checked} />
                  </div>
                ))}
              </div>
              <Button><Save className="mr-2 h-4 w-4" /> Save Settings</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="workflow" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>SLA Configuration</CardTitle>
              <CardDescription>Processing time limits by priority</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2"><Label>Urgent SLA (hours)</Label><Input type="number" defaultValue="4" /></div>
                <div className="space-y-2"><Label>High SLA (hours)</Label><Input type="number" defaultValue="24" /></div>
                <div className="space-y-2"><Label>Normal SLA (hours)</Label><Input type="number" defaultValue="72" /></div>
                <div className="space-y-2"><Label>Low SLA (hours)</Label><Input type="number" defaultValue="168" /></div>
              </div>
              <Separator />
              <div className="space-y-2">
                <Label>Default Assignment Strategy</Label>
                <Select defaultValue="workload">
                  <SelectTrigger className="w-[250px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fifo">FIFO (First In, First Out)</SelectItem>
                    <SelectItem value="workload">Workload Balanced</SelectItem>
                    <SelectItem value="region">Region Based</SelectItem>
                    <SelectItem value="provider">Provider Based</SelectItem>
                    <SelectItem value="random">Random</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button><Save className="mr-2 h-4 w-4" /> Save Workflow Settings</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications">
          <Card>
            <CardHeader>
              <CardTitle>Notification Settings</CardTitle>
              <CardDescription>Configure email and SMS notification parameters</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2"><Label>SMTP Host</Label><Input defaultValue="smtp.cic.co.ke" /></div>
                <div className="space-y-2"><Label>SMTP Port</Label><Input type="number" defaultValue="587" /></div>
                <div className="space-y-2"><Label>From Email</Label><Input defaultValue="claims@cic.co.ke" /></div>
                <div className="space-y-2"><Label>SMS Provider</Label>
                  <Select defaultValue="africastalking">
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="africastalking">Africa's Talking</SelectItem>
                      <SelectItem value="twilio">Twilio</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button><Save className="mr-2 h-4 w-4" /> Save Notification Settings</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integrations">
          <Card>
            <CardHeader>
              <CardTitle>External Integrations</CardTitle>
              <CardDescription>Configure EDMS and eOxegen connections</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2"><Label>EDMS API URL</Label><Input placeholder="https://edms.cic.co.ke/api" /></div>
                <div className="space-y-2"><Label>EDMS API Key</Label><Input type="password" placeholder="Enter API key" /></div>
                <div className="space-y-2"><Label>eOxegen API URL</Label><Input placeholder="https://eoxegen.cic.co.ke/api" /></div>
                <div className="space-y-2"><Label>eOxegen API Key</Label><Input type="password" placeholder="Enter API key" /></div>
              </div>
              <Button><Save className="mr-2 h-4 w-4" /> Save Integration Settings</Button>
            </CardContent>
          </Card>
        </TabsContent>
        {/* ── EMAIL INGESTION ── */}
        <TabsContent value="email-ingestion" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" /> Email Ingestion Configuration
              </CardTitle>
              <CardDescription>
                Configure OAuth 2.0 email ingestion to automatically process claim documents received via email.
                Supports Gmail (Google API) and Outlook (Microsoft Graph).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">

              {/* Enable toggle */}
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="font-medium">Enable Email Ingestion</p>
                  <p className="text-sm text-muted-foreground">
                    Automatically poll inbox every {pollInterval} minutes for PDF attachments from providers
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {emailEnabled && <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">Active</Badge>}
                  <Switch checked={emailEnabled} onCheckedChange={setEmailEnabled} />
                </div>
              </div>

              <Separator />

              {/* Provider selection */}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Email Provider</Label>
                  <Select value={emailProvider} onValueChange={setEmailProvider}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gmail">Gmail (Google Workspace)</SelectItem>
                      <SelectItem value="outlook">Outlook (Microsoft 365)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {emailProvider === 'gmail'
                      ? 'Uses Google Gmail API with OAuth 2.0. Requires a Google Cloud project with Gmail API enabled.'
                      : 'Uses Microsoft Graph API with OAuth 2.0. Requires an Azure AD app registration.'}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Monitored Inbox / User Email</Label>
                  <Input
                    type="email"
                    placeholder="claims@cic.co.ke"
                    value={inboxUser}
                    onChange={e => setInboxUser(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">The email address whose inbox will be polled</p>
                </div>
              </div>

              <Separator />

              {/* OAuth credentials */}
              <div>
                <p className="text-sm font-semibold mb-3">OAuth 2.0 Credentials</p>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>OAuth Client ID</Label>
                    <Input
                      placeholder={emailProvider === 'gmail' ? '123456789.apps.googleusercontent.com' : 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'}
                      value={clientId}
                      onChange={e => setClientId(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>OAuth Client Secret</Label>
                    <Input
                      type="password"
                      placeholder="Enter client secret"
                      value={clientSecret}
                      onChange={e => setClientSecret(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>OAuth Refresh Token</Label>
                    <Input
                      type="password"
                      placeholder="Long-lived refresh token (obtained via OAuth flow below)"
                      value={refreshToken}
                      onChange={e => setRefreshToken(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      The refresh token is used to obtain access tokens automatically. Use the OAuth flow below to generate one.
                    </p>
                  </div>
                </div>
              </div>

              {/* OAuth setup flow */}
              <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                <p className="text-sm font-semibold flex items-center gap-2">
                  <ExternalLink className="h-4 w-4" /> OAuth Setup Wizard
                </p>
                <p className="text-xs text-muted-foreground">
                  1. Ensure your Client ID and Secret are saved above. <br />
                  2. Click "Open Authorization URL" — this opens the {emailProvider === 'gmail' ? 'Google' : 'Microsoft'} consent screen in a new tab. <br />
                  3. Authorize the app to access the inbox. <br />
                  4. Copy the authorization code from the redirect URL and exchange it for tokens below.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={getAuthUrl}
                    disabled={oauthStatus === 'loading' || !clientId}
                    className="gap-2"
                  >
                    {oauthStatus === 'loading'
                      ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      : <ExternalLink className="h-3.5 w-3.5" />
                    }
                    Open Authorization URL
                  </Button>
                  {oauthStatus === 'success' && (
                    <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 self-center">
                      <CheckCircle className="mr-1 h-3 w-3" /> URL opened
                    </Badge>
                  )}
                  {oauthStatus === 'error' && (
                    <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 self-center">
                      <AlertTriangle className="mr-1 h-3 w-3" /> Failed — check credentials
                    </Badge>
                  )}
                </div>
              </div>

              <Separator />

              {/* Filtering options */}
              <div>
                <p className="text-sm font-semibold mb-3">Filtering &amp; Polling Options</p>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Subject Filter (keyword)</Label>
                    <Input
                      placeholder="e.g. medical claim, invoice, CIC"
                      value={subjectFilter}
                      onChange={e => setSubjectFilter(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Only process emails whose subject contains this keyword (case-insensitive)</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Poll Interval (minutes)</Label>
                    <Select value={pollInterval} onValueChange={setPollInterval}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">Every 1 minute</SelectItem>
                        <SelectItem value="5">Every 5 minutes</SelectItem>
                        <SelectItem value="10">Every 10 minutes</SelectItem>
                        <SelectItem value="30">Every 30 minutes</SelectItem>
                        <SelectItem value="60">Every hour</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Manual poll */}
              <div className="flex items-center gap-4">
                <Button
                  onClick={triggerPoll}
                  disabled={pollStatus === 'loading' || !emailEnabled}
                  variant="outline"
                  className="gap-2"
                >
                  {pollStatus === 'loading'
                    ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    : <RefreshCw className="h-3.5 w-3.5" />
                  }
                  Trigger Manual Poll
                </Button>
                {lastPollResult && (
                  <p className={`text-sm ${pollStatus === 'error' ? 'text-red-600' : 'text-muted-foreground'}`}>
                    {lastPollResult}
                  </p>
                )}
              </div>

              <Button className="gap-2">
                <Save className="h-4 w-4" /> Save Email Ingestion Settings
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── DOCUMENT CLASSIFIERS ── */}
        <TabsContent value="document-classifiers" className="space-y-6">
          <DocumentClassifiersTab />
        </TabsContent>

      </Tabs>
    </div>
  )
}
