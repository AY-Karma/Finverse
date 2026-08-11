import type { Folio, Position, Settings } from './types'

const FOLIOS_KEY = 'finverse:folios'
const LEGACY_POSITIONS_KEY = 'finverse:positions'
const SETTINGS_KEY = 'finverse:settings'
const SESSION_API_KEY = 'finverse:apiKey:session'

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
  try {
    const raw = localStorage.getItem(LEGACY_POSITIONS_KEY)
    if (raw) {
      const positions = JSON.parse(raw) as Position[]
      if (Array.isArray(positions) && positions.length > 0) {
        return [{ id: crypto.randomUUID(), name: 'My portfolio', importedAt: Date.now(), positions }]
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
    provider: '', apiKey: '', model: '', baseUrl: '', currency: 'INR', allowExternalData: false,
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
    return { ...defaults, ...parsed, apiKey: loadSessionApiKey() || legacyApiKey }
  } catch {
    return defaults
  }
}
