import { useState } from 'react'
import { useStore } from '../useStore'
import { ImportView } from './ImportView'
import { RemoveFolioButton } from './RemoveFolioButton'
import { UndoImportButton } from './UndoImportButton'

export function ManageHoldings() {
  const { folios, positions, exportPortfolio, undoLastImport, undoImportFolioId, removeFolio } = useStore()
  const [importOpen, setImportOpen] = useState(false)
  const hasPositions = positions.length > 0

  return <section className="panel holdings-manage enter d4" aria-label="Manage holdings">
    <div className="panel-head">
      <span className="panel-title">Manage holdings</span>
    </div>
    <div className="manage-actions">
      <button className="btn btn--secondary btn--small" type="button" aria-expanded={importOpen} title={importOpen ? 'Hide the import area.' : 'Choose spreadsheet files to add holdings.'} onClick={() => setImportOpen((open) => !open)}>{importOpen ? 'Close import' : 'Import holdings'}</button>
      <button className="btn btn--secondary btn--small" type="button" title="Download all holdings as a CSV file." disabled={!hasPositions} onClick={() => exportPortfolio('csv')}>Export CSV</button>
      <button className="btn btn--secondary btn--small" type="button" title="Download a JSON backup of your folios." disabled={!hasPositions} onClick={() => exportPortfolio('json')}>Backup JSON</button>
      <UndoImportButton targetId={undoImportFolioId} onConfirm={undoLastImport} />
    </div>
    {importOpen && <div className="holdings-import"><ImportView compact /></div>}
    {folios.length > 0 && <div className="folio-list">{folios.map((folio) => <div className="folio-row" key={folio.id}>
      <div className="folio-marker" />
      <div className="folio-copy"><span className="sym">{folio.name}</span><span className="hint">{folio.positions.length} holding{folio.positions.length === 1 ? '' : 's'} · {new Date(folio.importedAt).toLocaleDateString()}</span></div>
      <RemoveFolioButton folio={folio} onConfirm={removeFolio} />
    </div>)}</div>}
  </section>
}
