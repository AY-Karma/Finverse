import { useEffect, useState } from 'react'
import { holdingIdentity } from '../monitor'
import { useMonitor } from '../useMonitor'
import { useStore } from '../useStore'
import { useMarketEvents } from '../useMarketEvents'
import type { MarketEvent } from '../marketEvents'
import { quoteKey } from '../valuation'
import { MonitorToast } from './MonitorToast'
import { MonitorNewsPanel } from './MonitorNewsPanel'
import { MonitorOnboarding } from './MonitorOnboarding'
import { MonitorAlerts } from './MonitorAlerts'
import { MonitorAgenda, MonitorDevelopments } from './MonitorAgenda'
import { MonitorCompanyContext } from './MonitorCompanyContext'
import { RulesPanel, type ReminderRequest, type RuleRequest } from './monitorPanels'
import './monitor.css'

export function MonitorView({ onRequestImport, initialQuery = '' }: { onRequestImport: () => void; initialQuery?: string }) {
  const controller = useMonitor()
  const { liveQuotes, workspaceReadOnly } = useStore()
  const { feed, loading, refresh: refreshEvents } = useMarketEvents(controller.positions, controller.allowExternalData, controller.hideValues)
  const [contextId, setContextId] = useState('')
  const [ruleRequest, setRuleRequest] = useState<RuleRequest>()
  const [reminderRequest, setReminderRequest] = useState<ReminderRequest>()
  const [newsSelection, setNewsSelection] = useState({ identity: '', revision: 0 })
  const contextPosition = !controller.hideValues ? controller.positions.find((position) => position.id === contextId) : undefined
  useEffect(() => { if (controller.hideValues) setContextId('') }, [controller.hideValues])

  const openIdentity = (identity: string) => {
    if (controller.hideValues) return
    const matches = controller.positions.filter((position) => holdingIdentity(position) === identity)
    if (matches.length === 1) setContextId(matches[0].id)
  }
  const remind = (event: MarketEvent) => {
    setReminderRequest((current) => ({ holdingId: event.holdingId, title: event.title, date: event.date, revision: (current?.revision ?? 0) + 1 }))
  }
  const openNews = (identity: string) => {
    setNewsSelection((current) => ({ identity, revision: current.revision + 1 }))
    setContextId('')
    window.requestAnimationFrame(() => {
      const heading = document.getElementById('monitor-news-heading')
      heading?.scrollIntoView?.({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' })
      heading?.focus({ preventScroll: true })
    })
  }

  if (controller.positions.length === 0) return <MonitorOnboarding onRequestImport={onRequestImport} />

  return <div className="mp-page">
    <header className="mp-hero"><div className="mp-hero-main">
      <div><h1>Monitor</h1><p>{controller.allowExternalData ? 'Your news, company updates and watches.' : <>External data off · <a href="/app/settings">Settings</a></>}</p></div>
      <button className="mp-button" type="button" disabled={controller.refreshing || !controller.allowExternalData} onClick={() => { void controller.refresh(); refreshEvents() }}>{controller.refreshing ? 'Refreshing prices…' : 'Refresh prices'}</button>
    </div></header>
    <div className="mp-content-flow" data-has-portfolio={controller.positions.length > 0}>
      <div className="mp-monitor-content">
        <MonitorAlerts controller={controller} onOpenHolding={setContextId} />
        <MonitorNewsPanel initialQuery={initialQuery} selectedIdentity={newsSelection.identity} selectedRevision={newsSelection.revision} reading={controller.reading} onReadingChange={controller.updateReading} onOpenHolding={openIdentity} readOnly={workspaceReadOnly} />
        <MonitorDevelopments events={feed.events} onOpenHolding={setContextId} />
      </div>
      {controller.positions.length > 0 && <aside className="mp-monitor-sidebar" aria-label="Upcoming events and watch rules">
        <MonitorAgenda controller={controller} feed={feed} loading={loading} onRemind={remind} onOpenHolding={setContextId} onRetry={refreshEvents} reminderRequest={reminderRequest} />
        <div className="mp-panel mp-watch-rules" id="monitor-watch-rules"><RulesPanel controller={controller} request={ruleRequest} /></div>
      </aside>}
    </div>
    {contextPosition && <MonitorCompanyContext key={contextPosition.id} position={contextPosition} quote={liveQuotes[quoteKey(contextPosition)]} controller={controller} events={feed.events} onClose={() => setContextId('')}
      onWatch={() => { setRuleRequest((current) => ({ holdingId: contextPosition.id, revision: (current?.revision ?? 0) + 1 })); setContextId('') }}
      onRemind={() => { setReminderRequest((current) => ({ holdingId: contextPosition.id, revision: (current?.revision ?? 0) + 1 })); setContextId('') }}
      onNews={() => openNews(holdingIdentity(contextPosition))} />}
    <MonitorToast message={controller.statusMessage} revision={controller.statusRevision} />
  </div>
}
