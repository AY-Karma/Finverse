export type AssetType = 'stock' | 'etf' | 'mutual-fund' | 'other'

export type ProviderId = 'openai' | 'anthropic' | 'openrouter' | 'ollama'

export type Currency = 'INR' | 'USD'

export type Density = 'comfortable' | 'compact'
export type Accent = 'indigo' | 'emerald' | 'cobalt' | 'amber'

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
  currency: Currency
  density: Density
  accent: Accent
  hideValues: boolean
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
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  charts?: ChartSpec[]
  /** Abort notices rendered with danger styling: 'stopped' (Stop button) or 'timeout' (generation cap). */
  kind?: 'stopped' | 'timeout' | 'quick-fallback'
}