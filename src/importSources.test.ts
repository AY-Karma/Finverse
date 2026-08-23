import { describe, expect, it } from 'vitest'
import { IMPORT_SOURCES } from './importSources'

describe('IMPORT_SOURCES', () => {
  it('contains each supported onboarding choice once', () => {
    expect(IMPORT_SOURCES.map((source) => source.name)).toEqual([
      'Zerodha',
      'Groww',
      'INDmoney',
      'Angel One',
    ])
  })

  it('only links to official HTTPS hosts', () => {
    const hosts = IMPORT_SOURCES.map((source) => new URL(source.url))
    expect(hosts.every((url) => url.protocol === 'https:')).toBe(true)
    expect(hosts.map((url) => url.hostname)).toEqual([
      'support.zerodha.com',
      'groww.in',
      'www.indmoney.com',
      'www.angelone.in',
    ])
  })
})
