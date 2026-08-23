export interface ImportSource {
  id: 'zerodha' | 'groww' | 'indmoney' | 'angel-one'
  name: string
  mark: string
  description: string
  url: string
}

export const IMPORT_SOURCES: readonly ImportSource[] = [
  {
    id: 'zerodha',
    name: 'Zerodha',
    mark: 'Z',
    description: 'Download a holdings report',
    url: 'https://support.zerodha.com/category/console/portfolio/console-holdings/articles/holding-report',
  },
  {
    id: 'groww',
    name: 'Groww',
    mark: 'G',
    description: 'Find holdings and reports',
    url: 'https://groww.in/help/stocks',
  },
  {
    id: 'indmoney',
    name: 'INDmoney',
    mark: 'I',
    description: 'Open reports help',
    url: 'https://www.indmoney.com/customer-service',
  },
  {
    id: 'angel-one',
    name: 'Angel One',
    mark: 'A',
    description: 'Download a holding statement',
    url: 'https://www.angelone.in/support/reports-and-statements/holding-statement',
  },
]
