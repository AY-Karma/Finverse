import { useMemo, useState } from 'react'
import type { Folio, Position } from '../types'
import { compareStatements } from '../statementChanges'
import { formatCurrency } from '../valuation'
import { ActionIcon } from './ActionIcon'
import './statementChanges.css'

interface StatementChangesProps {
  before: Position[]
  after: Position[]
  beforeDate?: string | null
  afterDate?: string | null
  hideValues: boolean
  summary?: string
  folio?: Pick<Folio, 'id' | 'importedAt'>
}

const units = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 6 })
const weight = (value: number | null | undefined) => value == null ? 'Unavailable' : `${value.toFixed(2)}%`
const statementValue = (holding: { value: number | null } | null) => !holding ? 'Not listed' : holding.value == null ? 'Unavailable' : formatCurrency(holding.value)

function dismissedRevision(folio: StatementChangesProps['folio']): string | null {
  if (!folio) return null
  try { return localStorage.getItem(`finverse:statement-changes:${folio.id}`) }
  catch { return null }
}

export function StatementChanges({ before, after, beforeDate, afterDate, hideValues, summary = 'Changes since last import', folio }: StatementChangesProps) {
  const comparison = useMemo(() => compareStatements(before, after), [before, after])
  const revision = folio ? `${folio.id}:${folio.importedAt}` : 'preview'
  const [dismissed, setDismissed] = useState(() => dismissedRevision(folio))
  const [viewed, setViewed] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [dismissError, setDismissError] = useState('')
  const hasViewed = viewed === revision
  if (folio && dismissed === revision) return null

  function dismiss() {
    if (!folio || !hasViewed || hideValues) return
    try {
      localStorage.setItem(`finverse:statement-changes:${folio.id}`, revision)
      setDismissed(revision)
    } catch { setDismissError('Could not save dismissal. Try again.') }
  }

  return <details className={`statement-changes${!hasViewed && !hideValues ? ' statement-changes--unread' : ''}`} onToggle={(event) => {
    setOpen(event.currentTarget.open)
    if (event.currentTarget.open && !hideValues) setViewed(revision)
  }}>
    <summary>
      <ActionIcon name="activity" />
      <span className="statement-change-copy"><strong>{summary}</strong><span>{hideValues ? 'Import details hidden' : comparison.changes.length ? `${comparison.changes.length} holding${comparison.changes.length === 1 ? '' : 's'} changed` : 'No holding changes'}</span></span>
      <span className="statement-change-action">{open ? 'Hide changes' : 'View changes'}</span>
      <svg className="statement-change-chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
    </summary>
    <div className="statement-change-body">
    {hideValues ? <p className="hint">Statement changes hidden. Turn off Hide portfolio values to review.</p> : <>
      <p className="statement-change-dates">{beforeDate ?? 'Undated statement'} → {afterDate ?? 'Undated statement'}</p>
      {(!comparison.beforeComplete || !comparison.afterComplete) && <p className="hint">Missing INR prices. Weights are unavailable for the incomplete statement.</p>}
      {comparison.changes.length > 0 && <div className="statement-change-scroll" tabIndex={0} role="region" aria-label="Statement holding changes">
        <table className="statement-change-table"><thead><tr><th scope="col">Holding</th><th scope="col">Quantity</th><th scope="col">Weight</th><th scope="col">Statement value</th></tr></thead><tbody>
        {comparison.changes.map((change) => {
          const label = change.after?.label ?? change.before!.label
          const title = change.kind === 'added' ? 'Added' : change.kind === 'removed' ? 'Removed' : change.kind === 'quantity' ? 'Updated' : 'Revalued'
          return <tr key={change.key}>
            <th scope="row"><span className="statement-change-kind">{title} · </span><strong>{label}</strong></th>
            <td><span className="sr-only">Quantity </span>{units.format(change.before?.quantity ?? 0)} → {units.format(change.after?.quantity ?? 0)}
              {change.before && change.after && change.before.invested !== change.after.invested && <small>Cost {units.format(change.before.invested)} {change.before.currency} → {units.format(change.after.invested)} {change.after.currency}</small>}
            </td>
            <td>{weight(change.before?.weight)} → {weight(change.after?.weight)}
              {change.weightChange != null && Math.abs(change.weightChange) >= 0.005 && <small className={change.weightChange > 0 ? 'up' : 'down'}>{change.weightChange >= 0 ? '+' : ''}{change.weightChange.toFixed(2)} pts</small>}
            </td>
            <td>{statementValue(change.before)} → {statementValue(change.after)}</td>
          </tr>
        })}
        </tbody></table>
      </div>}
      {comparison.changes.length === 0 && <p className="hint">No changes between these statements</p>}
      <div className="statement-change-footer"><p className="statement-change-note">Statement balances, not a record of trades. Weights use imported prices.</p>
        {folio && hasViewed && <button type="button" className="btn btn--ghost btn--small statement-change-dismiss" onClick={dismiss} aria-label="Dismiss import changes"><ActionIcon name="close" />Dismiss</button>}
      </div>
      {dismissError && <p className="hint down" role="alert">{dismissError}</p>}
    </>}
    </div>
  </details>
}
