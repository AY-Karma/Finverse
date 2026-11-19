import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('deployment security headers', () => {
  it('keeps Vercel and Netlify rules in sync', () => {
    const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
      headers: { source: string; headers: { key: string; value: string }[] }[]
    }
    const vercel = config.headers.find((rule) => rule.source === '/(.*)')
    const netlify = readFileSync('public/_headers', 'utf8')
    expect(vercel).toBeDefined()
    for (const { key, value } of vercel?.headers ?? []) {
      expect(netlify).toContain(`  ${key}: ${value}`)
    }
    expect(vercel?.headers.map(({ key }) => key)).toEqual(expect.arrayContaining([
      'Content-Security-Policy',
      'X-Frame-Options',
      'Referrer-Policy',
      'X-Content-Type-Options',
      'Strict-Transport-Security',
    ]))
    const csp = vercel?.headers.find(({ key }) => key === 'Content-Security-Policy')?.value ?? ''
    const html = readFileSync('index.html', 'utf8')
    expect(html).toContain(`content="${csp.replace("frame-ancestors 'none'; ", '')}"`)
    expect(csp).toContain('img-src \'self\' data: https://cdn.jsdelivr.net https://eodhd.com;')
    expect(csp).toContain('connect-src \'self\' https://api.mfapi.in;')
    expect(csp).toContain("style-src 'self' 'unsafe-inline'; font-src 'self';")
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'")
  })

  it('allows only the boot theme script inline, by its exact hash', () => {
    const html = readFileSync('index.html', 'utf8')
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1])
    expect(inline).toHaveLength(1)
    const hash = `'sha256-${createHash('sha256').update(inline[0]).digest('base64')}'`
    const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as { headers: { source: string; headers: { key: string; value: string }[] }[] }
    const csp = config.headers.find((rule) => rule.source === '/(.*)')?.headers.find(({ key }) => key === 'Content-Security-Policy')?.value ?? ''
    expect(csp).toContain(`script-src 'self' ${hash};`)
  })

  it.each([
    ['light', JSON.stringify({ mode: 'light' }), 'light', '#e6e6e3'],
    ['dark', JSON.stringify({ mode: 'dark' }), undefined, '#0d0d0c'],
    ['missing', null, undefined, '#0d0d0c'],
    ['corrupt', '{', undefined, '#0d0d0c'],
  ])('starts the boot screen in the saved theme (%s settings)', (_label, saved, mode, themeColor) => {
    const script = /<script>([\s\S]*?)<\/script>/.exec(readFileSync('index.html', 'utf8'))![1]
    const meta = { content: '#0d0d0c' }
    const documentElement = { dataset: {} as Record<string, string> }
    const document = { documentElement, querySelector: () => meta }
    const localStorage = { getItem: () => saved }
    new Function('document', 'localStorage', script)(document, localStorage)
    expect(documentElement.dataset.mode).toBe(mode)
    expect(meta.content).toBe(themeColor)
  })

  it('runs API functions in Mumbai, next to Indian users and India-only sources', () => {
    expect((JSON.parse(readFileSync('vercel.json', 'utf8')) as { regions?: string[] }).regions).toEqual(['bom1'])
  })

  it('lets browsers keep content-hashed build files without revalidating', () => {
    const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
      headers: { source: string; headers: { key: string; value: string }[] }[]
    }
    const immutable = 'public, max-age=31536000, immutable'
    expect(config.headers.find((rule) => rule.source === '/assets/(.*)')?.headers).toEqual([{ key: 'Cache-Control', value: immutable }])
    expect(readFileSync('public/_headers', 'utf8')).toContain(`/assets/*
  Cache-Control: ${immutable}`)
  })
})
