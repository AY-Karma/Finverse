import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatMessage, ChartSpec, Currency, LiveQuote, Position } from '../types'
import { boundChatHistory, chat, MAX_CHAT_MESSAGE_CHARS, portfolioContext, isLocalProvider } from '../providers'
import { renderMessage, extractCharts } from '../format'
import { ChatChart } from '../ChatChart'
import { instrumentLabel } from '../instruments'
import { computePortfolioStats, effectivePrice, positionPnlPct, positionValue, formatCurrency } from '../valuation'
import { useStore, type View } from '../useStore'
import { visibleQuotes } from '../privacy'
import { PortfolioRequiredState } from './PortfolioRequiredState'

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

// Quick mode is a promise: it must come back fast. If the model hasn't answered
// within this window, we abort and hand over the computed snapshot instead.
const QUICK_CAP_MS = 30 * 1000

/** Computed snapshot shown when quick mode hits its 30s cap. */
function quickSummary(
  positions: Position[],
  liveQuotes: Record<string, LiveQuote>,
  currency: Currency,
  usdInrRate?: number | null,
): string {
  if (positions.length === 0) {
    return 'Quick mode hit its 30-second cap, but there are no positions loaded yet — import a sheet and ask again.'
  }
  const stats = computePortfolioStats(positions, liveQuotes)
  const { invested, currentValue: value, pnl, pnlPct } = stats
  const equity = positions.filter((p) => p.type !== 'mutual-fund').length
  const mf = positions.length - equity

  const rows = positions
    .slice(0, 100)
    .map((p) => {
      const price = effectivePrice(p, liveQuotes)
      const v = positionValue(p, liveQuotes)
      const hPnlPct = positionPnlPct(p, liveQuotes)
      const weight = price != null && value > 0 ? (v / value) * 100 : null
      const label = p.type === 'mutual-fund' ? p.name || p.ticker : p.ticker
      return (
        `${label} — ${p.quantity} @ ${formatCurrency(p.buyPrice, currency, usdInrRate)} | last ` +
        `${price != null ? formatCurrency(price, currency, usdInrRate) : 'n/a'} | P&L ` +
        `${hPnlPct != null ? (hPnlPct >= 0 ? '+' : '') + hPnlPct.toFixed(2) + '%' : 'n/a'} | ` +
        `weight ${weight != null ? weight.toFixed(1) + '%' : 'n/a'}`
      )
    })
    .join('\n')

  return [
    'Quick mode hit its 30-second cap, so here is the computed snapshot of your board:',
    `Invested: ${formatCurrency(invested, currency, usdInrRate)} | Current${stats.valuationComplete ? '' : ' (priced subtotal)'}: ${stats.pricedCount > 0 ? formatCurrency(value, currency, usdInrRate) : 'unknown'} | ` +
      `P&L${stats.valuationComplete ? '' : ' (priced holdings only)'}: ${stats.pricedCount > 0 ? `${pnl >= 0 ? '+' : ''}${formatCurrency(pnl, currency, usdInrRate)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)` : 'unknown'}`,
    `Valuation coverage: ${stats.pricedCount}/${positions.length} holdings priced. Missing prices are unknown, not zero.`,
    `Holdings: ${positions.length} (${equity} equity, ${mf} mutual fund${mf === 1 ? '' : 's'})`,
    '',
    rows,
    ...(positions.length > 100 ? [`${positions.length - 100} additional holdings omitted from this summary.`] : []),
  ].join('\n')
}

/** Follow-up chips derived from the current portfolio, so suggestions stay relevant. */
function contextualSuggestions(
  positions: Position[],
  liveQuotes: Record<string, LiveQuote>,
): string[] {
  const valued = positions
    .map((p) => {
      const value = positionValue(p, liveQuotes)
      const pnlPct = positionPnlPct(p, liveQuotes)
      return { p, value, pnlPct }
    })
    .sort((a, b) => b.value - a.value)
  const top = valued[0]
  const worst = [...valued]
    .filter((v) => v.pnlPct != null)
    .sort((a, b) => (a.pnlPct ?? 0) - (b.pnlPct ?? 0))[0]

  const out: string[] = []
  if (top) out.push(`Go deeper on ${instrumentLabel(top.p)}`)
  if (worst && worst.p !== top?.p) out.push(`What is dragging ${instrumentLabel(worst.p)}?`)
  if (positions.some((p) => p.type === 'mutual-fund') && positions.length > 1)
    out.push('Compare my equity vs mutual funds')
  out.push('How concentrated is my portfolio?')
  out.push('Show me my risk exposure')
  out.push('What should I watch this week?')
  return out
}

function loadChat(): { messages: ChatMessage[]; omitted: boolean } {
  try {
    const raw = localStorage.getItem(CHAT_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return { messages: [], omitted: false }
    const valid = parsed
      .filter((message): message is ChatMessage =>
        message && typeof message === 'object' &&
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.content === 'string',
      )
      .slice(-100)
      .map((message) => ({
        role: message.role,
        content: message.content.slice(0, MAX_CHAT_MESSAGE_CHARS),
        charts: sanitizeCharts(message.charts),
        kind: message.kind === 'stopped' || message.kind === 'timeout' || message.kind === 'quick-fallback' ? message.kind : undefined,
      }))
    const messages = boundChatHistory(valid)
    return { messages, omitted: messages.length < parsed.length }
  } catch {
    return { messages: [], omitted: false }
  }
}

function sanitizeCharts(value: unknown): ChartSpec[] | undefined {
  if (!Array.isArray(value)) return undefined
  const charts = value.slice(0, 8).flatMap((candidate): ChartSpec[] => {
    if (!candidate || typeof candidate !== 'object') return []
    const chart = candidate as Record<string, unknown>
    const kind = chart.kind
    if (kind !== 'bar' && kind !== 'pie' && kind !== 'line') return []
    if (!Array.isArray(chart.data)) return []
    const data = chart.data.slice(0, 20).flatMap((row): ChartSpec['data'] => {
      if (!row || typeof row !== 'object') return []
      const item = row as Record<string, unknown>
      return typeof item.label === 'string' && typeof item.value === 'number' && Number.isFinite(item.value)
        ? [{ label: item.label.slice(0, 120), value: item.value }]
        : []
    }).slice(0, 20)
    return data.length > 0 ? [{ kind, title: typeof chart.title === 'string' ? chart.title.slice(0, 160) : undefined, data }] : []
  })
  return charts.slice(0, 8)
}

function persistChat(messages: ChatMessage[]): void {
  try {
    localStorage.setItem(CHAT_KEY, JSON.stringify(boundChatHistory(messages)))
  } catch {
    /* Chat remains available in memory when browser storage is unavailable/full. */
  }
}

export function AssistantView({ onGoTo, onRequestImport, initialDraft = '' }: { onGoTo: (v: View) => void; onRequestImport: () => void; initialDraft?: string }) {
  const { positions, settings, liveQuotes: retainedQuotes, fxRate, quickMode, setQuickMode } = useStore()
  const liveQuotes = useMemo(() => visibleQuotes(settings.allowExternalData, retainedQuotes), [settings.allowExternalData, retainedQuotes])
  const [initialChat] = useState(loadChat)
  const [messages, setMessages] = useState<ChatMessage[]>(initialChat.messages)
  const [historyOmitted, setHistoryOmitted] = useState(initialChat.omitted)
  const [conversationRevealed, setConversationRevealed] = useState(false)
  const conversationHidden = settings.hideValues && !conversationRevealed
  const [input, setInput] = useState(initialDraft)
  const [chips, setChips] = useState<string[]>(QUICK_PROMPTS)
  const [loading, setLoading] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [statusIdx, setStatusIdx] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [warnOpen, setWarnOpen] = useState(false)
  const [escalate, setEscalate] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const chatRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => setConversationRevealed(false), [settings.hideValues])

  function updateMessages(next: ChatMessage[]) {
    const bounded = boundChatHistory(next.map((message) => ({ ...message, charts: sanitizeCharts(message.charts) })))
    if (bounded.length < next.length) setHistoryOmitted(true)
    setMessages(bounded)
    return bounded
  }

  useEffect(() => {
    persistChat(messages)
  }, [messages])

  // Leaving the view only stops network work. Persisted history is cleared by
  // the explicit Clear chat action, so navigation does not erase the conversation.
  useEffect(() => {
    return () => {
      controllerRef.current?.abort()
    }
  }, [])

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

  const context = useMemo(
    () => portfolioContext(positions, settings.currency || 'INR', liveQuotes, fxRate?.usdInr),
    [positions, settings.currency, liveQuotes, fxRate?.usdInr],
  )

  const refillChips = () =>
    setChips((prev) => {
      const fresh = contextualSuggestions(positions, liveQuotes).filter((ch) => !prev.includes(ch))
      return [...prev, ...fresh].slice(0, CHIP_CAP)
    })

  async function sendText(text: string, opts: { quick?: boolean } = {}) {
    const trimmed = text.trim().slice(0, MAX_CHAT_MESSAGE_CHARS)
    const quick = opts.quick ?? quickMode
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

    const history = updateMessages([...messages, { role: 'user' as const, content: trimmed }])
    setLoading(true)

    const controller = new AbortController()
    controllerRef.current = controller

    // Quick mode answers in <=30s; full mode gets a 5-minute generation cap.
    // Either way, if the cap is hit we abort and respond with what we have.
    const timedOut = { current: false }
    const timeoutId = window.setTimeout(() => {
      timedOut.current = true
      controller.abort()
    }, quick ? QUICK_CAP_MS : 5 * 60 * 1000)

    try {
      const { content, charts } = await chat({
        provider: settings.provider,
        apiKey: settings.apiKey,
        model: settings.model || undefined,
        baseUrl: settings.baseUrl || undefined,
        history,
        context,
        positions,
        liveQuotes,
        signal: controller.signal,
        quick,
        confirmRemoteOllama: settings.confirmRemoteOllama,
        allowExternalData: settings.allowExternalData,
      })
      if (controllerRef.current !== controller) return
      updateMessages([...history, { role: 'assistant', content, charts }])
      refillChips()
    } catch (e) {
      if (controllerRef.current !== controller) return
      if (controller.signal.aborted) {
        if (timedOut.current && quick) {
          // 30s cap hit in quick mode: hand over the computed snapshot and
          // offer to continue the request in full mode.
          updateMessages([
            ...history,
            {
              role: 'assistant',
              content: quickSummary(
                positions,
                liveQuotes,
                settings.currency || 'INR',
                fxRate?.usdInr,
              ),
              kind: 'quick-fallback',
            },
          ])
          setEscalate(trimmed)
        } else {
          updateMessages([
            ...history,
            {
              role: 'assistant',
              content: timedOut.current
                ? 'That took too long to generate. Please simplify your prompt or narrow the context — ask about a single holding or one metric — so I can answer more quickly.'
                : 'Generation stopped.',
              kind: timedOut.current ? 'timeout' : 'stopped',
            },
          ])
        }
        setError(null)
      } else {
        setError(e instanceof Error ? e.message : 'Request failed.')
      }
    } finally {
      window.clearTimeout(timeoutId)
      if (controllerRef.current === controller) {
        controllerRef.current = null
        setLoading(false)
      }
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
    controllerRef.current = null
    setLoading(false)
    setMessages([])
    setHistoryOmitted(false)
    setInput('')
    setError(null)
    persistChat([])
  }

  if (positions.length === 0) {
    return (
      <PortfolioRequiredState
        area="04 · Research · AI"
        description="Bring in your holdings so the assistant has real portfolio context to study."
        onImport={onRequestImport}
      />
    )
  }

  return (
    <>
      <div className="page-head enter d0">
        <div>
          <div className="page-eyebrow">04 · Research · AI</div>
          <h1 className="page-title">Ask about your portfolio</h1>
        </div>
        <div className="assistant-head-actions"><button type="button" className="btn btn--ghost btn--small" onClick={() => onGoTo('research')}>← Back to Research</button><p className="page-sub">Your portfolio context goes only to the provider you configure.</p></div>
      </div>

      <div className="panel enter d2">
        <div className="panel-head">
          <div className="panel-head-title-group">
            <span className="panel-title">Conversation</span>
            {quickMode && (
              <span className="quick-badge">
                <span className="quick-badge-dot" aria-hidden="true" />
                Quick
              </span>
            )}
          </div>
          <div className="panel-head-actions">
            {settings.hideValues && !conversationHidden && (
              <button className="btn btn--ghost btn--small" onClick={() => setConversationRevealed(false)}>Hide conversation</button>
            )}
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

        {conversationHidden ? (
          <div className="chat">
            <p className="hint">Conversation hidden. Messages, charts, and prompts may contain portfolio values.</p>
            <button className="btn btn--ghost" onClick={() => setConversationRevealed(true)}>Reveal conversation</button>
            {loading && <button className="btn btn--stop" onClick={stop}>Stop generation</button>}
          </div>
        ) : <>
        {historyOmitted && <p className="hint" role="status">Older messages were omitted to keep the conversation within its size limit.</p>}
        <div className="chat" ref={chatRef}>
          {messages.length === 0 && (
            <div className="msg msg--assistant">
              Coach is live on the board. Feed me a ticker, a scheme, or the whole portfolio — I'll read the spread, flag
              the outliers, and show you where the risk sits. What are we reading first?
            </div>
          )}
          {messages.map((m, i) =>
            m.role === 'assistant' ? (
              m.kind === 'stopped' || m.kind === 'timeout' ? (
                <div key={i} className={`msg msg--assistant msg--${m.kind}`}>
                  <span className="msg-danger-sym" aria-hidden="true">!</span>
                  <span>{m.content}</span>
                </div>
              ) : (
                (() => {
                  const extracted = extractCharts(m.content)
                  const charts = (m.charts ?? []).concat(extracted.charts)
                  return (
                    <Fragment key={i}>
                      <div className="msg msg--assistant">{renderMessage(extracted.text)}</div>
                       {charts.map((c, ci) => <ChatChart key={ci} spec={c} currency={settings.currency || 'INR'} />)}
                    </Fragment>
                  )
                })()
              )
            ) : (
              <div key={i} className="msg msg--user">{m.content}</div>
            ),
          )}
          {loading && (
            <div className="msg msg--assistant coach-working">
              <span className="coach-status">
                {elapsed >= 240 ? 'Running long — consider simplifying the prompt' : status}
              </span>
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

        {initialDraft && <p className="hint">Draft from Research. Review it before sending. Your current portfolio context is included.</p>}
        <div className="chat-input">
            <input
              className="input"
              aria-label="Message to AI provider"
              maxLength={MAX_CHAT_MESSAGE_CHARS}
              placeholder={quickMode ? 'Quick ask…' : 'Ask your coach…'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') send()
              }}
            />
            <button
              className={`btn btn--ghost btn--quick${quickMode ? ' btn--quick--on' : ''}`}
              aria-pressed={quickMode}
              title={quickMode ? 'Quick responses: ON — short answers (Send and suggestions)' : 'Quick responses: OFF — full analysis (Send and suggestions)'}
              disabled={loading}
              onClick={() => setQuickMode(!quickMode)}
            >
              &gt;&gt;
            </button>
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
        </>}
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

      {escalate && (
        <div className="coach-warn coach-escalate" role="alert">
          <div className="coach-warn-card coach-escalate-card">
            <p className="coach-warn-msg coach-escalate-msg">
              Quick mode hit its 30-second cap. Need more info? Switch to full mode and I'll dig deeper into
              your request.
            </p>
            <div className="coach-escalate-actions">
              <button className="btn btn--ghost" onClick={() => setEscalate(null)}>
                Dismiss
              </button>
              <button
                className="btn btn--primary"
                onClick={() => {
                  const q = escalate
                  setEscalate(null)
                  void sendText(q, { quick: false })
                }}
              >
                Full analysis
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
