import type { AccountStatement, Folio, Position } from './types'
import type { ImportPreview } from './useStore'
import { hasVerifiedNsePricing, listingIdentity, normalizePosition } from './instruments'

export interface StatementImportOptions {
  operation: 'add' | 'replace'
  accountId?: string
  accountAlias?: string
  statementDate: string | null
  complete: boolean
  expectedStatementId?: string
  allowUndatedReplacement?: boolean
}

export interface StatementImportPlan {
  nextFolios: Folio[]
  added: Position[]
  removed: Position[]
  changed: { before: Position; after: Position }[]
  warnings: string[]
  noOp: boolean
  accountId: string
  statementId: string
}

const MAX_ACCOUNTS = 100
const MAX_POSITIONS = 5_000

function copyPosition(position: Position): Position {
  return { ...position, ...(position.mfScheme ? { mfScheme: { ...position.mfScheme } } : {}),
    ...(position.pricingListing ? { pricingListing: { ...position.pricingListing } } : {}),
  }
}

function statementFor(account: Folio): AccountStatement {
  return account.statement ?? { id: `legacy:${account.id}`, fileName: account.name, statementDate: null, completeness: 'unknown' }
}

function validateDate(date: string | null, now: number): void {
  if (date === null) return
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`))
    || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new Error('Enter a valid statement date in YYYY-MM-DD format.')
  }
  const todayInIndia = new Date(now + 330 * 60_000).toISOString().slice(0, 10)
  if (date > todayInIndia) throw new Error('The statement date cannot be in the future.')
}

function holdingKey(position: Position): string {
  return JSON.stringify([listingIdentity(position), position.type === 'mutual-fund' ? position.folio?.trim() ?? '' : ''])
}

function positionFingerprint(position: Position): string {
  const { id: _id, instrumentKey: _instrumentKey, priceAsOf: _priceAsOf, ...fields } = position
  if (fields.mfScheme) fields.mfScheme = { code: fields.mfScheme.code, name: fields.mfScheme.name, source: fields.mfScheme.source }
  return JSON.stringify(Object.fromEntries(Object.entries(fields)
    .filter(([key, value]) => value !== undefined && (value !== null || key === 'lastPrice'))
    .sort(([left], [right]) => left.localeCompare(right))))
}

function sameHoldings(left: Position[], right: Position[]): boolean {
  if (left.length !== right.length) return false
  const fingerprints = (positions: Position[]) => positions.map(positionFingerprint).sort()
  return JSON.stringify(fingerprints(left)) === JSON.stringify(fingerprints(right))
}

function groupedPositions(positions: Position[]): Map<string, Position[]> {
  const grouped = new Map<string, Position[]>()
  for (const position of positions) {
    const key = holdingKey(position)
    const rows = grouped.get(key)
    if (rows) rows.push(position)
    else grouped.set(key, [position])
  }
  return grouped
}

function preserveReviewedMappings(incoming: Position[], previous: Position[]): Position[] {
  const nameKey = (position: Position) => JSON.stringify([position.name.trim().toLowerCase(), position.folio?.trim() ?? ''])
  const confirmed = new Map<string, Position['mfScheme']>()
  const pricing = new Map<string, Position['pricingListing']>()
  for (const position of previous) {
    if (!hasVerifiedNsePricing(position)) continue
    const key = `${position.type}:${position.isin}`
    if (!pricing.has(key)) pricing.set(key, position.pricingListing)
    else if (pricing.get(key)?.providerSymbol !== position.pricingListing?.providerSymbol) pricing.set(key, undefined)
  }
  for (const position of previous) {
    if (position.type !== 'mutual-fund' || !position.name.trim() || position.mfScheme?.source !== 'confirmed') continue
    const key = nameKey(position)
    if (!confirmed.has(key)) confirmed.set(key, position.mfScheme)
    else if (confirmed.get(key)?.code !== position.mfScheme.code) confirmed.set(key, undefined)
  }
  return incoming.map((position) => {
    if (position.type !== 'mutual-fund' && !position.pricingListing) {
      const mapping = pricing.get(`${position.type}:${position.isin}`)
      return mapping ? normalizePosition({ ...position, pricingListing: { ...mapping } }) : position
    }
    if (position.type !== 'mutual-fund' || position.mfScheme || !position.name.trim()) return position
    const mapping = confirmed.get(nameKey(position))
    return mapping ? normalizePosition({ ...position, mfScheme: { ...mapping } }) : position
  })
}

function retainRowIds(incoming: Position[], previous: Position[]): Position[] {
  const previousGroups = groupedPositions(previous)
  const incomingGroups = groupedPositions(incoming)
  return incoming.map((position) => {
    const key = holdingKey(position)
    const candidates = previousGroups.get(key)
    return candidates?.length === 1 && incomingGroups.get(key)?.length === 1 ? { ...position, id: candidates[0].id } : position
  })
}

function uniqueRowIds(positions: Position[], claimed: Set<string>, statementId: string): Position[] {
  return positions.map((position, index) => {
    let id = position.id
    let suffix = 0
    while (claimed.has(id)) id = `row:${statementId}:${index}:${suffix++}`
    claimed.add(id)
    return id === position.id ? position : normalizePosition({ ...position, id })
  })
}

function differences(previous: Position[], incoming: Position[]): Pick<StatementImportPlan, 'added' | 'removed' | 'changed'> {
  const previousGroups = groupedPositions(previous)
  const incomingGroups = groupedPositions(incoming)
  const matchedPrevious = new Set<Position>()
  const added: Position[] = []
  const changed: StatementImportPlan['changed'] = []
  for (const after of incoming) {
    const key = holdingKey(after)
    const candidates = previousGroups.get(key)
    if (candidates?.length !== 1 || incomingGroups.get(key)?.length !== 1) {
      added.push(after)
      continue
    }
    const before = candidates[0]
    matchedPrevious.add(before)
    if (positionFingerprint(before) !== positionFingerprint(after)) changed.push({ before, after })
  }
  return { added, removed: previous.filter((position) => !matchedPrevious.has(position)), changed }
}

/** Build an account change without mutating the workspace or recording a balance. */
export function planStatementImport(
  folios: Folio[],
  options: StatementImportOptions & { preview: ImportPreview },
  now = Date.now(),
): StatementImportPlan {
  const { preview, operation, statementDate, complete } = options
  if (operation !== 'add' && operation !== 'replace') throw new Error('Choose whether to add an account or update an existing account.')
  if (operation === 'add' && preview.positions.length === 0) throw new Error('An empty statement cannot add an account. Choose Update existing account and confirm a complete statement to remove its holdings.')
  if (!Number.isFinite(now) || now < 0 || now > 8_640_000_000_000_000) throw new Error('The import time is invalid.')
  if (!preview.id.trim() || preview.id.length > 450 || !preview.fileName.trim() || preview.fileName.length > 500) throw new Error('This import preview has invalid statement metadata. Prepare the file again.')
  if (folios.length > MAX_ACCOUNTS || folios.some((folio) => folio.positions.length > MAX_POSITIONS) || preview.positions.length > MAX_POSITIONS) {
    throw new Error('A workspace supports up to 100 accounts and 5,000 holdings per account.')
  }
  if (preview.positions.some((position) => !position.id.trim() || !position.ticker.trim()
    || [position.quantity, position.buyPrice, position.invested].some((value) => !Number.isFinite(value) || value < 0)
    || (position.lastPrice !== null && (!Number.isFinite(position.lastPrice) || position.lastPrice < 0)))) {
    throw new Error('This preview contains an invalid holding. Prepare the file again before importing.')
  }
  validateDate(statementDate, now)
  const accountId = operation === 'replace' ? options.accountId : `account:${preview.id}`
  const current = folios.find((folio) => folio.id === accountId)
  if (operation === 'replace' && !current) throw new Error('Choose an existing account to update. It may have been removed since the preview was opened.')
  const alias = options.accountAlias === undefined ? current?.name ?? preview.fileName.trim() : options.accountAlias.trim()
  if (!alias || alias.length > 500) throw new Error('Enter an account alias between 1 and 500 characters.')
  let positions = preview.positions.map((position) => normalizePosition(copyPosition(position)))
  if (current) positions = preserveReviewedMappings(positions, current.positions)
  const currentStatement = current ? statementFor(current) : undefined
  const importedAccount = folios.find((folio) => folio.statement?.id === preview.id)
  const warnings: string[] = []
  if (!statementDate) warnings.push('The statement date is unknown. Imported prices cannot be dated reliably.')
  else if (operation === 'replace' && !currentStatement?.statementDate) warnings.push('The current account statement is undated. Its date cannot be compared with the replacement.')
  if (preview.rejectedCount > 0) warnings.push(`${preview.rejectedCount} row(s) were rejected. This statement is incomplete.`)
  const unchanged = (account: Folio): StatementImportPlan => ({
    nextFolios: folios, added: [], removed: [], changed: [], warnings, noOp: true,
    accountId: account.id, statementId: statementFor(account).id,
  })
  if (importedAccount) {
    if ((operation === 'add' || importedAccount.id === accountId)
      && importedAccount.statement?.statementDate === statementDate && sameHoldings(importedAccount.positions, preserveReviewedMappings(positions, importedAccount.positions))) return unchanged(importedAccount)
    throw new Error('This statement preview has already been imported. Prepare the file again for another account or update.')
  }
  if (folios.some((folio) => folio.previousRevision?.statement.id === preview.id) || (operation === 'add' && current)) {
    throw new Error('This statement preview has already been used. Prepare a new preview before importing it again.')
  }
  if (operation === 'replace') {
    if (options.expectedStatementId !== currentStatement!.id) throw new Error('This account changed after the preview was opened. Review its latest statement and prepare the update again.')
    if (!complete || preview.rejectedCount > 0) throw new Error('Updating an account requires a complete statement with no rejected rows. An incomplete import could remove holdings that are still owned.')
    if ((!statementDate || !currentStatement!.statementDate) && !options.allowUndatedReplacement) throw new Error('Confirm that this is the latest complete statement when the current or incoming account has an undated statement.')
    if (statementDate && currentStatement!.statementDate && statementDate < currentStatement!.statementDate) throw new Error('This statement is older than the current account statement. Choose a newer statement to update the account.')
    if (currentStatement!.statementDate === statementDate && sameHoldings(current!.positions, positions)) return unchanged(current!)
  } else if (folios.length >= MAX_ACCOUNTS) throw new Error('The workspace already has 100 accounts. Remove an account before adding another.')
  positions = retainRowIds(positions, current?.positions ?? [])
  const claimed = new Set(folios.filter((folio) => folio.id !== accountId).flatMap((folio) => folio.positions.map((position) => position.id)))
  positions = uniqueRowIds(positions, claimed, preview.id)
  const statement: AccountStatement = {
    id: preview.id, fileName: preview.fileName.trim(), statementDate,
    completeness: preview.rejectedCount > 0 ? 'partial' : complete ? 'complete' : 'unknown',
  }
  const next: Folio = {
    id: accountId!, name: alias, importedAt: now, positions, statement,
    lastOperation: operation === 'add' ? 'added' : 'updated', operationAt: now,
    ...(current ? { previousRevision: { statement: { ...currentStatement! }, importedAt: current.importedAt, positions: current.positions.map(copyPosition), ...(current.reviewedAt !== undefined ? { reviewedAt: current.reviewedAt } : {}) } } : {}),
  }
  return {
    nextFolios: current ? folios.map((folio) => folio.id === current.id ? next : folio) : [...folios, next],
    ...differences(current?.positions ?? [], positions), warnings, noOp: false, accountId: next.id, statementId: preview.id,
  }
}

export function latestUndoableAccount(folios: Folio[]): Folio | null {
  return folios.reduce<Folio | null>((latest, account) => {
    if (account.lastOperation !== 'added' && !(account.lastOperation === 'updated' && account.previousRevision)) return latest
    return !latest || (account.operationAt ?? account.importedAt) >= (latest.operationAt ?? latest.importedAt) ? account : latest
  }, null)
}

export function undoStatementImport(folios: Folio[], accountId: string): Folio[] {
  const account = folios.find((folio) => folio.id === accountId)
  if (!account || !account.lastOperation) throw new Error('This account has no import available to undo.')
  if (account.lastOperation === 'added') return folios.filter((folio) => folio.id !== accountId)
  if (!account.previousRevision) throw new Error('The previous account statement is unavailable. Restore a workspace backup to recover it.')
  const { previousRevision, lastOperation: _lastOperation, operationAt: _operationAt, ...restored } = account
  return folios.map((folio) => folio.id === accountId ? {
    ...restored, statement: { ...previousRevision.statement }, importedAt: previousRevision.importedAt,
    reviewedAt: previousRevision.reviewedAt,
    positions: previousRevision.positions.map(copyPosition),
  } : folio)
}
