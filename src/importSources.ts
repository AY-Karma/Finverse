import zerodhaIcon from './assets/imports/zerodha.svg'
import growwIcon from './assets/imports/groww.png'
import indmoneyIcon from './assets/imports/indmoney.png'
import angelOneIcon from './assets/imports/angel-one.ico'

export interface ImportSource {
  id: 'zerodha' | 'groww' | 'indmoney' | 'angel-one'
  name: string
  icon: string
  description: string
  url: string
}

export const IMPORT_SOURCES: readonly ImportSource[] = [
  {
    id: 'zerodha',
    name: 'Zerodha',
    icon: zerodhaIcon,
    description: 'Download a holdings report',
    url: 'https://support.zerodha.com/category/console/portfolio/console-holdings/articles/holding-report',
  },
  {
    id: 'groww',
    name: 'Groww',
    icon: growwIcon,
    description: 'Find holdings and reports',
    url: 'https://groww.in/help/stocks',
  },
  {
    id: 'indmoney',
    name: 'INDmoney',
    icon: indmoneyIcon,
    description: 'Open reports help',
    url: 'https://www.indmoney.com/customer-service',
  },
  {
    id: 'angel-one',
    name: 'Angel One',
    icon: angelOneIcon,
    description: 'Download a holding statement',
    url: 'https://www.angelone.in/support/reports-and-statements/holding-statement',
  },
]
