import { useEffect, useRef, useState } from 'react'
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

export function ManageHoldings({ onRequestImport, reviewOpen, onReviewListings }: { onRequestImport: (accountId?: string) => void; reviewOpen: boolean; onReviewListings: () => void }) {
  const { folios, positions, settings, exportPortfolio, undoLastImport, undoImportFolioId, removeFolio, confirmFolioUnchanged, workspaceReadOnly } = useStore()
  const hideValues = settings.hideValues
  const hasPositions = positions.length > 0
  const now = useFolioReviewTime()
  const sectionRef = useRef<HTMLElement>(null)
  const busyRef = useRef(false)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [reviewedId, setReviewedId] = useState<string | null>(null)
  const [reviewError, setReviewError] = useState('')

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

  return <section ref={sectionRef} id="manage-holdings" tabIndex={-1} className="panel holdings-manage enter d4" aria-label="Manage holdings">
    <div className="panel-head">
      <span className="panel-title">Manage holdings</span>
    </div>
    <div className="manage-actions">
      <button className="btn btn--secondary btn--small" type="button" aria-haspopup="dialog" title="Choose a broker or local file to add or update holdings." onClick={() => onRequestImport()}><ActionIcon name="import" />Import holdings</button>
      <button className="btn btn--secondary btn--small" type="button" title="Download all holdings as a CSV file." disabled={!hasPositions} onClick={() => exportPortfolio('csv')}>Export CSV</button>
      <button className="btn btn--secondary btn--small" type="button" title="Download a complete workspace backup." onClick={() => exportPortfolio('json')}>Backup JSON</button>
      <UndoImportButton targetId={undoImportFolioId} targetName={privateValue(folios.find((folio) => folio.id === undoImportFolioId)?.name ?? '', hideValues)} onConfirm={undoLastImport} />
    </div>
    <WorkspaceRestore />
    <FundSchemeReview />
    {positions.some((position) => position.type !== 'mutual-fund') && <div className="workspace-recovery">
      <button id="listing-review-trigger" type="button" className="btn btn--ghost listing-review-trigger" aria-expanded={reviewOpen} aria-controls="instrument-review" onClick={onReviewListings}>
        <ActionIcon name="review" />
        <span>Review instrument listings{!hideValues && <> · {positions.filter(needsInstrumentReview).length} inferred or unresolved</>}</span>
        <span aria-hidden="true">→</span>
      </button>
    </div>}
    {folios.length > 0 && <div className="folio-list">{folios.map((folio) => <div className="folio-row" key={folio.id}>
      <div className="folio-marker" />
      <div className="folio-copy">
        <div className="folio-title"><span className="sym">{privateValue(folio.name, hideValues)}</span>{!hideValues && <ImportHealthIndicator importedAt={folio.importedAt} reviewedAt={folio.reviewedAt} />}</div>
        <span className="hint">{hideValues ? 'Import details hidden' : <>{folio.positions.length} holding{folio.positions.length === 1 ? '' : 's'} · {folio.statement?.statementDate ? `Statement ${folio.statement.statementDate}` : 'Statement date unknown'} · Uploaded {new Date(folio.importedAt).toLocaleDateString()}{folio.reviewedAt != null && <> · Reviewed {new Date(folio.reviewedAt).toLocaleDateString()}</>}</>}</span>
        <div className="folio-review-actions">
          <button type="button" className="btn btn--secondary btn--small" aria-haspopup="dialog" disabled={workspaceReadOnly || reviewingId !== null} onClick={() => onRequestImport(folio.id)}>Update folio</button>
          {canConfirmFolioUnchanged(folio, now) && <button type="button" className="btn btn--ghost btn--small" disabled={workspaceReadOnly || reviewingId !== null} onClick={() => void confirmUnchanged(folio.id)}>{reviewingId === folio.id ? 'Saving…' : 'Holdings unchanged'}</button>}
        </div>
        {reviewedId === folio.id && <span className="hint" role="status">Marked fresh</span>}
      </div>
      <RemoveFolioButton folio={{ id: folio.id, name: privateValue(folio.name, hideValues) }} onConfirm={removeFolio} />
    </div>)}</div>}
    {reviewError && <p className="hint down" role="alert">{reviewError}</p>}
  </section>
}
