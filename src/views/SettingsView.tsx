import { useEffect, useState, type ReactNode } from 'react'
import type { Mode } from '../types'
import { MARKET_INDEX_CHOICES, normalizeMarketIndexIds } from '../marketIndexSelection'
import { useStore } from '../useStore'
import { ManageHoldings } from './ManageHoldings'
import { ActionIcon, type ActionIconName } from './ActionIcon'
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
    </div>
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
  return <div className="settings-index-control"><SelectControl label={label} value={value} options={marketIndexOptions} onChange={onChange} /></div>
}

function DataHandlingCard({ icon, label, destination, children }: { icon: ActionIconName; label: string; destination: string; children: ReactNode }) {
  return (
    <article className="data-handling-card">
      <span className="data-handling-icon"><ActionIcon name={icon} /></span>
      <div className="setting-copy"><h4>{label}</h4><p>{children}</p></div>
      <span className="data-destination">{destination}</span>
    </article>
  )
}
