import { useState } from 'react'
import { loadSampleWorkspace, SAMPLE_MARKER_KEY, simulateNextImport } from '../sampleWorkspace'
import './sampleWorkspaceBar.css'

const NOTICE_KEY = 'finverse:sample-notice'

/** Preview-only controls for the sample workspace. Never rendered in production builds. */
export function SampleWorkspaceBar() {
  const [notice] = useState(() => { try { const text = sessionStorage.getItem(NOTICE_KEY) ?? ''; sessionStorage.removeItem(NOTICE_KEY); return text } catch { return '' } })
  const sample = !!localStorage.getItem(SAMPLE_MARKER_KEY)
  const empty = !localStorage.getItem('finverse:folios')
  if (!sample && !empty && !notice) return null
  const run = (action: () => string) => {
    const text = action()
    try { sessionStorage.setItem(NOTICE_KEY, text) } catch { /* the notice is optional */ }
    window.location.reload()
  }
  return <aside className="sample-bar" aria-label="Sample workspace controls">
    <strong>Sample workspace</strong>
    {notice && <span className="sample-bar-notice" role="status">{notice}</span>}
    {sample && <button type="button" onClick={() => run(() => simulateNextImport())}>Simulate next import</button>}
    {(sample || empty) && <button type="button" onClick={() => run(() => loadSampleWorkspace() ? 'Sample workspace loaded. SIP NAVs are recorded in a few seconds.' : 'A real workspace exists here; the sample was not loaded.')}>{sample ? 'Reset sample' : 'Load sample'}</button>}
  </aside>
}
