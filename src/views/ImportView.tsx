import { useRef, useState } from 'react'
import { useStore } from '../useStore'

export function ImportView() {
  const { uploadFile, folios, positions, removeFolio } = useStore()
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [parsing, setParsing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File | undefined) {
    if (!file || parsing) return
    setError(null)
    setParsing(true)
    try {
      await uploadFile(file)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read file.')
    } finally {
      setParsing(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <>
      <div className="page-head enter d0">
        <div>
          <div className="page-eyebrow">02 · Portfolio</div>
          <h1 className="page-title">Feed the machine</h1>
        </div>
        <p className="page-sub">Import an equity, ETF, or mutual-fund holdings export. Each accepted file becomes its own folio.</p>
      </div>

      {folios.length > 0 && (
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
        </div>
      )}

      <input
        ref={inputRef}
        id="portfolio-file"
        className="sr-only"
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      <button
        type="button"
        className={`dropzone enter d2${dragOver ? ' dropzone--over' : ''}`}
        disabled={parsing}
        aria-describedby="upload-instructions upload-status"
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); void handleFile(e.dataTransfer.files?.[0]) }}
        onClick={() => inputRef.current?.click()}
      >
        <span className="drop-title">{parsing ? 'Reading your sheet…' : 'Drop your sheet in the pit'}</span>
        <span id="upload-instructions" className="hint">or press Enter or Space to browse · .xlsx, .xls, .csv · 10 MB maximum</span>
      </button>
      <p id="upload-status" className="sr-only" aria-live="polite">{parsing ? 'Import in progress.' : error ?? ''}</p>

      {error && <div className="panel enter d3" role="alert" style={{ borderColor: 'var(--semantic-danger)' }}><p className="hint down">{error}</p></div>}

      <div className="panel enter d4" style={{ display: 'grid', gap: 16 }}>
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
      </div>
    </>
  )
}
