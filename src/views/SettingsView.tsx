import type { CSSProperties } from 'react'
import { describeOllamaEndpoint, isLocalProvider, LOCAL_MODEL_PRESETS, PROVIDERS } from '../providers'
import { ACCENTS, ACCENT_KEYS } from '../theme'
import type { Accent, Density } from '../types'
import { useStore } from '../useStore'

const STORAGE_HINT =
  'Keys are kept only for this browser session and go straight to the provider you pick; Finverse has no backend. A local Ollama model stays on your machine only when its Base URL is local. Use a low-limit key and do not share this device.'

export function SettingsView() {
  const { settings, setSettings } = useStore()
  const update = (patch: Partial<typeof settings>) => setSettings({ ...settings, ...patch })
  const local = settings.provider ? isLocalProvider(settings.provider) : false
  const ollamaDestination = local ? describeOllamaEndpoint(settings.baseUrl) : null
  const configured = Boolean(settings.provider) && (
    local
      ? Boolean(ollamaDestination && !ollamaDestination.error && (!ollamaDestination.requiresConfirmation || settings.confirmRemoteOllama))
      : Boolean(settings.apiKey)
  )

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
            <span className="switch">
              <input
                id="external-data"
                type="checkbox"
                checked={settings.allowExternalData}
                onChange={(e) => update({ allowExternalData: e.target.checked })}
              />
              <span className="switch-track" aria-hidden="true">
                <span className="switch-thumb" />
              </span>
            </span>
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
                update({
                  provider: id,
                  model: settings.model || provider?.model || '',
                  baseUrl: id === 'ollama' && !settings.baseUrl ? 'http://localhost:11434/v1' : settings.baseUrl,
                  confirmRemoteOllama: false,
                })
              }}
            >
              <option value="">Select a provider</option>
              {PROVIDERS.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
            </select>
          </div>

          {local ? (
            <>
              <TextField id="model" label="Model" placeholder="e.g. qwen2.5:1.5b, llama3.2:latest" value={settings.model} onChange={(model) => update({ model })} />
              <div className="field">
                <span className="field-label">Installed on this device</span>
                <div className="model-chips">
                  {LOCAL_MODEL_PRESETS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`model-chip${settings.model === m ? ' model-chip--active' : ''}`}
                      aria-pressed={settings.model === m}
                      onClick={() => update({ model: m })}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <TextField
                id="baseurl"
                label="Base URL"
                placeholder="http://localhost:11434/v1"
                value={settings.baseUrl}
                onChange={(baseUrl) => update({ baseUrl, confirmRemoteOllama: false })}
              />
              {ollamaDestination && (
                <div className="ollama-destination" role={ollamaDestination.error ? 'alert' : 'status'}>
                  <span className="field-label">Resolved destination</span>
                  <code>{ollamaDestination.endpoint}</code>
                  {ollamaDestination.error && <span className="hint down">{ollamaDestination.error}</span>}
                  {!ollamaDestination.error && ollamaDestination.requiresConfirmation && (
                    <label className="remote-ollama-confirm">
                      <input
                        type="checkbox"
                        checked={settings.confirmRemoteOllama}
                        onChange={(e) => update({ confirmRemoteOllama: e.target.checked })}
                      />
                      <span>I understand this sends my portfolio and chat to this remote HTTPS server.</span>
                    </label>
                  )}
                </div>
              )}
              <p className="hint">Localhost is the default. Remote Ollama endpoints must use HTTPS and require the confirmation above before any request is sent.</p>
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
