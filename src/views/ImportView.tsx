import { useRef, useState } from 'react'
import { useStore } from '../useStore'

export function ImportView() {
  const { uploadFile, folios, positions, removeFolio } = useStore()
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File | undefined) {
    if (!file) return
    setError(null)
    try {
      await uploadFile(file)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read file.')
    }
  }

  return (
    <>
      <div className="page-head enter d0">
        <div>
          <div className="page-eyebrow">02 · Portfolio</div>
          <h1 className="page-title">Feed the machine</h1>
        </div>
        <p className="page-sub">
          Drop a broker export (.xlsx / .csv) for equity, or a mutual-fund holdings sheet for
          schemes. Finverse detects the layout automatically — ticker/symbol, quantity/units, and
          cost — then runs it onto the scoreboard across Equity and Mutual Funds scopes.
        </p>
      </div>

      {folios.length > 0 && (
        <div className="panel enter d1" style={{ display: 'grid', gap: 4 }}>
          <div className="panel-head">
            <span className="panel-title">Folios on the board</span>
            <span className="section-index">
              {positions.length} position{positions.length === 1 ? '' : 's'}
            </span>
          </div>
          {folios.map((f) => (
            <div key={f.id} className="folio-row">
              <div className="folio-marker" />
              <div style={{ display: 'grid', gap: 2, flex: 1 }}>
                <span className="sym">{f.name}</span>
                <span className="hint">
                  {f.positions.length} position{f.positions.length === 1 ? '' : 's'} ·{' '}
                  {new Date(f.importedAt).toLocaleString()}
                </span>
              </div>
              <button
                className="btn-remove"
                aria-label={`Remove ${f.name}`}
                title="Remove folio"
                onClick={() => removeFolio(f.id)}
              >
                ✕
              </button>
            </div>
          ))}
          <p className="hint" style={{ borderTop: '1px solid var(--hairline)', paddingTop: 12 }}>
            Remove a folio to drop a duplicate or outdated import. The rest of the board re-tallies
            instantly.
          </p>
        </div>
      )}

      <div
        className={`dropzone enter d2${dragOver ? ' dropzone--over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          handleFile(e.dataTransfer.files?.[0])
        }}
        onClick={() => inputRef.current?.click()}
      >
        <div className="drop-title">Drop your sheet in the pit</div>
        <p className="hint" style={{ marginTop: 8 }}>
          or click to browse · .xlsx, .xls, .csv — each file becomes its own folio
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          style={{ display: 'none' }}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>

      {error && (
        <div className="panel enter d3" style={{ borderColor: 'var(--semantic-danger)' }}>
          <p className="hint down">{error}</p>
        </div>
      )}

      <div className="panel enter d4" style={{ display: 'grid', gap: 16 }}>
        <div className="panel-head">
          <span className="panel-title">Scout column aliases</span>
          <span className="section-index">Auto-detected</span>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Field</th>
              <th>Recognizes</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="sym">Ticker</td>
              <td className="muted">ticker · symbol · security · name · isin</td>
            </tr>
            <tr>
              <td className="sym">Quantity</td>
              <td className="muted">quantity · qty · units · shares · no of units</td>
            </tr>
            <tr>
              <td className="sym">Buy / Cost</td>
              <td className="muted">average price · buy price · avg cost · nav · cost</td>
            </tr>
            <tr>
              <td className="sym">Last Price</td>
              <td className="muted">optional · ltp · previous closing · current · market price</td>
            </tr>
            <tr>
              <td className="sym">Type</td>
              <td className="muted">optional · stock / etf / mutual fund</td>
            </tr>
            <tr>
              <td className="sym">Mutual Funds</td>
              <td className="muted">
                scheme name · amc · category · sub-category · folio · units · invested value · current
                value · xirr
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  )
}