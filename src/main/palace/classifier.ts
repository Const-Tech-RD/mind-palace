import {
  buildClassifierPrompt,
  CLASSIFICATION_JSON_SCHEMA,
  CLASSIFIER_SYSTEM_PROMPT,
  classificationSchema,
  dueForQuietCheck,
  interpretClassification,
  roomChange,
  type Classification,
  type ClassifierMessage,
  type ClassifierRoom,
  type OpenProject
} from '@shared/classify'
import type { JsonAnswer } from '../chat/claude'
import type { PalaceRepo } from './repo'

export interface ClassifierDeps {
  repo: PalaceRepo
  /** The rooms that exist now; rooms are made while the app runs. */
  rooms: () => ClassifierRoom[]
  fallbackRoomId: string
  messagesOf: (chatId: string) => ClassifierMessage[]
  /** One JSON question to the model; the real one is `askJson` bound to Haiku. */
  askModel: (prompt: string, system: string, schema: Record<string, unknown>) => Promise<JsonAnswer>
  /** Tells the renderer a chat's room or suggestion changed. */
  onChanged: (chatId: string) => void
  /** Runs before a chat changes room, so the room it leaves keeps what it earned. */
  beforeMove?: () => void
  now?: () => Date
  log?: (message: string) => void
}

/** How long to leave a chat alone after a failed classification. */
const RETRY_AFTER_MS = 30 * 60_000
/** After this many user messages the chat is classified for the first time. */
export const FIRST_CLASSIFICATION_AT = 2

/** Runs the model over a transcript and applies the rules. No database access. */
export async function classifyTranscript(input: {
  rooms: ClassifierRoom[]
  fallbackRoomId: string
  messages: ClassifierMessage[]
  openProjects: OpenProject[]
  askModel: ClassifierDeps['askModel']
}): Promise<{ ok: true; result: Classification; tokensIn: number; tokensOut: number } | { ok: false; error: string }> {
  const prompt = buildClassifierPrompt(input)
  const answer = await input.askModel(prompt, CLASSIFIER_SYSTEM_PROMPT, CLASSIFICATION_JSON_SCHEMA)
  if (!answer.ok) return answer
  const parsed = classificationSchema.safeParse(answer.value)
  if (!parsed.success) {
    return { ok: false, error: `The classifier answer did not match the expected shape: ${parsed.error.issues[0]?.message ?? 'invalid'}` }
  }
  return {
    ok: true,
    result: interpretClassification(parsed.data, {
      roomIds: input.rooms.map((room) => room.id),
      fallbackRoomId: input.fallbackRoomId,
      openProjects: input.openProjects
    }),
    tokensIn: answer.tokensIn,
    tokensOut: answer.tokensOut
  }
}

export function createClassifier(deps: ClassifierDeps) {
  const { repo } = deps
  const now = deps.now ?? (() => new Date())
  const log = deps.log ?? (() => {})
  const inFlight = new Set<string>()
  const failedAt = new Map<string, number>()

  async function classify(chatId: string): Promise<'done' | 'skipped' | 'failed'> {
    if (inFlight.has(chatId)) return 'skipped'
    const before = repo.chat(chatId)
    if (!before) return 'skipped'
    const messages = deps.messagesOf(chatId)
    if (!messages.some((m) => m.role === 'user')) return 'skipped'

    inFlight.add(chatId)
    try {
      const openProjects = repo.openProjects()
      const outcome = await classifyTranscript({
        rooms: deps.rooms(),
        fallbackRoomId: deps.fallbackRoomId,
        messages,
        openProjects,
        askModel: deps.askModel
      })
      if (!outcome.ok) {
        failedAt.set(chatId, now().getTime())
        log(`classification of ${chatId} failed: ${outcome.error}`)
        return 'failed'
      }
      failedAt.delete(chatId)

      // The chat may have been moved, answered or deleted while the model was thinking.
      const chat = repo.chat(chatId)
      if (!chat) return 'skipped'
      const { result } = outcome
      const at = now().toISOString()

      const newRoom = roomChange(chat, result)
      if (newRoom !== null) deps.beforeMove?.()
      repo.transaction(() => {
        if (newRoom !== null) repo.setRoom(chatId, newRoom, 'model')
        repo.markClassified(chatId, at)

        const room = newRoom ?? chat.roomId ?? result.roomId
        const mayOffer =
          result.project.kind !== 'none' &&
          chat.suggestedProjectId === null &&
          chat.projectDismissedAt === null &&
          !repo.hasTrackedProject(chatId)
        if (!mayOffer) return

        if (result.project.kind === 'existing') {
          repo.setSuggestion(chatId, result.project.projectId)
        } else if (result.project.kind === 'new') {
          const projectId = repo.createSuggested({
            title: result.project.title,
            nextStep: result.project.nextStep,
            roomId: room,
            originChatId: chatId,
            at
          })
          repo.setSuggestion(chatId, projectId)
        }
      })
      deps.onChanged(chatId)
      return 'done'
    } catch (error) {
      failedAt.set(chatId, now().getTime())
      log(`classification of ${chatId} failed: ${error instanceof Error ? error.message : String(error)}`)
      return 'failed'
    } finally {
      inFlight.delete(chatId)
    }
  }

  return {
    classify,

    /** Hook for the chat service: the first classification runs after the second user message. */
    afterUserMessage(chatId: string, userMessageCount: number): void {
      if (userMessageCount !== FIRST_CLASSIFICATION_AT) return
      if (repo.chat(chatId)?.roomId != null) return
      void classify(chatId)
    },

    /** Classifies, one at a time, every chat that has gone quiet since it was last classified. */
    async runQuietChecks(): Promise<number> {
      const at = now()
      const due = repo
        .chatsWithMessages()
        .filter((chat) => dueForQuietCheck(chat, at))
        .filter((chat) => at.getTime() - (failedAt.get(chat.id) ?? -Infinity) >= RETRY_AFTER_MS)
      let done = 0
      for (const chat of due) if ((await classify(chat.id)) === 'done') done++
      return done
    }
  }
}

export type Classifier = ReturnType<typeof createClassifier>
