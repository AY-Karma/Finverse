import type { AccountStatement, Folio, PortfolioSnapshot, Position, Settings } from './types'
import type { MonitorAlert, MonitorEvent, MonitorMetric, MonitorRule, MonitorState } from './monitor'
import { holdingIdentity } from './monitor'
import { parseMonitorReadingState } from './monitorReading'
import { combinePositions } from './valuation'
import { migrateFolioIdentities } from './instruments'
import { hasCompatibleFundScheme } from './fundSchemes'
import { remapMonitorReferences } from './workspaceReferences'
import { writeWorkspaceRecords, type WorkspaceRecords } from './workspaceStorage'

export { captureWorkspaceRecords, hasWorkspaceRecovery, recoverWorkspaceWrite, restorePreviousWorkspace } from './workspaceStorage'
export type { WorkspaceRecords } from './workspaceStorage'
export const MAX_WORKSPACE_ARCHIVE_BYTES = 10 * 1024 * 1024

export interface WorkspaceArchive {
  format: 'finverse-workspace'
  version: 1
  exportedAt: number
  folios: Folio[]
  settings: Settings
  snapshots: PortfolioSnapshot[]
  monitor: MonitorState
}
export interface WorkspaceArchivePreview { archive: WorkspaceArchive; legacy: boolean; warnings: string[] }

const MAX_NUMBER = Number.MAX_SAFE_INTEGER
const MAX_DATE = 8_640_000_000_000_000
const DEFAULT_SETTINGS: Settings = { currency: 'INR', allowExternalData: false, density: 'comfortable', accent: 'cobalt', mode: 'dark', hideValues: false }

function fail(label: string): never { throw new Error(`The backup contains an invalid ${label}. Your current workspace was not changed.`) }
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(label)
  return value as Record<string, unknown>
}
function text(value: unknown, label: string, empty = false, maximum = 500): string {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > maximum) return fail(label)
  return value
}
function number(value: unknown, label: string, minimum = 0, maximum = MAX_NUMBER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) return fail(label)
  return value
}
function integer(value: unknown, label: string, maximum = MAX_NUMBER): number {
  const parsed = number(value, label, 0, maximum)
  return Number.isSafeInteger(parsed) ? parsed : fail(label)
}
function boolean(value: unknown, label: string): boolean { return typeof value === 'boolean' ? value : fail(label) }
function choice<const T extends string>(value: unknown, values: readonly T[], label: string): T {
  return typeof value === 'string' && values.includes(value as T) ? value as T : fail(label)
}
function list<T>(value: unknown, maximum: number, label: string, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > maximum) return fail(label)
  return value.map(parse)
}
function unique<T extends { id: string }>(items: T[], label: string): T[] {
  if (new Set(items.map((item) => item.id)).size !== items.length) return fail(`duplicate ${label} ID`)
  return items
}
function optionalText(value: unknown, label: string): string | undefined { return value === undefined ? undefined : text(value, label, true) }
function nullableNumber(value: unknown, label: string, minimum = 0): number | null {
  return value === null ? null : number(value, label, minimum)
}
function validDate(value: unknown, label: string): string {
  const date = text(value, label)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) return fail(label)
  return date
}

function parsePosition(value: unknown): Position {
  const row = object(value, 'holding')
  const position: Position = {
    id: text(row.id, 'holding ID'), ticker: text(row.ticker, 'holding symbol'), name: text(row.name, 'holding name', true),
    type: choice(row.type, ['stock', 'etf', 'mutual-fund', 'other'], 'asset type'),
    quantity: number(row.quantity, 'quantity'), buyPrice: number(row.buyPrice, 'purchase price'),
    invested: number(row.invested, 'invested amount'), lastPrice: nullableNumber(row.lastPrice, 'latest price'),
  }
  for (const key of ['amc', 'category', 'subCategory', 'folio', 'source', 'instrumentKey', 'isin', 'providerSymbol', 'sector', 'industry'] as const) {
    if (row[key] !== undefined) position[key] = optionalText(row[key], key)
  }
  if (row.exchange !== undefined) position.exchange = choice(row.exchange, ['NSE', 'BSE', 'NASDAQ', 'NYSE', 'LSE', 'OTHER'], 'exchange')
  if (row.currency !== undefined) {
    const currency = text(row.currency, 'currency')
    if (currency === 'INR') position.currency = currency
    else position.reportedCurrency = currency
  }
  if (row.identityVersion !== undefined) {
    if (row.identityVersion !== 2) return fail('instrument identity version')
    Object.assign(position, { identityVersion: 2 })
  }
  if (row.exchangeSource !== undefined) Object.assign(position, { exchangeSource: choice(row.exchangeSource, ['explicit', 'inferred'], 'exchange source') })
  for (const key of ['identityIssue', 'reportedExchange', 'reportedCurrency'] as const) {
    if (row[key] !== undefined) Object.assign(position, { [key]: optionalText(row[key], key)?.trim() || position[key] })
  }
  if (row.returns !== undefined) position.returns = nullableNumber(row.returns, 'reported gain', -MAX_NUMBER)
  if (row.xirr !== undefined) position.xirr = nullableNumber(row.xirr, 'reported XIRR', -MAX_NUMBER)
  if (row.priceAsOf !== undefined) position.priceAsOf = row.priceAsOf === null ? null : validDate(row.priceAsOf, 'imported price date')
  if (row.mfScheme !== undefined) {
    const mapping = object(row.mfScheme, 'fund mapping')
    if (position.type !== 'mutual-fund') return fail('fund mapping on a non-fund holding')
    const code = integer(mapping.code, 'fund scheme code')
    if (!code) return fail('fund scheme code')
    Object.assign(position, { mfScheme: { code, name: text(mapping.name, 'fund scheme name'), source: choice(mapping.source, ['exact', 'confirmed'], 'fund mapping source') } })
    if (!position.reportedCurrency && !hasCompatibleFundScheme(position)) return fail('fund mapping that conflicts with its plan, option or native currency')
  }
  return position
}

function parseStatement(value: unknown): AccountStatement {
  const row = object(value, 'statement metadata')
  return {
    id: text(row.id, 'statement ID'), fileName: text(row.fileName, 'statement filename'),
    statementDate: row.statementDate === null ? null : validDate(row.statementDate, 'statement date'),
    completeness: choice(row.completeness, ['complete', 'partial', 'unknown'], 'statement completeness'),
  }
}

function parseFolio(value: unknown): Folio {
  const row = object(value, 'account')
  const folio: Folio = {
    id: text(row.id, 'account ID'), name: text(row.name, 'account alias'), importedAt: number(row.importedAt, 'upload time', 0, MAX_DATE),
    positions: unique(list(row.positions, 5_000, 'account holdings', parsePosition), 'holding'),
  }
  if (row.statement !== undefined) folio.statement = parseStatement(row.statement)
  if (row.reviewedAt !== undefined) folio.reviewedAt = number(row.reviewedAt, 'holdings review time', 0, MAX_DATE)
  if (row.previousRevision !== undefined) {
    const previous = object(row.previousRevision, 'previous account revision')
    if (previous.previousRevision !== undefined) return fail('nested account revision')
    folio.previousRevision = {
      importedAt: number(previous.importedAt, 'previous upload time', 0, MAX_DATE),
      positions: unique(list(previous.positions, 5_000, 'previous holdings', parsePosition), 'previous holding'),
      statement: parseStatement(previous.statement),
      ...(previous.reviewedAt !== undefined ? { reviewedAt: number(previous.reviewedAt, 'previous holdings review time', 0, MAX_DATE) } : {}),
    }
  }
  if (row.lastOperation !== undefined) {
    folio.lastOperation = choice(row.lastOperation, ['added', 'updated'], 'account operation')
    folio.operationAt = number(row.operationAt, 'account operation time', 0, MAX_DATE)
  } else if (row.operationAt !== undefined) return fail('account operation')
  return folio
}

function parseSettings(value: unknown): Settings {
  const row = object(value, 'preferences')
  const settings: Settings = {
    currency: 'INR', allowExternalData: boolean(row.allowExternalData, 'external-data preference'),
    density: choice(row.density, ['comfortable', 'compact'], 'density'), accent: 'cobalt',
    mode: choice(row.mode, ['dark', 'light'], 'theme'), hideValues: boolean(row.hideValues, 'hidden-values preference'),
  }
  return settings
}

function parseSnapshot(value: unknown): PortfolioSnapshot {
  const row = object(value, 'tracked balance')
  const snapshot: PortfolioSnapshot = {
    at: number(row.at, 'balance timestamp', 0, MAX_DATE), value: number(row.value, 'balance value'), invested: number(row.invested, 'balance cost'),
    pnl: number(row.pnl, 'balance gain', -MAX_NUMBER), holdingCount: integer(row.holdingCount, 'balance holding count', 500_000),
  }
  if (row.event !== undefined) {
    const event = object(row.event, 'balance event')
    snapshot.event = { kind: choice(event.kind, ['account-import', 'account-update', 'account-undo', 'account-remove'], 'balance event kind'), accountId: text(event.accountId, 'balance account ID'), statementId: text(event.statementId, 'balance statement ID') }
  }
  if (row.dataQuality !== undefined) Object.assign(snapshot, { dataQuality: choice(row.dataQuality, ['legacy-instrument-identity'], 'balance data quality') })
  return snapshot
}

function parseRule(value: unknown): MonitorRule {
  const row = object(value, 'watch rule')
  const threshold = number(row.threshold, 'watch threshold')
  if (!threshold) return fail('watch threshold')
  return {
    id: text(row.id, 'watch rule ID'), holding: text(row.holding, 'watch holding', true), holdingId: text(row.holdingId, 'watch holding ID'),
    instrumentIdentity: text(row.instrumentIdentity, 'watch identity'), condition: choice(row.condition, ['price_above', 'price_below', 'daily_move'], 'watch condition'),
    threshold, active: boolean(row.active, 'watch active state'),
    ...(row.unresolved !== undefined ? { unresolved: boolean(row.unresolved, 'watch reference state') } : {}),
  }
}
function parseEvent(value: unknown): MonitorEvent {
  const row = object(value, 'reminder')
  return {
    id: text(row.id, 'reminder ID'), holding: text(row.holding, 'reminder holding', true),
    ...(row.holdingId !== undefined ? { holdingId: text(row.holdingId, 'reminder holding ID') } : {}),
    title: text(row.title, 'reminder title', false, 160), date: validDate(row.date, 'reminder date'), kind: choice(row.kind, ['Reminder'], 'reminder kind'), reminder: boolean(row.reminder, 'reminder state'),
    ...(row.unresolved !== undefined ? { unresolved: boolean(row.unresolved, 'reminder reference state') } : {}),
  }
}
function parseMetric(value: unknown): MonitorMetric {
  const row = object(value, 'alert metric')
  return { label: text(row.label, 'metric label', false, 80), value: text(row.value, 'metric value', false, 100), ...(row.trend !== undefined ? { trend: choice(row.trend, ['up', 'down', 'neutral'], 'metric direction') } : {}) }
}
function parseAlert(value: unknown): MonitorAlert {
  const row = object(value, 'historical alert')
  return {
    id: text(row.id, 'alert ID'), holding: text(row.holding, 'alert holding', true), holdingId: text(row.holdingId, 'alert holding ID'),
    title: text(row.title, 'alert title', true), reason: text(row.reason, 'alert reason', true), evidence: text(row.evidence, 'alert evidence', true, 2000),
    kind: choice(row.kind, ['price'], 'alert kind'), state: choice(row.state, ['open', 'reviewed', 'snoozed'], 'alert review state'),
    observationKey: text(row.observationKey, 'alert observation key', false, 2000), time: text(row.time, 'alert display time', true, 80),
    at: number(row.at, 'alert timestamp', 1, Math.min(MAX_DATE, Date.now() + 300_000)), metrics: list(row.metrics, 6, 'alert metrics', parseMetric),
    ...(row.snoozedUntil !== undefined ? { snoozedUntil: number(row.snoozedUntil, 'snooze deadline', 1, MAX_DATE) } : {}),
  }
}
function parseMonitor(value: unknown): MonitorState {
  const row = object(value, 'Monitor data')
  return {
    rules: unique(list(row.rules, 200, 'watch rules', parseRule), 'watch rule'),
    events: unique(list(row.events, 200, 'reminders', parseEvent), 'reminder'),
    alerts: unique(list(row.alerts, 200, 'historical alerts', parseAlert), 'alert'),
    ...(row.reading !== undefined ? { reading: parseMonitorReadingState(row.reading) } : {}),
  }
}

function validateReferences(archive: WorkspaceArchive): string[] {
  const raw = archive.folios.flatMap((folio) => folio.positions)
  unique(raw, 'holding across accounts')
  const holdings = new Map([...raw, ...combinePositions(raw)].map((position) => [position.id, position]))
  const unresolved = (item: object): boolean => 'unresolved' in item && item.unresolved === true
  for (const rule of archive.monitor.rules) {
    const holding = holdings.get(rule.holdingId)
    if (!unresolved(rule) && (!holding || holdingIdentity(holding) !== rule.instrumentIdentity)) throw new Error('A watch rule does not match a holding in this backup. Resolve its holding reference before restoring.')
  }
  for (const reminder of archive.monitor.events) {
    if (!unresolved(reminder) && reminder.holdingId && !holdings.has(reminder.holdingId)) throw new Error('A reminder refers to a missing holding. Resolve its holding reference before restoring.')
  }
  const warnings: string[] = []
  if (archive.monitor.rules.some(unresolved) || archive.monitor.events.some(unresolved)) warnings.push('Unresolved watch rules and reminders are preserved for review and will not be evaluated until their holding references are resolved.')
  if (archive.monitor.alerts.some((alert) => !holdings.has(alert.holdingId))) warnings.push('Historical alerts for removed holdings are preserved as past observations.')
  return warnings
}

export function validateWorkspaceArchive(value: unknown): WorkspaceArchive {
  const row = object(value, 'workspace archive')
  if (row.format !== 'finverse-workspace' || row.version !== 1) throw new Error('This workspace backup version is unsupported. Your current workspace was not changed.')
  return {
    format: 'finverse-workspace', version: 1, exportedAt: number(row.exportedAt, 'export time', 0, MAX_DATE),
    folios: unique(list(row.folios, 100, 'accounts', parseFolio), 'account'), settings: parseSettings(row.settings),
    snapshots: list(row.snapshots, 730, 'tracked balances', parseSnapshot), monitor: parseMonitor(row.monitor),
  }
}

export function createWorkspaceArchive(folios: Folio[], settings: Settings, snapshots: PortfolioSnapshot[], monitor?: MonitorState): WorkspaceArchive {
  let state = monitor
  if (!state) {
    const raw = localStorage.getItem('finverse:monitor:v1')
    if (!raw) state = { rules: [], events: [], alerts: [] }
    else {
      let stored: Record<string, unknown>
      try { stored = object(JSON.parse(raw), 'saved Monitor data') } catch { throw new Error('Saved Monitor data could not be read. Keep your browser data before exporting.') }
      if (stored.version !== 1) throw new Error('Saved Monitor data uses an unsupported version.')
      state = parseMonitor(stored)
    }
  }
  const archive = validateWorkspaceArchive({ format: 'finverse-workspace', version: 1, exportedAt: Date.now(), folios, settings, snapshots, monitor: state })
  validateReferences(archive)
  if (new TextEncoder().encode(JSON.stringify(archive, null, 2)).byteLength > MAX_WORKSPACE_ARCHIVE_BYTES) throw new Error('This workspace exceeds the 10 MB backup limit. Reduce retained data before exporting.')
  return archive
}

export function parseWorkspaceArchive(content: string): WorkspaceArchivePreview {
  if (new TextEncoder().encode(content).byteLength > MAX_WORKSPACE_ARCHIVE_BYTES) throw new Error('Workspace backups must be 10 MB or smaller.')
  let value: unknown
  try { value = JSON.parse(content) } catch { throw new Error('This file is not valid JSON. Choose a Finverse workspace backup.') }
  const row = object(value, 'workspace backup')
  const legacy = row.format === undefined && row.version === undefined && row.exportedAt !== undefined && Array.isArray(row.folios)
  let archive = validateWorkspaceArchive(legacy ? {
    format: 'finverse-workspace', version: 1, exportedAt: row.exportedAt, folios: row.folios,
    settings: DEFAULT_SETTINGS, snapshots: [], monitor: { rules: [], events: [], alerts: [] },
  } : row)
  const migratedFolios = migrateFolioIdentities(archive.folios)
  const migrated = JSON.stringify(migratedFolios) !== JSON.stringify(archive.folios)
  if (migrated) {
    archive = {
      ...archive, folios: migratedFolios,
      monitor: remapMonitorReferences(archive.monitor, archive.folios.flatMap((folio) => folio.positions), migratedFolios.flatMap((folio) => folio.positions)),
      snapshots: archive.snapshots.map((snapshot) => ({ ...snapshot, dataQuality: 'legacy-instrument-identity' })),
    }
  }
  const warnings = validateReferences(archive)
  if (migrated) warnings.unshift('Older instrument identities have been migrated. Unverified listings need review; recorded balances are preserved and flagged, not recalculated.')
  if (legacy) warnings.unshift('This legacy backup restores holdings only. It contains no tracked balances, preferences, watch rules, reminders or alert history; those cannot be recovered from this file.')
  warnings.push('Restoring replaces the whole workspace. External market data stays off until you enable it again.')
  return { archive, legacy, warnings }
}

export async function restoreWorkspaceArchive(value: WorkspaceArchive, expectedRecords: WorkspaceRecords): Promise<void> {
  const { archive } = parseWorkspaceArchive(JSON.stringify(value))
  const records: WorkspaceRecords = {
    'finverse:folios': JSON.stringify(archive.folios), 'finverse:settings': JSON.stringify({ ...archive.settings, allowExternalData: false }),
    'finverse:portfolio-snapshots': JSON.stringify(archive.snapshots), 'finverse:monitor:v1': JSON.stringify({ version: 1, ...archive.monitor }), 'finverse:positions': null,
  }
  await writeWorkspaceRecords(records, expectedRecords)
}
