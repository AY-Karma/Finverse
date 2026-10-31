import type { AssetType, Exchange, Folio, Position } from './types'
import { hasCompatibleFundScheme } from './fundSchemes'
import { isMarketSymbol } from './marketDataProtocol'
import { isNsePricingListing } from './nsePricingProtocol'

const NSE_SERIES_SUFFIX = /-(EQ|BE|SM|ST|T|BL|Z|E|B|N|W)$/i
const EXCHANGES: Exchange[] = ['NSE', 'BSE', 'NASDAQ', 'NYSE', 'LSE', 'OTHER']
const ISIN_PATTERN = /^[A-Z]{2}[A-Z0-9]{9}\d$/
const LEGACY_IDENTITY_NOTICE = 'The original listing metadata was not verified. Confirm the exchange and provider symbol before using market data.'

function clean(value: string | undefined): string {
  return (value ?? '').trim()
}

function canonicalSymbol(value: string): string {
  return value.trim().toUpperCase().replace(/\.(NS|NSE|BO|BSE)$/i, '').replace(NSE_SERIES_SUFFIX, '')
}

export function isNumericBseScripCode(symbol: string): boolean {
  return /^\d+$/.test(canonicalSymbol(symbol))
}

function symbolExchange(value: string): Exchange | undefined {
  if (/\.(NS|NSE)$/i.test(value)) return 'NSE'
  if (/\.(BO|BSE)$/i.test(value)) return 'BSE'
  return undefined
}

/** The NSE inference is limited to ordinary ticker-shaped imports, never names, ISINs or numeric scrip codes. */
function normalizeListing(position: Position): Position {
  // Repair old equity-shaped rows without changing reviewed version 2 asset types.
  const type = position.identityVersion !== 2 && position.type === 'other'
    && (Boolean(position.providerSymbol) || (position.exchange && position.exchange !== 'OTHER' && EXCHANGES.includes(position.exchange))) ? 'stock' : position.type
  const ticker = canonicalSymbol(position.ticker)
  const explicitExchange = clean(position.exchange).toUpperCase()
  const reportedExchange = clean(position.reportedExchange)
  const exchange = EXCHANGES.includes(explicitExchange as Exchange) ? explicitExchange as Exchange
    : explicitExchange || reportedExchange ? 'OTHER'
      : symbolExchange(position.ticker) || symbolExchange(clean(position.providerSymbol)) || 'NSE'
  const exchangeSource = position.exchangeSource || (explicitExchange || reportedExchange ? 'explicit' : 'inferred')
  const { reportedCurrency, currency } = position
  const supportedExchange = exchange === 'NSE' || exchange === 'BSE'
  const providerSuffix = exchange === 'BSE' ? 'BO' : exchange === 'NSE' ? 'NS' : ''
  const providerSymbol = clean(position.providerSymbol).toUpperCase()
    || (providerSuffix ? `${ticker}.${providerSuffix}` : exchange === 'OTHER' ? '' : ticker)
  const isin = clean(position.isin).toUpperCase()
  let issue: string | undefined
  if (exchange === 'OTHER') issue = `The reported exchange ${reportedExchange || explicitExchange || 'is unknown'} needs review.`
  else if (reportedCurrency || !currency) issue = `The reported currency ${reportedCurrency || 'is unknown'} is unsupported. Imported amounts are retained for review.`
  else if (!supportedExchange) issue = 'Only NSE and BSE listings are supported.'
  else if (type !== 'stock' && type !== 'etf') issue = 'Confirm the supported holding type before using market data.'
  else if (isin && !ISIN_PATTERN.test(isin)) issue = 'The ISIN is invalid. Correct it before using market data.'
  else if (ISIN_PATTERN.test(ticker) && canonicalSymbol(providerSymbol) === ticker) issue = 'An ISIN alone does not identify a supported listing. Confirm the ticker and venue.'
  else if (exchange === 'BSE' && isNumericBseScripCode(providerSymbol)) issue = 'The numeric BSE mapping is not verified. Confirm the matching BSE provider symbol; imported values are retained.'
  else if (!position.providerSymbol && (!isMarketSymbol(ticker) || (!/[A-Z]/.test(ticker) && exchangeSource === 'inferred' && !symbolExchange(position.ticker)))) issue = 'The holding needs a ticker and a confirmed exchange. Names and numeric scrip codes are not inferred as NSE listings.'
  else if (!isMarketSymbol(providerSymbol) || providerSymbol.startsWith('^')) issue = 'The provider symbol is invalid or unsupported. Correct the listing before using market data.'
  else if ((symbolExchange(providerSymbol) && symbolExchange(providerSymbol) !== exchange)
    || (symbolExchange(position.ticker) && symbolExchange(position.ticker) !== exchange)) issue = 'The ticker or provider symbol conflicts with the exchange. Confirm the intended listing.'
  else if ((exchange === 'NSE' && !/\.NS$/.test(providerSymbol)) || (exchange === 'BSE' && !/\.BO$/.test(providerSymbol))) issue = 'The provider symbol needs the correct listing suffix for this exchange.'
  return {
    ...position, type, ticker, exchange, currency, providerSymbol: providerSymbol || undefined, isin: isin || undefined,
    identityVersion: 2, exchangeSource, identityIssue: issue || clean(position.identityIssue) || undefined,
    reportedExchange: reportedExchange || (explicitExchange && !EXCHANGES.includes(explicitExchange as Exchange) ? explicitExchange : undefined),
    reportedCurrency: reportedCurrency || (!currency ? 'Unknown' : undefined),
    sector: clean(position.sector || position.category) || undefined,
    industry: clean(position.industry || position.subCategory) || undefined,
  }
}

function listingKey(position: Position): string {
  if (position.identityIssue) return `EQ:v2:unresolved:${position.id}`
  if (hasVerifiedNsePricing(position)) position = { ...position, ...position.pricingListing }
  // ISIN identifies the security; venue/provider/currency identify the listing used for pricing.
  return ['EQ:v2', position.type, position.exchange || '', position.currency || '', position.providerSymbol || '', position.isin || '']
    .map((part, index) => index === 0 ? part : encodeURIComponent(part)).join(':')
}

export function listingIdentity(position: Position): string {
  if (position.type === 'mutual-fund') {
    if (unsupportedCurrency(position) || hasForeignExchange(position)) return `MF:unresolved:${position.id}`
    return hasCompatibleFundScheme(position) ? `MF:mfapi:${position.mfScheme!.code}` : `MF:${clean(position.name || position.ticker).toLowerCase()}`
  }
  return listingKey(normalizePosition(position))
}

/** Recomputed, versioned listing identity shared by valuation, quotes and research. */
export function instrumentKey(position: Position): string { return listingIdentity(position) }

export function needsInstrumentReview(position: Position): boolean {
  if (hasVerifiedNsePricing(position)) return false
  return !!position.identityIssue || (position.type !== 'mutual-fund' && position.exchangeSource !== 'explicit')
}

export function hasVerifiedNsePricing(position: Position): boolean {
  return isNsePricingListing(position.pricingListing) && position.type === position.pricingListing.type
    && position.isin?.trim().toUpperCase() === position.pricingListing.isin && hasInrDenomination(position)
    && (position.exchange === 'NSE' || position.exchange === 'BSE')
}

export function pricingProviderSymbol(position: Position): string | undefined {
  return hasVerifiedNsePricing(position) ? position.pricingListing!.providerSymbol : position.providerSymbol
}

export function hasInrDenomination(position: Pick<Position, 'currency' | 'reportedCurrency'>): boolean {
  return position.currency === 'INR' && !position.reportedCurrency
}

function hasForeignExchange(position: Position): boolean {
  return !!position.exchange && !['NSE', 'BSE', 'OTHER'].includes(position.exchange)
}

function unsupportedCurrency(position: Position): string | undefined {
  const reported = clean(position.reportedCurrency)
    || (position.currency && position.currency !== 'INR' ? String(position.currency).trim() : '')
  if (reported) return reported
  if (hasForeignExchange(position) && !position.currency) return 'Unknown'
  return undefined
}

export function normalizePosition(position: Position): Position {
  const reportedCurrency = unsupportedCurrency(position)
  position = { ...position, currency: reportedCurrency ? undefined : 'INR', reportedCurrency }
  if (position.type !== 'mutual-fund') {
    const normalized = normalizeListing(position)
    if (hasVerifiedNsePricing(normalized)) normalized.identityIssue = undefined
    else normalized.pricingListing = undefined
    return { ...normalized, instrumentKey: listingKey(normalized) }
  }
  return {
    ...position, ticker: clean(position.ticker), instrumentKey: listingIdentity(position),
    pricingListing: undefined,
    mfScheme: !hasForeignExchange(position) && hasCompatibleFundScheme(position) ? position.mfScheme : undefined,
    identityIssue: reportedCurrency ? `The reported currency ${reportedCurrency} is unsupported. Imported amounts are retained for review.`
      : hasForeignExchange(position) ? 'Only NSE and BSE listings are supported.' : position.identityIssue,
    sector: clean(position.sector || position.category) || undefined,
    industry: clean(position.industry || position.subCategory) || undefined,
  }
}

/** Old metadata is preserved as reported; the original discarded fields cannot be reconstructed. */
export function migrateFolioIdentities(folios: Folio[]): Folio[] {
  const migratePosition = (position: Position) => normalizePosition(position.type !== 'mutual-fund' && position.identityVersion !== 2
    ? { ...position, exchangeSource: 'inferred', identityIssue: position.identityIssue || LEGACY_IDENTITY_NOTICE }
    : position)
  return folios.map((folio) => {
    const result = { ...folio, positions: folio.positions.map(migratePosition) }
    const previous = 'previousRevision' in folio ? folio.previousRevision as { positions: Position[] } : undefined
    if (previous) Object.assign(result, { previousRevision: { ...previous, positions: previous.positions.map(migratePosition) } })
    return result
  })
}

export function instrumentLabel(position: Pick<Position, 'ticker' | 'name' | 'type'>): string {
  return position.type === 'mutual-fund' ? clean(position.name || position.ticker) : clean(position.ticker || position.name)
}

export function assetTypeLabel(type: AssetType): string {
  if (type === 'mutual-fund') return 'Mutual fund'
  if (type === 'etf') return 'ETF'
  if (type === 'stock') return 'Equity'
  return 'Other'
}
