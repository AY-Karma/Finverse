import { useEffect, useRef, useState } from 'react'

export function UndoImportButton({ targetId, targetName, onConfirm }: { targetId: string | null; targetName?: string; onConfirm: () => void | boolean | Promise<boolean> }) {
  const [armedTarget, setArmedTarget] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const busyRef = useRef(false)
  const armed = targetId !== null && armedTarget === targetId

  useEffect(() => {
    if (!armed || busy) return
    const timeout = window.setTimeout(() => setArmedTarget(null), 5000)
    return () => window.clearTimeout(timeout)
  }, [armed, armedTarget, busy])

  return <><button
    className={`btn btn--ghost btn--small undo-import${armed ? ' undo-import--armed' : ''}`}
    type="button"
    title={`Undo the latest account change${targetName ? ` for ${targetName}` : ''}. Requires a second tap and remains available after reload.`}
    disabled={!targetId || busy}
    onClick={async () => {
      if (busyRef.current) return
      setError('')
      if (!armed) {
        setArmedTarget(targetId)
        return
      }
      busyRef.current = true
      setBusy(true)
      try {
        if (await onConfirm() !== false) setArmedTarget(null)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'The account change could not be undone.')
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    }}
  >
    <span>{busy ? 'Undoing…' : armed ? 'Confirm undo' : 'Undo import'}</span>
  </button>{error && <p className="hint down" role="alert">{error}</p>}</>
}
