import { create } from 'zustand'
import type { HearingStatus } from '@shared/ipc'
import { splitSources } from '@shared/chat'
import {
  checkReply,
  confirmationAnswer,
  guessLanguage,
  splitActions,
  spokenSummary,
  type StewardAction,
  type StewardContext,
  type StewardLanguage
} from '@shared/steward'
import { useMusic } from './music'
import { useStore } from './store'

/**
 * The steward in the renderer: it records an order, has it transcribed and
 * understood in the main process, runs the actions through the app's own
 * store (so it can do exactly what the buttons do, and nothing else), and
 * speaks the reply with the system's voice.
 */
export type StewardStatus = 'idle' | 'preparing' | 'listening' | 'transcribing' | 'thinking' | 'speaking'

const VOICE_KEY = 'mind-palace.steward-voice'
const SAMPLE_RATE = 16_000
/** Loudness (RMS, 0 to 1) above which someone is talking, and below which they have stopped. */
const SPEECH = 0.02
const QUIET = 0.012
const QUIET_MS = 1300
const NO_SPEECH_MS = 7000
const MAX_MS = 25_000

const WORDS: Record<StewardLanguage, { done: string; cancelled: string; confirm: string; trouble: string; nothing: string }> = {
  en: { done: 'Done.', cancelled: 'Cancelled.', confirm: 'Should I go ahead?', trouble: 'Something went wrong. Please try again.', nothing: "I didn't catch that." },
  es: { done: 'Hecho.', cancelled: 'Cancelado.', confirm: '¿Lo hago?', trouble: 'Algo salió mal. Inténtalo de nuevo.', nothing: 'No te escuché bien.' }
}

interface StewardState {
  open: boolean
  status: StewardStatus
  hearing: HearingStatus
  /** The last order, as it was heard or typed. */
  heard: string
  /** The last reply. */
  said: string
  language: StewardLanguage
  /** What waits for a yes. */
  pending: StewardAction[] | null
  /** Loudness of the microphone while listening, 0 to 1. */
  level: number
  /** Whether replies are spoken aloud. */
  voice: boolean
  error: string | null
  setOpen(open: boolean): void
  setVoice(on: boolean): void
  /** Starts listening, or stops and sends what was heard. */
  toggleListening(): Promise<void>
  /** A typed order, or the words that were heard. */
  order(text: string, language?: StewardLanguage): Promise<void>
  stopSpeaking(): void
}

const readVoice = (): boolean => {
  try {
    return window.localStorage.getItem(VOICE_KEY) !== '0'
  } catch {
    return true
  }
}

/** What the steward is told about the palace right now. */
export function contextNow(): StewardContext {
  const s = useStore.getState()
  const music = useMusic.getState()
  const rooms = s.status?.rooms.map((r) => ({ id: r.id, name: r.name })) ?? []
  const roomName = (id: string | null): string => rooms.find((r) => r.id === id)?.name ?? 'a room'
  const chat = s.chats.find((c) => c.id === s.activeChatId)
  const where =
    s.view === 'projects'
      ? 'the projects list'
      : s.view === 'reminders'
        ? 'the reminders inbox'
        : s.view === 'chat'
          ? chat
            ? `the chat "${chat.title}"${chat.roomId ? ` in the ${roomName(chat.roomId)}` : ''}`
            : 'a new, empty chat'
          : s.palaceRoomId
            ? `the ${roomName(s.palaceRoomId)}`
            : 'the palace map, with every room'
  const recent = [...s.chats].sort((a, b) => (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt)).slice(0, 25)
  return {
    where,
    rooms,
    chats: recent.map((c) => ({ id: c.id, title: c.title || 'New chat', roomId: c.roomId })),
    projects: s.projects.filter((p) => p.state !== 'dropped').slice(0, 60).map((p) => ({ id: p.id, title: p.title, roomId: p.roomId, state: p.state })),
    reminders: s.reminders.map((r) => ({ id: r.id, projectTitle: r.projectTitle })),
    music: { chosen: music.track !== null, playing: music.playing }
  }
}

/** Runs one action through the app's store: the same calls the buttons make. */
async function run(action: StewardAction): Promise<void> {
  const s = useStore.getState()
  const music = useMusic.getState()
  switch (action.type) {
    case 'go_palace':
      return s.showPalace(null)
    case 'go_room':
      return s.showPalace(action.roomId)
    case 'show_projects':
      return s.showProjects()
    case 'show_reminders':
      return s.showReminders()
    case 'open_chat':
      return s.selectChat(action.chatId)
    case 'new_chat':
      if (action.roomId) s.startChatIn(action.roomId)
      else await s.selectChat(null)
      if (action.message) {
        await useStore.getState().send(action.message)
        // When the written answer is finished, its beginning is read aloud.
        readAnswerOf = useStore.getState().activeChatId
      }
      return
    case 'move_chat':
      return s.moveChat(action.chatId, action.roomId)
    case 'delete_chat':
      return s.deleteChat(action.chatId)
    case 'project_action':
      return s.projectAction(action.projectId, action.action)
    case 'reminder_respond':
      return s.respondToReminder(action.reminderId, action.response)
    case 'music':
      if (action.op === 'play') return music.play()
      if (action.op === 'pause') return music.pause()
      if (action.op === 'mute') return music.setMuted(true)
      if (action.op === 'unmute') return music.setMuted(false)
      return music.setVolume(music.volume + (action.op === 'louder' ? 0.2 : -0.2))
  }
}

/** The chat whose next finished answer should be read aloud. */
let readAnswerOf: string | null = null

let recording: { stop: (send: boolean) => void } | null = null

function voiceFor(language: StewardLanguage): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices()
  const wanted = language === 'es' ? 'es' : 'en'
  return voices.find((v) => v.lang.toLowerCase().startsWith(wanted) && v.localService) ?? voices.find((v) => v.lang.toLowerCase().startsWith(wanted))
}

export const useSteward = create<StewardState>((set, get) => {
  const settle = (): void => {
    if (get().status === 'speaking') set({ status: 'idle' })
    useMusic.getState().duck(false)
  }

  /** Says the reply aloud in its own language, with the music turned down meanwhile. */
  const speak = (text: string, language: StewardLanguage): void => {
    set({ said: text, language })
    if (!get().voice || text === '' || typeof window.speechSynthesis === 'undefined') {
      set({ status: 'idle' })
      useMusic.getState().duck(false)
      return
    }
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = language === 'es' ? 'es-ES' : 'en-US'
    const voice = voiceFor(language)
    if (voice) utterance.voice = voice
    utterance.rate = 1.04
    utterance.onend = settle
    utterance.onerror = settle
    set({ status: 'speaking' })
    useMusic.getState().duck(true)
    window.speechSynthesis.speak(utterance)
  }

  // Read the start of an answer the steward asked for, once it has been written.
  useStore.subscribe((state, before) => {
    const chatId = readAnswerOf
    if (!chatId || !before.streaming[chatId] || state.streaming[chatId]) return
    readAnswerOf = null
    const last = [...(state.messages[chatId] ?? [])].reverse().find((m) => m.role === 'assistant')
    if (!last) return
    const summary = spokenSummary(splitSources(last.content).body)
    if (summary) speak(summary, guessLanguage(summary))
  })

  return {
    open: false,
    status: 'idle',
    hearing: { state: 'absent', progress: 0, detail: null },
    heard: '',
    said: '',
    language: 'en',
    pending: null,
    level: 0,
    voice: readVoice(),
    error: null,

    setOpen(open) {
      set({ open })
      if (!open) {
        recording?.stop(false)
        get().stopSpeaking()
      }
    },
    setVoice(on) {
      try {
        window.localStorage.setItem(VOICE_KEY, on ? '1' : '0')
      } catch {
        // Not remembered.
      }
      set({ voice: on })
      if (!on) get().stopSpeaking()
    },
    stopSpeaking() {
      if (typeof window.speechSynthesis !== 'undefined') window.speechSynthesis.cancel()
      settle()
    },

    async toggleListening() {
      if (recording) {
        recording.stop(true)
        return
      }
      get().stopSpeaking()
      set({ open: true, error: null, status: 'preparing' })
      try {
        // The first time, this asks for the microphone and starts loading the speech model.
        let hearing = await window.mindPalace.invoke('steward:prepare')
        if (!hearing.microphone) throw new Error('The microphone is not allowed. Turn it on for this app in System Settings, under Privacy and Security.')
        set({ hearing })
        while (hearing.state === 'loading') {
          await new Promise((resolve) => setTimeout(resolve, 600))
          const next = await window.mindPalace.invoke('steward:hearing')
          hearing = { ...next, microphone: true }
          set({ hearing: next })
          if (get().status !== 'preparing') return
        }
        if (hearing.state !== 'ready') throw new Error(hearing.detail ?? 'The speech model could not be loaded. Check the internet connection for the first download.')

        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } })
        const audio = new AudioContext({ sampleRate: SAMPLE_RATE })
        const source = audio.createMediaStreamSource(stream)
        const tap = audio.createScriptProcessor(4096, 1, 1)
        const chunks: Float32Array[] = []
        const started = performance.now()
        let spoke = false
        let quietSince = 0
        let finished = false

        const stop = (send: boolean): void => {
          if (finished) return
          finished = true
          recording = null
          tap.disconnect()
          source.disconnect()
          stream.getTracks().forEach((track) => track.stop())
          void audio.close()
          set({ level: 0 })
          if (!send || !spoke) {
            set({ status: 'idle' })
            useMusic.getState().duck(false)
            return
          }
          const samples = new Float32Array(chunks.reduce((n, c) => n + c.length, 0))
          let at = 0
          for (const chunk of chunks) {
            samples.set(chunk, at)
            at += chunk.length
          }
          set({ status: 'transcribing' })
          void window.mindPalace
            .invoke('steward:transcribe', { samples })
            .then(({ text, language }) => {
              if (text === '') {
                set({ status: 'idle', said: WORDS[get().language].nothing })
                useMusic.getState().duck(false)
                return
              }
              return get().order(text, language)
            })
            .catch((error: unknown) => {
              set({ status: 'idle', error: error instanceof Error ? error.message : String(error) })
              useMusic.getState().duck(false)
            })
        }

        tap.onaudioprocess = (event) => {
          const input = event.inputBuffer.getChannelData(0)
          chunks.push(new Float32Array(input))
          let sum = 0
          for (let i = 0; i < input.length; i++) sum += input[i]! * input[i]!
          const level = Math.sqrt(sum / input.length)
          set({ level: Math.min(1, level * 8) })
          const now = performance.now()
          if (level > SPEECH) {
            spoke = true
            quietSince = 0
          } else if (spoke && level < QUIET) {
            quietSince ||= now
            // A pause after speaking ends the order by itself.
            if (now - quietSince > QUIET_MS) stop(true)
          }
          if ((!spoke && now - started > NO_SPEECH_MS) || now - started > MAX_MS) stop(spoke)
        }
        source.connect(tap)
        tap.connect(audio.destination)
        recording = { stop }
        useMusic.getState().duck(true)
        set({ status: 'listening' })
      } catch (error) {
        recording = null
        useMusic.getState().duck(false)
        set({ status: 'idle', error: error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(error) })
      }
    },

    async order(text, language) {
      const order = text.trim()
      if (order === '') return
      const pending = get().pending
      const answer = pending ? confirmationAnswer(order) : null
      // A bare "no" or "sí" says little about its language: a yes or no is answered in the language of the question.
      const spoken = answer ? get().language : (language ?? guessLanguage(order))
      set({ open: true, heard: order, error: null, status: 'thinking', language: spoken })
      try {
        if (pending) {
          set({ pending: null })
          if (answer === 'yes') {
            for (const action of pending) await run(action)
            return speak(WORDS[spoken].done, spoken)
          }
          if (answer === 'no') return speak(WORDS[spoken].cancelled, spoken)
          // Anything else is a new order; the pending one is dropped.
        }
        const context = contextNow()
        const result = await window.mindPalace.invoke('steward:interpret', { order, context })
        if (!result.ok) throw new Error(result.error)
        const reply = checkReply(result.reply, context)
        const { now, held } = splitActions(reply.actions)
        for (const action of now) await run(action)
        if (held.length > 0) set({ pending: held })
        speak(reply.say || (held.length > 0 ? WORDS[reply.language].confirm : WORDS[reply.language].done), reply.language)
      } catch (error) {
        set({ status: 'idle', error: error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(error) })
        useMusic.getState().duck(false)
      }
    }
  }
})
