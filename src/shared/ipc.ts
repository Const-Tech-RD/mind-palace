/**
 * The one IPC contract between the renderer and the main process.
 *
 * Every channel is listed here with its request and response type. The main
 * process registers handlers through `handle()` (src/main/ipc.ts), the preload
 * exposes `window.mindPalace` built from the same map, so a channel name or
 * payload that drifts is a compile error on both sides.
 */
import type { AuthState, ChatEvent, ChatMessage, ChatSummary } from './chat'
import type { ProjectAction, ProjectSummary } from './projects'

export interface IpcContract {
  ping: {
    request: { message: string }
    response: {
      pong: true
      /** The message that was sent, unchanged. */
      echo: string
      /** Main-process time of the reply, UTC ISO-8601. */
      at: string
    }
  }
  'app:status': {
    request: void
    response: AppStatus
  }
  /** Whether a Claude Code login is available on this machine. */
  'auth:check': {
    request: void
    response: AuthState
  }
  /** The user says the login is fixed: forget a remembered refusal and check again. */
  'auth:retry': {
    request: void
    response: AuthState
  }
  'chat:list': {
    request: void
    response: ChatSummary[]
  }
  'chat:messages': {
    request: { chatId: string }
    response: ChatMessage[]
  }
  /**
   * Stores the user's message and starts the answer. Resolves as soon as the
   * message is stored; the answer arrives as `ChatEvent`s on `CHAT_EVENT_CHANNEL`.
   * `chatId: null` starts a new chat.
   */
  'chat:send': {
    request: { chatId: string | null; text: string }
    response: { chatId: string }
  }
  /** Stops the answer in progress for this chat, keeping what was written so far. */
  'chat:stop': {
    request: { chatId: string }
    response: { stopped: boolean }
  }
  'chat:delete': {
    request: { chatId: string }
    response: { deleted: boolean }
  }
  /** "Move to room": sets the room by hand; the classifier leaves the chat alone afterwards. */
  'chat:move': {
    request: { chatId: string; roomId: string }
    response: { moved: true }
  }
  /** Tracked projects in every state except `suggested`. */
  'project:list': {
    request: void
    response: ProjectSummary[]
  }
  /** Answers the "Track it?" card with Track. */
  'project:track': {
    request: { chatId: string }
    response: { projectId: string }
  }
  /** Answers the "Track it?" card with "Just a question". */
  'project:dismiss': {
    request: { chatId: string }
    response: { dismissed: true }
  }
  'project:action': {
    request: { projectId: string; action: ProjectAction }
    response: ProjectSummary
  }
}

/** One-way channel, main to renderer, carrying `ChatEvent`s. */
export const CHAT_EVENT_CHANNEL = 'chat:event'

export interface AppStatus {
  version: string
  /** Absolute path of the SQLite file in the user-data folder. */
  databasePath: string
  /** Names of the tables found in the database after migrations. */
  tables: string[]
  rooms: Array<{ id: string; name: string; accent: string }>
  /** Non-fatal oddities found in the catalog files, as `file: field: message`. */
  catalogWarnings: string[]
  startAtLogin: boolean
}

export type IpcChannel = keyof IpcContract
export type IpcRequest<C extends IpcChannel> = IpcContract[C]['request']
export type IpcResponse<C extends IpcChannel> = IpcContract[C]['response']

/** Runtime list of channels; `satisfies` keeps it in step with the contract. */
export const IPC_CHANNELS = [
  'ping',
  'app:status',
  'auth:check',
  'auth:retry',
  'chat:list',
  'chat:messages',
  'chat:send',
  'chat:stop',
  'chat:delete',
  'chat:move',
  'project:list',
  'project:track',
  'project:dismiss',
  'project:action'
] as const satisfies readonly IpcChannel[]

/** What the preload puts on `window.mindPalace`. */
export interface MindPalaceApi {
  invoke<C extends IpcChannel>(
    channel: C,
    ...args: IpcRequest<C> extends void ? [] : [request: IpcRequest<C>]
  ): Promise<IpcResponse<C>>
  ping(message: string): Promise<IpcResponse<'ping'>>
  status(): Promise<AppStatus>
  /** Subscribes to chat events; returns the function that unsubscribes. */
  onChatEvent(listener: (event: ChatEvent) => void): () => void
}

export const API_KEY = 'mindPalace'
