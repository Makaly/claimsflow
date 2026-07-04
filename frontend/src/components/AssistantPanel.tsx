import { useState, useRef, useEffect } from 'react'
import { Send, Bot, User, BookOpen, AlertTriangle, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import api from '@/services/api'

interface Citation {
  source: string
  excerpt: string
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  citations?: Citation[]
  refused?: boolean
}

export function AssistantPanel() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'Hello! I am the ClaimsFlow policy assistant. Ask me anything about SRD policy, circulars, or benefit coverage.',
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function submit() {
    const question = input.trim()
    if (!question || loading) return
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: question }])
    setLoading(true)
    try {
      const res = await api.post('/assistant/query', { question })
      const { answer, citations, refused } = res.data
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: answer, citations, refused },
      ])
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Sorry, an error occurred. Please try again.', refused: false },
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="flex flex-col h-full max-h-[600px]">
      <CardHeader className="border-b pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot className="h-5 w-5 text-blue-500" />
          Policy Assistant (RAG)
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto py-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600'}`}>
              {msg.role === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
            </div>
            <div className={`max-w-[80%] space-y-1 ${msg.role === 'user' ? 'items-end' : ''}`}>
              {msg.refused && (
                <div className="flex items-center gap-1 text-amber-600 text-xs">
                  <AlertTriangle className="h-3 w-3" />
                  <span>Low confidence — could not find relevant policy text</span>
                </div>
              )}
              <div className={`rounded-lg px-3 py-2 text-sm ${msg.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-800'}`}>
                {msg.content}
              </div>
              {msg.citations && msg.citations.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {msg.citations.map((c, j) => (
                    <Badge key={j} variant="outline" className="text-xs flex items-center gap-1">
                      <BookOpen className="h-2.5 w-2.5" />
                      {c.source}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Searching policy corpus...
          </div>
        )}
        <div ref={bottomRef} />
      </CardContent>
      <div className="border-t p-3 flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Ask about coverage, limits, exclusions..."
          disabled={loading}
          className="flex-1"
        />
        <Button onClick={submit} disabled={loading || !input.trim()} size="sm">
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  )
}
