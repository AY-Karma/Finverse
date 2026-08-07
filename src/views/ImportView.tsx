import { useRef, useState } from 'react'
import { useStore } from '../useStore'

export function ImportView() {
  const { uploadFile } = useStore()
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
      <div>
        <div className="eyebrow">Portfolio</div>
        <h1 className="page-title">Import portfolio</h1>
        <p className="hint" style={{ marginTop: 4 }}>
          Upload a broker export (.xlsx or .csv). Finverse reads ticker, quantity, buy price, and
          optionally last price / type columns automatically.
        </p>
      </div>

      <div
        className="dropzone"
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
        style={dragOver ? { borderColor: 'var(--primary)' } : undefined}
      >
        <div className="page-title" style={{ fontSize: 22 }}>
          Drop your file here
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          or click to browse
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
        <div className="card" style={{ borderColor: 'var(--semantic-danger)' }}>
          <p className="hint">{error}</p>
        </div>
      )}

      <div className="card" style={{ display: 'grid', gap: 16 }}>
        <div className="stat-label">Supported columns</div>
        <ul className="hint" style={{ paddingLeft: 20 }}>
          <li><span className="mono">Ticker / Symbol</span> — required</li>
          <li><span className="mono">Quantity / Units / Shares</span> — required</li>
          <li><span className="mono">Buy price / Avg cost / NAV</span> — required</li>
          <li><span className="mono">Last price / LTP / Current</span> — optional, powers P&L & value</li>
          <li><span className="mono">Type / Asset class</span> — optional (stock / ETF / mutual fund)</li>
        </ul>
      </div>
    </>
  )
}