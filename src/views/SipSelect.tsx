import { useId } from 'react'
import { SelectControl, type SelectControlOption } from './SelectControl'
import './sipSelect.css'

export function SipSelect({ label, value, options, onChange, fullWidth = false, description }: {
  label: string
  value: string
  options: readonly SelectControlOption[]
  onChange: (value: string) => void
  fullWidth?: boolean
  description?: string
}) {
  const id = useId()
  return <div className={`sip-field${fullWidth ? ' sip-span' : ''}`}>
    <label id={`${id}-label`} htmlFor={id}>{label}</label>
    <SelectControl id={id} label={label} labelledBy={`${id}-label`} describedBy={description ? `${id}-description` : undefined} value={value} options={options} onChange={onChange} />
    {description && <span id={`${id}-description`} className="sip-selected-scheme">{description}</span>}
  </div>
}
