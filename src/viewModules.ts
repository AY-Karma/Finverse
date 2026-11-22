import type { View } from './useStore'

const modules = {
  overview: () => import('./views/Overview').then((module) => module.Overview),
  holdings: () => import('./views/MonitorView').then((module) => module.MonitorView),
  research: () => import('./views/ResearchView').then((module) => module.ResearchView),
  insights: () => import('./views/InsightsView').then((module) => module.InsightsView),
  settings: () => import('./views/SettingsView').then((module) => module.SettingsView),
} satisfies { [K in View]: () => Promise<ViewComponents[K]> }

type ViewComponents = {
  overview: typeof import('./views/Overview')['Overview']
  holdings: typeof import('./views/MonitorView')['MonitorView']
  research: typeof import('./views/ResearchView')['ResearchView']
  insights: typeof import('./views/InsightsView')['InsightsView']
  settings: typeof import('./views/SettingsView')['SettingsView']
}

const loaded: Partial<ViewComponents> = {}
const inflight = new Map<View, Promise<void>>()

/**
 * Loads a screen's code. Screens are shown only once this resolves, so a screen's first frame is its real layout
 * (with in-card loaders for data) rather than a placeholder that is later replaced.
 */
export function loadView(view: View): Promise<void> {
  if (loaded[view]) return Promise.resolve()
  let request = inflight.get(view)
  if (!request) {
    request = modules[view]().then((component) => { (loaded as Record<View, unknown>)[view] = component })
      .finally(() => inflight.delete(view))
    inflight.set(view, request)
  }
  return request
}

export function loadedView<K extends View>(view: K): ViewComponents[K] | undefined {
  return loaded[view]
}
