import { Fragment, useEffect, useRef, useState } from 'react'
import type { ChatMessage, Position } from '../types'
import { chat, portfolioContext, isLocalProvider } from '../providers'
import { renderMessage, extractCharts } from '../format'
import { ChatChart } from '../ChatChart'
import { useStore, type View } from '../useStore'

const CHAT_KEY = 'finverse:chat'

const QUICK_PROMPTS = [
  'Analyze my portfolio',
  'What are my top risks?',
  'How concentrated is my portfolio?',
  'Suggest a rebalancing plan',
  'Which holding should I watch?',
]

const WORKING_PHRASES = [
  'On it as we speak',
  'Crunching the numbers',
  'Reading your board',
  'Running the allocation',
  'Tallying the tape',
  'Cross-checking the ledger',
  'Sizing up the spread',
]

const CHIP_CAP = 6

function labelOf(p: Position): string {
  return p.type === 'mutual-fund' ? p.name || p.ticker : p.ticker
}

/** Follow-up chips derived from the current portfolio, so suggestions stay relevant. */
function contextualSuggestions(positions: Position[]): string[] {
  const valued = positions
    .map((p) => {
      const price = p.lastPrice ?? (p.invested > 0 ? p.buyPrice : null)
      const value = price != null ? price * p.quantity : p.invested
      const pnlPct =
        p.invested > 0 && price != null ? ((value - p.invested) / p.invested) * 100 : null
      return { p, value, pnlPct }
    })
    .sort((a, b) => b.value - a.value)
  const top = valued[0]
  const worst = [...valued]
    .filter((v) => v.pnlPct != null)
    .sort((a, b) => (a.pnlPct ?? 0) - (b.pnlPct ?? 0))[0]

  const out: string[] = []
  if (top) out.push(`Go deeper on ${labelOf(top.p)}`)
  if (worst && worst.p !== top?.p) out.push(`What is dragging ${labelOf(worst.p)}?`)
  if (positions.some((p) => p.type === 'mutual-fund') && positions.length > 1)
    out.push('Compare my equity vs mutual funds')
  out.push('How concentrated is my portfolio?')
  out.push('Show me my risk exposure')
  out.push('What should I watch this week?')
  return out
}

function loadChat(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(CHAT_KEY)
    return raw ? (JSON.parse(raw) as ChatMessage[]) : []
  } catch {
    return []
  }
}

export function AssistantView({ onGoTo }: { onGoTo: (v: View) => void }) {
  const { positions, settings } = useStore()
  const [messages, setMessages] = useState<ChatMessage[]>(loadChat)
  const [input, setInput] = useState('')
  const [chips, setChips] = useState<string[]>(QUICK_PROMPTS)
  const [loading, setLoading] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [statusIdx, setStatusIdx] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [warnOpen, setWarnOpen] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)
  const chatRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    localStorage.setItem(CHAT_KEY, JSON.stringify(messages))
  }, [messages])

  useEffect(() => {
    const el = chatRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, loading])

  useEffect(() => {
    if (!loading) {
      setElapsed(0)
      return
    }
    const id = window.setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [loading])

  useEffect(() => {
    if (!loading) return
    const id = window.setInterval(() => {
      setStatusIdx((i) => (i + 1) % WORKING_PHRASES.length)
    }, 6000)
    return () => window.clearInterval(id)
  }, [loading])

  const status = WORKING_PHRASES[statusIdx]

  const context = portfolioContext(positions, settings.currency || 'INR')

  const refillChips = () =>
    setChips((prev) => {
      const fresh = contextualSuggestions(positions).filter((ch) => !prev.includes(ch))
      return [...prev, ...fresh].slice(0, CHIP_CAP)
    })

  async function sendText(text: string) {
    const trimmed = text.trim()
    const local = settings.provider ? isLocalProvider(settings.provider) : false

    if (!settings.provider || (!local && !settings.apiKey)) {
      setWarnOpen(true)
      return
    }
    if (!trimmed || loading) return
    setInput('')
    setError(null)
    setChips((c) => c.filter((ch) => ch !== trimmed))
    refillChips()

    const history = [...messages, { role: 'user' as const, content: trimmed }]
    setMessages(history)
    setLoading(true)

    const controller = new AbortController()
    controllerRef.current = controller

    try {
      const { content, charts } = await chat({
        provider: settings.provider,
        apiKey: settings.apiKey,
        model: settings.model || undefined,
        baseUrl: settings.baseUrl || undefined,
        history,
        context,
        positions,
        signal: controller.signal,
      })
      setMessages([...history, { role: 'assistant', content, charts }])
      refillChips()
    } catch (e) {
      if (controller.signal.aborted) {
        setMessages([...history, { role: 'assistant', content: 'Generation stopped.' }])
        setError(null)
      } else {
        setError(e instanceof Error ? e.message : 'Request failed.')
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null
      setLoading(false)
    }
  }

  function send() {
    void sendText(input)
  }

  function stop() {
    controllerRef.current?.abort()
  }

  function clearChat() {
    controllerRef.current?.abort()
    setMessages([])
    setInput('')
    setError(null)
    localStorage.setItem(CHAT_KEY, JSON.stringify([]))
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
          <div className="panel-head-actions">
            {messages.length > 0 && (
              <button className="btn btn--ghost btn--small" onClick={clearChat} disabled={loading}>
                Clear chat
              </button>
            )}
            <span className="section-index">
              {settings.provider ? settings.provider : 'no provider'}
            </span>
          </div>
        </div>

        <div className="chat" ref={chatRef}>
          {messages.length === 0 && (
            <div className="msg msg--assistant">
              Coach is live on the board. Feed me a ticker, a scheme, or the whole portfolio — I'll read the spread, flag
              the outliers, and show you where the risk sits. What are we reading first?
            </div>
          )}
          {messages.map((m, i) =>
            m.role === 'assistant' ? (
              (() => {
                const extracted = extractCharts(m.content)
                const charts = (m.charts ?? []).concat(extracted.charts)
                return (
                  <Fragment key={i}>
                    <div className="msg msg--assistant">{renderMessage(extracted.text)}</div>
                    {charts.map((c, ci) => <ChatChart key={ci} spec={c} />)}
                  </Fragment>
                )
              })()
            ) : (
              <div key={i} className="msg msg--user">{m.content}</div>
            ),
          )}
          {loading && (
            <div className="msg msg--assistant coach-working">
              <span className="coach-status">{status}</span>
              <span className="coach-dots" aria-hidden="true">
                <span>.</span><span>.</span><span>.</span>
              </span>
              <span className="coach-timer">{elapsed}s</span>
            </div>
          )}
        </div>

        <div className="quick-prompts">
          {chips.map((q) => (
            <button key={q} className="chip" disabled={loading} onClick={() => void sendText(q)}>
              {q}
            </button>
          ))}
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
          {loading ? (
            <button className="btn btn--stop" onClick={stop}>
              ⏹ Stop
            </button>
          ) : (
            <button className="btn btn--primary" onClick={send}>
              Send
            </button>
          )}
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
