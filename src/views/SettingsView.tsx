import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { hexToHsv, hsvToHex, type Hsv } from '../theme'
import { ACCENTS, ACCENT_KEYS, normalizeHex } from '../theme'
import type { Accent, Density, Mode } from '../types'
import { useStore } from '../useStore'
import { ManageHoldings } from './ManageHoldings'
import { ActionIcon } from './ActionIcon'

type SettingsSection = 'preferences' | 'privacy'

export function SettingsView() {
  const { settings, setSettings } = useStore()
  const [activeSection, setActiveSection] = useState<SettingsSection>('preferences')
  const update = (patch: Partial<typeof settings>) => setSettings({ ...settings, ...patch })

  // Floating custom-accent card: pinned next to the rainbow chip in the empty
  // right zone of the settings page. Rendered through a portal because the
  // settings group clips absolutely-positioned children.
  const customChipRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  // Drags commit instantly to settings, so closing the card always "saves";
  // Cancel is the only path that discards, by restoring the prior accent.
  const [pickerOpen, setPickerOpen] = useState(false)
  const previousAccent = useRef<Accent>('indigo')
  const popoverOpen = settings.accent === 'custom' && pickerOpen
  const [cardPos, setCardPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    if (!popoverOpen) { setCardPos(null); return }
    const place = () => {
      const rect = customChipRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = 304
      const left = Math.min(rect.right + 24, window.innerWidth - width - 20)
      setCardPos({ left: Math.max(16, left), top: Math.max(16, rect.top - 10) })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [popoverOpen])

  // Click outside or press Escape: keep the picked colour and close.
  useEffect(() => {
    if (!popoverOpen) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (popoverRef.current?.contains(target) || customChipRef.current?.contains(target)) return
      setPickerOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPickerOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [popoverOpen])

  // A preset click closes the card; the next Custom click starts a fresh session.
  useEffect(() => {
    if (settings.accent !== 'custom') setPickerOpen(false)
  }, [settings.accent])
  const sections: { id: SettingsSection; index: string; label: string; summary: string }[] = [
    { id: 'preferences', index: '01', label: 'Preferences', summary: `${settings.currency} · ${settings.density}` },
    { id: 'privacy', index: '02', label: 'Data & privacy', summary: settings.allowExternalData ? 'External data on' : 'Local-first' },
  ]

  return (
    <>
      <div className="page-head enter d0">
        <div>
          <div className="page-eyebrow">05 · Workspace</div>
          <h1 className="page-title">Settings</h1>
        </div>
        <p className="page-sub">Control the workspace and where portfolio data can go.</p>
      </div>

      <div className="settings-shell enter d1">
        <nav className="settings-nav" aria-label="Settings categories">
          <div className="settings-nav-head">
            <span>Settings</span>
            <span>{sections.length}</span>
          </div>
          <div className="settings-nav-list">
            {sections.map((section) => (
              <button
                key={section.id}
                type="button"
                className={`settings-nav-item${activeSection === section.id ? ' settings-nav-item--active' : ''}`}
                aria-current={activeSection === section.id ? 'page' : undefined}
                onClick={() => setActiveSection(section.id)}
              >
                <span className="settings-nav-icon"><ActionIcon name={section.id} /></span>
                <span className="settings-nav-index">{section.index}</span>
                <span className="settings-nav-copy">
                  <strong>{section.label}</strong>
                  <small>{section.summary}</small>
                </span>
              </button>
            ))}
          </div>
          <div className="settings-nav-foot">
            <span className="settings-saved-mark" aria-hidden="true">✓</span>
            <span><strong>Saved automatically</strong><small>Preferences stay in this browser.</small></span>
          </div>
        </nav>

        <div className="settings-detail">
          {activeSection === 'preferences' && (
            <SettingsSectionHeader
              eyebrow="Workspace"
              title="Preferences"
              description="Choose how portfolio information is displayed across Finverse."
            >
              <span className="settings-status">Auto-saved</span>
            </SettingsSectionHeader>
          )}
          {activeSection === 'preferences' && (
            <div className="settings-group">
              <SettingRow
                label="Display currency"
                description="Imported values remain in INR. USD uses a live conversion rate when external data is on."
              >
                <select
                  id="currency"
                  className="select settings-control"
                  aria-label="Display currency"
                  value={settings.currency}
                  onChange={(event) => update({ currency: event.target.value as typeof settings.currency })}
                >
                  <option value="INR">INR (₹)</option>
                  <option value="USD">USD ($)</option>
                </select>
              </SettingRow>

              <SettingRow label="Interface density" description="Change spacing without changing the information shown.">
                <select
                  id="density"
                  className="select settings-control"
                  aria-label="Interface density"
                  value={settings.density}
                  onChange={(event) => update({ density: event.target.value as Density })}
                >
                  <option value="comfortable">Comfortable</option>
                  <option value="compact">Compact</option>
                </select>
              </SettingRow>

              <SettingRow label="Appearance" description="Dark is tuned for markets; light for bright rooms.">
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

              <SettingRow label="Accent colour" description="Used for focus, selections, and primary actions. Pick a preset or any hex.">
                <div className="accent-options" role="group" aria-label="Accent colour">
                  {ACCENT_KEYS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      className={`accent-option${settings.accent === key ? ' accent-option--active' : ''}`}
                      style={{ '--swatch': ACCENTS[key].primary } as CSSProperties}
                      aria-label={`${capitalize(key)} accent`}
                      title={`${capitalize(key)}`}
                      aria-pressed={settings.accent === key}
                      onClick={() => update({ accent: key as Accent })}
                    >
                      <span className="accent-option-dot" />
                    </button>
                  ))}

                  <button
                    ref={customChipRef}
                    type="button"
                    className={`accent-option${settings.accent === 'custom' ? ' accent-option--active' : ''}`}
                    aria-label="Custom accent — opens the colour picker"
                    title={`Custom${settings.customAccent ? ` · ${settings.customAccent}` : ''}`}
                    aria-pressed={settings.accent === 'custom'}
                    aria-expanded={popoverOpen}
                    onClick={() => {
                      if (popoverOpen) { setPickerOpen(false); return }
                      if (settings.accent !== 'custom') previousAccent.current = settings.accent
                      update({ accent: 'custom' })
                      setPickerOpen(true)
                    }}
                  >
                    <span
                      className="accent-option-dot"
                      style={{ background: 'conic-gradient(from 210deg, #ff5f57, #febc2e, #28c840, #22d3ee, #7c6cff, #ff2d92, #ff5f57)' }}
                    />
                  </button>
                </div>
              </SettingRow>

              <SettingToggle
                id="hide-values"
                label="Hide portfolio values"
                description="Mask balances, gains, and losses when someone else can see your screen."
                checked={settings.hideValues}
                onChange={(hideValues) => update({ hideValues })}
              />
            </div>
          )}

          {activeSection === 'preferences' && <ManageHoldings />}

          {activeSection === 'privacy' && (
            <SettingsSectionHeader
              eyebrow="Permissions"
              title="Data & privacy"
              description="Finverse is local-first. External access remains off until you allow it."
            >
              <span className="settings-status-pill settings-status-pill--on" role="status"><span className="settings-status-dot" />Local-first</span>
            </SettingsSectionHeader>
          )}
          {activeSection === 'privacy' && (
            <div className="settings-stack">
              <div className="settings-group">
                <SettingToggle
                  id="external-data"
                  label="External market data"
                  description="Allow quote, NAV, company feed, and optional media requests for this portfolio."
                  checked={settings.allowExternalData}
                  onChange={(allowExternalData) => update({ allowExternalData })}
                  status={settings.allowExternalData ? 'On' : 'Off'}
                />
              </div>

              <section aria-labelledby="data-handling-title">
                <div className="settings-subhead">
                  <div>
                    <h3 id="data-handling-title">How data is handled</h3>
                    <p>What stays here and what can leave the browser.</p>
                  </div>
                </div>
                <div className="settings-group">
                  <DataRow label="Portfolio & history" destination="This browser">
                    Holdings and tracked history use local storage.
                  </DataRow>
                  <DataRow label="Market data" destination={settings.allowExternalData ? 'Identifiers only' : 'Blocked'}>
                    Quote providers receive instrument identifiers, never quantities or cost basis.
                  </DataRow>
                </div>
              </section>
            </div>
          )}

        </div>
      </div>

      {popoverOpen && cardPos && createPortal(
        <div
          ref={popoverRef}
          className="accent-popover"
          style={cardPos}
          role="dialog"
          aria-label="Custom accent"
        >
          <ColorPickerPanel
            value={settings.customAccent ?? '#7c6cff'}
            onChange={(hex) => update({ customAccent: hex })}
          />
          <div className="accent-popover-foot">
            <span className="accent-hex-state">hover/focus shades derive automatically</span>
            <button
              type="button"
              className="btn btn--danger btn--small"
              onClick={() => {
                update({ accent: previousAccent.current })
                setPickerOpen(false)
              }}
            >
              Cancel
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

function SettingsSectionHeader({ eyebrow, title, description, children }: {
  eyebrow: string
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <div className="settings-detail-head">
      <div>
        <span className="settings-detail-eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {children}
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

function SettingToggle({ id, label, description, checked, onChange, status }: {
  id: string
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
  status?: string
}) {
  return (
    <label className="setting-row setting-row--toggle" htmlFor={id}>
      <span className="setting-copy">
        <span className="setting-label-line"><strong>{label}</strong>{status && <small>{status}</small>}</span>
        <span>{description}</span>
      </span>
      <span className="switch">
        <input id={id} type="checkbox" aria-label={label} checked={checked} onChange={(event) => onChange(event.target.checked)} />
        <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
      </span>
    </label>
  )
}

function DataRow({ label, destination, children }: { label: string; destination: string; children: ReactNode }) {
  return (
    <div className="data-handling-row">
      <span className="data-handling-mark" aria-hidden="true" />
      <span className="setting-copy"><strong>{label}</strong><span>{children}</span></span>
      <span className="data-destination">{destination}</span>
    </div>
  )
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/**
 * In-app colour picker: saturation/value canvas over a hue slider with a live
 * hex readout. Opens in the empty right zone of the settings page — no OS
 * dialog, no positioning surprises.
 */
function ColorPickerPanel({ value, onChange }: { value?: string; onChange: (hex: string) => void }) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value ?? '#7c6cff'))
  const hsvRef = useRef(hsv)
  const lastEmitted = useRef<string | null>(null)
  const padRef = useRef<HTMLDivElement>(null)
  const hueRef = useRef<HTMLDivElement>(null)

  // Adopt external changes (e.g. preset click) unless this panel emitted them.
  useEffect(() => {
    if (value && value.toLowerCase() !== lastEmitted.current) setHsv(hexToHsv(value))
  }, [value])

  const commit = (next: Hsv) => {
    hsvRef.current = next
    setHsv(next)
    const hex = hsvToHex(next)
    lastEmitted.current = hex
    onChange(hex)
  }

  const trackPointer = (
    element: RefObject<HTMLDivElement | null>,
    onMove: (xRatio: number, yRatio: number) => void,
  ) => (event: React.PointerEvent) => {
    event.preventDefault()
    const el = element.current
    if (!el) return
    el.setPointerCapture(event.pointerId)
    const applyFrom = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect()
      onMove(clamp01((clientX - rect.left) / rect.width), clamp01((clientY - rect.top) / rect.height))
    }
    applyFrom(event.clientX, event.clientY)
    const move = (moveEvent: PointerEvent) => applyFrom(moveEvent.clientX, moveEvent.clientY)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="colorpicker">
      <div
        ref={padRef}
        className="colorpicker-pad"
        style={{ background: `hsl(${hsv.h} 100% 50%)` }}
        onPointerDown={trackPointer(padRef, (x, y) => commit({ ...hsvRef.current, s: x, v: 1 - y }))}
        role="application"
        aria-label="Saturation and brightness area"
      >
        <span
          className="colorpicker-thumb"
          style={{
            left: `${hsv.s * 100}%`,
            top: `${(1 - hsv.v) * 100}%`,
            background: hsvToHex(hsv),
          }}
        />
      </div>

      <div
        ref={hueRef}
        className="colorpicker-hue"
        onPointerDown={trackPointer(hueRef, (x) => commit({ ...hsvRef.current, h: Math.min(359, Math.round(x * 360)) }))}
        role="slider"
        aria-label="Hue"
        aria-valuenow={Math.round(hsv.h)}
      >
        <span className="colorpicker-thumb colorpicker-thumb--hue" style={{ left: `${(hsv.h / 360) * 100}%`, background: `hsl(${hsv.h} 100% 50%)` }} />
      </div>

      <div className="colorpicker-meta">
        <span className="colorpicker-swatch" style={{ background: hsvToHex(hsv) }} />
        <input
          className="input accent-hex"
          type="text"
          spellCheck={false}
          value={hsvToHex(hsv)}
          onChange={(event) => {
            const normalized = normalizeHex(event.target.value)
            if (normalized) commit(hexToHsv(normalized))
          }}
          aria-label="Custom accent hex value"
        />
        <span className="accent-hex-state">live</span>
      </div>
    </div>
  )
}
