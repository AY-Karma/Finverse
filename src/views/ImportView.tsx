import { useId, useRef, useState } from 'react'
import { IMPORT_SOURCES } from '../importSources'
import { MAX_IMPORT_FILES } from '../importLimits'
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
  const [previews, setPreviews] = useState<ImportPreview[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const id = useId()
  const inputId = `${id}-portfolio-file`
  const instructionsId = `${id}-upload-instructions`
  const statusId = `${id}-upload-status`
  const previewTitleId = `${id}-import-preview-title`

  async function handleFiles(selectedFiles: FileList | readonly File[] | null | undefined) {
    const files = Array.from(selectedFiles ?? [])
    if (files.length === 0 || parsing) return
    setError(null)
    setPreviews([])
    if (files.length > MAX_IMPORT_FILES) {
      setError(`Choose ${MAX_IMPORT_FILES} or fewer files at once.`)
      if (inputRef.current) inputRef.current.value = ''
      return
    }
    setParsing(true)
    const parsed: ImportPreview[] = []
    const failures: string[] = []
    try {
      // Keep peak memory bounded when several 10 MB spreadsheets are selected.
      for (const file of files) {
        try {
          parsed.push(await previewFile(file))
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : 'Could not read file.'
          failures.push(`${file.name}: ${message}`)
        }
      }
      setPreviews(parsed)
      if (failures.length > 0) setError(failures.join(' '))
    } finally {
      setParsing(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function confirmImport() {
    if (previews.length === 0) return
    for (const preview of previews) commitImport(preview)
    setPreviews([])
    onImported?.()
  }

  const previewPositions = previews.flatMap((preview) => preview.positions)
  const previewFileLabel = `${previews.length} file${previews.length === 1 ? '' : 's'}`

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
        multiple
        onChange={(event) => void handleFiles(event.target.files)}
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
            onDrop={(event) => { event.preventDefault(); setDragOver(false); void handleFiles(event.dataTransfer.files) }}
            onClick={() => inputRef.current?.click()}
          >
            <span className="import-source-mark import-source-mark--local" aria-hidden="true">XLS</span>
            <strong>{parsing ? 'Reading files…' : 'Local files'}</strong>
            <small id={instructionsId}>Drop or choose one or more .xlsx, .xls, or .csv files</small>
            <span className="import-source-action">Up to {MAX_IMPORT_FILES} files · 10 MB each</span>
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
          onDrop={(event) => { event.preventDefault(); setDragOver(false); void handleFiles(event.dataTransfer.files) }}
          onClick={() => inputRef.current?.click()}
        >
          <span className="drop-title">{parsing ? 'Reading your sheets…' : 'Drop your sheets in the pit'}</span>
          <span id={instructionsId} className="hint">or press Enter or Space to browse · select up to {MAX_IMPORT_FILES} files · 10 MB each</span>
        </button>
      )}
      <p id={statusId} className="sr-only" aria-live="polite">
        {parsing ? 'Import in progress.' : error ?? (previews.length > 0 ? `${previewFileLabel} with ${previewPositions.length} holdings ready for review.` : '')}
      </p>

      {previews.length > 0 && (
        <section className="panel import-preview enter d3" aria-labelledby={previewTitleId}>
          <div className="panel-head">
            <div className="panel-head-titles"><span id={previewTitleId} className="panel-title">Review import{previews.length === 1 ? '' : 's'}</span><span className="section-index">Nothing saved yet</span></div>
            <button type="button" className="btn-remove" onClick={() => setPreviews([])} aria-label="Cancel import">×</button>
          </div>
          <p className="hint">
            {previews.length === 1
              ? `${previews[0].fileName} contains ${previewPositions.length} normalized holding${previewPositions.length === 1 ? '' : 's'}.`
              : `${previewFileLabel} contain ${previewPositions.length} normalized holdings. Each file will become its own folio.`}
          </p>
          {previews.length > 1 && (
            <div className="import-preview-list">
              {previews.map((preview) => (
                <span key={preview.id} className="tag">{preview.fileName} · {preview.positions.length} holding{preview.positions.length === 1 ? '' : 's'}</span>
              ))}
            </div>
          )}
          <div className="import-quality">
            <div><strong>{previews.reduce((total, preview) => total + preview.duplicateCount, 0)}</strong><span>duplicate rows merged</span></div>
            <div><strong>{previews.reduce((total, preview) => total + preview.unmatchedCount, 0)}</strong><span>symbols needing review</span></div>
            <div><strong>{previewPositions.filter((position) => position.type === 'mutual-fund').length}</strong><span>fund rows recognized</span></div>
          </div>
          <div className="import-preview-list">
            {previewPositions.slice(0, 8).map((position, index) => <span key={`${position.id}-${index}`} className="tag">{position.ticker} · {position.exchange ?? 'local'} · {position.currency ?? 'INR'}</span>)}
            {previewPositions.length > 8 && <span className="hint">+ {previewPositions.length - 8} more</span>}
          </div>
          <div className="import-actions"><button type="button" className="btn btn--primary" onClick={confirmImport}>{previews.length === 1 ? 'Add to portfolio' : `Add ${previews.length} folios`}</button><button type="button" className="btn btn--ghost" onClick={() => setPreviews([])}>Cancel</button></div>
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
