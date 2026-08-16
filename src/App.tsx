import { lazy, Suspense, useEffect, useState } from 'react'
import type { View } from './useStore'
import { useStore } from './useStore'
import { applyTheme } from './theme'
import { Overview } from './views/Overview'

const ImportView = lazy(() => import('./views/ImportView').then((module) => ({ default: module.ImportView })))
const AssistantView = lazy(() => import('./views/AssistantView').then((module) => ({ default: module.AssistantView })))
const SettingsView = lazy(() => import('./views/SettingsView').then((module) => ({ default: module.SettingsView })))
const InsightsView = lazy(() => import('./views/InsightsView').then((module) => ({ default: module.InsightsView })))

const NAV: { id: View; label: string; index: string }[] = [
  { id: 'overview', label: 'Overview', index: '01' },
  { id: 'import', label: 'Portfolio', index: '02' },
  { id: 'insights', label: 'Insights', index: '03' },
  { id: 'assistant', label: 'AI Assistant', index: '04' },
  { id: 'settings', label: 'Settings', index: '05' },
]

export default function App() {
  const [view, setView] = useState<View>('overview')
  const { positions, settings, quickMode } = useStore()

  // Reflect theme + density across the whole app as soon as it loads or changes.
  useEffect(() => {
    applyTheme(settings.accent, settings.density)
  }, [settings.accent, settings.density])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">⌁</div>
          <div>
            <div className="brand-name">Finverse</div>
            <div className="brand-sub">Live · Market Scoreboard</div>
          </div>
        </div>

        <nav className="nav">
          <span className="nav-label">Terminal</span>
          {NAV.map((item) => (
            <button
              key={item.id}
              className={`nav-item${view === item.id ? ' nav-item--active' : ''}`}
              onClick={() => setView(item.id)}
            >
              <span className="nav-item-label">
                {item.label}
                {item.id === 'assistant' && quickMode && (
                  <span className="nav-quick-dot" aria-label="Quick mode on" title="Quick mode is on" />
                )}
              </span>
              <span className="nav-index">{item.index}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <span className="hint">
            {positions.length > 0
              ? `${positions.length} position${positions.length === 1 ? '' : 's'} in the arena`
              : 'No portfolio loaded'}
          </span>
        </div>
      </aside>

      <main className="main">
        {view === 'overview' && <Overview onGoTo={setView} />}
        {view !== 'overview' && (
          <Suspense fallback={<div className="view-loading">Loading workspace…</div>}>
            {view === 'import' && <ImportView />}
            {view === 'insights' && <InsightsView />}
            {view === 'assistant' && <AssistantView onGoTo={setView} />}
            {view === 'settings' && <SettingsView />}
          </Suspense>
        )}
      </main>
    </div>
  )
}
