import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appendPortfolioSnapshot, loadPortfolioSnapshots } from './portfolioHistory'

const values = new Map<string, string>()

beforeEach(() => {
  values.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  })
})

describe('portfolio snapshots', () => {
  it('keeps only the latest snapshot for an Indian market day', () => {
    const first = { at: Date.UTC(2026, 0, 1, 4), value: 100, invested: 90, pnl: 10, holdingCount: 1 }
    const later = { ...first, at: first.at + 60_000, value: 101, pnl: 11 }
    appendPortfolioSnapshot(first)
    appendPortfolioSnapshot(later)
    expect(loadPortfolioSnapshots()).toEqual([later])
  })

  it('ignores malformed stored data', () => {
    values.set('finverse:portfolio-snapshots', '{bad json')
    expect(loadPortfolioSnapshots()).toEqual([])
  })
})
