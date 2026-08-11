import type { CSSProperties } from 'react'
import { isLocalProvider, PROVIDERS } from '../providers'
import { ACCENTS, ACCENT_KEYS } from '../theme'
import type { Accent, Density } from '../types'
import { useStore } from '../useStore'

const STORAGE_HINT =
  'Keys are kept only for this browser session and go straight to the provider you pick; Finverse has no backend. A local Ollama model stays on your machine only when its Base URL is local. Use a low-limit key and do not share this device.'

export function SettingsView() {
  const { settings, setSettings } = useStore()
  const update = (patch: Partial<typeof settings>) => setSettings({ ...settings, ...patch })
  const local = settings.provider ? isLocalProvider(settings.provider) : false
  const configured = Boolean(settings.provider) && (local || Boolean(settings.apiKey))

  return (
    <>
      <div className="page-head enter d0">
        <div>
          <div className="page-eyebrow">04 · Settings</div>
          <h1 className="page-title">Wire the terminal</h1>
        </div>
        <p className="page-sub">Choose where portfolio data can go and how it is displayed.</p>
      </div>

      <div className="settings-grid">
        <div className="panel enter d1" style={{ display: 'grid', gap: 20 }}>
          <div className="panel-head">
            <span className="panel-title">Display</span>
            <span className="section-index">Market</span>
          </div>

          <div className="settings-row">
            <div className="field">
              <label className="field-label" htmlFor="currency">Currency</label>
              <select
                id="currency"
                className="select"
                value={settings.currency}
                onChange={(e) => update({ currency: e.target.value as typeof settings.currency })}
              >
                <option value="INR">INR (₹)</option>
                <option value="USD">USD ($)</option>
              </select>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="density">Density</label>
              <select
                id="density"
                className="select"
                value={settings.density}
                onChange={(e) => update({ density: e.target.value as Density })}
              >
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </div>
          </div>

          <div className="field">
            <span className="field-label">Accent</span>
            <div className="accent-row">
              {ACCENT_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  className={`accent-swatch${settings.accent === key ? ' accent-swatch--active' : ''}`}
                  style={{ '--swatch': ACCENTS[key].primary } as CSSProperties}
                  aria-label={`${key} accent`}
                  aria-pressed={settings.accent === key}
                  onClick={() => update({ accent: key as Accent })}
                >
                  <span className="accent-swatch-swatch" />
                </button>
              ))}
            </div>
          </div>

          <label className="field field--toggle" htmlFor="external-data">
            <span>
              <span className="field-label">External market data</span>
              <span className="hint">Allow quote, NAV, and USD/INR requests for this portfolio.</span>
            </span>
            <input
              id="external-data"
              type="checkbox"
              checked={settings.allowExternalData}
              onChange={(e) => update({ allowExternalData: e.target.checked })}
            />
          </label>
          <p className="hint" style={{ marginTop: 0 }}>
            Imported values are INR. USD display uses a live USD/INR rate after you enable external data;
            it shows an em dash until a rate is available.
          </p>
        </div>

        <div className="panel enter d1" style={{ display: 'grid', gap: 20 }}>
          <div className="panel-head">
            <span className="panel-title">AI Provider</span>
            <span className={`provider-status ${configured ? 'provider-status--on' : 'provider-status--off'}`} role="status">
              <span className="provider-status-dot" />
              {configured ? 'Configured' : 'Not configured'}
            </span>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="provider">Provider</label>
            <select
              id="provider"
              className="select"
              value={settings.provider}
              onChange={(e) => {
                const id = e.target.value as typeof settings.provider
                const provider = PROVIDERS.find((item) => item.id === id)
                update({ provider: id, model: settings.model || provider?.model || '' })
              }}
            >
              <option value="">Select a provider</option>
              {PROVIDERS.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
            </select>
          </div>

          {local ? (
            <>
              <TextField id="model" label="Model" placeholder="e.g. llama3, phi3, gemma2" value={settings.model} onChange={(model) => update({ model })} />
              <TextField id="baseurl" label="Base URL" placeholder="http://localhost:11434/v1" value={settings.baseUrl} onChange={(baseUrl) => update({ baseUrl })} />
              <p className="hint">Only use a non-local Base URL if you intend to send your portfolio to that server.</p>
            </>
          ) : (
            <>
              <TextField id="apikey" label="API key" type="password" placeholder="sk-…" value={settings.apiKey} onChange={(apiKey) => update({ apiKey })} />
              <TextField id="model" label="Model" placeholder={getProviderDefault(settings.provider)} value={settings.model} onChange={(model) => update({ model })} />
            </>
          )}
          <p className="hint" style={{ borderTop: '1px solid var(--hairline)', paddingTop: 16 }}>{STORAGE_HINT}</p>
        </div>
      </div>
    </>
  )
}

function TextField({ id, label, type = 'text', placeholder, value, onChange }: {
  id: string; label: string; type?: string; placeholder: string; value: string; onChange: (value: string) => void
}) {
  return <div className="field">
    <label className="field-label" htmlFor={id}>{label}</label>
    <input id={id} className="input" type={type} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
  </div>
}

function getProviderDefault(provider: string): string {
  return PROVIDERS.find((item) => item.id === provider)?.model ?? 'model'
}
