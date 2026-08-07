import { useStore } from '../useStore'
import { PROVIDERS } from '../providers'

const STORAGE_HINT =
  'API keys are stored only in this browser\u2019s local storage on your device and are sent directly to the provider you choose. Nothing is routed through a Finverse server. Do not use a production-scoped key.'

export function SettingsView() {
  const { settings, setSettings } = useStore()

  return (
    <>
      <div>
        <div className="eyebrow">Configuration</div>
        <h1 className="page-title">Settings</h1>
      </div>

      <div className="card" style={{ display: 'grid', gap: 20, maxWidth: 520 }}>
        <div className="field">
          <label className="field-label" htmlFor="provider">AI provider</label>
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
            placeholder="sk-..."
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