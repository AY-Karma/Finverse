export type AssetType = 'stock' | 'etf' | 'mutual-fund' | 'other'

export type ProviderId = 'openai' | 'anthropic' | 'openrouter' | 'ollama'

export type Currency = 'INR' | 'USD'

export type Exchange = 'NSE' | 'BSE' | 'NASDAQ' | 'NYSE' | 'LSE' | 'OTHER'

export type Density = 'comfortable' | 'compact'
export type Accent = 'indigo' | 'emerald' | 'cobalt' | 'amber' | 'custom'
export type Mode = 'dark' | 'light'

export interface Position {
  id: string
  ticker: string
  name: string
  type: AssetType
  quantity: number
  buyPrice: number
  lastPrice: number | null
  invested: number
  // Mutual-fund holdings metadata (optional; equity rows leave these unset).
  amc?: string
  category?: string
  subCategory?: string
  folio?: string
  source?: string
  returns?: number | null
  xirr?: number | null
  /** Canonical identity fields filled by the investment workspace. */
  instrumentKey?: string
  isin?: string
  exchange?: Exchange
  providerSymbol?: string
  currency?: Currency
  sector?: string
  industry?: string
}

export interface Folio {
  id: string
  name: string
  importedAt: number
  positions: Position[]
}

export interface Settings {
  provider: ProviderId | ''
  apiKey: string
  model: string
  baseUrl: string
  /** Explicit consent is required before Ollama can send data to a remote host. */
  confirmRemoteOllama: boolean
  currency: Currency
  allowExternalData: boolean
  density: Density
  accent: Accent
  /** Hex source for the 'custom' accent, e.g. '#7c6cff'. */
  customAccent?: string
  mode: Mode
  hideValues: boolean
}

export interface FxRate {
  usdInr: number
  at: number
}

export interface ChartSpec {
  kind: 'bar' | 'pie' | 'line'
  title?: string
  data: { label: string; value: number }[]
}

export interface LiveQuote {
  price: number
  at: number
  source: 'yahoo' | 'nav'
  change?: number | null
  changePct?: number | null
}

export interface PortfolioSnapshot {
  at: number
  value: number
  invested: number
  pnl: number
  /** Number of valued positions when the snapshot was captured. */
  holdingCount: number
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  charts?: ChartSpec[]
  /** Abort notices rendered with danger styling: 'stopped' (Stop button) or 'timeout' (generation cap). */
  kind?: 'stopped' | 'timeout' | 'quick-fallback'
}
