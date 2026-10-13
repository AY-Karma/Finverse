import { afterEach, describe, expect, it, vi } from 'vitest'
import { canConfirmFundScheme, isMfSchemeMapping, matchFundScheme, reviewFundScheme } from './fundSchemes'
import { instrumentKey, normalizePosition } from './instruments'
import type { Position } from './types'

afterEach(() => vi.unstubAllGlobals())

const idcwCandidates = [
  { schemeCode: 1, schemeName: 'Example Equity Fund Direct Plan Growth Option' },
  { schemeCode: 2, schemeName: 'Example Equity Fund Direct Plan IDCW Option' },
]

describe('fund scheme review', () => {
  it('resolves the audited IDCW fixture without selecting Growth', () => {
    expect(matchFundScheme('Example Equity Fund Direct IDCW', idcwCandidates))
      .toMatchObject({ status: 'matched', match: idcwCandidates[1] })
  })

  it.each([
    ['Example Equity Fund Direct Growth', 'Example Equity Fund Regular Growth'],
    ['Example Equity Fund Regular Growth', 'Example Equity Fund Direct Growth'],
    ['Example Equity Fund Growth Direct Plan', 'Example Equity Fund Growth'],
    ['Example Equity Fund Direct IDCW', 'Example Equity Fund Direct Growth'],
    ['Example Equity Fund Direct Growth', 'Different Equity Fund Direct Growth'],
  ])('requires review instead of substituting %s with %s', (target, schemeName) => {
    expect(matchFundScheme(target, [{ schemeCode: 1, schemeName }]).status).toBe('review')
  })

  it.each(['Example Equity Fund Growth', 'Example Equity Fund Direct', 'Example Equity Fund'])('reviews missing plan or option even for an exact name: %s', (target) => {
    expect(matchFundScheme(target, [{ schemeCode: 1, schemeName: target }]).status).toBe('review')
  })

  it('does not bypass ambiguity with an exact name or ignore an incompletely identified candidate', () => {
    const name = 'Example Equity Fund Direct Growth'
    expect(matchFundScheme(name, [{ schemeCode: 1, schemeName: name }, { schemeCode: 2, schemeName: name }]).status).toBe('review')
    expect(matchFundScheme(name, [{ schemeCode: 1, schemeName: name }, { schemeCode: 2, schemeName: 'Example Equity Fund Growth' }]).status).toBe('review')
  })

  it('deduplicates identical provider records without merging different scheme codes', () => {
    expect(matchFundScheme('Example Equity Fund Direct IDCW', [idcwCandidates[1], idcwCandidates[1]]))
      .toMatchObject({ status: 'matched', match: idcwCandidates[1], candidates: [idcwCandidates[1]] })
    expect(matchFundScheme('Example Equity Fund Direct IDCW', [{ ...idcwCandidates[0], schemeCode: 2 }, idcwCandidates[1]]).status).toBe('unavailable')
  })

  it('keeps payout and reinvestment separate while recognizing the dividend/IDCW name change', () => {
    const candidates = [
      { schemeCode: 1, schemeName: 'Example Equity Fund Direct Plan IDCW Payout' },
      { schemeCode: 2, schemeName: 'Example Equity Fund IDCW Reinvestment Direct' },
    ]
    expect(matchFundScheme('Example Equity Fund Direct IDCW', candidates).status).toBe('review')
    expect(matchFundScheme('Example Equity Fund Direct Dividend Payout', candidates).match).toEqual(candidates[0])
    expect(matchFundScheme('Example Equity Fund Direct IDCW Reinvestment', candidates).match).toEqual(candidates[1])
    expect(canConfirmFundScheme('Example Equity Fund Direct IDCW', candidates[0])).toBe(true)
    expect(canConfirmFundScheme('Example Equity Fund Direct IDCW Payout', candidates[1])).toBe(false)
  })

  it.each(['Growth Opportunities', 'Dividend Yield'])('preserves %s as part of the fund identity instead of treating it as an option', (fundName) => {
    const candidate = { schemeCode: 1, schemeName: `Example ${fundName} Fund Direct Plan IDCW` }
    expect(matchFundScheme(`Example ${fundName} Fund Direct IDCW`, [candidate]).match).toEqual(candidate)
    expect(canConfirmFundScheme(`Example ${fundName} Fund Direct IDCW`, candidate)).toBe(true)
  })

  it('lets explicit confirmation resolve a missing plan or abbreviated fund but rejects contradictory or missing candidate details', () => {
    const direct = idcwCandidates[0]
    expect(canConfirmFundScheme('Example Equity Fund', direct)).toBe(true)
    expect(canConfirmFundScheme('Example Eq. Fund Direct Growth', direct)).toBe(true)
    expect(canConfirmFundScheme('Example Equity Fund Regular Growth', direct)).toBe(false)
    expect(canConfirmFundScheme('Example Equity Fund Direct IDCW', direct)).toBe(false)
    expect(canConfirmFundScheme('Example Equity Fund Direct Growth', { schemeCode: 2, schemeName: 'Example Equity Fund Growth' })).toBe(false)
    expect(canConfirmFundScheme('Example Equity Fund Direct Regular Growth', direct)).toBe(false)
  })

  it('validates mapping records before they can drive provider requests', () => {
    expect(isMfSchemeMapping({ code: 1, name: 'Fund', source: 'confirmed' })).toBe(true)
    for (const invalid of [null, { code: 0, name: 'Fund', source: 'exact' }, { code: 1.5, name: 'Fund', source: 'confirmed' }, { code: '1', name: 'Fund', source: 'confirmed' }, { code: 1, name: '', source: 'confirmed' }, { code: 1, name: 'Fund', source: 'guessed' }]) {
      expect(isMfSchemeMapping(invalid)).toBe(false)
    }
  })

  it('searches by fund identity, coalesces requests and returns validated review candidates', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(idcwCandidates))
    vi.stubGlobal('fetch', fetcher)
    const results = await Promise.all([reviewFundScheme('Example Equity Fund Direct IDCW'), reviewFundScheme('Example Equity Fund Direct IDCW')])
    expect(results.map((result) => result.match?.schemeCode)).toEqual([2, 2])
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.mfapi.in/mf/search?q=example%20equity%20fund')
  })

  it.each([
    { wrong: 'shape' },
    [{ schemeCode: '2', schemeName: 'Example Equity Fund Direct IDCW' }],
    Array.from({ length: 501 }, (_, index) => ({ schemeCode: index + 1, schemeName: 'Example Equity Fund Direct IDCW' })),
  ])('does not choose from malformed or truncated provider results', async (payload) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(payload)))
    expect((await reviewFundScheme('Example Equity Fund Direct IDCW')).status).toBe('unavailable')
  })

  it('retains imported-data status when the provider fails or exceeds the response bound', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Offline') }))
    expect((await reviewFundScheme('Example Equity Fund Direct IDCW')).status).toBe('unavailable')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(idcwCandidates, { headers: { 'Content-Length': '524289' } })))
    expect((await reviewFundScheme('Example Equity Fund Direct IDCW')).status).toBe('unavailable')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(' '.repeat(524_288) + '[]')))
    expect((await reviewFundScheme('Example Equity Fund Direct IDCW')).status).toBe('unavailable')
  })
})

describe('saved fund identity', () => {
  it('keys prices by saved scheme code ahead of a legacy name key', () => {
    const holding: Position = {
      id: 'fund', ticker: 'Imported alias', name: 'Imported alias', type: 'mutual-fund', quantity: 1, buyPrice: 100, invested: 100, lastPrice: 120,
      instrumentKey: 'MF:imported alias', mfScheme: { code: 2, name: idcwCandidates[1].schemeName, source: 'confirmed' },
    }
    expect(normalizePosition(holding).instrumentKey).toBe('MF:mfapi:2')
    expect(instrumentKey({ ...holding, name: 'Another alias', mfScheme: { ...holding.mfScheme!, code: 3 } })).toBe('MF:mfapi:3')
    expect(instrumentKey({ ...holding, mfScheme: undefined })).toBe('MF:imported alias')
  })
})
