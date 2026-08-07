import { useRef, useState } from 'react'
import { useStore } from '../useStore'

export function ImportView() {
  const { uploadFile, positions } = useStore()
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
          Drop a broker export (.xlsx / .csv). Finverse reads ticker, quantity, cost, and optional
          last price — then runs it onto the scoreboard.
        </p>
      </div>

      {positions.length > 0 && (
        <div className="panel enter d1" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div className="score-label live-dot" />
          <span className="hint">
            {positions.length} position{positions.length === 1 ? '' : 's'} currently on the board.
            Re-upload to replace the lineup.
          </span>
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
          or click to browse · .xlsx, .xls, .csv
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
              <td className="muted">buy price · avg cost · nav · price · cost</td>
            </tr>
            <tr>
              <td className="sym">Last Price</td>
              <td className="muted">optional · ltp · current price · market price · close</td>
            </tr>
            <tr>
              <td className="sym">Type</td>
              <td className="muted">optional · stock / etf / mutual fund</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  )
}