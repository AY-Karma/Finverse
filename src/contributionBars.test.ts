import { describe, expect, it } from 'vitest'
import { buildContributionColumns } from './contributionBars'

const rows = [
  { id: 'kronox', label: 'KRONOX', name: 'KRONOX', dailyPriceChange: 3.46, dailyPriceChangePct: 1.1 },
  { id: 'tmcv', label: 'TMCV', name: 'TMCV', dailyPriceChange: 6.65, dailyPriceChangePct: 0.5 },
  { id: 'krn', label: 'KRN', name: 'KRN', dailyPriceChange: -20.9, dailyPriceChangePct: -2.2 },
  { id: 'wareeener', label: 'WAREEENER', name: 'WAREEENER', dailyPriceChange: -30.1, dailyPriceChangePct: -1.3 },
]

describe('buildContributionColumns', () => {
  it('sorts and scales bars by the selected price measure', () => {
    const result = buildContributionColumns(rows, 'price')
    expect(result.tailwinds.map((item) => item.label)).toEqual(['TMCV', 'KRONOX'])
    expect(result.headwinds.map((item) => item.label)).toEqual(['WAREEENER', 'KRN'])
    expect(result.tailwinds[1].width).toBeCloseTo(3.46 / 30.1 * 100)
    expect(result.headwinds[0].width).toBe(100)
  })

  it('changes both ordering and scale when percent is selected', () => {
    const result = buildContributionColumns(rows, 'percent')
    expect(result.tailwinds.map((item) => item.label)).toEqual(['KRONOX', 'TMCV'])
    expect(result.headwinds.map((item) => item.label)).toEqual(['KRN', 'WAREEENER'])
    expect(result.headwinds[0].width).toBe(100)
  })
})
