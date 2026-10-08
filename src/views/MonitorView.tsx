import { useState } from 'react'
import { useMonitor } from '../useMonitor'
import { ActionIcon } from './ActionIcon'
import { MonitorToast } from './MonitorToast'
import { MonitorNewsPanel } from './MonitorNewsPanel'
import { MonitorActivityPanel } from './MonitorActivityPanel'
import { RulesPanel } from './monitorPanels'
import { PortfolioRequiredState } from './PortfolioRequiredState'
import './monitor.css'

export function MonitorView({ onRequestImport, initialQuery = '' }: { onRequestImport: () => void; initialQuery?: string }) {
  const controller = useMonitor()
  const [newsSelection, setNewsSelection] = useState({ identity: '', revision: 0 })
  if (controller.positions.length === 0) {
    return <PortfolioRequiredState area="03 · Monitor" description="Bring in your holdings to follow price updates, create watch rules, and read portfolio news." onImport={onRequestImport} />
  }

  return <div className="mp-page">
    <header className="mp-hero">
      <div className="mp-hero-top">
        <p className="mp-eyebrow">03 · Monitor</p>
        <div className="mp-data-status"><span className="mp-data-dot" />{controller.allowExternalData ? 'Market data enabled' : <><span>Market data off</span><a href="/app/settings"><ActionIcon name="settings" />Settings</a></>}</div>
      </div>
      <div className="mp-hero-main">
        <div><h1>Portfolio watch</h1><p>What moved. What needs your attention.</p></div>
        <button className="mp-button" type="button" disabled={controller.refreshing || !controller.allowExternalData} onClick={() => void controller.refresh()}>
          <svg className="mp-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 7a9 9 0 1 0 1 9M20 3v5h-5" /></svg>
          {controller.refreshing ? 'Refreshing prices…' : 'Refresh prices'}
        </button>
      </div>
    </header>
    <div className="mp-content-flow">
      <MonitorActivityPanel controller={controller} onSelectNews={(identity) => setNewsSelection((current) => ({ identity, revision: current.revision + 1 }))} />
      <MonitorNewsPanel initialQuery={initialQuery} selectedIdentity={newsSelection.identity} selectedRevision={newsSelection.revision} />
      <div className="mp-panel mp-watch-rules"><RulesPanel controller={controller} /></div>
    </div>
    <p className="mp-source-note">Prices and NAVs use provider observation times. Estimated impact uses your current units and the reported price change, converted at the available FX rate. Headlines are related coverage, not an explanation of a price move.</p>
    <footer className="mp-status-footer"><MonitorToast message={controller.statusMessage} revision={controller.statusRevision} /></footer>
  </div>
}
