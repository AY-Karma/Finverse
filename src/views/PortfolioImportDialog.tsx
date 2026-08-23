import { useEffect, useRef } from 'react'
import { ImportView } from './ImportView'

interface PortfolioImportDialogProps {
  open: boolean
  onClose: () => void
}

export function PortfolioImportDialog({ open, onClose }: PortfolioImportDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      dialog.showModal()
    }
    if (!open && dialog.open) dialog.close()
  }, [open])

  const closeDialog = () => {
    onClose()
    window.requestAnimationFrame(() => returnFocusRef.current?.focus())
  }

  return (
    <dialog
      ref={dialogRef}
      className="portfolio-import-dialog"
      aria-labelledby="portfolio-import-title"
      aria-describedby="portfolio-import-description portfolio-import-privacy"
      onCancel={closeDialog}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeDialog()
      }}
    >
      <div className="portfolio-import-card">
        <div className="portfolio-import-head">
          <div>
            <span className="page-eyebrow">Start with your holdings</span>
            <h2 id="portfolio-import-title">Bring in your portfolio</h2>
          </div>
          <button className="btn-remove" type="button" onClick={closeDialog} aria-label="Close portfolio import" autoFocus>×</button>
        </div>
        <p id="portfolio-import-description">
          Need your latest holdings file? Open your broker below, download the latest holdings statement,
          then return here and choose Local files. Already have it? Go straight to Local files.
        </p>
        <ImportView compact initialStep="sources" onImported={closeDialog} />
        <p id="portfolio-import-privacy" className="portfolio-import-privacy">
          Broker sites open in a new tab. Finverse never asks for or receives your broker login.
        </p>
      </div>
    </dialog>
  )
}
