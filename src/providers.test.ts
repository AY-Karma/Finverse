import { afterEach, describe, expect, it, vi } from 'vitest'
import { chat } from './providers'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('provider chat requests', () => {
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
