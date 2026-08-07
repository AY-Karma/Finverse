import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { Position, Settings } from './types'
import { loadPositions, loadSettings, savePositions, saveSettings } from './store'
import { parseSpreadsheet } from './spreadsheet'

export type View = 'overview' | 'import' | 'assistant' | 'settings'

interface Store {
  positions: Position[]
  settings: Settings
  setPositions: (p: Position[]) => void
  setSettings: (s: Settings) => void
  uploadFile: (file: File) => Promise<void>
}

const StoreContext = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [positions, setPositionsState] = useState<Position[]>(() => loadPositions())
  const [settings, setSettingsState] = useState<Settings>(() => loadSettings())

  useEffect(() => savePositions(positions), [positions])
  useEffect(() => saveSettings(settings), [settings])

  const setPositions = useCallback((p: Position[]) => setPositionsState(p), [])
  const setSettings = useCallback((s: Settings) => setSettingsState(s), [])

  const uploadFile = useCallback(async (file: File) => {
    const buffer = await file.arrayBuffer()
    const parsed = parseSpreadsheet(buffer)
    setPositionsState(parsed)
  }, [])

  const value = { positions, settings, setPositions, setSettings, uploadFile }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): Store {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}