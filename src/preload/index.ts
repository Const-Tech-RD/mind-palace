import { contextBridge, ipcRenderer } from 'electron'
import type { ChatEvent } from '@shared/chat'
import { API_KEY, CHAT_EVENT_CHANNEL, IPC_CHANNELS, type IpcChannel, type MindPalaceApi } from '@shared/ipc'

const channels: ReadonlySet<string> = new Set(IPC_CHANNELS)

const invoke = ((channel: IpcChannel, request?: unknown) => {
  // The renderer can only reach channels that are part of the contract.
  if (!channels.has(channel)) return Promise.reject(new Error(`Unknown IPC channel "${String(channel)}"`))
  return ipcRenderer.invoke(channel, request)
}) as MindPalaceApi['invoke']

const api: MindPalaceApi = {
  invoke,
  ping: (message) => invoke('ping', { message }),
  status: () => invoke('app:status'),
  onChatEvent: (listener) => {
    const handler = (_event: unknown, payload: ChatEvent): void => listener(payload)
    ipcRenderer.on(CHAT_EVENT_CHANNEL, handler)
    return () => ipcRenderer.removeListener(CHAT_EVENT_CHANNEL, handler)
  }
}

contextBridge.exposeInMainWorld(API_KEY, api)
