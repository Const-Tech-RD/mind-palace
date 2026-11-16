/**
 * The one IPC contract between the renderer and the main process.
 *
 * Every channel is listed here with its request and response type. The main
 * process registers handlers through `handle()` (src/main/ipc.ts), the preload
 * exposes `window.mindPalace` built from the same map, so a channel name or
 * payload that drifts is a compile error on both sides.
 */
import type { AuthState, ChatEvent, ChatMessage, ChatSummary } from './chat'
import type { PalaceView } from './palace'
import type { GitInfo, MilestoneEdit, ProjectProgress, SweepCandidate } from './milestones'
import type { PlacementChange } from './placements'
import type { ProjectAction, ProjectSummary } from './projects'
import type { ReminderItem, ReminderResponse } from './reminders'

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
  /** A project's milestones, waiting proposals, folder and progress. */
  'progress:get': {
    request: { projectId: string }
    response: ProjectProgress
  }
  /** Chats the model thinks belong to the project (only chats newer than the last sweep), for the person to confirm. */
  'progress:sweep': {
    request: { projectId: string }
    response: { candidates: SweepCandidate[] }
  }
  /** Links the confirmed chats; unticked ones are never offered to this project again. */
  'progress:link': {
    request: { projectId: string; accept: string[]; dismiss: string[] }
    response: ProjectProgress
  }
  /** The first draft of milestones; a refresh when there already are some. */
  'progress:build': {
    request: { projectId: string }
    response: ProjectProgress
  }
  /** New proposals only; milestones are never changed. */
  'progress:refresh': {
    request: { projectId: string }
    response: ProjectProgress
  }
  'progress:edit': {
    request: { projectId: string; edit: MilestoneEdit }
    response: ProjectProgress
  }
  'progress:answer': {
    request: { projectId: string; proposalId: string; accept: boolean }
    response: ProjectProgress
  }
  /** The project folder's branch, last commit and uncommitted files (read-only, cached until the next refresh); null without a repo. */
  'progress:git': {
    request: { projectId: string }
    response: GitInfo | null
  }
  /** Sets the folder (`'pick'` opens a folder dialog; a cancelled dialog changes nothing) or clears it (null). */
  'progress:folder': {
    request: { projectId: string; folder: string | null }
    response: ProjectProgress
  }
  /** Every room's state from the progression engine, with what is new since it was last looked at. */
  'palace:view': {
    /** `focus`: the room zoomed into; its back walls rise and show what hangs on them. */
    request: { focus?: string | null } | void
    response: PalaceView
  }
  /** Moves an item to a slot, picks its variant, or hides it (only the fields given change). */
  'palace:place': {
    request: PlacementChange
    response: PalaceView
  }
  /** Puts an item back where the catalog puts it. */
  'palace:reset': {
    request: { roomId: string; instance: string }
    response: PalaceView
  }
  /** Marks a room as looked at: what it holds now is no longer "new". */
  'palace:seen': {
    request: { roomId: string }
    response: { seen: true }
  }
  /** Makes the room for an area (one model call); its Mail-room chats move in. `name` overrides the proposed name. */
  'rooms:materialize': {
    request: { area: string; name?: string }
    response: PalaceView
  }
  /** "Not now": the area is not suggested again until 5 more chats arrive in it. */
  'rooms:dismiss': {
    request: { area: string }
    response: PalaceView
  }
  'rooms:rename': {
    request: { roomId: string; name: string }
    response: PalaceView
  }
  /** "Find my rooms": the model tags the Mail room's chats with areas. */
  'rooms:find': {
    request: void
    response: { tagged: number; view: PalaceView }
  }
  /** Reminders waiting for a reaction, newest first. */
  'reminder:list': {
    request: void
    response: ReminderItem[]
  }
  /** Reacts to a reminder. Returns where to go for `open`. */
  'reminder:respond': {
    request: { reminderId: string; response: ReminderResponse }
    response: { projectId: string; chatId: string | null }
  }
  /** Reads, or with `enabled` sets, whether system notifications are shown for reminders. */
  'reminder:notifications': {
    request: { enabled?: boolean }
    response: { enabled: boolean }
  }
}

/** One-way channel, main to renderer, carrying `ChatEvent`s. */
export const CHAT_EVENT_CHANNEL = 'chat:event'

/** Things the main process tells the renderer that are not about one chat's answer. */
export type AppEvent =
  /** The reminder inbox changed. */
  | { type: 'reminders_changed' }
  /** A room was made or renamed, or chats were moved or tagged by room changes: refresh rooms, chats and palace. */
  | { type: 'rooms_changed' }
  /** A notification was clicked: show this project's chat (or the projects panel if it has none). */
  | { type: 'open_project'; projectId: string; chatId: string | null }
  /** A project's milestones, proposals, folder or running state changed. */
  | { type: 'progress_changed'; projectId: string }

/** One-way channel, main to renderer, carrying `AppEvent`s. */
export const APP_EVENT_CHANNEL = 'app:event'

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
  'project:action',
  'progress:get',
  'progress:sweep',
  'progress:link',
  'progress:build',
  'progress:refresh',
  'progress:edit',
  'progress:answer',
  'progress:folder',
  'progress:git',
  'palace:view',
  'palace:seen',
  'palace:place',
  'palace:reset',
  'rooms:materialize',
  'rooms:dismiss',
  'rooms:rename',
  'rooms:find',
  'reminder:list',
  'reminder:respond',
  'reminder:notifications'
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
  onAppEvent(listener: (event: AppEvent) => void): () => void
}

export const API_KEY = 'mindPalace'
