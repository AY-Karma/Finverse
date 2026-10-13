export const WORKSPACE_STORAGE_KEYS = [
  'finverse:folios',
  'finverse:settings',
  'finverse:portfolio-snapshots',
  'finverse:monitor:v1',
  'finverse:positions',
] as const

export type WorkspaceRecords = Record<typeof WORKSPACE_STORAGE_KEYS[number], string | null>
export interface WorkspaceWriteOptions { keepRecoveryCopy?: boolean; invalidateCaches?: boolean }

const JOURNAL_KEY = 'finverse:workspace-write:v1'
const PREVIOUS_KEY = 'finverse:workspace-previous:v1'
const LOCK_NAME = 'finverse:workspace-write'
type StoredRecords = Record<string, string | null>
interface WriteJournal { version: 1; id: string; phase: 'writing' | 'committed'; before: StoredRecords }

function isCacheKey(key: string): boolean {
  return key.startsWith('finverse:history:') || key.startsWith('finverse:screenerPath:') || key === 'finverse:manualRefresh'
}

function readRecords(value: unknown): StoredRecords {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The saved recovery copy is invalid.')
  const records: StoredRecords = {}
  for (const [key, raw] of Object.entries(value)) {
    if (!(WORKSPACE_STORAGE_KEYS as readonly string[]).includes(key) && !isCacheKey(key)) throw new Error('The saved recovery copy contains an unsupported record.')
    if (raw !== null && typeof raw !== 'string') throw new Error('The saved recovery copy is invalid.')
    records[key] = raw
  }
  if (WORKSPACE_STORAGE_KEYS.some((key) => !(key in records))) throw new Error('The saved recovery copy is incomplete.')
  return records
}

function readJournal(raw: string): WriteJournal {
  const value = JSON.parse(raw) as Partial<WriteJournal> | null
  if (!value || value.version !== 1 || typeof value.id !== 'string' || !value.id || (value.phase !== 'writing' && value.phase !== 'committed')) {
    throw new Error('The pending workspace recovery record is invalid. Keep your browser data and export a backup before trying again.')
  }
  return { version: 1, id: value.id, phase: value.phase, before: readRecords(value.before) }
}

export function captureWorkspaceRecords(): WorkspaceRecords {
  return Object.fromEntries(WORKSPACE_STORAGE_KEYS.map((key) => [key, localStorage.getItem(key)])) as WorkspaceRecords
}

/** Regular saves must not overwrite a restore's rollback records. */
export function workspaceWritesBlocked(): boolean {
  try { return localStorage.getItem(JOURNAL_KEY) !== null } catch { return true }
}

function applyRecords(records: StoredRecords, assertOwner?: () => void): void {
  for (const [key, raw] of Object.entries(records)) {
    assertOwner?.()
    if (raw === null) localStorage.removeItem(key)
    else localStorage.setItem(key, raw)
  }
}

async function withWorkspaceLock<T>(operation: () => T): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request(LOCK_NAME, { mode: 'exclusive' }, operation)
  }
  return operation()
}

function assertUnchanged(expected: WorkspaceRecords): void {
  if (WORKSPACE_STORAGE_KEYS.some((key) => localStorage.getItem(key) !== expected[key])) {
    throw new Error('Your workspace changed after this preview. Open the preview again before restoring.')
  }
}

function writeRecords(next: WorkspaceRecords, expected: WorkspaceRecords, options: WorkspaceWriteOptions = {}): void {
  if (workspaceWritesBlocked()) throw new Error('A workspace recovery is pending. Reload to recover it before making another change.')
  assertUnchanged(expected)
  const before: StoredRecords = { ...expected }
  const target: StoredRecords = { ...next }
  if (options.invalidateCaches !== false) {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (key && isCacheKey(key)) {
        before[key] = localStorage.getItem(key)
        target[key] = null
      }
    }
  }
  const journal: WriteJournal = { version: 1, id: crypto.randomUUID(), phase: 'writing', before }
  const ownsJournal = () => {
    const raw = localStorage.getItem(JOURNAL_KEY)
    if (!raw || readJournal(raw).id !== journal.id) throw new Error('Another tab changed the workspace recovery. Reload before continuing.')
  }
  let started = false
  let replacing = false
  let committed = false
  try {
    localStorage.setItem(JOURNAL_KEY, JSON.stringify(journal))
    started = true
    ownsJournal()
    assertUnchanged(expected)
    // Keep undo durable before replacing any canonical record.
    if (options.keepRecoveryCopy !== false) localStorage.setItem(PREVIOUS_KEY, JSON.stringify({ version: 1, records: before }))
    replacing = true
    applyRecords(target, ownsJournal)
    ownsJournal()
    localStorage.setItem(JOURNAL_KEY, JSON.stringify({ ...journal, phase: 'committed' }))
    committed = true
    try { localStorage.removeItem(JOURNAL_KEY) } catch { /* Startup can finish a committed transaction. */ }
  } catch (error) {
    if (committed) return
    if (started) {
      try {
        ownsJournal()
        if (replacing) applyRecords(before, ownsJournal)
        localStorage.removeItem(JOURNAL_KEY)
      } catch {
        throw new Error('The workspace could not be saved. Its original data remains in the recovery journal. Reload to recover it; do not clear browser data.')
      }
    }
    throw new Error(error instanceof Error && error.message.startsWith('Your workspace changed')
      ? error.message
      : 'The workspace could not be saved. Your original workspace has been retained. Free browser storage or export a backup before trying again.')
  }
}

export function writeWorkspaceRecords(next: WorkspaceRecords, expected: WorkspaceRecords, options?: WorkspaceWriteOptions): Promise<void> {
  return withWorkspaceLock(() => writeRecords(next, expected, options))
}

export async function recoverWorkspaceWrite(): Promise<{ recovered: boolean; error: string | null }> {
  try {
    return await withWorkspaceLock(() => {
      const raw = localStorage.getItem(JOURNAL_KEY)
      if (!raw) return { recovered: false, error: null }
      const journal = readJournal(raw)
      if (journal.phase === 'writing') applyRecords(journal.before)
      localStorage.removeItem(JOURNAL_KEY)
      return { recovered: journal.phase === 'writing', error: null }
    })
  } catch (error) {
    return { recovered: false, error: error instanceof Error ? error.message : 'Workspace recovery is unavailable. Keep your browser data and try again.' }
  }
}

export function hasWorkspaceRecovery(): boolean {
  try { return !workspaceWritesBlocked() && localStorage.getItem(PREVIOUS_KEY) !== null } catch { return false }
}

export function restorePreviousWorkspace(expected: WorkspaceRecords): Promise<void> {
  return withWorkspaceLock(() => {
    const raw = localStorage.getItem(PREVIOUS_KEY)
    if (!raw) throw new Error('No previous workspace is available to restore.')
    let previous: { version?: unknown; records?: unknown }
    try { previous = JSON.parse(raw) } catch { throw new Error('The previous workspace could not be read.') }
    if (!previous || previous.version !== 1) throw new Error('The previous workspace version is unsupported.')
    const records = readRecords(previous.records)
    const target = Object.fromEntries(WORKSPACE_STORAGE_KEYS.map((key) => [key, records[key]])) as WorkspaceRecords
    const settings = target['finverse:settings']
    if (settings) {
      let parsed: unknown
      try { parsed = JSON.parse(settings) } catch { throw new Error('The previous preferences could not be read.') }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The previous preferences are invalid.')
      target['finverse:settings'] = JSON.stringify({ ...parsed, allowExternalData: false })
    }
    writeRecords(target, expected)
  })
}
