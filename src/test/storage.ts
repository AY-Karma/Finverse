import { afterAll, beforeEach } from 'vitest'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(String(key)) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(String(key)) }
  setItem(key: string, value: string) { this.values.set(String(key), String(value)) }
}

const original = Object.fromEntries(['Storage', 'localStorage', 'sessionStorage', 'navigator']
  .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))

beforeEach(() => {
  for (const [key, value] of Object.entries({ Storage: MemoryStorage, localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage(), navigator: {} })) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
})

afterAll(() => {
  for (const [key, descriptor] of Object.entries(original)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
})
