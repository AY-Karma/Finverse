import type { Position, Settings } from './types'

const POSITIONS_KEY = 'finverse:positions'
const SETTINGS_KEY = 'finverse:settings'

export function savePositions(positions: Position[]): void {
  localStorage.setItem(POSITIONS_KEY, JSON.stringify(positions))
}

export function loadPositions(): Position[] {
  try {
    const raw = localStorage.getItem(POSITIONS_KEY)
    return raw ? (JSON.parse(raw) as Position[]) : []
  } catch {
    return []
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw
      ? (JSON.parse(raw) as Settings)
      : { provider: '', apiKey: '' }
  } catch {
    return { provider: '', apiKey: '' }
  }
}

export interface PortfolioStats {
  invested: number
  currentValue: number
  pnl: number
  pnlPct: number
  allocations: { symbol: string; value: number; type: string }[]
}

export function computeStats(positions: Position[]): PortfolioStats {
  const invested = positions.reduce((s, p) => s + p.invested, 0)
  const currentValue = positions.reduce(
    (s, p) => s + (p.lastPrice != null ? p.lastPrice * p.quantity : p.invested),
    0,
  )
  const pnl = currentValue - invested
  const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0

  const bySymbol = new Map<string, { value: number; type: string }>()
  for (const p of positions) {
    const v = p.lastPrice != null ? p.lastPrice * p.quantity : p.invested
    const prev = bySymbol.get(p.ticker)
    if (prev) prev.value += v
    else bySymbol.set(p.ticker, { value: v, type: p.type })
  }
  const allocations = Array.from(bySymbol.entries())
    .map(([symbol, { value, type }]) => ({
      symbol,
      value,
      type: type as Position['type'],
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)

  return { invested, currentValue, pnl, pnlPct, allocations }
}

export function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: n >= 1000 ? 0 : 2,
  }).format(n)
}

export function formatPercent(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}