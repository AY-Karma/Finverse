import type { ChartSpec, Position, ProviderId, Currency, LiveQuote } from './types'
import { fetchYahooPrice, livePriceOf } from './live'

export interface Provider {
  id: ProviderId
  name: string
  endpoint: string
  model: string
}

export const PROVIDERS: Provider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
  },
  {
    id: 'anthropic',
    name: 'Claude',
    endpoint: 'https://api.anthropic.com/v1/messages',
    model: 'claude-3-5-sonnet-latest',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter (OpenCode)',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'openai/gpt-4o-mini',
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    endpoint: 'http://localhost:11434/v1/chat/completions',
    model: 'qwen2.5:7b',
  },
]

export function isLocalProvider(id: string): boolean {
  return id === 'ollama'
}

/** Accept a base URL with or without the /v1/chat/completions suffix. */
function normalizeEndpoint(base: string | undefined, fallback: string): string {
  if (!base) return fallback
  const clean = base.trim().replace(/\/+$/, '')
  if (!clean) return fallback
  if (clean.endsWith('/chat/completions')) return clean
  return `${clean.replace(/\/v1$/, '')}/v1/chat/completions`
}

export function getProvider(id: string): Provider | undefined {
  return PROVIDERS.find((p) => p.id === id)
}

const SYSTEM_PROMPT = `You are Finverse, a personal investment coach. You analyze the user's uploaded portfolio.

IMPORTANT: The user's current portfolio is ALWAYS provided to you in your system context (a "Portfolio Digest"). Never ask the user to upload or share their portfolio details — use the digest and tools directly.

Analysis procedure:
1. Start from the totals (invested, current value, P&L, P&L %) and state them up front.
2. Concentration check: if the single largest holding is more than ~30% of the portfolio, call it out.
3. Diversification check: equity vs mutual-fund split, and how many positions drive most of the value.
4. Outliers: flag the best and worst performers and whether overall P&L is dominated by one position.
5. Suggest concrete rebalancing ideas, but never invent prices or returns not present in the data.

Grounding in real data:
- When the user asks about current prices, call get_quote — it returns live crypto prices AND live stock quotes
  (Indian NSE tickers default to .NS). Use the returned numbers; never guess a price yourself.
- Use portfolio_metrics for per-holding numbers instead of doing arithmetic yourself.
- Prefer showing real numbers from the tools/context over estimates. If data is unavailable, say so plainly.

Charts (make them appear — this is important):
- Whenever a comparison or breakdown would help (e.g. comparing holdings, allocation mix, P&L by position),
  emit a chart. If your provider supports tool calls, call render_chart (kind bar|pie|line, data {label,value}).
  If you are not sure tool calls work, ALSO append a chart block to your reply text:
  [chart]
  {"kind":"bar","title":"Holdings comparison","data":[{"label":"RELIANCE","value":13000},{"label":"TCS","value":12500}]}
  [/chart]
  kind is "bar" (comparisons), "pie" (share of whole) or "line" (trends). Use numbers you already have from the
  context or tools — never invent data. The block MUST be valid JSON, exactly as shown: keys are kind/title/data,
  every data row uses "value" (not "volume" or "pct"), no trailing commas, no extra text inside the block.
  Malformed blocks will not render as charts. Then write a short text summary around the chart.

Style:
- Be concise and structured; prefer short bullet points over paragraphs.
- Use plain text emphasis (brackets like [biggest holding] or CAPS) — do NOT use markdown # or ** symbols.
- For any number where direction matters (a gain vs a loss), wrap it in backticks AND include the explicit sign,
  e.g. \`+4.2%\` or \`-9.1%\`. The app colors + as green and - as red, so the sign must match the meaning in
  your sentence. Never rely on surrounding context to imply the sign of a number.
- If a position is unknown, say so rather than guessing.
- Always end substantive responses with: "This is informational, not financial advice."`

// ---- Tool definitions (OpenAI-compatible) ---------------------------------
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_quote',
      description:
        'Fetch a live market quote. Crypto symbols (BTC, ETH, SOL, ...) return real-time prices. Stock symbols return live quotes (Indian NSE tickers resolve automatically, e.g. RELIANCE -> RELIANCE.NS; use suffix for others like AAPL -> AAPL).',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Ticker symbol, e.g. BTC, ETH, RELIANCE, TCS, AAPL' },
        },
        required: ['symbol'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'portfolio_metrics',
      description:
        'Get computed metrics for one holding from the uploaded portfolio: current value, P&L %, weight in the portfolio, and XIRR (if present). Use this instead of hand-calculating.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Holding ticker or scheme name from the uploaded portfolio' },
        },
        required: ['symbol'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'render_chart',
      description:
        'Render a chart card in the chat for a comparison or breakdown. kind is bar, pie, or line; data is an array of {label, value} rows using numbers you already have. The app renders it visually.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['bar', 'pie', 'line'], description: 'Chart type' },
          title: { type: 'string', description: 'Short chart heading' },
          data: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: 'Item name' },
                value: { type: 'number', description: 'Numeric value' },
              },
              required: ['label', 'value'],
            },
            description: 'Data rows for the chart',
          },
        },
        required: ['kind', 'data'],
      },
    },
  },
]

const ANTHROPIC_TOOLS = TOOLS.map((t) => ({
  name: t.function.name,
  description: t.function.description,
  input_schema: t.function.parameters,
}))

const MAX_TOOL_ROUNDS = 5
const MAX_TOKENS = 2048

// Quick-response mode ("&gt;&gt;" button): a single short generation with no
// tool loop, so it returns in seconds instead of running the full pipeline.
const QUICK_MAX_TOKENS = 320
const QUICK_INSTRUCTION =
  'Answer in 1-3 short bullet points, no charts, no tool calls, under 60 words. Skip the preamble; just answer directly.'

// ---- Portfolio digest (#3) ------------------------------------------------
/** Pre-computed portfolio digest so weak models don't have to do arithmetic. */
export function portfolioContext(
  positions: Position[],
  currency: Currency = 'INR',
  liveQuotes: Record<string, LiveQuote> = {},
): string {
  if (positions.length === 0) return 'The user has no uploaded positions yet.'

  const invested = positions.reduce((s, p) => s + p.invested, 0)
  const totalValue = positions.reduce(
    (s, p) => s + (livePriceOf(p, liveQuotes) ?? 0) * p.quantity,
    0,
  )
  const pnl = totalValue - invested
  const pnlPct = invested > 0 ? (pnl / invested) * 100 : null

  const equity = positions.filter((p) => p.type !== 'mutual-fund').length
  const mf = positions.length - equity

  const byTicker = new Map<string, { value: number; type: Position['type'] }>()
  for (const p of positions) {
    const v = (livePriceOf(p, liveQuotes) ?? 0) * p.quantity
    const prev = byTicker.get(p.ticker)
    if (prev) prev.value += v
    else byTicker.set(p.ticker, { value: v, type: p.type })
  }
  const topAlloc = Array.from(byTicker.entries())
    .map(([symbol, { value, type }]) => ({ symbol, value, type }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5)
    .map(
      (a) =>
        `${a.symbol} ${totalValue > 0 ? ((a.value / totalValue) * 100).toFixed(1) : 0}%`,
    )
    .join(', ')

  const lines: string[] = []
  lines.push('=== Portfolio Digest ===')
  lines.push(`Invested: ${fmtMoney(invested, currency)}`)
  lines.push(`Current value: ${fmtMoney(totalValue, currency)}`)
  lines.push(`Unrealized P&L: ${fmtMoney(pnl, currency)}${pnlPct != null ? ` (${pnlPct.toFixed(2)}%)` : ''}`)
  lines.push(`Holdings: ${positions.length} (${equity} equity, ${mf} mutual fund${mf === 1 ? '' : 's'})`)
  lines.push(`Top allocations: ${topAlloc || 'none'}`)
  lines.push('')
  lines.push('=== Positions (per holding) ===')

  for (const p of positions) {
    const price = livePriceOf(p, liveQuotes)
    const value = price != null ? price * p.quantity : p.invested
    const pnlH = price != null ? value - p.invested : null
    const pnlPctH = p.invested > 0 && pnlH != null ? (pnlH / p.invested) * 100 : null
    const weight = totalValue > 0 ? ((value / totalValue) * 100).toFixed(1) : '0'
    const xirr = p.xirr != null ? p.xirr.toFixed(2) + '%' : 'n/a'
    const sym = p.type === 'mutual-fund' ? p.name || p.ticker : p.ticker
    lines.push(
      `${sym} | ${p.type} | qty=${p.quantity} | buy=${fmtMoney(p.buyPrice, currency)} | ` +
        `last=${price != null ? fmtMoney(price, currency) : 'n/a'} | value=${fmtMoney(value, currency)} | ` +
        `pnl=${pnlPctH != null ? pnlPctH.toFixed(2) + '%' : 'n/a'} | weight=${weight}% | xirr=${xirr}`,
    )
  }

  return lines.join('\n')
}

function fmtMoney(n: number, currency: Currency): string {
  const s = new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
  return n < 0 ? s.replace('-', '\u2212') : s
}

// ---- Tools execution ------------------------------------------------------
async function executeTool(
  name: string,
  args: Record<string, unknown>,
  positions: Position[],
  charts: ChartSpec[],
  liveQuotes: Record<string, LiveQuote> = {},
): Promise<string> {
  try {
    switch (name) {
      case 'get_quote':
        return await getQuote(String(args.symbol ?? ''))
      case 'portfolio_metrics':
        return portfolioMetrics(String(args.symbol ?? ''), positions, liveQuotes)
      case 'render_chart':
        return renderChart(args, charts)
      default:
        return `Unknown tool: ${name}`
    }
  } catch (e) {
    return `Tool error: ${e instanceof Error ? e.message : String(e)}`
  }
}

function renderChart(args: Record<string, unknown>, charts: ChartSpec[]): string {
  const kind = args.kind
  if (kind !== 'bar' && kind !== 'pie' && kind !== 'line') return 'render_chart: kind must be bar, pie or line.'
  if (!Array.isArray(args.data)) return 'render_chart: data must be an array of {label, value}.'
  const data: ChartSpec['data'] = []
  for (const row of args.data) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const label = String(r.label ?? '')
    const value = Number(r.value)
    if (!label || !Number.isFinite(value)) continue
    data.push({ label, value })
  }
  if (data.length === 0) return 'render_chart: no valid data rows.'
  charts.push({ kind, title: args.title ? String(args.title) : undefined, data })
  return `Chart "${args.title ?? kind}" queued for rendering (${data.length} points).`
}

const CRYPTO_IDS: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  BNB: 'binancecoin',
  XRP: 'ripple',
  ADA: 'cardano',
  DOGE: 'dogecoin',
  DOT: 'polkadot',
  MATIC: 'polygon-ecosystem-token',
  LTC: 'litecoin',
  AVAX: 'avalanche-2',
  SHIB: 'shiba-inu',
  LINK: 'chainlink',
  TON: 'the-open-network',
  USDT: 'tether',
  USDC: 'usd-coin',
}

/** Live quote — crypto via CoinGecko, stocks via Yahoo Finance through a CORS proxy. */
async function getQuote(symbol: string): Promise<string> {
  const sym = symbol.trim().toUpperCase()
  if (!sym) return 'No symbol provided.'
  const id = CRYPTO_IDS[sym]
  if (id) {
    try {
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd,inr`,
        { signal: AbortSignal.timeout(8000) },
      )
      if (!res.ok) return `Live quote for ${sym}: unavailable (HTTP ${res.status}).`
      const data = (await res.json()) as Record<string, { usd?: number; inr?: number }>
      const p = data[id]
      if (!p) return `Live quote for ${sym}: not found.`
      const inr = p.inr != null ? ` / ₹${p.inr.toLocaleString('en-IN')}` : ''
      return `LIVE quote ${sym}: ${p.usd ?? 'n/a'} USD${inr}.`
    } catch {
      return `Live quote for ${sym}: unavailable (network error). Use the sheet prices in the portfolio context.`
    }
  }

  const yahoo = await yahooQuote(sym)
  if (yahoo) return yahoo
  return `Live quote for ${sym}: unavailable right now. Use the lastPrice/sheet values in the portfolio context.`
}

async function yahooQuote(symbol: string): Promise<string | null> {
  const withSuffix = symbol.includes('.') ? symbol : `${symbol}.NS`
  const q = await fetchYahooPrice(withSuffix)
  if (!q) return null
  const signed = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}`
  return `LIVE quote ${symbol} (${withSuffix}): ${q.price.toFixed(2)} INR today; change ${q.change != null ? signed(q.change) : 'n/a'} (${q.pct != null ? signed(q.pct) + '%' : 'n/a'}).`
}

function portfolioMetrics(
  symbol: string,
  positions: Position[],
  liveQuotes: Record<string, LiveQuote> = {},
): string {
  const sym = symbol.trim().toLowerCase()
  const p = positions.find((x) => (x.name || x.ticker).toLowerCase() === sym)
  if (!p) return `No holding matching "${symbol}" in the uploaded portfolio.`
  const price = livePriceOf(p, liveQuotes)
  const value = price != null ? price * p.quantity : p.invested
  const pnlH = price != null ? value - p.invested : null
  const pnlPctH = p.invested > 0 && pnlH != null ? (pnlH / p.invested) * 100 : null
  const total = positions.reduce((s, x) => s + (livePriceOf(x, liveQuotes) ?? 0) * x.quantity, 0)
  const weight = total > 0 ? (value / total) * 100 : null
  const label = p.type === 'mutual-fund' ? p.name || p.ticker : p.ticker
  return [
    `Metrics for ${label}:`,
    `  value=${value.toFixed(2)}`,
    `  invested=${p.invested.toFixed(2)}`,
    `  pnl=${pnlH != null ? pnlH.toFixed(2) : 'n/a'}`,
    `  pnlPct=${pnlPctH != null ? pnlPctH.toFixed(2) + '%' : 'n/a'}`,
    `  weightInPortfolio=${weight != null ? weight.toFixed(1) + '%' : 'n/a'}`,
    `  xirr=${p.xirr != null ? p.xirr.toFixed(2) + '%' : 'n/a'}`,
  ].join('\n')
}

function safeParse(input: string | undefined): Record<string, unknown> {
  if (!input) return {}
  try {
    const v = JSON.parse(input)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

// ---- Chat (#4 + #6) -------------------------------------------------------
export async function chat({
  provider,
  apiKey,
  model,
  baseUrl,
  history,
  context,
  positions,
  liveQuotes,
  signal,
  quick,
}: {
  provider: string
  apiKey: string
  model?: string
  baseUrl?: string
  history: { role: 'user' | 'assistant'; content: string }[]
  context: string
  positions: Position[]
  liveQuotes: Record<string, LiveQuote>
  signal: AbortSignal
  quick?: boolean
}): Promise<{ content: string; charts: ChartSpec[] }> {
  const p = getProvider(provider)
  if (!p) throw new Error('Unknown provider selected.')
  const usedModel = model || p.model
  const userHistory = history.map((m) => ({ role: m.role, content: m.content }))
  const charts: ChartSpec[] = []

  if (provider === 'anthropic') {
    return anthropicChat({ apiKey, model: usedModel, userHistory, context, positions, liveQuotes, signal, charts, quick })
  }

  if (isLocalProvider(provider)) {
    return openaiCompat({
      endpoint: normalizeEndpoint(baseUrl, p.endpoint),
      apiKey: '',
      model: usedModel,
      userHistory,
      context,
      positions,
      liveQuotes,
      signal,
      charts,
      quick,
    })
  }

  if (!apiKey) throw new Error('Add an API key in Settings before chatting.')
  return openaiCompat({ endpoint: p.endpoint, apiKey, model: usedModel, userHistory, context, positions, liveQuotes, signal, charts, quick })
}

/**
 * Some models (especially small local ones) down-weight or ignore the system role,
 * which made the very first turn miss the portfolio. To guarantee the holdings reach
 * the model on turn one, fold the digest into the first user message as well.
 */
function withFirstTurnContext(
  history: { role: 'user' | 'assistant'; content: string }[],
  context: string,
): { role: 'user' | 'assistant'; content: string }[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = []
  let injected = false
  for (const m of history) {
    if (!injected && m.role === 'user') {
      out.push({
        role: 'user',
        content: `[Portfolio on file — use these numbers in your answer, never ask the user to share their holdings again]\n\n${context}\n\nMy question: ${m.content}`,
      })
      injected = true
    } else {
      out.push(m)
    }
  }
  if (!injected) {
    out.push({
      role: 'user',
      content: `[Portfolio on file — use these numbers in your answer]\n\n${context}\n\nProceed with the analysis.`,
    })
  }
  return out
}

async function openaiCompat({
  endpoint,
  apiKey,
  model,
  userHistory,
  context,
  positions,
  liveQuotes,
  signal,
  charts,
  quick,
}: {
  endpoint: string
  apiKey: string
  model: string
  userHistory: { role: 'user' | 'assistant'; content: string }[]
  context: string
  positions: Position[]
  liveQuotes: Record<string, LiveQuote>
  signal: AbortSignal
  charts: ChartSpec[]
  quick?: boolean
}): Promise<{ content: string; charts: ChartSpec[] }> {
  const messages: unknown[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: context },
    ...withFirstTurnContext(userHistory, context),
  ]

  const call = async (useTools: boolean) => {
    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: quick ? QUICK_MAX_TOKENS : MAX_TOKENS,
      stream: false,
    }
    if (useTools && !quick) body.tools = TOOLS
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (apiKey) headers.authorization = `Bearer ${apiKey}`
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    })
    if (!res.ok) throw new Error(`API error: ${res.status}`)
    return (await res.json()) as {
      choices?: { message?: { content?: string | null; tool_calls?: unknown[] } }[]
    }
  }

  const finish = (content: string) => ({ content, charts })

  if (quick) {
    const last = messages[messages.length - 1] as { role?: string; content?: string } | undefined
    if (last && last.role === 'user') {
      last.content = `[QUICK ANSWER MODE — ${QUICK_INSTRUCTION}]\n\n${last.content}`
    }
    const data = await call(false)
    return finish(data.choices?.[0]?.message?.content ?? '')
  }

  let useTools = true
  try {
    for (let i = 0; i < MAX_TOOL_ROUNDS; i++) {
      const data = await call(useTools)
      const msg = data.choices?.[0]?.message
      const toolCalls = (msg?.tool_calls ?? []) as {
        id?: string
        function?: { name?: string; arguments?: string }
      }[]
      if (!msg?.tool_calls || toolCalls.length === 0) {
        return finish(msg?.content ?? '')
      }
      messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: toolCalls })
      for (const tc of toolCalls) {
        const result = await executeTool(tc.function?.name ?? '', safeParse(tc.function?.arguments), positions, charts, liveQuotes)
        messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
      }
    }
    return finish('I ran out of steps to finish. Ask me a smaller question.')
  } catch (e) {
    // Some models/endpoints reject tool schemas — retry once without them.
    if (useTools) {
      useTools = false
      try {
        const data = await call(false)
        return finish(data.choices?.[0]?.message?.content ?? '')
      } catch {
        throw e
      }
    }
    throw e
  }
}

async function anthropicChat({
  apiKey,
  model,
  userHistory,
  context,
  positions,
  liveQuotes,
  signal,
  charts,
  quick,
}: {
  apiKey: string
  model: string
  userHistory: { role: 'user' | 'assistant'; content: string }[]
  context: string
  positions: Position[]
  liveQuotes: Record<string, LiveQuote>
  signal: AbortSignal
  charts: ChartSpec[]
  quick?: boolean
}): Promise<{ content: string; charts: ChartSpec[] }> {
  const messages: unknown[] = [...withFirstTurnContext(userHistory, context)]

  const call = async (useTools: boolean) => {
    const body: Record<string, unknown> = {
      model,
      max_tokens: quick ? QUICK_MAX_TOKENS : MAX_TOKENS,
      system: [SYSTEM_PROMPT, context],
      messages,
    }
    if (useTools && !quick) body.tools = ANTHROPIC_TOOLS
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal,
    })
    if (!res.ok) throw new Error(`Claude error: ${res.status}`)
    return (await res.json()) as {
      stop_reason?: string | null
      content?: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[]
    }
  }

  const finish = (content: string) => ({ content, charts })

  if (quick) {
    const last = messages[messages.length - 1] as { role?: string; content?: string } | undefined
    if (last && last.role === 'user') {
      last.content = `[QUICK ANSWER MODE — ${QUICK_INSTRUCTION}]\n\n${last.content}`
    }
    const data = await call(false)
    return finish((data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join(''))
  }

  let useTools = true
  try {
    for (let i = 0; i < MAX_TOOL_ROUNDS; i++) {
      const data = await call(useTools)
      const blocks = data.content ?? []
      if (data.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: blocks })
        const results = []
        for (const b of blocks) {
          if (b.type === 'tool_use') {
            results.push({ type: 'tool_result', tool_use_id: b.id, content: await executeTool(b.name ?? '', b.input ?? {}, positions, charts, liveQuotes) })
          }
        }
        messages.push({ role: 'user', content: results })
        continue
      }
      return finish(blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join(''))
    }
    return finish('I ran out of steps to finish. Ask me a smaller question.')
  } catch (e) {
    if (useTools) {
      useTools = false
      try {
        const data = await call(false)
        return finish((data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join(''))
      } catch {
        throw e
      }
    }
    throw e
  }
}
