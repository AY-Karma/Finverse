import { afterEach, describe, expect, it, vi } from 'vitest'
import { chat, describeOllamaEndpoint } from './providers'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('provider chat requests', () => {
  it('accepts CSP-supported local hosts and ports and rejects IPv6 literals before sending', () => {
    for (const url of ['http://localhost:11434/v1', 'http://localhost:11435/v1', 'http://127.0.0.1:11435/v1']) {
      expect(describeOllamaEndpoint(url)).toMatchObject({ isLocal: true, requiresConfirmation: false })
      expect(describeOllamaEndpoint(url).error).toBeUndefined()
    }
    expect(describeOllamaEndpoint('http://[::1]:11434/v1').error).toContain('IPv6')
  })
  it.each(['openai', 'anthropic'])('blocks unsolicited live quote tools for %s when market permission is absent', async (provider) => {
    const requests: { url: string; body: Record<string, unknown> }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(init?.body ?? '{}')) })
      const first = requests.length === 1
      const payload = provider === 'anthropic'
        ? first
          ? { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'quote', name: 'get_quote', input: { symbol: 'BTC' } }] }
          : { content: [{ type: 'text', text: 'Using imported values.' }] }
        : { choices: [{ message: first
          ? { tool_calls: [{ id: 'quote', function: { name: 'get_quote', arguments: '{"symbol":"BTC"}' } }] }
          : { content: 'Using imported values.' } }] }
      return new Response(JSON.stringify(payload))
    }))

    await chat({ provider, apiKey: 'test-key', history: [{ role: 'user', content: 'Quote BTC' }], context: 'Digest', positions: [], liveQuotes: {}, signal: new AbortController().signal })

    expect(requests).toHaveLength(2)
    expect(requests.every((request) => request.url.includes(provider === 'anthropic' ? 'anthropic.com' : 'openai.com'))).toBe(true)
    expect(JSON.stringify(requests[0].body.tools)).not.toContain('get_quote')
    expect(JSON.stringify(requests[1].body.messages)).toContain('permission is disabled')
  })

  it.each(['openai', 'anthropic', 'ollama'])('bounds long input history for %s and retains the latest question', async (provider) => {
    const requests: RequestInit[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(init ?? {})
      return new Response(JSON.stringify(provider === 'anthropic'
        ? { content: [{ type: 'text', text: 'Done' }] }
        : { choices: [{ message: { content: 'Done' } }] }))
    }))
    await chat({ provider, apiKey: 'test-key', history: [
      ...Array.from({ length: 120 }, (_, i) => ({ role: 'user' as const, content: `old-${i}:` + 'x'.repeat(24_000) })),
      { role: 'user', content: 'LATEST_QUESTION' },
    ], context: 'Digest', positions: [], liveQuotes: {}, signal: new AbortController().signal })
    const body = JSON.parse(String(requests[0].body))
    const history = body.messages.filter((message: { role: string }) => message.role !== 'system')
    expect(history.reduce((total: number, message: { content: string }) => total + message.content.length, 0)).toBeLessThanOrEqual(65_000)
    expect(JSON.stringify(history)).toContain('LATEST_QUESTION')
    expect(JSON.stringify(history)).not.toContain('old-0:')
  })

  it('sends the portfolio digest once to a remote OpenAI-compatible provider', async () => {
    const requests: RequestInit[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(init ?? {})
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Done' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))

    await chat({
      provider: 'openai',
      apiKey: 'test-key',
      history: [{ role: 'user', content: 'Review my portfolio.' }],
      context: 'UNIQUE_PORTFOLIO_DIGEST',
      positions: [],
      liveQuotes: {},
      signal: new AbortController().signal,
    })

    const body = JSON.stringify(JSON.parse(String(requests[0].body)))
    expect(body.match(/UNIQUE_PORTFOLIO_DIGEST/g)).toHaveLength(1)
  })

  it('sends the portfolio digest once to Anthropic', async () => {
    const requests: RequestInit[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(init ?? {})
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Done' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))

    await chat({
      provider: 'anthropic',
      apiKey: 'test-key',
      history: [{ role: 'user', content: 'Review my portfolio.' }],
      context: 'UNIQUE_PORTFOLIO_DIGEST',
      positions: [],
      liveQuotes: {},
      signal: new AbortController().signal,
    })

    const body = JSON.stringify(JSON.parse(String(requests[0].body)))
    expect(body.match(/UNIQUE_PORTFOLIO_DIGEST/g)).toHaveLength(1)
  })

  it('retains first-turn portfolio context compatibility for local Ollama', async () => {
    const requests: RequestInit[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      requests.push(init ?? {})
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Done' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))

    await chat({
      provider: 'ollama',
      apiKey: '',
      history: [{ role: 'user', content: 'Review my portfolio.' }],
      context: 'UNIQUE_PORTFOLIO_DIGEST',
      positions: [],
      liveQuotes: {},
      signal: new AbortController().signal,
    })

    const body = JSON.stringify(JSON.parse(String(requests[0].body)))
    expect(body.match(/UNIQUE_PORTFOLIO_DIGEST/g)).toHaveLength(2)
  })
})
