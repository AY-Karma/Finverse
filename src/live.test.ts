import { describe, expect, it } from 'vitest'
import { marketStatusText } from './live'

describe('market status text', () => {
  it('describes the initial fetch while the market is open', () => {
    expect(marketStatusText(true, true, true, true)).toBe('Live Market - fetching latest data')
  })

  it('describes the initial fetch outside market hours', () => {
    expect(marketStatusText(false, true, true, true)).toBe('Off-market hours - fetching latest data')
  })

  it('keeps the fetch message visible while USD conversion is still loading', () => {
    expect(marketStatusText(true, true, false, true)).toBe('Live Market - fetching latest data')
  })
})
