import { useStore } from '../useStore'
import { PROVIDERS } from '../providers'

const STORAGE_HINT =
  'Keys live only in this browser\u2019s local storage and go straight to the provider you pick — nothing routes through a Finverse server. Use a low-limit key, and don\u2019t share this device. This is informational, not financial advice.'

export function SettingsView() {
  const { settings, setSettings } = useStore()

  return (
    <>
      <div className="page-head enter d0">
        <div>
          <div className="page-eyebrow">04 · Settings</div>
          <h1 className="page-title">Wire the terminal</h1>
        </div>
        <p className="page-sub">Pick a provider and drop in your key to arm the AI coach.</p>
      </div>

      <div className="panel enter d1" style={{ display: 'grid', gap: 20, maxWidth: 520 }}>
        <div className="panel-head">
          <span className="panel-title">AI Provider</span>
          <span className="section-index">BYOK</span>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="provider">Provider</label>
          <select
            id="provider"
            className="select"
            value={settings.provider}
            onChange={(e) =>
              setSettings({ ...settings, provider: e.target.value as typeof settings.provider })
            }
          >
            <option value="">Select a provider</option>
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="apikey">API key</label>
          <input
            id="apikey"
            className="input"
            type="password"
            placeholder="sk-…"
            value={settings.apiKey}
            onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
          />
        </div>

        <p className="hint" style={{ borderTop: '1px solid var(--hairline)', paddingTop: 16 }}>
          {STORAGE_HINT}
        </p>
      </div>
    </>
  )
}