import type { AccountRevision, AccountStatement, Folio, Position, Settings } from './types'
import { normalizePosition } from './instruments'
import { workspaceWritesBlocked } from './workspaceStorage'
import { isMfSchemeMapping } from './fundSchemes'

const FOLIOS_KEY = 'finverse:folios'
const LEGACY_POSITIONS_KEY = 'finverse:positions'
const SETTINGS_KEY = 'finverse:settings'

const MAX_PERSISTED_FOLIOS = 100
const MAX_PERSISTED_POSITIONS_PER_FOLIO = 5_000
const MAX_PERSISTED_TEXT = 500

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function persistedText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_PERSISTED_TEXT) : fallback
}

function persistedNumber(value: unknown, fallback: number | null = null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function persistedDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = Date.parse(`${value}T12:00:00Z`)
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? value : null
}

function sanitizeStatement(value: unknown): AccountStatement | null {
  if (!isRecord(value)) return null
  const id = persistedText(value.id)
  const fileName = persistedText(value.fileName)
  const statementDate = value.statementDate === null ? null : persistedDate(value.statementDate)
  const completeness = value.completeness
  if (!id || !fileName || (value.statementDate !== null && !statementDate)
    || (completeness !== 'complete' && completeness !== 'partial' && completeness !== 'unknown')) return null
  return { id, fileName, statementDate, completeness }
}

function sanitizePosition(value: unknown): Position | null {
  if (!isRecord(value)) return null
  const type = value.type
  if (type !== 'stock' && type !== 'etf' && type !== 'mutual-fund' && type !== 'other') return null
  const quantity = persistedNumber(value.quantity)
  const buyPrice = persistedNumber(value.buyPrice)
  const invested = persistedNumber(value.invested)
  if (!persistedText(value.id) || !persistedText(value.ticker) || quantity == null || buyPrice == null || invested == null) return null

  const optionalNumber = (key: string) => persistedNumber(value[key])
  const optionalText = (key: string) => persistedText(value[key]) || undefined
  const providerSymbol = optionalText('providerSymbol')
  const priceAsOf = persistedDate(value.priceAsOf)
  const exchange = value.exchange === 'NSE' || value.exchange === 'BSE' || value.exchange === 'NASDAQ' || value.exchange === 'NYSE' || value.exchange === 'LSE' || value.exchange === 'OTHER' ? value.exchange : undefined
  const currency = optionalText('currency')
  return normalizePosition({
    id: persistedText(value.id),
    ticker: persistedText(value.ticker),
    name: persistedText(value.name),
    type,
    quantity,
    buyPrice,
    lastPrice: optionalNumber('lastPrice'),
    ...(value.priceAsOf === null ? { priceAsOf: null } : priceAsOf ? { priceAsOf } : {}),
    invested,
    amc: optionalText('amc'),
    category: optionalText('category'),
    subCategory: optionalText('subCategory'),
    folio: optionalText('folio'),
    source: optionalText('source'),
    returns: optionalNumber('returns'),
    xirr: optionalNumber('xirr'),
    mfScheme: type === 'mutual-fund' && isMfSchemeMapping(value.mfScheme)
      ? { code: value.mfScheme.code, name: value.mfScheme.name.trim(), source: value.mfScheme.source }
      : undefined,
    instrumentKey: optionalText('instrumentKey'),
    isin: optionalText('isin'),
    exchange,
    providerSymbol,
    currency: value.currency === 'INR' ? 'INR' : undefined,
    sector: optionalText('sector'),
    industry: optionalText('industry'),
    identityVersion: value.identityVersion === 2 ? 2 : undefined,
    exchangeSource: value.exchangeSource === 'explicit' || value.exchangeSource === 'inferred' ? value.exchangeSource : undefined,
    identityIssue: optionalText('identityIssue'),
    reportedExchange: optionalText('reportedExchange'),
    reportedCurrency: optionalText('reportedCurrency') || (currency !== 'INR' ? currency : undefined),
  })
}

function sanitizeRevision(value: unknown): AccountRevision | null {
  if (!isRecord(value) || value.previousRevision !== undefined || !Array.isArray(value.positions) || value.positions.length > MAX_PERSISTED_POSITIONS_PER_FOLIO) return null
  const statement = sanitizeStatement(value.statement)
  const importedAt = persistedNumber(value.importedAt)
  const positions = value.positions.map(sanitizePosition).filter((position): position is Position => position !== null)
  if (!statement || importedAt == null || importedAt < 0 || positions.length !== value.positions.length) return null
  const reviewedAt = persistedNumber(value.reviewedAt)
  return { statement, importedAt, positions, ...(reviewedAt != null && reviewedAt >= 0 ? { reviewedAt } : {}) }
}

function sanitizeFolio(value: unknown): Folio | null {
  if (!isRecord(value) || !Array.isArray(value.positions)) return null
  if (value.positions.length > MAX_PERSISTED_POSITIONS_PER_FOLIO) return null
  const positions = value.positions.map(sanitizePosition).filter((p): p is Position => p !== null)
  const importedAt = persistedNumber(value.importedAt)
  const id = persistedText(value.id)
  const name = persistedText(value.name)
  if (!id || !name || importedAt == null) return null
  const folio: Folio = { id, name, importedAt, positions }
  const reviewedAt = persistedNumber(value.reviewedAt)
  if (reviewedAt != null && reviewedAt >= 0) folio.reviewedAt = reviewedAt
  const statement = sanitizeStatement(value.statement)
  const previousRevision = sanitizeRevision(value.previousRevision)
  if (statement) folio.statement = statement
  if (previousRevision) folio.previousRevision = previousRevision
  const operationAt = persistedNumber(value.operationAt)
  if (operationAt != null && operationAt >= 0
    && (value.lastOperation === 'added' || (value.lastOperation === 'updated' && previousRevision))) {
    folio.lastOperation = value.lastOperation
    folio.operationAt = operationAt
  }
  return folio
}

/** Validate the persisted boundary so malformed browser data cannot reach React state. */
export function sanitizeFolios(value: unknown): Folio[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_PERSISTED_FOLIOS).map(sanitizeFolio).filter((f): f is Folio => f !== null)
}

export function saveFolios(folios: Folio[]): boolean {
  if (workspaceWritesBlocked()) return false
  try {
    localStorage.setItem(FOLIOS_KEY, JSON.stringify(folios.map((folio) => ({
      ...folio, positions: folio.positions.map(normalizePosition),
      ...(folio.previousRevision ? { previousRevision: { ...folio.previousRevision, positions: folio.previousRevision.positions.map(normalizePosition) } } : {}),
    }))))
    return true
  } catch {
    return false
  }
}

export function loadFolios(): Folio[] {
  try {
    const raw = localStorage.getItem(FOLIOS_KEY)
    if (raw) return sanitizeFolios(JSON.parse(raw))
  } catch {
    /* fall through to migration */
  }
  try {
    const raw = localStorage.getItem(LEGACY_POSITIONS_KEY)
    if (raw) {
      const positions = JSON.parse(raw)
      const sanitized = Array.isArray(positions) ? positions.map(sanitizePosition).filter((p): p is Position => p !== null) : []
      if (sanitized.length > 0) {
        return [{ id: crypto.randomUUID(), name: 'My portfolio', importedAt: Date.now(), positions: sanitized }]
      }
    }
  } catch {
    /* ignore an invalid legacy record */
  }
  return []
}

export function saveSettings(settings: Settings): boolean {
  if (workspaceWritesBlocked()) return false
  const { allowExternalData, density, accent, customAccent, mode, hideValues } = settings
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ currency: 'INR', allowExternalData, density, accent, customAccent, mode, hideValues }))
    return true
  } catch {
    return false
  }
}

function clearRetiredStorage(): void {
  for (const key of ['finverse:chat', 'finverse:quickMode', 'finverse:apiKey:session', 'finverse:monitorNewsApiKey:session']) {
    try {
      localStorage.removeItem(key)
    } catch {
      /* storage unavailable */
    }
    try {
      sessionStorage.removeItem(key)
    } catch {
      /* storage unavailable */
    }
  }
}

export function loadSettings(): Settings {
  const defaults: Settings = {
    currency: 'INR', allowExternalData: false,
    density: 'comfortable', accent: 'indigo', mode: 'dark', hideValues: false,
  }
  clearRetiredStorage()
  let parsed: Record<string, unknown> = {}
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    const value: unknown = raw ? JSON.parse(raw) : {}
    if (isRecord(value)) parsed = value
  } catch {
    /* invalid or unavailable storage uses defaults */
  }
  const customAccent = typeof parsed.customAccent === 'string' && /^#[0-9a-fA-F]{6}$/.test(parsed.customAccent) ? parsed.customAccent.toLowerCase() : undefined
  const settings: Settings = {
    currency: defaults.currency,
    allowExternalData: parsed.allowExternalData === true,
    density: parsed.density === 'compact' ? 'compact' : defaults.density,
    accent: parsed.accent === 'emerald' || parsed.accent === 'cobalt' || parsed.accent === 'amber' || parsed.accent === 'custom' ? parsed.accent : defaults.accent,
    ...(customAccent ? { customAccent } : {}),
    mode: parsed.mode === 'light' ? 'light' : defaults.mode,
    hideValues: parsed.hideValues === true,
  }
  saveSettings(settings)
  return settings
}
