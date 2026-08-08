import type { CSSProperties } from 'react'
import { useStore } from '../useStore'
import { PROVIDERS, isLocalProvider } from '../providers'
import { ACCENTS, ACCENT_KEYS } from '../theme'
import type { Accent, Density } from '../types'

const STORAGE_HINT =
  'Keys live only in this browser\u2019s local storage and go straight to the provider you pick — nothing routes through a Finverse server. For a local Ollama model, the app talks to your machine directly and never leaves it. Use a low-limit key, and don\u2019t share this device. This is informational, not financial advice.'

export function SettingsView() {
  const { settings, setSettings } = useStore()

  const update = (patch: Partial<typeof settings>) =>
    setSettings({ ...settings, ...patch })

  const local = settings.provider ? isLocalProvider(settings.provider) : false

  // "Connected" = a provider is armed and the coach can actually run: a selected
  // provider always counts for local Ollama (no key), otherwise an API key must be set.
  const connected = Boolean(settings.provider) && (local || Boolean(settings.apiKey))
  const statusLabel = connected ? 'Connected' : 'Disconnected'

  return (
    <>
      <div className="page-head enter d0">
        <div>
          <div className="page-eyebrow">04 · Settings</div>
          <h1 className="page-title">Wire the terminal</h1>
        </div>
        <p className="page-sub">Pick a provider to arm the AI coach. Local Ollama needs no key.</p>
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
              value={settings.currency || 'INR'}
              onChange={(e) =>
                update({ currency: e.target.value as typeof settings.currency })
              }
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
          <label className="field-label">Accent</label>
          <div className="accent-row">
            {ACCENT_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                className={`accent-swatch${settings.accent === key ? ' accent-swatch--active' : ''}`}
                style={{ '--swatch': ACCENTS[key].primary } as CSSProperties}
                aria-label={`${key} accent`}
                title={key}
                onClick={() => update({ accent: key as Accent })}
              >
                <span className="accent-swatch-swatch" />
              </button>
            ))}
          </div>
        </div>

        <p className="hint" style={{ marginTop: 0 }}>
          Live prices are converted automatically (USD ↔ INR) when the holding trades in a different
          currency. Density and accent are applied across every screen instantly.
        </p>
      </div>

      <div className="panel enter d1" style={{ display: 'grid', gap: 20 }}>
        <div className="panel-head">
          <span className="panel-title">AI Provider</span>
          <span
            className={`provider-status ${connected ? 'provider-status--on' : 'provider-status--off'}`}
            role="status"
          >
            <span className="provider-status-dot" />
            {statusLabel}
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
              const p = PROVIDERS.find((x) => x.id === id)
              update({
                provider: id,
                // Seed a sensible model when a provider is chosen the first time.
                model: settings.model || (p ? p.model : ''),
              })
            }}
          >
            <option value="">Select a provider</option>
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {local ? (
          <>
            <div className="field">
              <label className="field-label" htmlFor="model">Model</label>
              <input
                id="model"
                className="input"
                type="text"
                placeholder="e.g. llama3, phi3, gemma2"
                value={settings.model}
                onChange={(e) => update({ model: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="baseurl">Base URL</label>
              <input
                id="baseurl"
                className="input"
                type="text"
                placeholder="http://localhost:11434/v1"
                value={settings.baseUrl}
                onChange={(e) => update({ baseUrl: e.target.value })}
              />
            </div>
            <p className="hint" style={{ borderTop: '1px solid var(--hairline)', paddingTop: 16 }}>
              Leave Base URL as is unless Ollama runs elsewhere. The model name follows the one
              installed locally (run <code>ollama list</code> to see yours).
            </p>
          </>
        ) : (
          <>
            <div className="field">
              <label className="field-label" htmlFor="apikey">API key</label>
              <input
                id="apikey"
                className="input"
                type="password"
                placeholder="sk-…"
                value={settings.apiKey}
                onChange={(e) => update({ apiKey: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="model">Model</label>
              <input
                id="model"
                className="input"
                type="text"
                placeholder={getProviderDefault(settings.provider)}
                value={settings.model}
                onChange={(e) => update({ model: e.target.value })}
              />
            </div>
          </>
        )}

        <p className="hint" style={{ borderTop: '1px solid var(--hairline)', paddingTop: 16 }}>
          {STORAGE_HINT}
        </p>
      </div>
      </div>
    </>
  )
}

function getProviderDefault(provider: string): string {
  return PROVIDERS.find((p) => p.id === provider)?.model ?? 'model'
}