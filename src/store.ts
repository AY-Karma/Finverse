import type { Folio, Position, Settings } from './types'
import { normalizePosition } from './instruments'

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
  const exchange = value.exchange === 'NSE' || value.exchange === 'BSE' || value.exchange === 'NASDAQ' || value.exchange === 'NYSE' || value.exchange === 'LSE' || value.exchange === 'OTHER' ? value.exchange : undefined
  // Older equity imports had no recognizable Type column and were stored as "other";
  // a listed instrument on a real venue is a stock. Heals previously saved folios.
  const effectiveType = type === 'other' && (Boolean(providerSymbol) || (exchange != null && exchange !== 'OTHER')) ? 'stock' : type
  return normalizePosition({
    id: persistedText(value.id),
    ticker: persistedText(value.ticker),
    name: persistedText(value.name),
    type: effectiveType,
    quantity,
    buyPrice,
    lastPrice: optionalNumber('lastPrice'),
    invested,
    amc: optionalText('amc'),
    category: optionalText('category'),
    subCategory: optionalText('subCategory'),
    folio: optionalText('folio'),
    source: optionalText('source'),
    returns: optionalNumber('returns'),
    xirr: optionalNumber('xirr'),
    instrumentKey: optionalText('instrumentKey'),
    isin: optionalText('isin'),
    exchange,
    providerSymbol,
    currency: value.currency === 'USD' ? 'USD' : value.currency === 'INR' ? 'INR' : undefined,
    sector: optionalText('sector'),
    industry: optionalText('industry'),
  })
}

function sanitizeFolio(value: unknown): Folio | null {
  if (!isRecord(value) || !Array.isArray(value.positions)) return null
  if (value.positions.length > MAX_PERSISTED_POSITIONS_PER_FOLIO) return null
  const positions = value.positions.map(sanitizePosition).filter((p): p is Position => p !== null)
  const importedAt = persistedNumber(value.importedAt)
  const id = persistedText(value.id)
  const name = persistedText(value.name)
  if (!id || !name || importedAt == null) return null
  return { id, name, importedAt, positions }
}

/** Validate the persisted boundary so malformed browser data cannot reach React state. */
export function sanitizeFolios(value: unknown): Folio[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_PERSISTED_FOLIOS).map(sanitizeFolio).filter((f): f is Folio => f !== null)
}

export function saveFolios(folios: Folio[]): boolean {
  try {
    localStorage.setItem(FOLIOS_KEY, JSON.stringify(folios.map((folio) => ({ ...folio, positions: folio.positions.map(normalizePosition) }))))
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

export function saveSettings(settings: Settings): void {
  const { currency, allowExternalData, density, accent, customAccent, mode, hideValues } = settings
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ currency, allowExternalData, density, accent, customAccent, mode, hideValues }))
  } catch {
    /* storage unavailable or full */
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
    currency: parsed.currency === 'USD' ? 'USD' : defaults.currency,
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
