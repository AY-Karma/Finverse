import { useId, useMemo, useRef, useState } from 'react'
import { IMPORT_SOURCES } from '../importSources'
import { MAX_IMPORT_FILES } from '../importLimits'
import { useStore, type ImportPreview } from '../useStore'
import { planStatementImport, type StatementImportOptions } from '../accountStatements'
import { investmentWorkspace } from '../investmentWorkspace'
import { formatCurrency, importedPriceWarnings } from '../valuation'
import { privateValue, visibleQuotes } from '../privacy'
import type { Position } from '../types'
import { UndoImportButton } from './UndoImportButton'
import { RemoveFolioButton } from './RemoveFolioButton'
import { ActionIcon } from './ActionIcon'
import folderIcon from '../assets/imports/folder.svg'

interface ImportViewProps {
  compact?: boolean
  initialStep?: 'dropzone' | 'sources'
  targetAccountId?: string
  onImported?: () => void
}

const QUANTITY_FORMATTER = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 6 })

export function ImportView({ compact = false, initialStep = 'dropzone', targetAccountId, onImported }: ImportViewProps) {
  const { previewFile, commitImport, commitImports, folios, positions, settings, liveQuotes, fxRate, removeFolio, undoLastImport, undoImportFolioId, exportPortfolio } = useStore()
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [previews, setPreviews] = useState<ImportPreview[]>([])
  const [operation, setOperation] = useState<StatementImportOptions['operation']>('add')
  const [accountId, setAccountId] = useState('')
  const [expectedStatementId, setExpectedStatementId] = useState<string>()
  const [accountAlias, setAccountAlias] = useState('')
  const [statementDate, setStatementDate] = useState('')
  const [complete, setComplete] = useState(false)
  const [allowUndatedReplacement, setAllowUndatedReplacement] = useState(false)
  const busyRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const id = useId()
  const inputId = `${id}-portfolio-file`
  const instructionsId = `${id}-upload-instructions`
  const statusId = `${id}-upload-status`
  const previewTitleId = `${id}-import-preview-title`

  async function handleFiles(selectedFiles: FileList | readonly File[] | null | undefined) {
    const files = Array.from(selectedFiles ?? [])
    if (files.length === 0 || busyRef.current) return
    setError(null)
    setPreviews([])
    const targetAccount = folios.find((folio) => folio.id === targetAccountId)
    setOperation(targetAccount ? 'replace' : 'add')
    setAccountId(targetAccount?.id ?? '')
    setExpectedStatementId(targetAccount ? targetAccount.statement?.id ?? `legacy:${targetAccount.id}` : undefined)
    setStatementDate('')
    setComplete(false)
    setAllowUndatedReplacement(false)
    setAccountAlias('')
    if (files.length > MAX_IMPORT_FILES) {
      setError(`Choose ${MAX_IMPORT_FILES} or fewer files at once.`)
      if (inputRef.current) inputRef.current.value = ''
      return
    }
    busyRef.current = true
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
      busyRef.current = false
      setParsing(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const previewPositions = previews.flatMap((preview) => preview.positions)
  const rejectedCount = previews.reduce((count, preview) => count + preview.rejectedCount, 0)
  const previewFileLabel = `${previews.length} file${previews.length === 1 ? '' : 's'}`
  const replacing = operation === 'replace'
  const target = folios.find((folio) => folio.id === accountId)
  const needsDateAcknowledgement = replacing && (!statementDate || !target?.statement?.statementDate)
  const options: StatementImportOptions = {
    operation, accountId: replacing ? accountId : undefined,
    accountAlias: !replacing && previews.length === 1 ? accountAlias.trim() || undefined : undefined,
    statementDate: statementDate || null, complete,
    expectedStatementId: replacing ? expectedStatementId : undefined,
    allowUndatedReplacement: replacing && allowUndatedReplacement,
  }
  const review = useMemo(() => {
    if (previews.length === 0) return null
    try {
      if (operation === 'replace' && previews.length !== 1) throw new Error('Choose one complete statement to update an account. Multiple files can be added as separate accounts.')
      let nextFolios = folios
      const added: Position[] = []
      const removed: Position[] = []
      const changed: { before: Position; after: Position }[] = []
      const warnings: string[] = []
      for (const preview of previews) {
        const plan = planStatementImport(nextFolios, { preview, ...options })
        nextFolios = plan.nextFolios
        added.push(...plan.added)
        removed.push(...plan.removed)
        changed.push(...plan.changed)
        warnings.push(...plan.warnings)
      }
      return { nextFolios, added, removed, changed, warnings: [...new Set([...warnings, ...importedPriceWarnings(nextFolios)])], error: null }
    } catch (cause) {
      return { nextFolios: folios, added: [] as Position[], removed: [] as Position[], changed: [] as { before: Position; after: Position }[], warnings: [] as string[], error: cause instanceof Error && cause.message ? cause.message : 'This statement cannot be imported.' }
    }
  }, [previews, folios, operation, accountId, accountAlias, statementDate, complete, expectedStatementId, allowUndatedReplacement])
  const resultingSnapshot = review && !review.error
    ? investmentWorkspace.readSnapshot({ folios: review.nextFolios, quotes: visibleQuotes(settings?.allowExternalData ?? false, liveQuotes ?? {}), fxRate: fxRate ?? null })
    : null
  const hideValues = settings?.hideValues ?? false
  const money = (amount: number) => privateValue(formatCurrency(amount, settings?.currency ?? 'INR', fxRate?.usdInr), hideValues)
  const quantity = (amount: number) => privateValue(QUANTITY_FORMATTER.format(amount), hideValues)
  const nativeAmount = (amount: number | null, currency = 'INR') => privateValue(amount == null ? 'unpriced' : `${amount} ${currency}`, hideValues)
  const holdingDetail = (position: Position) => `${position.ticker} · Quantity ${quantity(position.quantity)} · Cost ${nativeAmount(position.invested, position.currency)}`

  async function confirmImport() {
    if (previews.length === 0 || busyRef.current || !review || review.error) return
    busyRef.current = true
    setSaving(true)
    setError(null)
    try {
      const saved = previews.length === 1 ? await commitImport(previews[0], options) : await commitImports(previews, options)
      if (saved !== true) {
        setError('The import could not be saved. Your review is still here. Try again after resolving the workspace error.')
        return
      }
      setPreviews([])
      onImported?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The import could not be saved. Your review is still here.')
    } finally {
      busyRef.current = false
      setSaving(false)
    }
  }

  return (
    <>
      {!compact && <div className="page-head enter d0">
        <div>
          <h1 className="page-title">Import holdings</h1>
        </div>
        <p className="page-sub">Import an equity, ETF, or mutual-fund statement. Add another account or update an existing account after review.</p>
      </div>}

      {!compact && folios.length > 0 && (
        <div className="panel enter d1" style={{ display: 'grid', gap: 4 }}>
          <div className="panel-head">
            <span className="panel-title">Accounts on the board</span>
            <span className="section-index">{positions.length} position{positions.length === 1 ? '' : 's'}</span>
          </div>
          {folios.map((folio) => (
            <div key={folio.id} className="folio-row">
              <div className="folio-marker" />
              <div style={{ display: 'grid', gap: 2, flex: 1, minWidth: 0 }}>
                <span className="sym">{folio.name}</span>
                <span className="hint">{folio.positions.length} position{folio.positions.length === 1 ? '' : 's'} · Statement {folio.statement?.statementDate ?? 'date unknown'} · Uploaded {new Date(folio.importedAt).toLocaleString()}</span>
              </div>
              <RemoveFolioButton folio={folio} onConfirm={removeFolio} />
            </div>
          ))}
          <div className="import-actions">
            <button type="button" className="btn btn--secondary btn--small" onClick={() => exportPortfolio('csv')}>Export CSV</button>
            <button type="button" className="btn btn--secondary btn--small" onClick={() => exportPortfolio('json')}>Backup JSON</button>
            <UndoImportButton targetId={undoImportFolioId} targetName={folios.find((folio) => folio.id === undoImportFolioId)?.name} onConfirm={undoLastImport} />
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
        disabled={parsing || saving}
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
              <span className={`import-source-mark import-source-mark--${source.id}`} aria-hidden="true"><img src={source.icon} alt="" width={44} height={44} /></span>
              <strong>{source.name}</strong>
              <small>{source.description}</small>
              <span className="import-source-action"><ActionIcon name="external" />Open official site</span>
            </a>
          ))}
          <button
            type="button"
            className={`import-source-card import-source-card--local${dragOver ? ' import-source-card--over' : ''}`}
            disabled={parsing || saving}
            aria-describedby={`${instructionsId} ${statusId}`}
            onDragOver={(event) => { event.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => { event.preventDefault(); setDragOver(false); void handleFiles(event.dataTransfer.files) }}
            onClick={() => inputRef.current?.click()}
          >
            <span className="import-source-mark import-source-mark--local" aria-hidden="true"><img src={folderIcon} alt="" width={44} height={44} /></span>
            <strong>{parsing ? 'Reading files…' : 'Local files'}</strong>
            <small id={instructionsId}>Drop or choose one or more .xlsx, .xls, or .csv files</small>
            <span className="import-source-action">Up to {MAX_IMPORT_FILES} files · 10 MB each</span>
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={`dropzone enter d2${dragOver ? ' dropzone--over' : ''}`}
          disabled={parsing || saving}
          aria-describedby={`${instructionsId} ${statusId}`}
          onDragOver={(event) => { event.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => { event.preventDefault(); setDragOver(false); void handleFiles(event.dataTransfer.files) }}
          onClick={() => inputRef.current?.click()}
        >
          <span className="drop-title">{parsing ? 'Reading files…' : compact ? 'Add holdings files' : 'Drop your sheets in the pit'}</span>
          <span id={instructionsId} className="hint">{compact ? 'Choose or drop .xlsx, .xls, or .csv' : 'or press Enter or Space to browse'} · up to {MAX_IMPORT_FILES} files, 10 MB each</span>
        </button>
      )}
      <p id={statusId} className="sr-only" aria-live="polite">
        {saving ? 'Saving import.' : parsing ? 'Import in progress.' : error ?? (previews.length > 0 ? `${previewFileLabel} with ${previewPositions.length} holdings ready for review.` : '')}
      </p>

      {previews.length > 0 && (
        <section className="panel import-preview enter d3" aria-labelledby={previewTitleId}>
          <div className="panel-head">
            <div className="panel-head-titles"><span id={previewTitleId} className="panel-title">Review import{previews.length === 1 ? '' : 's'}</span><span className="section-index">Nothing saved yet</span></div>
            <button type="button" className="btn-remove" disabled={saving} onClick={() => { setPreviews([]); setError(null) }} aria-label="Cancel import">×</button>
          </div>
          <p className="hint">
            {previews.length === 1
              ? `${previews[0].fileName} contains ${previewPositions.length} normalized holding${previewPositions.length === 1 ? '' : 's'}.`
              : `${previewFileLabel} contain ${previewPositions.length} normalized holdings. Adding creates one account per file, using each filename as its alias.`}
          </p>
          {previewPositions.length === 0 && <p className="hint down">This statement contains no holdings. To clear a selected account, choose Update existing account and confirm that this is its latest complete statement. Review every holding being removed before saving.</p>}
          <fieldset disabled={saving} style={{ display: 'grid', gap: 12, border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <legend className="sr-only">Statement import options</legend>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))' }}>
              <label className="statement-field">Import operation
                <select className="select" value={operation} onChange={(event) => { setOperation(event.target.value as StatementImportOptions['operation']); setAllowUndatedReplacement(false); setError(null) }}>
                  <option value="add">Add another account</option>
                  <option value="replace" disabled={folios.length === 0}>Update existing account</option>
                </select>
              </label>
              {replacing ? <label className="statement-field">Target account
                <select className="select" value={accountId} onChange={(event) => {
                  const selected = folios.find((folio) => folio.id === event.target.value)
                  setAccountId(event.target.value)
                  setExpectedStatementId(selected ? selected.statement?.id ?? `legacy:${selected.id}` : undefined)
                  setAllowUndatedReplacement(false)
                  setError(null)
                }}>
                  <option value="">Choose the account to update</option>
                  {folios.map((folio) => <option key={folio.id} value={folio.id}>{folio.name}</option>)}
                </select>
              </label> : previews.length === 1 && <label className="statement-field">Account alias, optional
                <input className="input" maxLength={200} placeholder={previews[0].fileName} value={accountAlias} onChange={(event) => { setAccountAlias(event.target.value); setError(null) }} />
              </label>}
              <label className="statement-field">Statement date, optional
                <input className="input" type="date" value={statementDate} onChange={(event) => { setStatementDate(event.target.value); setAllowUndatedReplacement(false); setError(null) }} />
              </label>
            </div>
            <p className="hint">Use the holdings date printed on the statement. Upload time is recorded separately. {previews.length > 1 ? 'This date applies to every selected file. Import separately if their statement dates differ.' : !statementDate ? 'Leaving it blank records an unknown statement date.' : ''}</p>
            {replacing && <p className="hint">Target account: {target?.name ?? 'Choose an account'}. Current statement date: {target?.statement?.statementDate ?? 'unknown'}. A complete replacement removes holdings omitted from this file and keeps the previous revision for undo.</p>}
            <label className="hint" style={{ display: 'flex', alignItems: 'start', gap: 8 }}>
              <input type="checkbox" checked={complete} disabled={rejectedCount > 0} onChange={(event) => { setComplete(event.target.checked); setError(null) }} />
              <span>This is a complete account statement{replacing ? '. Required to replace all holdings in the selected account.' : '. Leave unchecked for a partial export.'}</span>
            </label>
            {needsDateAcknowledgement && <label className="hint" style={{ display: 'flex', alignItems: 'start', gap: 8 }}>
              <input type="checkbox" checked={allowUndatedReplacement} onChange={(event) => { setAllowUndatedReplacement(event.target.checked); setError(null) }} />
              <span>I have verified this is the latest statement for this account. A missing statement date prevents an automatic date comparison.</span>
            </label>}
          </fieldset>
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
            {previewPositions.slice(0, 8).map((position, index) => <span key={`${position.id}-${index}`} className="tag">{position.ticker} · {position.exchange ?? (position.type === 'mutual-fund' ? 'fund' : 'venue unresolved')} · {position.currency ?? 'currency unresolved'}{position.exchangeSource === 'inferred' ? ' · exchange inferred' : ''}{position.identityIssue ? ` · unresolved: ${position.identityIssue}` : ''}</span>)}
            {previewPositions.length > 8 && <span className="hint">+ {previewPositions.length - 8} more</span>}
          </div>
          {rejectedCount > 0 && <div role="alert">
            <p className="hint down">{rejectedCount} row{rejectedCount === 1 ? '' : 's'} rejected. Correct the amounts in your file and import again, or add only the accepted holdings.</p>
            <details><summary>Review rejected rows</summary>
              <ul>{previews.flatMap((preview) => preview.issues.map((issue, index) => <li className="hint" key={`${preview.id}-${index}`}>{preview.fileName} · {issue.sheet}, row {issue.row}, {issue.field}: {issue.message}</li>))}</ul>
              {rejectedCount > previews.reduce((count, preview) => count + preview.issues.length, 0) && <p className="hint">Showing the first reported errors per file. {rejectedCount} rows were rejected in total.</p>}
            </details>
          </div>}
          {review?.error && <p className="hint down" role="alert">{review.error}</p>}
          {review && !review.error && resultingSnapshot && <>
            <div className="import-quality" aria-label="Account holding changes">
              <div><strong>{review.added.length}</strong><span>holdings added</span></div>
              <div><strong>{review.removed.length}</strong><span>holdings removed</span></div>
              <div><strong>{review.changed.length}</strong><span>holdings changed</span></div>
            </div>
            <details>
              <summary>Review holding changes</summary>
              <ul>
                {review.added.map((position, index) => <li className="hint" key={`added-${index}`}>Added · {holdingDetail(position)}</li>)}
                {review.removed.map((position, index) => <li className="hint" key={`removed-${index}`}>Removed · {holdingDetail(position)}</li>)}
                {review.changed.map(({ before, after }, index) => <li className="hint" key={`changed-${index}`}>{after.ticker} · Quantity {quantity(before.quantity)} → {quantity(after.quantity)} · Cost {nativeAmount(before.invested, before.currency)} → {nativeAmount(after.invested, after.currency)} · Imported price {nativeAmount(before.lastPrice, before.currency)} → {nativeAmount(after.lastPrice, after.currency)}</li>)}
              </ul>
              {review.added.length + review.removed.length + review.changed.length === 0 && <p className="hint">No holding changes in this statement.</p>}
            </details>
            <div className="import-quality" aria-label="Resulting portfolio totals">
              <div><strong>{resultingSnapshot.positions.length}</strong><span>resulting holdings</span></div>
              <div><strong>{money(resultingSnapshot.invested)}</strong><span>resulting cost</span></div>
              <div><strong>{money(resultingSnapshot.currentValue)}</strong><span>resulting portfolio value</span></div>
            </div>
            {!resultingSnapshot.valuationComplete && <p className="hint">Value is partial. {resultingSnapshot.unpricedCount} holding{resultingSnapshot.unpricedCount === 1 ? ' is' : 's are'} unpriced; unsupported asset currencies are excluded.</p>}
            <p className="hint">{settings?.allowExternalData ? 'Available enabled market quotes take precedence.' : 'External data is off. Values use imported prices.'} Across accounts, the latest dated statement supplies an imported price. Undated prices are a fallback; conflicts are reported below. Account changes record balance events, not investment returns.</p>
            {review.warnings.map((warning) => <p className="hint" key={warning}>{warning}</p>)}
          </>}
          <div className="import-actions"><button type="button" className="btn btn--primary" disabled={saving || !review || !!review.error} onClick={() => void confirmImport()}>{saving ? 'Saving import…' : replacing ? 'Update account' : rejectedCount > 0 ? 'Add accepted holdings' : previews.length === 1 ? 'Add to portfolio' : `Add ${previews.length} accounts`}</button><button type="button" className="btn btn--ghost" disabled={saving} onClick={() => { setPreviews([]); setError(null) }}>Cancel</button></div>
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
