import { useEffect, useId, useRef, useState } from 'react'
import { useStore } from '../useStore'
import { ActionIcon } from './ActionIcon'
import { RemoveFolioButton } from './RemoveFolioButton'
import { UndoImportButton } from './UndoImportButton'
import { WorkspaceRestore } from './WorkspaceRestore'
import { FundSchemeReview } from './FundSchemeReview'
import { ImportHealthIndicator } from './ImportHealthIndicator'
import { needsInstrumentReview } from '../instruments'
import { privateValue } from '../privacy'
import { canConfirmFolioUnchanged } from '../importFreshness'
import { useFolioReviewTime } from '../useFolioReviewTime'
import { InstrumentReview } from './InstrumentReview'
import { dateFormatter } from '../formatters'

const statementDate = dateFormatter({ day: 'numeric', month: 'short', year: 'numeric' })
function displayDate(value: number | string): string {
  const date = new Date(typeof value === 'string' ? `${value}T00:00:00` : value)
  return Number.isFinite(date.getTime()) ? statementDate.format(date) : 'Not available'
}

export function ManageHoldings({ onRequestImport, reviewOpen, onReviewListings }: { onRequestImport: (accountId?: string) => void; reviewOpen: boolean; onReviewListings: () => void }) {
  const { folios, positions, settings, exportPortfolio, undoLastImport, undoImportFolioId, removeFolio, confirmFolioUnchanged, workspaceReadOnly } = useStore()
  const hideValues = settings.hideValues
  const hasPositions = positions.length > 0
  const now = useFolioReviewTime()
  const listingCount = positions.filter((position) => position.type !== 'mutual-fund').length
  const pendingListings = positions.filter(needsInstrumentReview).length
  const sectionRef = useRef<HTMLElement>(null)
  const busyRef = useRef(false)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [reviewedId, setReviewedId] = useState<string | null>(null)
  const [reviewError, setReviewError] = useState('')
  const [actionsOpen, setActionsOpen] = useState(false)
  const actionsId = useId()
  const actionsTriggerRef = useRef<HTMLButtonElement>(null)
  const [restoreActionsTarget, setRestoreActionsTarget] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    if (window.location.hash !== '#manage-holdings') return
    sectionRef.current?.scrollIntoView?.({ block: 'start' })
    sectionRef.current?.focus({ preventScroll: true })
  }, [])

  async function confirmUnchanged(id: string) {
    if (busyRef.current) return
    busyRef.current = true
    setReviewingId(id)
    setReviewedId(null)
    setReviewError('')
    try { await confirmFolioUnchanged(id); setReviewedId(id) }
    catch (cause) { setReviewError(cause instanceof Error ? cause.message : 'The folio review could not be saved. Try again.') }
    finally { busyRef.current = false; setReviewingId(null) }
  }

  return <section ref={sectionRef} id="manage-holdings" tabIndex={-1} className="panel holdings-manage" aria-label="Manage holdings">
    <div className="panel-head">
      <h2 className="panel-title"><ActionIcon name="holdings" />Manage holdings</h2>
    </div>
    <div className="manage-actions" onKeyDown={(event) => {
      if (event.key !== 'Escape' || !actionsOpen) return
      setActionsOpen(false)
      actionsTriggerRef.current?.focus()
    }}>
      <div className="manage-import-control">
      <button className="btn btn--import" type="button" aria-haspopup="dialog" title="Choose a broker or local file to add or update holdings." onClick={() => onRequestImport()}><ActionIcon name="import" />Import holdings</button>
      <button ref={actionsTriggerRef} className="btn btn--import manage-actions-toggle" type="button" aria-label="More holdings actions" aria-expanded={actionsOpen} aria-controls={actionsId} onClick={() => setActionsOpen(!actionsOpen)}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m8 6 4 4-4 4" /></svg></button>
      </div>
      <div id={actionsId} className="manage-actions-reveal" data-open={actionsOpen} aria-hidden={!actionsOpen} inert={!actionsOpen}>
      <div className="manage-actions-clip"><div className="manage-actions-list">
      <button className="btn btn--secondary btn--small" type="button" title="Download all holdings as a CSV file." disabled={!hasPositions} onClick={() => exportPortfolio('csv')}>Export CSV</button>
      <button className="btn btn--secondary btn--small" type="button" title="Download a complete workspace backup." onClick={() => exportPortfolio('json')}>Backup JSON</button>
      <UndoImportButton targetId={undoImportFolioId} targetName={privateValue(folios.find((folio) => folio.id === undoImportFolioId)?.name ?? '', hideValues)} onConfirm={undoLastImport} />
      <div className="manage-restore-actions" ref={setRestoreActionsTarget} />
      </div></div></div>
    </div>
    <WorkspaceRestore actionsTarget={restoreActionsTarget} />
    {folios.length > 0 && <div className="imported-statements">
      <h3>Imported statements</h3>
      <div className="folio-list">{folios.map((folio) => <div className="folio-row" key={folio.id}>
      <span className="folio-document" aria-hidden="true"><ActionIcon name="sources" /></span>
      <div className="folio-copy">
        <div className="folio-title"><span className="sym">{privateValue(folio.name, hideValues)}</span>{!hideValues && <ImportHealthIndicator importedAt={folio.importedAt} reviewedAt={folio.reviewedAt} showLabel />}</div>
        {hideValues ? <span className="hint">Import details hidden</span> : <dl className="folio-facts">
          <div><dt>Holdings</dt><dd>{folio.positions.length}</dd></div>
          {folio.statement?.statementDate && <div><dt>Statement</dt><dd>{displayDate(folio.statement.statementDate)}</dd></div>}
          <div><dt>Imported</dt><dd>{displayDate(folio.importedAt)}</dd></div>
          {folio.reviewedAt != null && <div><dt>Reviewed</dt><dd>{displayDate(folio.reviewedAt)}</dd></div>}
        </dl>}
        <div className="folio-review-actions">
          <button type="button" className="btn btn--secondary btn--small" aria-haspopup="dialog" disabled={workspaceReadOnly || reviewingId !== null} onClick={() => onRequestImport(folio.id)}>Update folio</button>
          {canConfirmFolioUnchanged(folio, now) && <button type="button" className="btn btn--ghost btn--small" disabled={workspaceReadOnly || reviewingId !== null} onClick={() => void confirmUnchanged(folio.id)}>{reviewingId === folio.id ? 'Saving…' : 'Holdings unchanged'}</button>}
        </div>
        {reviewedId === folio.id && <span className="hint" role="status">Marked fresh</span>}
      </div>
      <RemoveFolioButton folio={{ id: folio.id, name: privateValue(folio.name, hideValues) }} onConfirm={removeFolio} showLabel />
    </div>)}</div></div>}
    {listingCount > 0 && <div className={`listing-review${!hideValues && pendingListings > 0 ? ' listing-review--pending' : ''}`}>
      <button id="listing-review-trigger" type="button" className="listing-review-trigger" aria-expanded={reviewOpen} aria-controls="instrument-review-content" onClick={onReviewListings}>
        <ActionIcon name="review" />
        <span className="listing-review-copy"><strong>Instrument listings</strong><span>{hideValues ? 'Listing details are hidden.' : pendingListings > 0 ? `${pendingListings} listing${pendingListings === 1 ? ' needs' : 's need'} your confirmation.` : 'No listings need review. View or edit them here.'}</span></span>
        <span className="listing-review-action">{reviewOpen ? 'Close listings' : !hideValues && pendingListings > 0 ? 'Review listings' : 'View listings'}</span>
        <svg className="listing-review-chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
      </button>
      <div id="instrument-review-content" hidden={!reviewOpen}>
        {reviewOpen && <InstrumentReview onClose={onReviewListings} autoFocus={window.location.hash === '#instrument-review'} />}
      </div>
    </div>}
    <FundSchemeReview />
    {reviewError && <p className="hint down" role="alert">{reviewError}</p>}
  </section>
}
