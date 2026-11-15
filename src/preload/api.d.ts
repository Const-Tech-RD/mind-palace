import type { MindPalaceApi } from '@shared/ipc'

declare global {
  interface Window {
    /** Exposed by src/preload/index.ts through contextBridge. */
    mindPalace: MindPalaceApi
  }
}

export {}
