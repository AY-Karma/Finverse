import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { Mode } from '../types'
import { MARKET_INDEX_CHOICES, normalizeMarketIndexIds } from '../marketIndexSelection'
import { useStore } from '../useStore'
import { ManageHoldings } from './ManageHoldings'
import { ActionIcon, type ActionIconName } from './ActionIcon'
import './settings.css'

export function SettingsView({ onRequestImport }: { onRequestImport: (accountId?: string) => void }) {
  const { positions, settings, setSettings, settingsSaved = true } = useStore()
  const [reviewOpen, setReviewOpen] = useState(() => window.location.hash === '#instrument-review')
  const showListingReview = reviewOpen && positions.some((position) => position.type !== 'mutual-fund')
  const update = (patch: Partial<typeof settings>) => setSettings({ ...settings, ...patch })
  const marketIndices = normalizeMarketIndexIds(settings.marketIndices)
  const updateMarketIndex = (slot: number, id: string) => {
    const next: [string, string] = [...marketIndices]
    const other = slot === 0 ? 1 : 0
    if (next[other] === id) next[other] = next[slot]
    next[slot] = id
    update({ marketIndices: next })
  }

  useEffect(() => {
    if (!showListingReview) return
    const dismiss = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return
      const box = document.getElementById('instrument-review-content')?.closest('.listing-review')
      if (!box || box.contains(event.target)) return
      setReviewOpen(false)
      if (window.location.hash === '#instrument-review') window.history.replaceState({}, '', window.location.pathname + window.location.search)
    }
    document.addEventListener('click', dismiss)
    return () => document.removeEventListener('click', dismiss)
  }, [showListingReview])

  const closeListingReview = () => {
    setReviewOpen(false)
    if (window.location.hash === '#instrument-review') window.history.replaceState({}, '', window.location.pathname + window.location.search)
    document.getElementById('listing-review-trigger')?.focus()
  }

  return (
    <>
      <div className="page-head settings-page-head">
        <div>
          <h1 className="page-title">Settings</h1>
        </div>
        <span className="settings-save-status" role="status">{settingsSaved ? 'Saved automatically' : 'Preferences not saved'}</span>
      </div>

      <div className="settings-page">
        <ManageHoldings onRequestImport={onRequestImport} reviewOpen={showListingReview} onReviewListings={showListingReview ? closeListingReview : () => setReviewOpen(true)} />
        <section className="settings-section" aria-label="Preferences">
          <SettingsSectionHeader
            icon="preferences"
            title="Preferences"
          />
          <div className="settings-group">
            <SettingRow label="Appearance" description="Choose a light or dark workspace." className="setting-row--appearance">
              <div className="settings-control mode-toggle" role="group" aria-label="Appearance mode" data-selected-mode={settings.mode}>
                <span className="mode-toggle-thumb" aria-hidden="true" />
                {(['dark', 'light'] as Mode[]).map((modeOption) => (
                  <button
                    key={modeOption}
                    type="button"
                    className={settings.mode === modeOption ? 'is-active' : ''}
                    aria-pressed={settings.mode === modeOption}
                    onClick={() => update({ mode: modeOption })}
                  >
                    <ActionIcon name={modeOption === 'dark' ? 'moon' : 'sun'} />
                    {modeOption === 'dark' ? 'Dark' : 'Light'}
                  </button>
                ))}
              </div>
            </SettingRow>
            {marketIndices.map((id, slot) => <SettingRow key={slot} label={slot === 0 ? 'First market index' : 'Second market index'} description={slot === 0 ? 'Left index on Overview.' : 'Right index on Overview.'} className="setting-row--index">
              <MarketIndexPreference label={slot === 0 ? 'First market index' : 'Second market index'} value={id} onChange={(next) => updateMarketIndex(slot, next)} />
            </SettingRow>)}
          </div>
        </section>
        <section className="settings-data" aria-labelledby="data-handling-title">
          <div className="settings-subhead">
            <div>
              <h2 id="data-handling-title">How data is handled</h2>
            </div>
          </div>
          <div className="data-handling-grid">
            <DataHandlingCard icon="device" label="Portfolio & history" destination="This browser">
              Holdings and tracked history use local storage.
            </DataHandlingCard>
            <DataHandlingCard icon="market" label="Market data" destination={settings.allowExternalData ? 'Identifiers only' : 'Blocked'}>
              Quote providers receive instrument identifiers, never quantities or cost basis.
            </DataHandlingCard>
          </div>
        </section>
      </div>
    </>
  )
}

function SettingsSectionHeader({ icon, title }: {
  icon: ActionIconName
  title: string
}) {
  return (
    <div className="settings-detail-head">
      <ActionIcon name={icon} />
      <h2>{title}</h2>
    </div>
  )
}

function SettingRow({ label, description, children, className = '' }: {
  label: string
  description: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`setting-row ${className}`}>
      <div className="setting-copy">
        <strong>{label}</strong>
        <span>{description}</span>
      </div>
      <div className="setting-control-wrap">{children}</div>
    </div>
  )
}

function MarketIndexPreference({ label, value, onChange }: { label: string; value: string; onChange: (id: string) => void }) {
  const menu = useRef<HTMLDetailsElement>(null)
  const selected = MARKET_INDEX_CHOICES.find((index) => index.id === value)!
  const close = (restoreFocus = false) => {
    if (!menu.current?.open) return
    menu.current.open = false
    if (restoreFocus) menu.current.querySelector('summary')?.focus({ preventScroll: true })
  }
  const fit = () => {
    const detail = menu.current
    if (!detail?.open) return
    const popover = detail.querySelector<HTMLElement>('.benchmark-menu-popover')!
    const box = detail.getBoundingClientRect()
    const viewport = window.visualViewport
    const top = viewport?.offsetTop ?? 0
    const left = viewport?.offsetLeft ?? 0
    const height = viewport?.height ?? window.innerHeight
    const viewportWidth = viewport?.width ?? window.innerWidth
    const navigation = document.querySelector('.sidebar')?.getBoundingClientRect()
    const visibleTop = navigation && navigation.width >= viewportWidth - 1 && navigation.top <= top
      ? Math.max(top, navigation.bottom) : top
    const width = Math.min(280, viewportWidth - 32)
    const below = Math.max(0, top + height - box.bottom - 24)
    const above = Math.max(0, box.top - visibleTop - 24)
    const upwards = below < 240 && above > below
    popover.style.width = `${width}px`
    popover.style.left = `${Math.min(Math.max(left + 16, box.right - width), left + viewportWidth - width - 16) - box.left}px`
    popover.style.right = 'auto'
    popover.style.top = upwards ? 'auto' : 'calc(100% + 8px)'
    popover.style.bottom = upwards ? 'calc(100% + 8px)' : 'auto'
    popover.style.maxHeight = `${Math.min(420, upwards ? above : below)}px`
  }
  useEffect(() => {
    const detail = menu.current
    const dismiss = (event: MouseEvent) => { if (event.target instanceof Node && !detail?.contains(event.target)) close() }
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && detail?.open) { event.preventDefault(); close(true) }
    }
    detail?.addEventListener('toggle', fit)
    document.addEventListener('click', dismiss)
    document.addEventListener('keydown', escape)
    window.addEventListener('resize', fit)
    window.addEventListener('scroll', fit, true)
    window.visualViewport?.addEventListener('resize', fit)
    window.visualViewport?.addEventListener('scroll', fit)
    return () => {
      detail?.removeEventListener('toggle', fit)
      document.removeEventListener('click', dismiss)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('resize', fit)
      window.removeEventListener('scroll', fit, true)
      window.visualViewport?.removeEventListener('resize', fit)
      window.visualViewport?.removeEventListener('scroll', fit)
    }
  }, [])
  const keyboard = (event: KeyboardEvent<HTMLDetailsElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const detail = menu.current!
    const options = [...detail.querySelectorAll<HTMLButtonElement>('.benchmark-menu-group button')]
    const current = options.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
      : current < 0 ? MARKET_INDEX_CHOICES.findIndex((index) => index.id === value)
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
    detail.open = true
    fit()
    const option = options[next]
    option.focus({ preventScroll: true })
    const popover = detail.querySelector<HTMLElement>('.benchmark-menu-popover')!
    if (option.offsetTop < popover.scrollTop) popover.scrollTop = option.offsetTop
    else if (option.offsetTop + option.offsetHeight > popover.scrollTop + popover.clientHeight) popover.scrollTop = option.offsetTop + option.offsetHeight - popover.clientHeight
  }
  return <details ref={menu} className="benchmark-menu settings-index-menu" onKeyDown={keyboard} onBlur={(event) => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) close() }}>
    <summary aria-label={`${label}: ${selected.label}`} title={selected.label}><strong>{selected.label}</strong><i aria-hidden="true" /></summary>
    <div className="benchmark-menu-popover">
      {(['India', 'Global'] as const).map((region) => <div className="benchmark-menu-group" key={region}>
        <span>{region}</span>
        {MARKET_INDEX_CHOICES.filter((index) => index.region === region).map((index) => <button key={index.id} type="button" className={index.id === value ? 'is-selected' : undefined} aria-current={index.id === value ? 'true' : undefined} onClick={() => { onChange(index.id); close(true) }}>
          <span>{index.label}</span><small>{index.id === value ? 'Selected' : ''}</small>
        </button>)}
      </div>)}
    </div>
  </details>
}

function DataHandlingCard({ icon, label, destination, children }: { icon: ActionIconName; label: string; destination: string; children: ReactNode }) {
  return (
    <article className="data-handling-card">
      <div className="data-handling-card-head">
        <span className="data-handling-icon"><ActionIcon name={icon} /></span>
        <span className="data-destination">{destination}</span>
      </div>
      <div className="setting-copy"><h4>{label}</h4><p>{children}</p></div>
    </article>
  )
}
