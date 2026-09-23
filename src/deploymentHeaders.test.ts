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
  })
})
