interface BenchmarkDefinition {
  id: string
  label: string
  symbol: string | null
  region: 'India' | 'Global'
  unavailableReason?: string
}

export const BENCHMARKS: BenchmarkDefinition[] = [
  { id: 'nifty-50', label: 'NIFTY 50', symbol: '^NSEI', region: 'India' },
  { id: 'nifty-next-50', label: 'NIFTY Next 50', symbol: '^NSMIDCP', region: 'India' },
  { id: 'nifty-100', label: 'NIFTY 100', symbol: '^CNX100', region: 'India' },
  { id: 'nifty-200', label: 'NIFTY 200', symbol: '^CNX200', region: 'India' },
  { id: 'nifty-midcap-50', label: 'NIFTY Midcap 50', symbol: '^NSEMDCP50', region: 'India' },
  { id: 'sensex', label: 'S&P BSE Sensex', symbol: '^BSESN', region: 'India' },
  { id: 'nifty-bank', label: 'NIFTY Bank', symbol: '^NSEBANK', region: 'India' },
  { id: 'sp-500', label: 'S&P 500', symbol: '^GSPC', region: 'Global' },
  { id: 'nasdaq-composite', label: 'NASDAQ Composite', symbol: '^IXIC', region: 'Global' },
  { id: 'dow-jones', label: 'Dow Jones', symbol: '^DJI', region: 'Global' },
  { id: 'ftse-100', label: 'FTSE 100', symbol: '^FTSE', region: 'Global' },
  { id: 'nikkei-225', label: 'Nikkei 225', symbol: '^N225', region: 'Global' },
  { id: 'hang-seng', label: 'Hang Seng', symbol: '^HSI', region: 'Global' },
  { id: 'dax', label: 'DAX', symbol: '^GDAXI', region: 'Global' },
  { id: 'cac-40', label: 'CAC 40', symbol: '^FCHI', region: 'Global' },
]

export const DEFAULT_MARKET_INDEX_IDS: [string, string] = ['nifty-bank', 'nifty-50']
export const MARKET_INDEX_CHOICES = BENCHMARKS.filter((index) => index.symbol && !index.unavailableReason)

export function normalizeMarketIndexIds(value: unknown): [string, string] {
  const valid = (id: unknown): id is string => typeof id === 'string' && MARKET_INDEX_CHOICES.some((index) => index.id === id)
  const first = Array.isArray(value) && valid(value[0]) ? value[0] : DEFAULT_MARKET_INDEX_IDS[0]
  const second = Array.isArray(value) && valid(value[1]) && value[1] !== first
    ? value[1] : DEFAULT_MARKET_INDEX_IDS[first === DEFAULT_MARKET_INDEX_IDS[1] ? 0 : 1]
  return [first, second]
}

export function selectedMarketIndices(value?: unknown) {
  return normalizeMarketIndexIds(value).map((id) => {
    const index = MARKET_INDEX_CHOICES.find((item) => item.id === id)!
    return { id: index.id, label: id === 'nifty-bank' ? 'Bank Nifty' : index.label, symbol: index.symbol!, region: index.region }
  })
}
