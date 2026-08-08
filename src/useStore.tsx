import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Folio, Position, Settings } from './types'
import { flattenFolios, loadFolios, loadSettings, saveFolios, saveSettings } from './store'
import { parseSpreadsheet } from './spreadsheet'

export type View = 'overview' | 'import' | 'assistant' | 'settings'

interface Store {
  folios: Folio[]
  positions: Position[]
  setFolios: (f: Folio[]) => void
  addFolio: (name: string, positions: Position[]) => void
  removeFolio: (id: string) => void
  setSettings: (s: Settings) => void
  settings: Settings
  uploadFile: (file: File) => Promise<void>
}

const StoreContext = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [folios, setFoliosState] = useState<Folio[]>(() => loadFolios())
  const [settings, setSettingsState] = useState<Settings>(() => loadSettings())

  useEffect(() => saveFolios(folios), [folios])
  useEffect(() => saveSettings(settings), [settings])

  const setFolios = useCallback((f: Folio[]) => setFoliosState(f), [])

  const addFolio = useCallback((name: string, positions: Position[]) => {
    setFoliosState((prev) => [
      ...prev,
      { id: crypto.randomUUID(), name, importedAt: Date.now(), positions },
    ])
  }, [])

  const removeFolio = useCallback((id: string) => {
    setFoliosState((prev) => prev.filter((f) => f.id !== id))
  }, [])

  const setSettings = useCallback((s: Settings) => setSettingsState(s), [])

  const positions = useMemo(() => flattenFolios(folios), [folios])

  const uploadFile = useCallback(
    async (file: File) => {
      const buffer = await file.arrayBuffer()
      const parsed = parseSpreadsheet(buffer)
      addFolio(file.name || 'Portfolio', parsed)
    },
    [addFolio],
  )

  const value: Store = {
    folios,
    positions,
    setFolios,
    addFolio,
    removeFolio,
    settings,
    setSettings,
    uploadFile,
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): Store {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}