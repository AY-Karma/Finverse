import { useEffect, useState } from 'react'

export function UndoImportButton({ targetId, onConfirm }: { targetId: string | null; onConfirm: () => void }) {
  const [armedTarget, setArmedTarget] = useState<string | null>(null)
  const armed = targetId !== null && armedTarget === targetId

  useEffect(() => {
    if (!armed) return
    const timeout = window.setTimeout(() => setArmedTarget(null), 5000)
    return () => window.clearTimeout(timeout)
  }, [armedTarget])

  return <button
    className={`btn btn--ghost btn--small undo-import${armed ? ' undo-import--armed' : ''}`}
    type="button"
    title="Remove the latest import from this session. Requires a second tap."
    disabled={!targetId}
    onClick={() => {
      if (!armed) {
        setArmedTarget(targetId)
        return
      }
      setArmedTarget(null)
      onConfirm()
    }}
  >
    <span>{armed ? 'Confirm undo' : 'Undo import'}</span>
  </button>
}
