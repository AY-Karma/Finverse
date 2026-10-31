import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { canConfirmFundScheme, type FundSchemeCandidate } from '../fundSchemes'
import './fundSchemePicker.css'

interface Props {
  importedName: string
  candidates: FundSchemeCandidate[]
  value: string
  onChange: (code: string) => void
  disabled?: boolean
}

export function FundSchemePicker({ importedName, candidates, value, onChange, disabled = false }: Props) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeCode, setActiveCode] = useState('')
  const selected = candidates.find((item) => String(item.schemeCode) === value)
  const choices = candidates.map((item) => ({ ...item, compatible: canConfirmFundScheme(importedName, item) }))
    .sort((a, b) => Number(b.compatible) - Number(a.compatible))
  const terms = query.toLowerCase().trim().split(/\s+/)
  const filtered = choices.filter((item) => terms.every((term) => `${item.schemeName} ${item.schemeCode}`.toLowerCase().includes(term)))
  const available = filtered.filter((item) => item.compatible)
  const active = available.find((item) => String(item.schemeCode) === activeCode) ?? available[0]
  const expanded = open && !disabled

  useEffect(() => {
    if (expanded) search.current?.focus()
  }, [expanded])

  useEffect(() => {
    if (expanded && active) document.getElementById(`${id}-${active.schemeCode}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [expanded, active?.schemeCode, id])

  function close() {
    setOpen(false)
    trigger.current?.focus()
  }

  function choose(item: FundSchemeCandidate) {
    if (disabled || !canConfirmFundScheme(importedName, item)) return
    onChange(String(item.schemeCode))
    close()
  }

  function navigate(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return }
    if (event.key === 'Enter') { event.preventDefault(); if (active) choose(active); return }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    if (!available.length) return
    const index = available.findIndex((item) => item === active)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + available.length) % available.length
    setActiveCode(String(available[next].schemeCode))
  }

  return <div className="scheme-picker" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
  }}>
    <span className="scheme-picker-label" id={`${id}-label`}>Provider scheme</span>
    <button ref={trigger} type="button" className="scheme-picker-trigger" disabled={disabled}
      aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="listbox" aria-expanded={expanded} aria-controls={expanded ? `${id}-list` : undefined}
      onClick={() => { setQuery(''); setActiveCode(value); setOpen(!expanded) }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); setQuery(''); setActiveCode(value); setOpen(true)
        }
      }}>
      <span className="scheme-picker-selection"><span id={`${id}-value`}>{selected?.schemeName ?? 'Choose a scheme'}</span>
        <span className="scheme-picker-meta">{selected ? `Code ${selected.schemeCode}` : 'Select the exact plan and option'}</span>
      </span>
      <svg className="scheme-picker-chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
    </button>
    {expanded && <div className="scheme-picker-panel">
      <div className="scheme-picker-search">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>
        <input ref={search} role="combobox" aria-label="Search schemes" aria-autocomplete="list" aria-expanded="true"
          aria-controls={`${id}-list`} aria-activedescendant={active ? `${id}-${active.schemeCode}` : undefined}
          placeholder="Search name or scheme code" value={query} onChange={(event) => { setQuery(event.target.value); setActiveCode('') }} onKeyDown={navigate} />
      </div>
      <div className="scheme-picker-caption" role="status">{available.length} compatible {available.length === 1 ? 'scheme' : 'schemes'}</div>
      <div className="scheme-picker-options" id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`}>
        {filtered.map((item) => <div key={item.schemeCode} id={`${id}-${item.schemeCode}`} role="option"
          aria-selected={String(item.schemeCode) === value} aria-disabled={!item.compatible}
          className={`scheme-picker-option${active?.schemeCode === item.schemeCode ? ' is-active' : ''}`}
          onMouseDown={(event) => event.preventDefault()} onClick={() => choose(item)}>
          <span className="scheme-picker-option-copy"><span>{item.schemeName}</span>
            <span className="scheme-picker-meta">Code {item.schemeCode}{!item.compatible && <span className="scheme-picker-mismatch">Plan or option differs</span>}</span>
          </span>
          {String(item.schemeCode) === value && <svg className="scheme-picker-check" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m4 10 4 4 8-8" /></svg>}
        </div>)}
      </div>
      {!filtered.length && <p className="scheme-picker-empty" role="status">No schemes found. Try another name or code.</p>}
    </div>}
  </div>
}
