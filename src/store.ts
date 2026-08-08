import type { Currency, Folio, Position, Settings } from './types'

const FOLIOS_KEY = 'finverse:folios'
const LEGACY_POSITIONS_KEY = 'finverse:positions'
const SETTINGS_KEY = 'finverse:settings'

export function saveFolios(folios: Folio[]): void {
  localStorage.setItem(FOLIOS_KEY, JSON.stringify(folios))
}

export function loadFolios(): Folio[] {
  try {
    const raw = localStorage.getItem(FOLIOS_KEY)
    if (raw) return JSON.parse(raw) as Folio[]
  } catch {
    /* fall through to migration */
  }
  // Migrate the old single-list format into one folio.
  try {
    const raw = localStorage.getItem(LEGACY_POSITIONS_KEY)
    if (raw) {
      const positions = JSON.parse(raw) as Position[]
      if (Array.isArray(positions) && positions.length > 0) {
        return [
          {
            id: crypto.randomUUID(),
            name: 'My portfolio',
            importedAt: Date.now(),
            positions,
          },
        ]
      }
    }
  } catch {
    /* ignore */
  }
  return []
}

export function flattenFolios(folios: Folio[]): Position[] {
  return folios.flatMap((f) => f.positions)
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

export function loadSettings(): Settings {
  const DEFAULTS: Settings = {
    provider: '',
    apiKey: '',
    model: '',
    baseUrl: '',
    currency: 'INR',
    density: 'comfortable',
    accent: 'indigo',
  }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

export interface PortfolioStats {
  invested: number
  currentValue: number
  pnl: number
  pnlPct: number
  allocations: { symbol: string; value: number; type: string }[]
}

function effectivePrice(p: Position, prices?: Map<string, number>): number | null {
  if (prices?.has(p.ticker)) return prices.get(p.ticker)!
  return p.lastPrice ?? (p.invested > 0 ? p.buyPrice : null)
}

export function computeStats(
  positions: Position[],
  prices?: Map<string, number>,
): PortfolioStats {
  const invested = positions.reduce((s, p) => s + p.invested, 0)
  const currentValue = positions.reduce(
    (s, p) => s + (effectivePrice(p, prices) ?? 0) * p.quantity,
    0,
  )
  const pnl = currentValue - invested
  const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0

  const bySymbol = new Map<string, { value: number; type: string }>()
  for (const p of positions) {
    const v = (effectivePrice(p, prices) ?? 0) * p.quantity
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

const MINUS_SIGN = '\u2212'

export function formatCurrency(n: number, currency: Currency = 'INR'): string {
  const s = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: n >= 1000 ? 0 : 2,
  }).format(n)
  // Use the typographic minus (U+2212) instead of the ASCII hyphen the formatter
  // emits — the hyphen sits high on many display fonts and renders the negative
  // sign as if it were floating above the digits.
  return n < 0 ? s.replace('-', MINUS_SIGN) : s
}

export function formatPercent(n: number): string {
  const sign = n >= 0 ? '+' : MINUS_SIGN
  return `${sign}${Math.abs(n).toFixed(2)}%`
}