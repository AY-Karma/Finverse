export type AssetType = 'stock' | 'etf' | 'mutual-fund' | 'other'

export type Currency = 'INR'

export type Exchange = 'NSE' | 'BSE' | 'NASDAQ' | 'NYSE' | 'LSE' | 'OTHER'

export type Density = 'comfortable' | 'compact'
export type Accent = 'cobalt'
export type Mode = 'dark' | 'light'

export interface MfSchemeMapping {
  code: number
  name: string
  source: 'exact' | 'confirmed'
}

export interface Position {
  id: string
  ticker: string
  name: string
  type: AssetType
  quantity: number
  buyPrice: number
  lastPrice: number | null
  /** Statement date attached to derived imported-price copies. */
  priceAsOf?: string | null
  invested: number
  // Mutual-fund holdings metadata (optional; equity rows leave these unset).
  amc?: string
  category?: string
  subCategory?: string
  folio?: string
  source?: string
  returns?: number | null
  xirr?: number | null
  /** Reviewed provider identity shared by NAV and historical prices. */
  mfScheme?: MfSchemeMapping
  /** Canonical identity fields filled by the investment workspace. */
  instrumentKey?: string
  isin?: string
  exchange?: Exchange
  providerSymbol?: string
  currency?: Currency
  sector?: string
  industry?: string
  identityVersion?: 2
  exchangeSource?: 'explicit' | 'inferred'
  identityIssue?: string
  reportedExchange?: string
  reportedCurrency?: string
}

export interface AccountStatement {
  id: string
  fileName: string
  statementDate: string | null
  completeness: 'complete' | 'partial' | 'unknown'
}

export interface AccountRevision {
  statement: AccountStatement
  importedAt: number
  reviewedAt?: number
  positions: Position[]
}

export interface Folio {
  id: string
  name: string
  importedAt: number
  reviewedAt?: number
  positions: Position[]
  statement?: AccountStatement
  previousRevision?: AccountRevision
  lastOperation?: 'added' | 'updated'
  operationAt?: number
}

export interface Settings {
  currency: Currency
  allowExternalData: boolean
  density: Density
  accent: Accent
  mode: Mode
  hideValues: boolean
}

export interface LiveQuote {
  price: number
  /** Provider market time for this price, not the time Finverse fetched it. */
  at: number
  /** Time Finverse fetched the quote. Used for request throttling only. */
  fetchedAt?: number
  source: 'yahoo' | 'nse-close' | 'nav'
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
  /** Original recorded balances are preserved after identity corrections. */
  dataQuality?: 'legacy-instrument-identity'
  event?: {
    kind: 'account-import' | 'account-update' | 'account-undo' | 'account-remove'
    accountId: string
    statementId: string
  }
}
