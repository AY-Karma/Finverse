const numbers = new Map<string, Intl.NumberFormat>()
const dates = new Map<string, Intl.DateTimeFormat>()

export function numberFormatter(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = JSON.stringify(options)
  let formatter = numbers.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-IN', options)
    numbers.set(key, formatter)
  }
  return formatter
}

export function dateFormatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options)
  let formatter = dates.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-IN', options)
    dates.set(key, formatter)
  }
  return formatter
}
