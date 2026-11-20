import { useEffect, useState, type ReactNode } from 'react'
import type { Mode } from '../types'
import { MARKET_INDEX_CHOICES, normalizeMarketIndexIds } from '../marketIndexSelection'
import { useStore } from '../useStore'
import { ManageHoldings } from './ManageHoldings'
import { ActionIcon } from './ActionIcon'
import { SelectControl } from './SelectControl'
import './settings.css'

const marketIndexOptions = MARKET_INDEX_CHOICES.map((index) => ({ value: index.id, label: index.label, group: index.region }))

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
    <div className="settings-layout">
      <div className="page-head settings-page-head">
        <div>
          <h1 className="page-title">Settings</h1>
        </div>
        {!settingsSaved && <span className="settings-save-status" role="alert">Preferences not saved</span>}
      </div>

      <div className="settings-page">
        <ManageHoldings onRequestImport={onRequestImport} reviewOpen={showListingReview} onReviewListings={showListingReview ? closeListingReview : () => setReviewOpen(true)} />
        <section className="settings-section" aria-label="Preferences">
          <h2 className="settings-detail-head">Preferences</h2>
          <div className="settings-group">
            <SettingRow label="Appearance" className="setting-row--appearance">
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
            <SettingRow label="Overview indices" className="setting-row--indices">
              {marketIndices.map((id, slot) => {
                const label = slot === 0 ? 'First market index' : 'Second market index'
                return <MarketIndexPreference key={slot} label={label} value={id} onChange={(next) => updateMarketIndex(slot, next)} />
              })}
            </SettingRow>
            <SettingRow label="Keyboard focus outlines" description="Outline the selected control when moving with Tab." className="setting-row--switch">
              <button type="button" role="switch" className="settings-switch" aria-label="Keyboard focus outlines" aria-checked={settings.focusRings !== false}
                onClick={() => update({ focusRings: settings.focusRings === false })}><span className="settings-switch-thumb" aria-hidden="true" /></button>
            </SettingRow>
          </div>
        </section>
        <section className="settings-data" aria-labelledby="data-handling-title">
          <h2 id="data-handling-title" className="settings-detail-head">How data is handled</h2>
          <div className="data-handling-grid">
            <DataHandlingCard label="Portfolio & history">Stored only in this browser.</DataHandlingCard>
            <DataHandlingCard label="Market data">
              {settings.allowExternalData ? 'Quote providers see instrument identifiers only, never quantities or costs.' : 'Quote providers are blocked.'}
            </DataHandlingCard>
          </div>
        </section>
      </div>
    </div>
  )
}

function SettingRow({ label, description, children, className = '' }: {
  label: string
  description?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`setting-row ${className}`}>
      <div className="setting-copy"><strong>{label}</strong>{description && <span>{description}</span>}</div>
      <div className="setting-control-wrap">{children}</div>
    </div>
  )
}

function MarketIndexPreference({ label, value, onChange }: { label: string; value: string; onChange: (id: string) => void }) {
  return <div className="settings-index-control"><SelectControl label={label} value={value} options={marketIndexOptions} onChange={onChange} /></div>
}

function DataHandlingCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <article className="data-handling-card">
      <div className="setting-copy"><h4>{label}</h4><p>{children}</p></div>
    </article>
  )
}
