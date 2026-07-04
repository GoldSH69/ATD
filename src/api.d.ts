import type { BridgeApi } from './types'

declare global {
  interface Window {
    api: BridgeApi
  }
}

export {}
