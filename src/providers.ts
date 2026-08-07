import type { Position, ProviderId } from './types'

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
]

export function getProvider(id: string): Provider | undefined {
  return PROVIDERS.find((p) => p.id === id)
}

const SYSTEM_PROMPT = `You are Finverse, a personal investment assistant. You help users understand
their portfolio and individual holdings. You only know about the positions the user has uploaded.

Guidelines:
- Be concise and concrete. Prefer structured points over paragraphs.
- When asked for analysis, factor in the portfolio's allocation and diversification.
- Always end substantive responses with: "This is informational, not financial advice."
- If a position is unknown, say so rather than guessing.
- You may not invent prices or returns that are not present in the provided data.`

export function portfolioContext(positions: Position[]): string {
  const rows = positions
    .map((p) => {
      const current = p.lastPrice != null ? (p.lastPrice * p.quantity).toFixed(2) : 'n/a'
      const pnl =
        p.lastPrice != null
          ? (((p.lastPrice - p.buyPrice) / p.buyPrice) * 100).toFixed(2) + '%'
          : 'n/a'
      return `${p.ticker} | type=${p.type} | qty=${p.quantity} | buy=${
        p.buyPrice
      } | last=${p.lastPrice ?? 'n/a'} | currentValue=${current} | pnl=${pnl}`
    })
    .join('\n')

  return `The user's current portfolio (uploaded positions):\n${rows}`
}

export async function chat({
  provider,
  apiKey,
  history,
  context,
  signal,
}: {
  provider: string
  apiKey: string
  history: { role: 'user' | 'assistant'; content: string }[]
  context: string
  signal: AbortSignal
}): Promise<string> {
  const p = getProvider(provider)
  if (!p) throw new Error('Unknown provider selected.')
  if (!apiKey) throw new Error('Add an API key in Settings before chatting.')

  const userHistory = history.map((m) => ({ role: m.role, content: m.content }))

  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: p.model,
        max_tokens: 1024,
        system: [SYSTEM_PROMPT, context],
        messages: userHistory,
      }),
      signal,
    })
    if (!res.ok) throw new Error(`Claude error: ${res.status}`)
    const data = await res.json()
    return data.content?.[0]?.text ?? ''
  }

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: context },
    ...userHistory,
  ]

  const res = await fetch(p.endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: p.model,
      messages,
      max_tokens: 1024,
    }),
    signal,
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? ''
}