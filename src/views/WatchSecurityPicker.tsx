import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { Position } from '../types'
import { privateValue } from '../privacy'
import { watchSecurityKey, watchSecurityLabel, type WatchSecurity } from '../watchSecurity'
import { cleanWatchQuery, searchWatchSecurities, type WatchSearchResult } from '../watchSecuritySearch'

export type WatchTarget = { kind: 'holding'; holdingId: string } | { kind: 'security'; security: WatchSecurity }

type Option = { key: string; name: string; detail: string; target: WatchTarget }
type Search = { query: string; result: WatchSearchResult | null }

const SEARCH_DELAY_MS = 250

function holdingOption(position: Position, hideValues: boolean): Option {
  return { key: `holding:${position.id}`, name: privateValue(position.name || position.ticker, hideValues), detail: 'In your portfolio', target: { kind: 'holding', holdingId: position.id } }
}

/** Search-only chooser: a rule can follow one of your holdings, or a security listed in the NSE or mutual-fund index. */
export function WatchSecurityPicker({ label, positions, target, hideValues, onSelect }: {
  label: string; positions: Position[]; target: WatchTarget | null; hideValues: boolean; onSelect: (target: WatchTarget) => void
}) {
  const id = useId()
  const selected = useMemo(() => {
    if (target?.kind === 'security') return target.security.name
    const position = target && positions.find((item) => item.id === target.holdingId)
    return position ? privateValue(position.name || position.ticker, hideValues) : ''
  }, [target, positions, hideValues])
  const [text, setText] = useState(selected)
  const [typed, setTyped] = useState(false)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [search, setSearch] = useState<Search | null>(null)
  const query = typed ? cleanWatchQuery(text) : null
  const typedText = typed ? text.trim() : ''
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => { setText(selected); setTyped(false) }, [selected])
  useEffect(() => { if (active >= 0) document.getElementById(`${id}-option-${active}`)?.scrollIntoView?.({ block: 'nearest' }) }, [active, id])

  useEffect(() => {
    if (!query) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      searchWatchSecurities(query, controller.signal)
        .then((result) => setSearch({ query, result }))
        .catch(() => { if (!controller.signal.aborted) setSearch({ query, result: { securities: [], unavailable: ['stocks', 'funds'] } }) })
    }, SEARCH_DELAY_MS)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [query])

  const holdings = useMemo(() => {
    const needle = typedText.toLowerCase()
    return positions
      .filter((position) => !needle || (!hideValues && `${position.name} ${position.ticker}`.toLowerCase().includes(needle)))
      .map((position) => holdingOption(position, hideValues))
  }, [positions, typedText, hideValues])
  const settled = query !== null && search?.query === query ? search.result : null
  const owned = (security: WatchSecurity) => positions.some((position) => security.kind === 'fund' ? position.mfScheme?.code === security.code : position.isin === security.isin)
  const listed: Option[] = (settled?.securities ?? []).filter((security) => !owned(security))
    .map((security) => ({ key: watchSecurityKey(security), name: security.name, detail: watchSecurityLabel(security), target: { kind: 'security', security } }))
  const options = [...holdings, ...listed]

  const notice = !typedText ? ''
    : !query ? (typedText.length < 2 ? 'Type at least 2 characters.' : 'Search by company, fund or symbol. Links and other text are not accepted.')
    : !settled ? 'Searching…'
    : settled.unavailable.length === 2 ? 'Search is unavailable. Check your connection and try again.'
    : settled.unavailable.length ? `${settled.unavailable[0] === 'stocks' ? 'Stock and ETF' : 'Mutual fund'} search is unavailable.`
    : !options.length ? 'No matching holding, stock, ETF or fund.' : ''

  function choose(option: Option) {
    onSelect(option.target)
    setTyped(false)
    setOpen(false)
    setActive(-1)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) return setOpen(true)
      if (!options.length) return
      setActive((current) => (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length)
    } else if (event.key === 'Enter' && open && options[active]) {
      event.preventDefault()
      choose(options[active])
    }
  }

  const showList = open && options.length > 0
  const optionId = (index: number) => `${id}-option-${index}`
  const render = (items: Option[], offset: number) => items.map((option, index) => <li key={option.key} id={optionId(offset + index)} role="option" aria-selected={offset + index === active}
    data-active={offset + index === active} title={option.name} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)}>
    <span className="mp-pick-name">{option.name}</span><span className="mp-pick-detail">{option.detail}</span>
  </li>)

  return <div className="mp-field mp-picker" ref={root} onBlur={(event) => {
    if (root.current?.contains(event.relatedTarget)) return
    // Typed text is never a choice: leaving the field restores the selection.
    setOpen(false)
    setText(selected)
    setTyped(false)
  }}>
    <label htmlFor={id}>{label}</label>
    <input id={id} role="combobox" aria-expanded={showList} aria-controls={`${id}-list`} aria-autocomplete="list" aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
      autoFocus autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={40} required placeholder="Search a stock, ETF or fund" value={text}
      onClick={() => setOpen(true)} onKeyDown={onKeyDown}
      onChange={(event) => { setText(event.target.value); setTyped(true); setOpen(true); setActive(-1) }} />
    {showList && <ul className="mp-pick-list" id={`${id}-list`} role="listbox" aria-label="Matching securities">
      {holdings.length > 0 && <li role="presentation" className="mp-pick-group">Your holdings</li>}
      {render(holdings, 0)}
      {listed.length > 0 && <li role="presentation" className="mp-pick-group">Listed securities</li>}
      {render(listed, holdings.length)}
    </ul>}
    <p className="mp-pick-notice" role="status" aria-live="polite">{notice}</p>
  </div>
}
