import type { LiveQuote } from './types'

export const PRIVATE_VALUE_MASK = '••••••'

/** Prevent retained quote state from affecting views after external data is disabled. */
export function visibleQuotes(
  allowExternalData: boolean,
  quotes: Record<string, LiveQuote>,
): Record<string, LiveQuote> {
  return allowExternalData ? quotes : {}
}

/** One display seam for values governed by the privacy toggle. */
export function privateValue(value: string, hideValues: boolean): string {
  return hideValues ? PRIVATE_VALUE_MASK : value
}
