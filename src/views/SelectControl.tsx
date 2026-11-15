import { Fragment, useEffect, useId, useRef, useState } from 'react'
import * as Select from '@radix-ui/react-select'
import './selectControl.css'

export type SelectControlOption = {
  value: string
  label: string
  group?: string
  separatorBefore?: boolean
}

type SelectControlProps = {
  label: string
  value: string
  options: readonly SelectControlOption[]
  onChange: (value: string) => void
  id?: string
  labelledBy?: string
  describedBy?: string
  getBottomClearance?: () => number
}

export function SelectControl({ label, value, options, onChange, id: suppliedId, labelledBy, describedBy, getBottomClearance }: SelectControlProps) {
  const generatedId = useId()
  const id = suppliedId ?? generatedId
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const selectedBounds = useRef<DOMRect | null>(null)
  const wasOpen = useRef(false)
  const phone = window.matchMedia('(max-width: 768px)').matches
  const topInset = phone ? (document.querySelector('.sidebar')?.getBoundingClientRect().bottom ?? 107) + 8 : 12
  const bottomInset = Math.max(12, getBottomClearance?.() ?? 12)
  const selectedLabel = options.find((option) => option.value === value)?.label ?? value
  const groups: { label?: string; options: SelectControlOption[] }[] = []
  for (const option of options) {
    const previous = groups[groups.length - 1]
    if (previous && previous.label === option.group) previous.options.push(option)
    else groups.push({ label: option.group, options: [option] })
  }

  // Restore after the old focus trap is removed, without a delayed refocus.
  useEffect(() => {
    if (wasOpen.current && !open) trigger.current?.focus({ preventScroll: true })
    wasOpen.current = open
  }, [open])

  useEffect(() => {
    const clearSelection = () => { selectedBounds.current = null }
    const consumeRepeat = (event: MouseEvent) => {
      const bounds = selectedBounds.current
      if (!bounds) return
      if (event.detail <= 1 || event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
        clearSelection(); return
      }
      // The popup has closed, but this click still belongs to its selection gesture.
      event.preventDefault(); event.stopPropagation()
      trigger.current?.focus({ preventScroll: true })
    }
    document.addEventListener('mousedown', consumeRepeat, true)
    document.addEventListener('click', consumeRepeat, true)
    document.addEventListener('dblclick', consumeRepeat, true)
    document.addEventListener('keydown', clearSelection, true)
    return () => {
      document.removeEventListener('mousedown', consumeRepeat, true)
      document.removeEventListener('click', consumeRepeat, true)
      document.removeEventListener('dblclick', consumeRepeat, true)
      document.removeEventListener('keydown', clearSelection, true)
    }
  }, [])

  return <Select.Root value={value} onValueChange={onChange} open={open} onOpenChange={setOpen}>
    <Select.Trigger ref={trigger} id={id} className="select-control-trigger" aria-label={labelledBy ? undefined : `${label} ${selectedLabel}`} aria-labelledby={labelledBy ? `${labelledBy} ${id}-value` : undefined} aria-describedby={describedBy}
      onPointerDown={(event) => { if (event.pointerType === 'mouse') event.preventDefault() }}
      onClick={(event) => {
        event.preventDefault(); event.stopPropagation()
        if (event.detail > 1) return
        event.currentTarget.focus({ preventScroll: true })
        setOpen((current) => !current)
      }}>
      <Select.Value id={`${id}-value`} />
      <Select.Icon asChild><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg></Select.Icon>
    </Select.Trigger>
    <Select.Portal>
      <Select.Content className="select-control-menu" position="popper" sideOffset={6} align="start" collisionPadding={{ top: topInset, bottom: bottomInset, left: 12, right: 12 }} onCloseAutoFocus={(event) => event.preventDefault()} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
        <Select.Viewport className="select-control-viewport">
          {groups.map((group, index) => <Select.Group key={`${group.label ?? ''}-${index}`}>
            {group.label && <Select.Label className="select-control-group-label">{group.label}</Select.Label>}
            {group.options.map((option) => <Fragment key={option.value}>
              {option.separatorBefore && <Select.Separator className="select-control-separator" />}
              <Select.Item value={option.value} className="select-control-option"
                onPointerUp={(event) => { if (event.pointerType === 'mouse') event.preventDefault() }}
                onClick={(event) => {
                  event.preventDefault(); event.stopPropagation()
                  if (event.detail > 1) return
                  if (event.detail > 0) selectedBounds.current = event.currentTarget.getBoundingClientRect()
                  onChange(option.value); setOpen(false)
                }}>
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator asChild><svg className="select-control-check" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m4 10 4 4 8-8" /></svg></Select.ItemIndicator>
              </Select.Item>
            </Fragment>)}
          </Select.Group>)}
        </Select.Viewport>
      </Select.Content>
    </Select.Portal>
  </Select.Root>
}
