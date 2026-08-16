import { describe, expect, it } from 'vitest'
import type { LiveQuote } from './types'
import { PRIVATE_VALUE_MASK, privateValue, visibleQuotes } from './privacy'

const quotes: Record<string, LiveQuote> = { INFY: { price: 100, at: 1, source: 'yahoo' } }

describe('private portfolio projections', () => {
  it('masks formatted values when privacy mode is enabled', () => {
    expect(privateValue('₹1,000', true)).toBe(PRIVATE_VALUE_MASK)
    expect(privateValue('₹1,000', false)).toBe('₹1,000')
  })

  it('drops retained quotes when external data is disabled', () => {
    expect(visibleQuotes(false, quotes)).toEqual({})
    expect(visibleQuotes(true, quotes)).toBe(quotes)
  })
})
