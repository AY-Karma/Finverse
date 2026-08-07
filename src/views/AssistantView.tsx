import { useState } from 'react'
import type { ChatMessage } from '../types'
import { chat, portfolioContext } from '../providers'
import { useStore } from '../useStore'

export function AssistantView() {
  const { positions, settings } = useStore()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const context = portfolioContext(positions)

  async function send() {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    setError(null)

    const history = [...messages, { role: 'user' as const, content: text }]
    setMessages(history)
    setLoading(true)

    const controller = new AbortController()
    try {
      const reply = await chat({
        provider: settings.provider,
        apiKey: settings.apiKey,
        history: messages,
        context,
        signal: controller.signal,
      })
      setMessages([...history, { role: 'assistant', content: reply }])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div>
        <div className="eyebrow">AI Assistant</div>
        <h1 className="page-title">Ask about your portfolio</h1>
        <p className="hint" style={{ marginTop: 4 }}>
          The assistant sees your uploaded positions. Configure a provider and API key in Settings
          first.
        </p>
      </div>

      {!positions.length && (
        <div className="card" style={{ borderColor: 'var(--hairline-strong)' }}>
          <p className="hint">No portfolio loaded. Import a spreadsheet to give the assistant context.</p>
        </div>
      )}

      <div className="card">
        <div className="chat">
          {messages.length === 0 && (
            <div className="msg msg--assistant">
              Hello. I\u2019m your investment assistant. Ask me about your holdings, allocation, or a
              single position, and I\u2019ll base my answer on the portfolio you\u2019ve uploaded.
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`msg msg--${m.role}`}>{m.content}</div>
          ))}
          {loading && <div className="msg msg--assistant muted">Thinking\u2026</div>}
        </div>

        <div className="chat-input" style={{ marginTop: 16 }}>
          <input
            className="input"
            placeholder="Ask about your investments\u2026"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send()
            }}
          />
          <button className="btn btn--primary" onClick={send} disabled={loading}>
            Send
          </button>
        </div>

        {error && <p className="hint down" style={{ marginTop: 12 }}>{error}</p>}
      </div>
    </>
  )
}