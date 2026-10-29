import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../useStore'
import {
  captureWorkspaceRecords, hasWorkspaceRecovery, MAX_WORKSPACE_ARCHIVE_BYTES,
  parseWorkspaceArchive, restorePreviousWorkspace, restoreWorkspaceArchive,
  type WorkspaceArchivePreview, type WorkspaceRecords,
} from '../workspaceArchive'

export function WorkspaceRestore({ actionsTarget }: { actionsTarget?: HTMLElement | null }) {
  const { folios } = useStore()
  return <WorkspaceRestorePanel accountCount={folios.length} actionsTarget={actionsTarget} />
}

export function WorkspaceRestorePanel({ accountCount, actionsTarget }: { accountCount: number | null; actionsTarget?: HTMLElement | null }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<WorkspaceArchivePreview | null>(null)
  const [expected, setExpected] = useState<WorkspaceRecords | null>(null)
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [undoArmed, setUndoArmed] = useState(false)
  const [recoveryAvailable] = useState(hasWorkspaceRecovery)

  async function readArchive(file: File | undefined) {
    if (!file || reading) return
    setError('')
    setPreview(null)
    setUndoArmed(false)
    setReading(true)
    try {
      if (file.size > MAX_WORKSPACE_ARCHIVE_BYTES) throw new Error(`Workspace backups must be ${MAX_WORKSPACE_ARCHIVE_BYTES / 1024 / 1024} MB or smaller.`)
      const records = captureWorkspaceRecords()
      const parsed = parseWorkspaceArchive(await file.text())
      setExpected(records)
      setPreview(parsed)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read the backup.')
    } finally {
      setReading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function restore(previous = false) {
    setError('')
    setRestoring(true)
    try {
      if (previous) await restorePreviousWorkspace(captureWorkspaceRecords())
      else {
        if (!preview || !expected) return
        await restoreWorkspaceArchive(preview.archive, expected)
      }
      window.location.reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The workspace could not be restored.')
    } finally {
      setRestoring(false)
    }
  }

  const actions = <div className="import-actions">
      <button type="button" className="btn btn--secondary btn--small" disabled={reading} onClick={() => inputRef.current?.click()}>{reading ? 'Reading backup…' : 'Restore backup'}</button>
      {recoveryAvailable && <button type="button" className="btn btn--ghost btn--small" onClick={() => { setUndoArmed(true); setPreview(null); setError('') }}>Undo last restore</button>}
    </div>

  return <div className="workspace-recovery">
    <input ref={inputRef} type="file" accept=".json,application/json" className="sr-only" aria-label="Choose workspace backup" disabled={reading} onChange={(event) => void readArchive(event.target.files?.[0])} />
    {actionsTarget === undefined ? actions : actionsTarget ? createPortal(actions, actionsTarget) : null}
    {preview && <section className="import-preview" aria-label="Review workspace restore">
      <div className="panel-head"><span className="panel-title">Review workspace restore</span><span className="section-index">Nothing changed yet</span></div>
      <div className="import-quality">
        <div><strong>{preview.archive.folios.length}</strong><span>accounts</span></div>
        <div><strong>{preview.archive.folios.reduce((sum, folio) => sum + folio.positions.length, 0)}</strong><span>holdings</span></div>
        <div><strong>{preview.archive.snapshots.length}</strong><span>tracked balances</span></div>
      </div>
      <p className="hint">{preview.archive.monitor.rules.length} watch rules, {preview.archive.monitor.events.length} reminders and {preview.archive.monitor.alerts.length} observations.</p>
      <p className="hint">{accountCount === null ? 'Your current saved workspace could not be read.' : `Your current workspace has ${accountCount} account${accountCount === 1 ? '' : 's'}.`} Restoring replaces the whole workspace. A recovery copy is kept for undo. External market data will be off.</p>
      {preview.warnings.map((warning) => <p className="hint down" key={warning}>{warning}</p>)}
      <div className="import-actions"><button type="button" className="btn btn--primary" disabled={restoring} onClick={() => void restore()}>Replace workspace</button><button type="button" className="btn btn--ghost" disabled={restoring} onClick={() => setPreview(null)}>Cancel restore</button></div>
    </section>}
    {undoArmed && <div role="alert"><p className="hint">Replace this workspace with the recovery copy from before your last restore? External market data will remain off.</p><div className="import-actions"><button type="button" className="btn btn--primary" disabled={restoring} onClick={() => void restore(true)}>Confirm restore undo</button><button type="button" className="btn btn--ghost" disabled={restoring} onClick={() => setUndoArmed(false)}>Cancel</button></div></div>}
    {error && <p className="hint down" role="alert">{error}</p>}
  </div>
}
