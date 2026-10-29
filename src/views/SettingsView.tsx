import { useState, type ReactNode } from 'react'
import type { Mode } from '../types'
import { useStore } from '../useStore'
import { ManageHoldings } from './ManageHoldings'
import { ActionIcon, type ActionIconName } from './ActionIcon'
import './settings.css'

export function SettingsView({ onRequestImport }: { onRequestImport: (accountId?: string) => void }) {
  const { positions, settings, setSettings, settingsSaved = true } = useStore()
  const [reviewOpen, setReviewOpen] = useState(() => window.location.hash === '#instrument-review')
  const showListingReview = reviewOpen && positions.some((position) => position.type !== 'mutual-fund')
  const update = (patch: Partial<typeof settings>) => setSettings({ ...settings, ...patch })

  const closeListingReview = () => {
    setReviewOpen(false)
    if (window.location.hash === '#instrument-review') window.history.replaceState({}, '', window.location.pathname + window.location.search)
    document.getElementById('listing-review-trigger')?.focus()
  }

  return (
    <>
      <div className="page-head settings-page-head enter d0">
        <div>
          <h1 className="page-title">Settings</h1>
        </div>
        <span className="settings-save-status" role="status">{settingsSaved ? 'Saved automatically' : 'Preferences not saved'}</span>
      </div>

      <div className="settings-page enter d1">
        <ManageHoldings onRequestImport={onRequestImport} reviewOpen={showListingReview} onReviewListings={showListingReview ? closeListingReview : () => setReviewOpen(true)} />
        <section className="settings-section" aria-label="Data & privacy">
          <SettingsSectionHeader
            icon="privacy"
            title="Data & privacy"
          />
          <div className="settings-group">
            <SettingToggle
              id="external-data"
              label="External market data"
              description="Allow quotes, NAVs, company updates, and market news after import."
              checked={settings.allowExternalData}
              onChange={(allowExternalData) => update({ allowExternalData })}
            />
          </div>
        </section>
        <section className="settings-section" aria-label="Preferences">
          <SettingsSectionHeader
            icon="preferences"
            title="Preferences"
          />
          <div className="settings-group">
            <SettingRow label="Appearance" description="Choose a light or dark workspace.">
              <div className="segmented-control settings-control mode-toggle" role="group" aria-label="Appearance mode">
                {(['dark', 'light'] as Mode[]).map((modeOption) => (
                  <button
                    key={modeOption}
                    type="button"
                    className={settings.mode === modeOption ? 'is-active' : ''}
                    aria-pressed={settings.mode === modeOption}
                    onClick={() => update({ mode: modeOption })}
                  >
                    {modeOption === 'dark' ? 'Dark' : 'Light'}
                  </button>
                ))}
              </div>
            </SettingRow>

            <SettingToggle
              id="hide-values"
              label="Hide portfolio values"
              description="Conceal holdings and amounts when sharing your screen."
              checked={settings.hideValues}
              onChange={(hideValues) => update({ hideValues })}
            />
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

function SettingRow({ label, description, children }: {
  label: string
  description: string
  children: ReactNode
}) {
  return (
    <div className="setting-row">
      <div className="setting-copy">
        <strong>{label}</strong>
        <span>{description}</span>
      </div>
      <div className="setting-control-wrap">{children}</div>
    </div>
  )
}

function SettingToggle({ id, label, description, checked, onChange }: {
  id: string
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="setting-row setting-row--toggle" htmlFor={id}>
      <span className="setting-copy">
        <strong>{label}</strong>
        <span id={`${id}-description`}>{description}</span>
      </span>
      <span className="setting-toggle-control">
        <span className="setting-toggle-status" aria-hidden="true">{checked ? 'On' : 'Off'}</span>
        <span className="switch">
          <input id={id} type="checkbox" role="switch" aria-label={label} aria-describedby={`${id}-description`} checked={checked} onChange={(event) => onChange(event.target.checked)} />
          <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
        </span>
      </span>
    </label>
  )
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
