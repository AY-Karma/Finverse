// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { DitherAreaFill } from './DitherAreaFill'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

it('renders the painted bitmap in SVG coordinates and refreshes it when points change', async () => {
  const putImageData = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    createImageData: (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
    putImageData,
  } as unknown as CanvasRenderingContext2D)
  const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL')
    .mockReturnValueOnce('data:image/png;base64,first').mockReturnValueOnce('data:image/png;base64,updated')
  const container = document.createElement('div')
  const root = createRoot(container)
  const render = async (endY: number) => {
    await act(async () => root.render(<svg viewBox="0 0 480 206">
      <DitherAreaFill points={[{ x: 64, y: 30, baselineY: 30 }, { x: 350, y: endY, baselineY: 30 }]}
        x={64} y={30} width={286} height={146} color="red" />
    </svg>))
  }
  try {
    await render(176)
    const image = container.querySelector('image')!
    expect(image.namespaceURI).toBe('http://www.w3.org/2000/svg')
    expect(image.getAttribute('href')).toBe('data:image/png;base64,first')
    expect(image.getAttribute('width')).toBe('286')
    expect(image.getAttribute('height')).toBe('146')
    expect(container.querySelector('foreignObject')).toBeNull()
    expect(putImageData.mock.calls[0][0].data.some((value: number) => value > 0)).toBe(true)
    await render(100)
    expect(image.getAttribute('href')).toBe('data:image/png;base64,updated')
    expect(toDataURL).toHaveBeenCalledTimes(2)
  } finally {
    await act(async () => root.unmount())
    vi.restoreAllMocks()
  }
})
