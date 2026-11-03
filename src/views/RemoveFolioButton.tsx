import { useEffect, useRef, useState } from 'react'
import type { Folio } from '../types'

export function RemoveFolioButton({ folio, onConfirm }: { folio: Pick<Folio, 'id' | 'name'>; onConfirm: (id: string) => void | boolean | Promise<void | boolean> }) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const buttonRef = useRef<HTMLButtonElement>(null)
  const busyRef = useRef(false)
  const armed = confirmingId === folio.id

  useEffect(() => {
    if (!armed || busy) return
    function cancelOutside(event: PointerEvent) {
      if (event.target instanceof Node && !buttonRef.current?.contains(event.target)) setConfirmingId(null)
    }
    document.addEventListener('pointerdown', cancelOutside, true)
    return () => document.removeEventListener('pointerdown', cancelOutside, true)
  }, [armed, busy])

  async function remove() {
    if (busyRef.current) return
    setError('')
    if (!armed) { setConfirmingId(folio.id); return }
    busyRef.current = true
    setBusy(true)
    try {
      if (await onConfirm(folio.id) !== false) setConfirmingId(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The import could not be deleted. Try again.')
    } finally { busyRef.current = false; setBusy(false) }
  }

  return <>
    <button ref={buttonRef} className={`btn-remove btn-remove--label${armed ? ' btn-remove--armed' : ''}`}
      type="button" disabled={busy} aria-label={armed ? `Confirm deletion of ${folio.name}` : `Remove ${folio.name}`}
      title={armed ? 'Click again to delete. Click outside or press Escape to cancel.' : 'Remove import'}
      onClick={() => void remove()} onBlur={() => { if (!busyRef.current) setConfirmingId(null) }}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setConfirmingId(null) } }}>
      {busy ? 'Deleting…' : armed ? 'Delete ?' : 'Remove'}
    </button>
    {error && <p className="hint down" role="alert">{error}</p>}
  </>
}
