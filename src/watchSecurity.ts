import { isMarketSymbol } from './marketDataProtocol'
import { isIsin } from './nsePricingProtocol'

/** A listed security a watch rule follows without the user owning it. */
export type WatchSecurity =
  | { kind: 'equity'; symbol: string; isin: string; name: string; type: 'stock' | 'etf' }
  | { kind: 'fund'; code: number; name: string }

const MAX_NAME = 200

export function watchSecurityKey(security: WatchSecurity): string {
  return security.kind === 'fund' ? `watch:fund:${security.code}` : `watch:equity:${security.symbol}:${security.isin}`
}

export function isWatchSecurityKey(key: string): boolean {
  return key.startsWith('watch:')
}

export function parseWatchSecurity(value: unknown): WatchSecurity | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  const name = typeof item.name === 'string' ? item.name.trim().slice(0, MAX_NAME) : ''
  if (!name) return null
  if (item.kind === 'fund') {
    return typeof item.code === 'number' && Number.isSafeInteger(item.code) && item.code > 0 ? { kind: 'fund', code: item.code, name } : null
  }
  if (item.kind !== 'equity' || typeof item.symbol !== 'string' || !item.symbol.endsWith('.NS') || !isMarketSymbol(item.symbol)
    || !isIsin(item.isin) || (item.type !== 'stock' && item.type !== 'etf')) return null
  return { kind: 'equity', symbol: item.symbol, isin: item.isin, name, type: item.type }
}

export function watchSecurityLabel(security: WatchSecurity): string {
  if (security.kind === 'fund') return 'Mutual fund'
  return `${security.symbol.replace(/\.NS$/, '')} · ${security.type === 'etf' ? 'ETF' : 'Stock'}`
}
