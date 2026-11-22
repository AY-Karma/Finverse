import { ActionIcon } from './ActionIcon'

/** A small bell that adds or removes something from Overview notifications. */
export function NotifyToggle({ on, label, onToggle, disabled = false }: { on: boolean; label: string; onToggle: () => void; disabled?: boolean }) {
  return <button type="button" className="notify-toggle" aria-pressed={on} aria-label={label} title={on ? `${label} (on)` : label} disabled={disabled} onClick={onToggle}>
    <ActionIcon name="bell" />
  </button>
}
