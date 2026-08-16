import type { Folio, Position, Settings } from './types'
import { normalizePosition } from './instruments'

const FOLIOS_KEY = 'finverse:folios'
const LEGACY_POSITIONS_KEY = 'finverse:positions'
const SETTINGS_KEY = 'finverse:settings'
const SESSION_API_KEY = 'finverse:apiKey:session'

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
  return normalizePosition({
    id: persistedText(value.id),
    ticker: persistedText(value.ticker),
    name: persistedText(value.name),
    type,
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
    exchange: value.exchange === 'NSE' || value.exchange === 'BSE' || value.exchange === 'NASDAQ' || value.exchange === 'NYSE' || value.exchange === 'LSE' || value.exchange === 'OTHER' ? value.exchange : undefined,
    providerSymbol: optionalText('providerSymbol'),
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

export function saveFolios(folios: Folio[]): void {
  localStorage.setItem(FOLIOS_KEY, JSON.stringify(folios.map((folio) => ({ ...folio, positions: folio.positions.map(normalizePosition) }))))
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

export function flattenFolios(folios: Folio[]): Position[] {
  return folios.flatMap((folio) => folio.positions)
}

/** Persist preferences only. Provider credentials are isolated to the current tab. */
export function saveSettings(settings: Settings): void {
  const persisted: Partial<Settings> = { ...settings }
  delete persisted.apiKey
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(persisted))
  } catch {
    /* storage unavailable or full */
  }
  try {
    if (settings.apiKey) sessionStorage.setItem(SESSION_API_KEY, settings.apiKey)
    else sessionStorage.removeItem(SESSION_API_KEY)
  } catch {
    /* session storage can be unavailable in privacy-restricted browsers */
  }
}

function loadSessionApiKey(): string {
  try {
    return sessionStorage.getItem(SESSION_API_KEY) ?? ''
  } catch {
    return ''
  }
}

export function loadSettings(): Settings {
  const defaults: Settings = {
    provider: '', apiKey: '', model: '', baseUrl: 'http://localhost:11434/v1', confirmRemoteOllama: false, currency: 'INR', allowExternalData: false,
    density: 'comfortable', accent: 'indigo', hideValues: false,
  }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    const parsed = raw ? (JSON.parse(raw) as Partial<Settings>) : {}
    const legacyApiKey = typeof parsed.apiKey === 'string' ? parsed.apiKey : ''
    delete parsed.apiKey
    if (legacyApiKey) {
      try {
        if (!loadSessionApiKey()) sessionStorage.setItem(SESSION_API_KEY, legacyApiKey)
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(parsed))
      } catch {
        /* retain the key in memory for this load if storage is blocked */
      }
    }
    const provider = parsed.provider === 'openai' || parsed.provider === 'anthropic' || parsed.provider === 'openrouter' || parsed.provider === 'ollama' ? parsed.provider : defaults.provider
    const currency = parsed.currency === 'USD' ? 'USD' : defaults.currency
    const density = parsed.density === 'compact' ? 'compact' : defaults.density
    const accent = parsed.accent === 'emerald' || parsed.accent === 'cobalt' || parsed.accent === 'amber' ? parsed.accent : defaults.accent
    return {
      ...defaults,
      ...parsed,
      provider,
      currency,
      density,
      accent,
      apiKey: loadSessionApiKey() || legacyApiKey,
      model: typeof parsed.model === 'string' ? parsed.model.slice(0, MAX_PERSISTED_TEXT) : defaults.model,
      baseUrl: typeof parsed.baseUrl === 'string' && parsed.baseUrl.trim() ? parsed.baseUrl.slice(0, MAX_PERSISTED_TEXT) : defaults.baseUrl,
      confirmRemoteOllama: parsed.confirmRemoteOllama === true,
      allowExternalData: parsed.allowExternalData === true,
      hideValues: parsed.hideValues === true,
    }
  } catch {
    return defaults
  }
}
