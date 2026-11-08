import { describe, expect, it, vi } from 'vitest'
import { createNseSymbolResolver } from '../api/nseSymbolChanges'

const NOW = Date.parse('2026-07-01T00:00:00+05:30')
const master = 'SYMBOL,SERIES,ISIN NUMBER\nNEW,EQ,INE001A01010\n'
const sme = 'SYMBOL,SERIES,ISIN_NUMBER\nSMENEW,SM,INE002A01010\n'
const changes = 'NAME OF THE COMPANY,OLD SYMBOL,NEW SYMBOL,EFFECTIVE DATE\nCompany,OLD,NEW,01-JUL-2026\n'

function source(options: { master?: string; changes?: string } = {}) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input)
    return new Response(url.includes('symbolchange.csv') ? options.changes ?? changes : url.includes('SME_EQUITY_L.csv') ? sme : options.master ?? master)
  })
}

describe('official NSE symbol-change recovery', () => {
  it('applies an effective rename at India midnight and shares reference requests', async () => {
    const fetcher = source()
    const resolve = createNseSymbolResolver(fetcher, () => NOW)
    expect(await Promise.all([resolve('OLD.NS'), resolve('OLD.NS')])).toEqual(['NEW.NS', 'NEW.NS'])
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(await resolve('OLD.NS')).toBe('NEW.NS')
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(await createNseSymbolResolver(source(), () => NOW - 1)('OLD.NS')).toBeNull()
  })

  it('follows a unique chain into a current SME listing', async () => {
    const fetcher = source({ changes: changes + 'Company,NEW,SMENEW,01-JUL-2026\n', master: 'SYMBOL,SERIES,ISIN NUMBER\nOTHER,EQ,INE003A01010\n' })
    expect(await createNseSymbolResolver(fetcher, () => NOW)('OLD.NS')).toBe('SMENEW.NS')
  })

  it.each([
    { reason: 'conflicting replacements', changes: changes + 'Company,OLD,SMENEW,01-JUL-2026\n' },
    { reason: 'a cycle', changes: 'NAME OF THE COMPANY,OLD SYMBOL,NEW SYMBOL,EFFECTIVE DATE\nCompany,OLD,LOOP,01-JUL-2026\nCompany,LOOP,OLD,01-JUL-2026\n' },
    { reason: 'a suspended target', master: 'SYMBOL,SERIES,ISIN NUMBER\nNEW,XX,INE001A01010\n' },
    { reason: 'conflicting security identifiers', master: master + 'NEW,EQ,INE004A01010\n' },
    { reason: 'a symbol reused by a current listing', master: master + 'OLD,EQ,INE004A01010\n' },
  ])('does not resolve $reason', async (options) => {
    expect(await createNseSymbolResolver(source(options), () => NOW)('OLD.NS')).toBeNull()
  })

  it('does not guess across exchanges or malformed symbols', async () => {
    const fetcher = source()
    const resolve = createNseSymbolResolver(fetcher, () => NOW)
    expect(await resolve('OLD.BO')).toBeNull()
    expect(await resolve('https://example.com.NS')).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('keeps provider failures recoverable without retrying the reference for every holding', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('', { status: 503 }))
    const resolve = createNseSymbolResolver(fetcher, () => NOW)
    expect(await resolve('OLD.NS')).toBeNull()
    expect(await resolve('OTHER.NS')).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
})
