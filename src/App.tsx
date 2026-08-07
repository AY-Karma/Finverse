import { useState } from 'react'
import type { View } from './useStore'
import { useStore } from './useStore'
import { Overview } from './views/Overview'
import { ImportView } from './views/ImportView'
import { AssistantView } from './views/AssistantView'
import { SettingsView } from './views/SettingsView'

const NAV: { id: View; label: string; index: string }[] = [
  { id: 'overview', label: 'Overview', index: '01' },
  { id: 'import', label: 'Portfolio', index: '02' },
  { id: 'assistant', label: 'AI Assistant', index: '03' },
  { id: 'settings', label: 'Settings', index: '04' },
]

export default function App() {
  const [view, setView] = useState<View>('overview')
  const { positions } = useStore()

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
              <span>{item.label}</span>
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
        {view === 'import' && <ImportView />}
        {view === 'assistant' && <AssistantView />}
        {view === 'settings' && <SettingsView />}
      </main>
    </div>
  )
}