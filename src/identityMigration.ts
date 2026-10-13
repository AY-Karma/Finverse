import { migrateFolioIdentities } from './instruments'
import { hasCompatibleFundScheme } from './fundSchemes'
import type { Folio, Settings } from './types'
import { validateWorkspaceArchive } from './workspaceArchive'
import { remapMonitorReferences } from './workspaceReferences'
import { captureWorkspaceRecords, writeWorkspaceRecords } from './workspaceStorage'

export { migrateFolioIdentities }

const DEFAULT_SETTINGS: Settings = { currency: 'INR', allowExternalData: false, density: 'comfortable', accent: 'indigo', mode: 'dark', hideValues: false }
const EMPTY_MONITOR = { version: 1, rules: [], events: [], alerts: [] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readSaved(raw: string | null, label: string, fallback: unknown): unknown {
  if (raw === null) return fallback
  try { return JSON.parse(raw) } catch { throw new Error(`Saved ${label} could not be read. Keep your browser data and restore a valid backup before retrying.`) }
}

function sameData(left: unknown, right: unknown): boolean {
  const stable = (value: unknown) => JSON.stringify(value, (_key, item: unknown) => isRecord(item)
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item)
  return stable(left) === stable(right)
}

function legacyFolios(value: unknown): unknown {
  if (!Array.isArray(value)) throw new Error('Saved legacy holdings are invalid. Keep your browser data and restore a valid backup before retrying.')
  if (value.length === 0) return []
  const positions = value.map((position: unknown) => isRecord(position)
    ? { ...position, name: position.name === undefined ? '' : position.name, lastPrice: position.lastPrice === undefined ? null : position.lastPrice } : position)
  return [{ id: 'legacy-portfolio', name: 'My portfolio', importedAt: Date.now(), positions }]
}

function validatePositionIds(folios: Folio[]): void {
  const ids = folios.flatMap((folio) => folio.positions.map((position) => position.id))
  if (new Set(ids).size !== ids.length) throw new Error('Saved holdings contain a duplicate ID across accounts. Keep your browser data and resolve the duplicate before retrying.')
}

/** Validate untouched persisted records before normalizing identities or replacing any storage. */
export async function migrateWorkspaceIdentities(): Promise<{ changed: boolean; error: string | null }> {
  try {
    const expected = captureWorkspaceRecords()
    const hasLegacyPositions = expected['finverse:folios'] === null && expected['finverse:positions'] !== null
    const folios = hasLegacyPositions ? legacyFolios(readSaved(expected['finverse:positions'], 'legacy holdings', []))
      : readSaved(expected['finverse:folios'], 'holdings', [])
    const preferences = readSaved(expected['finverse:settings'], 'preferences', DEFAULT_SETTINGS)
    if (!isRecord(preferences)) throw new Error('Saved preferences are invalid. Keep your browser data and restore a valid backup before retrying.')
    const monitor = readSaved(expected['finverse:monitor:v1'], 'Monitor data', EMPTY_MONITOR)
    if (!isRecord(monitor) || monitor.version !== 1) throw new Error('Saved Monitor data uses an unsupported version. Keep your browser data and restore a supported backup before retrying.')
    const original = validateWorkspaceArchive({
      format: 'finverse-workspace', version: 1, exportedAt: Date.now(), folios,
      settings: { ...DEFAULT_SETTINGS, ...preferences },
      snapshots: readSaved(expected['finverse:portfolio-snapshots'], 'tracked balances', []), monitor,
    })
    validatePositionIds(original.folios)
    const migratedFolios = migrateFolioIdentities(original.folios)
    const identityChanged = !sameData(original.folios, migratedFolios)
    const historyNeedsReview = original.folios.some((folio) => folio.positions.some((position) => position.type === 'mutual-fund' && !hasCompatibleFundScheme(position)))
      && original.snapshots.some((snapshot) => !snapshot.dataQuality)
    const migratedMonitor = remapMonitorReferences(original.monitor, original.folios.flatMap((folio) => folio.positions), migratedFolios.flatMap((folio) => folio.positions))
    if (!identityChanged && !historyNeedsReview && !hasLegacyPositions && sameData(original.monitor, migratedMonitor)) return { changed: false, error: null }
    const snapshots = identityChanged || historyNeedsReview ? original.snapshots.map((snapshot) => ({ ...snapshot, dataQuality: 'legacy-instrument-identity' as const })) : original.snapshots
    const migrated = validateWorkspaceArchive({ ...original, folios: migratedFolios, snapshots, monitor: migratedMonitor })
    const next = {
      ...expected,
      'finverse:folios': JSON.stringify(migrated.folios),
      'finverse:portfolio-snapshots': expected['finverse:portfolio-snapshots'] === null ? null : JSON.stringify(migrated.snapshots),
      'finverse:monitor:v1': expected['finverse:monitor:v1'] === null ? null : JSON.stringify({ version: 1, ...migrated.monitor }),
      'finverse:positions': hasLegacyPositions ? null : expected['finverse:positions'],
    }
    await writeWorkspaceRecords(next, expected, { keepRecoveryCopy: false, invalidateCaches: identityChanged })
    return { changed: true, error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Workspace identity migration is unavailable. Keep your browser data and reload to retry.'
    return { changed: false, error: message.replace('The backup contains', 'Saved workspace data contains') }
  }
}
