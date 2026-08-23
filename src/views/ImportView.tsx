import { useId, useRef, useState } from 'react'
import { IMPORT_SOURCES } from '../importSources'
import { useStore, type ImportPreview } from '../useStore'

interface ImportViewProps {
  compact?: boolean
  initialStep?: 'dropzone' | 'sources'
  onImported?: () => void
}

export function ImportView({ compact = false, initialStep = 'dropzone', onImported }: ImportViewProps) {
  const { previewFile, commitImport, folios, positions, removeFolio, undoLastImport, exportPortfolio } = useStore()
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const id = useId()
  const inputId = `${id}-portfolio-file`
  const instructionsId = `${id}-upload-instructions`
  const statusId = `${id}-upload-status`
  const previewTitleId = `${id}-import-preview-title`

  async function handleFile(file: File | undefined) {
    if (!file || parsing) return
    setError(null)
    setParsing(true)
    try {
      setPreview(await previewFile(file))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read file.')
    } finally {
      setParsing(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function confirmImport() {
    if (!preview) return
    commitImport(preview)
    setPreview(null)
    onImported?.()
  }

  return (
    <>
      {!compact && <div className="page-head enter d0">
        <div>
          <div className="page-eyebrow">02 · Portfolio</div>
          <h1 className="page-title">Feed the machine</h1>
        </div>
        <p className="page-sub">Import an equity, ETF, or mutual-fund holdings export. Each accepted file becomes its own folio.</p>
      </div>}

      {!compact && folios.length > 0 && (
        <div className="panel enter d1" style={{ display: 'grid', gap: 4 }}>
          <div className="panel-head">
            <span className="panel-title">Folios on the board</span>
            <span className="section-index">{positions.length} position{positions.length === 1 ? '' : 's'}</span>
          </div>
          {folios.map((folio) => (
            <div key={folio.id} className="folio-row">
              <div className="folio-marker" />
              <div style={{ display: 'grid', gap: 2, flex: 1, minWidth: 0 }}>
                <span className="sym">{folio.name}</span>
                <span className="hint">{folio.positions.length} position{folio.positions.length === 1 ? '' : 's'} · {new Date(folio.importedAt).toLocaleString()}</span>
              </div>
              <button className="btn-remove" aria-label={`Remove ${folio.name}`} title="Remove folio" onClick={() => removeFolio(folio.id)}>×</button>
            </div>
          ))}
          <div className="import-actions">
            <button type="button" className="btn btn--secondary btn--small" onClick={() => exportPortfolio('csv')}>Export CSV</button>
            <button type="button" className="btn btn--secondary btn--small" onClick={() => exportPortfolio('json')}>Backup JSON</button>
            <button type="button" className="btn btn--ghost btn--small" onClick={undoLastImport}>Undo last import</button>
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        id={inputId}
        className="sr-only"
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      {initialStep === 'sources' ? (
        <div className="import-source-grid">
          {IMPORT_SOURCES.map((source) => (
            <a
              className="import-source-card"
              href={source.url}
              key={source.id}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className={`import-source-mark import-source-mark--${source.id}`} aria-hidden="true">{source.mark}</span>
              <strong>{source.name}</strong>
              <small>{source.description}</small>
              <span className="import-source-action">Open official site ↗</span>
            </a>
          ))}
          <button
            type="button"
            className={`import-source-card import-source-card--local${dragOver ? ' import-source-card--over' : ''}`}
            disabled={parsing}
            aria-describedby={`${instructionsId} ${statusId}`}
            onDragOver={(event) => { event.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => { event.preventDefault(); setDragOver(false); void handleFile(event.dataTransfer.files?.[0]) }}
            onClick={() => inputRef.current?.click()}
          >
            <span className="import-source-mark import-source-mark--local" aria-hidden="true">XLS</span>
            <strong>{parsing ? 'Reading file…' : 'Local files'}</strong>
            <small id={instructionsId}>Drop or choose .xlsx, .xls, or .csv</small>
            <span className="import-source-action">10 MB maximum</span>
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={`dropzone enter d2${dragOver ? ' dropzone--over' : ''}`}
          disabled={parsing}
          aria-describedby={`${instructionsId} ${statusId}`}
          onDragOver={(event) => { event.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => { event.preventDefault(); setDragOver(false); void handleFile(event.dataTransfer.files?.[0]) }}
          onClick={() => inputRef.current?.click()}
        >
          <span className="drop-title">{parsing ? 'Reading your sheet…' : 'Drop your sheet in the pit'}</span>
          <span id={instructionsId} className="hint">or press Enter or Space to browse · .xlsx, .xls, .csv · 10 MB maximum</span>
        </button>
      )}
      <p id={statusId} className="sr-only" aria-live="polite">
        {parsing ? 'Import in progress.' : error ?? (preview ? `${preview.positions.length} holdings ready for review.` : '')}
      </p>

      {preview && (
        <section className="panel import-preview enter d3" aria-labelledby={previewTitleId}>
          <div className="panel-head">
            <div className="panel-head-titles"><span id={previewTitleId} className="panel-title">Review import</span><span className="section-index">Nothing saved yet</span></div>
            <button type="button" className="btn-remove" onClick={() => setPreview(null)} aria-label="Cancel import">×</button>
          </div>
          <p className="hint">{preview.fileName} contains {preview.positions.length} normalized holding{preview.positions.length === 1 ? '' : 's'}.</p>
          <div className="import-quality">
            <div><strong>{preview.duplicateCount}</strong><span>duplicate rows merged</span></div>
            <div><strong>{preview.unmatchedCount}</strong><span>symbols needing review</span></div>
            <div><strong>{preview.positions.filter((position) => position.type === 'mutual-fund').length}</strong><span>fund rows recognized</span></div>
          </div>
          <div className="import-preview-list">
            {preview.positions.slice(0, 8).map((position) => <span key={position.id} className="tag">{position.ticker} · {position.exchange ?? 'local'} · {position.currency ?? 'INR'}</span>)}
            {preview.positions.length > 8 && <span className="hint">+ {preview.positions.length - 8} more</span>}
          </div>
          <div className="import-actions"><button type="button" className="btn btn--primary" onClick={confirmImport}>Add to portfolio</button><button type="button" className="btn btn--ghost" onClick={() => setPreview(null)}>Cancel</button></div>
        </section>
      )}

      {error && <div className="panel enter d3" role="alert" style={{ borderColor: 'var(--semantic-danger)' }}><p className="hint down">{error}</p></div>}

      {!compact && <div className="panel enter d4" style={{ display: 'grid', gap: 16 }}>
        <div className="panel-head"><span className="panel-title">Scout column aliases</span><span className="section-index">Auto-detected</span></div>
        <table className="table">
          <thead><tr><th>Field</th><th>Recognizes</th></tr></thead>
          <tbody>
            <tr><td className="sym">Ticker</td><td className="muted">ticker · symbol · security · name · isin</td></tr>
            <tr><td className="sym">Quantity</td><td className="muted">quantity · qty · units · shares · no of units</td></tr>
            <tr><td className="sym">Buy / Cost</td><td className="muted">average price · buy price · avg cost · nav · cost</td></tr>
            <tr><td className="sym">Last Price</td><td className="muted">optional · ltp · previous closing · current · market price</td></tr>
            <tr><td className="sym">Type</td><td className="muted">optional · stock / etf / mutual fund</td></tr>
            <tr><td className="sym">Mutual Funds</td><td className="muted">scheme name · units · invested value · current value · xirr</td></tr>
          </tbody>
        </table>
      </div>}
    </>
  )
}
