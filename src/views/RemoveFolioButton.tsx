import { useEffect, useRef, useState } from 'react'
import type { Folio } from '../types'

export function RemoveFolioButton({ folio, onConfirm }: { folio: Pick<Folio, 'id' | 'name'>; onConfirm: (id: string) => void }) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const removeButtonRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef(false)

  useEffect(() => {
    if (confirmingId === null && restoreFocusRef.current) {
      removeButtonRef.current?.focus()
      restoreFocusRef.current = false
    }
  }, [confirmingId])

  function cancel() {
    restoreFocusRef.current = true
    setConfirmingId(null)
  }

  if (confirmingId !== folio.id) {
    return <button ref={removeButtonRef} className="btn-remove" type="button" aria-label={`Remove ${folio.name}`} title="Remove import" onClick={() => setConfirmingId(folio.id)}>×</button>
  }

  return <div className="folio-remove-confirm" role="group" aria-label={`Confirm deletion of ${folio.name}`} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); cancel() } }}>
    <span className="hint">Delete this import?</span>
    <div className="folio-remove-actions">
      <button className="btn btn--ghost btn--small" type="button" autoFocus onClick={cancel}>Cancel</button>
      <button className="btn btn--secondary btn--small down" type="button" onClick={() => { setConfirmingId(null); onConfirm(folio.id) }}>Delete</button>
    </div>
  </div>
}
