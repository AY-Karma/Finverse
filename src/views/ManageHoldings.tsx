import { useStore } from '../useStore'
import { ActionIcon } from './ActionIcon'
import { RemoveFolioButton } from './RemoveFolioButton'
import { UndoImportButton } from './UndoImportButton'
import { WorkspaceRestore } from './WorkspaceRestore'
import { FundSchemeReview } from './FundSchemeReview'
import { ImportHealthIndicator } from './ImportHealthIndicator'
import { needsInstrumentReview } from '../instruments'

export function ManageHoldings({ onRequestImport, reviewOpen, onReviewListings }: { onRequestImport: () => void; reviewOpen: boolean; onReviewListings: () => void }) {
  const { folios, positions, exportPortfolio, undoLastImport, undoImportFolioId, removeFolio } = useStore()
  const hasPositions = positions.length > 0

  return <section className="panel holdings-manage enter d4" aria-label="Manage holdings">
    <div className="panel-head">
      <span className="panel-title">Manage holdings</span>
    </div>
    <div className="manage-actions">
      <button className="btn btn--secondary btn--small" type="button" aria-haspopup="dialog" title="Choose a broker or local file to add or update holdings." onClick={onRequestImport}><ActionIcon name="import" />Import holdings</button>
      <button className="btn btn--secondary btn--small" type="button" title="Download all holdings as a CSV file." disabled={!hasPositions} onClick={() => exportPortfolio('csv')}>Export CSV</button>
      <button className="btn btn--secondary btn--small" type="button" title="Download a complete workspace backup." onClick={() => exportPortfolio('json')}>Backup JSON</button>
      <UndoImportButton targetId={undoImportFolioId} targetName={folios.find((folio) => folio.id === undoImportFolioId)?.name} onConfirm={undoLastImport} />
    </div>
    <WorkspaceRestore />
    <FundSchemeReview />
    {positions.some((position) => position.type !== 'mutual-fund') && <div className="workspace-recovery">
      <button id="listing-review-trigger" type="button" className="btn btn--ghost listing-review-trigger" aria-expanded={reviewOpen} aria-controls="instrument-review" onClick={onReviewListings}>
        <ActionIcon name="review" />
        <span>Review instrument listings · {positions.filter(needsInstrumentReview).length} inferred or unresolved</span>
        <span aria-hidden="true">→</span>
      </button>
    </div>}
    {folios.length > 0 && <div className="folio-list">{folios.map((folio) => <div className="folio-row" key={folio.id}>
      <div className="folio-marker" />
      <div className="folio-copy">
        <div className="folio-title"><span className="sym">{folio.name}</span><ImportHealthIndicator importedAt={folio.importedAt} /></div>
        <span className="hint">{folio.positions.length} holding{folio.positions.length === 1 ? '' : 's'} · {folio.statement?.statementDate ? `Statement ${folio.statement.statementDate}` : 'Statement date unknown'} · Uploaded {new Date(folio.importedAt).toLocaleDateString()}</span>
      </div>
      <RemoveFolioButton folio={folio} onConfirm={removeFolio} />
    </div>)}</div>}
  </section>
}
