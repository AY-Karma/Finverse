import type { Position } from './types'
import { normalizePosition } from './instruments'

export interface ResearchLink {
  label: string
  url: string
  description: string
  kind: 'search' | 'page'
}

export function researchSource(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    return ({ 'nseindia.com': 'NSE India', 'tradingview.com': 'TradingView', 'screener.in': 'Screener', 'google.com': 'Google Search', 'news.google.com': 'Google News' } as Record<string, string>)[host] || host
  } catch { return 'External source' }
}

function tickerBase(symbol: string): string {
  return symbol.toUpperCase().replace(/\.(NS|NSE|BO|BSE)$/, '').replace(/[^A-Z0-9&_-]/g, '')
}

export function screenerFallbackSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`site:screener.in ${query.trim()}`)}`
}

export function supportsCompanyResearch(position: Position): boolean {
  const { exchange } = normalizePosition(position)
  return position.type === 'stock' && (exchange === 'NSE' || exchange === 'BSE')
}

const RESOLVE_TTL_MS = 7 * 24 * 60 * 60 * 1000
function validCompanyPath(value: unknown): value is string {
  return typeof value === 'string' && /^\/company\/[A-Za-z0-9&_-]+\/$/.test(value)
}

/** Only an exact symbol match becomes a company link. Failure stays a search. */
export async function resolveScreenerCompanyPath(symbol: string, signal?: AbortSignal): Promise<string | null> {
  signal?.throwIfAborted()
  const key = `finverse:screenerPath:v3:${tickerBase(symbol)}`
  try {
    const cached = JSON.parse(localStorage.getItem(key) || 'null') as { path?: unknown; at?: number } | null
    if (cached && validCompanyPath(cached.path) && cached.path.split('/')[2].toUpperCase() === tickerBase(symbol) && typeof cached.at === 'number' && Date.now() - cached.at >= 0 && Date.now() - cached.at < RESOLVE_TTL_MS) return cached.path
  } catch { /* A denied cache does not prevent a lookup. */ }
  try {
    const target = `https://www.screener.in/api/company/search/?q=${encodeURIComponent(symbol)}`
    const response = await fetch(`https://corsproxy.io/?url=${encodeURIComponent(target)}`, {
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000),
    })
    if (!response.ok) return null
    const candidates: unknown = await response.json()
    if (!Array.isArray(candidates)) return null
    const paths = [...new Set(candidates.flatMap((candidate): string[] => {
      if (!candidate || typeof candidate.url !== 'string') return []
      const path = candidate.url.replace(/\/consolidated\/?$/, '/').replace(/\/+$/, '/')
      return validCompanyPath(path) ? [path] : []
    }))]
    const path = paths.find((path) => path.split('/')[2].toUpperCase() === tickerBase(symbol))
    if (!path) return null
    try { localStorage.setItem(key, JSON.stringify({ path, at: Date.now() })) } catch { /* Link still works without cache. */ }
    return path
  } catch {
    signal?.throwIfAborted()
    return null
  }
}

function sourceSearch(label: string, query: string, description: string): ResearchLink {
  return { label, url: `https://www.google.com/search?q=${encodeURIComponent(query)}`, description, kind: 'search' }
}

export function marketLinks(position: Position, screenerPath?: string | null): ResearchLink[] {
  const name = position.name?.trim() || position.ticker
  const symbol = tickerBase(position.ticker)
  if (position.type === 'mutual-fund') return [
    sourceSearch('Scheme factsheet', `${name} ${position.amc || ''} official factsheet`, 'Check the plan, mandate, holdings and benchmark.'),
    sourceSearch('Costs and risk', `${name} official expense ratio exit load riskometer`, 'Verify fees and risk in the scheme documents.'),
    sourceSearch('Scheme documents', `${name} official SID KIM`, 'Read the scheme information and investment terms.'),
  ]
  if (position.type === 'other') return [sourceSearch('Investment documents', `${name} official investment information`, 'Confirm the investment identity and its risks.')]
  const { exchange } = normalizePosition(position)
  const links: ResearchLink[] = []
  if (supportsCompanyResearch({ ...position, exchange })) links.push({
    label: 'Company financials',
    url: screenerPath && validCompanyPath(screenerPath) ? `https://www.screener.in${screenerPath}` : screenerFallbackSearchUrl(`${name} ${exchange}`),
    description: 'Review earnings, cash flow, ownership and peers at the source.',
    kind: screenerPath && validCompanyPath(screenerPath) ? 'page' : 'search',
  })
  if (exchange === 'NSE') links.push({ label: 'Exchange quote', url: `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`, description: 'Open the NSE quote and company disclosures.', kind: 'page' })
  else if (exchange === 'BSE') links.push(sourceSearch('Exchange quote', `site:bseindia.com ${name} ${symbol} quote`, 'Find the matching BSE security page.'))
  else links.push(sourceSearch('Company filings', `${name} ${exchange} investor relations official filings`, 'Find official reports for this listing.'))
  if (exchange && ['NSE', 'BSE', 'NASDAQ', 'NYSE', 'LSE'].includes(exchange)) links.push({ label: 'Price chart', url: `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(`${exchange}:${symbol}`)}`, description: 'Explore market price history on TradingView.', kind: 'page' })
  if (position.type === 'etf') links.push(sourceSearch('Issuer factsheet', `${name} official ETF factsheet tracking difference expense ratio`, 'Review the index, costs and tracking at the issuer.'))
  return links
}

export function reviewQuestions(type: Position['type']): { id: string; text: string }[] {
  if (type === 'mutual-fund') return [
    { id: 'mandate', text: 'Confirm the scheme, plan and investment mandate' },
    { id: 'cost', text: 'Review fees, exit load and the latest factsheet' },
    { id: 'risk', text: 'Check risk, benchmark and underlying holdings' },
    { id: 'thesis', text: 'Revisit why this fund belongs in my portfolio' },
  ]
  if (type === 'etf') return [
    { id: 'index', text: 'Confirm the tracked index or underlying asset' },
    { id: 'tracking', text: 'Review costs and tracking difference' },
    { id: 'liquidity', text: 'Check liquidity and the issuer factsheet' },
    { id: 'thesis', text: 'Revisit why I own this ETF' },
  ]
  if (type === 'other') return [
    { id: 'identity', text: 'Confirm the investment and its source documents' },
    { id: 'risk', text: 'Review costs, risks and liquidity' },
    { id: 'thesis', text: 'Record why I own it and what would change my view' },
  ]
  return [
    { id: 'results', text: 'Read the latest results and business updates' },
    { id: 'cash', text: 'Check cash flow, debt and valuation' },
    { id: 'ownership', text: 'Review ownership and governance' },
    { id: 'thesis', text: 'Revisit the original reason to own this company' },
  ]
}
