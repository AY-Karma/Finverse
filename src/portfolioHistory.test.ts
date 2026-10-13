import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appendPortfolioSnapshot, loadPortfolioSnapshots, updatePortfolioSnapshots } from './portfolioHistory'

const values = new Map<string, string>()

beforeEach(() => {
  values.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  })
})

describe('portfolio snapshots', () => {
  it('records an account event without a balance change and retains it during subsequent price observations', () => {
    const balance = { at: Date.UTC(2026, 0, 1, 4), value: 100, invested: 90, pnl: 10, holdingCount: 1 }
    const event = { kind: 'account-update' as const, accountId: 'account', statementId: 'statement' }
    const changed = updatePortfolioSnapshots({ ...balance, at: balance.at + 1_000, event }, [balance])
    expect(changed[0].event).toEqual(event)
    const later = updatePortfolioSnapshots({ ...balance, at: balance.at + 2_000, value: 110, pnl: 20 }, changed)
    expect(later[0]).toMatchObject({ event, value: 110 })
  })
  it('preserves a restored balance timestamp and quality when its totals have not changed', () => {
    const restored = { at: Date.UTC(2026, 0, 1, 4), value: 100, invested: 90, pnl: 10, holdingCount: 1, dataQuality: 'legacy-instrument-identity' as const }
    const result = updatePortfolioSnapshots({ at: restored.at + 60_000, value: 100, invested: 90, pnl: 10, holdingCount: 1 }, [restored])
    expect(result).toEqual([restored])
    expect(values.size).toBe(0)
  })
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
