// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { TickerTape } from './TickerTape'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

it('does not schedule recurring animation for static market indices', async () => {
  const frame = vi.spyOn(window, 'requestAnimationFrame')
  const container = document.createElement('div'), root = createRoot(container)
  try {
    await act(async () => root.render(<TickerTape><span>Bank Nifty</span><span>NIFTY 50</span></TickerTape>))
    expect(frame).not.toHaveBeenCalled()
  } finally { await act(async () => root.unmount()); frame.mockRestore() }
})
