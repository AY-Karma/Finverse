import { useState } from 'react'
import type { View } from './useStore'
import { useStore } from './useStore'
import { Overview } from './views/Overview'
import { ImportView } from './views/ImportView'
import { AssistantView } from './views/AssistantView'
import { SettingsView } from './views/SettingsView'

const NAV: { id: View; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'import', label: 'Import portfolio' },
  { id: 'assistant', label: 'AI Assistant' },
  { id: 'settings', label: 'Settings' },
]

export default function App() {
  const [view, setView] = useState<View>('overview')
  const { positions } = useStore()

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">F</div>
          <div className="brand-name">Finverse</div>
        </div>

        <nav className="nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              className={`nav-item${view === item.id ? ' nav-item--active' : ''}`}
              onClick={() => setView(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div>
          <p className="hint">
            {positions.length > 0
              ? `${positions.length} position${positions.length === 1 ? '' : 's'} loaded`
              : 'No portfolio loaded yet'}
          </p>
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