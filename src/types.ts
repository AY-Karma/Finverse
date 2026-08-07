export type AssetType = 'stock' | 'etf' | 'mutual-fund' | 'other'

export type ProviderId = 'openai' | 'anthropic' | 'openrouter'

export interface Position {
  id: string
  ticker: string
  name: string
  type: AssetType
  quantity: number
  buyPrice: number
  lastPrice: number | null
  invested: number
}

export interface Settings {
  provider: ProviderId | ''
  apiKey: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}