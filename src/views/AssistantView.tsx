import { useState } from 'react'
import type { ChatMessage } from '../types'
import { chat, portfolioContext, isLocalProvider } from '../providers'
import { useStore, type View } from '../useStore'

export function AssistantView({ onGoTo }: { onGoTo: (v: View) => void }) {
  const { positions, settings } = useStore()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warnOpen, setWarnOpen] = useState(false)

  const context = portfolioContext(positions)

  async function send() {
    const text = input.trim()
    const local = settings.provider ? isLocalProvider(settings.provider) : false

    if (!settings.provider || (!local && !settings.apiKey)) {
      setWarnOpen(true)
      return
    }
    if (!text || loading) return
    setInput('')
    setError(null)

    const history = [...messages, { role: 'user' as const, content: text }]
    setMessages(history)
    setLoading(true)

    try {
      const reply = await chat({
        provider: settings.provider,
        apiKey: settings.apiKey,
        model: settings.model || undefined,
        baseUrl: settings.baseUrl || undefined,
        history,
        context,
        signal: new AbortController().signal,
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
      <div className="page-head enter d0">
        <div>
          <div className="page-eyebrow">03 · AI Assistant</div>
          <h1 className="page-title">Call the coach</h1>
        </div>
        <p className="page-sub">
          The assistant reads your board and the portfolio you uploaded. Ask about a single holding or
          the whole lineup.
        </p>
      </div>

      {positions.length === 0 && (
        <div className="panel enter d1">
          <p className="hint">
            No positions loaded — the coach has nothing to study yet. Import a sheet first.
          </p>
        </div>
      )}

      <div className="panel enter d2">
        <div className="panel-head">
          <span className="panel-title">Conversation</span>
          <span className="section-index">
            {settings.provider ? settings.provider : 'no provider'}
          </span>
        </div>

        <div className="chat">
          {messages.length === 0 && (
            <div className="msg msg--assistant">
              Coach on deck. Ask about allocation, a single stock / ETF / mutual fund, or how your
              portfolio is spread across the field.
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`msg msg--${m.role}`}>{m.content}</div>
          ))}
          {loading && <div className="msg msg--assistant">Studying the tape…</div>}
        </div>

        <div className="chat-input">
          <input
            className="input"
            placeholder="Ask your coach…"
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

      {warnOpen && (
        <div className="coach-warn" role="alert">
          <div className="coach-warn-card">
            <p className="coach-warn-msg">
              Looks like your Coach isn't wired up - Get him on board!
            </p>
            <button className="btn btn--primary" onClick={() => { setWarnOpen(false); onGoTo('settings') }}>
              Set up Provider
            </button>
          </div>
        </div>
      )}
    </>
  )
}