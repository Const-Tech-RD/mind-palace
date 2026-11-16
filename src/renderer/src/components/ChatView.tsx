import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { accentCss } from '../theme'
import Markdown from 'react-markdown'
import { splitSources, type ChatMessage, type Source } from '@shared/chat'
import { useStore } from '../store'

const NO_MESSAGES: ChatMessage[] = []

function Sources({ sources }: { sources: Source[] }) {
  if (sources.length === 0) return null
  return (
    <div className="mt-3 border-t border-brass/25 pt-2">
      <p className="text-xs text-muted">Sources</p>
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {sources.map((source) => (
          <li key={source.url}>
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer"
              title={source.url}
              className="inline-block max-w-64 truncate rounded-full bg-paper/10 px-2.5 py-0.5 align-bottom text-xs text-paper hover:bg-paper/20"
            >
              {source.title}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Answer({ text }: { text: string }) {
  return (
    <div className="markdown">
      <Markdown
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          )
        }}
      >
        {text}
      </Markdown>
    </div>
  )
}

function Bubble({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <p className="max-w-[80%] rounded-2xl rounded-br-sm bg-paper px-4 py-2 text-sm whitespace-pre-wrap text-ink">
          {message.content}
        </p>
      </div>
    )
  }
  return (
    <div className="max-w-[90%] rounded-2xl rounded-bl-sm bg-ink-soft px-4 py-3 text-sm">
      {/* The trailing "Sources:" list is shown once, as chips. */}
      <Answer text={splitSources(message.content).body} />
      <Sources sources={message.sources} />
    </div>
  )
}

export function ChatView() {
  const activeChatId = useStore((s) => s.activeChatId)
  const chat = useStore((s) => s.chats.find((c) => c.id === s.activeChatId))
  const room = useStore((s) => s.status?.rooms.find((r) => r.id === chat?.roomId))
  const messages = useStore((s) => (s.activeChatId ? s.messages[s.activeChatId] : undefined)) ?? NO_MESSAGES
  const streaming = useStore((s) => (s.activeChatId ? s.streaming[s.activeChatId] : undefined))
  const error = useStore((s) => (s.activeChatId ? s.errors[s.activeChatId] : s.appError))
  const startingChat = useStore((s) => s.startingChat)
  const send = useStore((s) => s.send)
  const stop = useStore((s) => s.stop)
  const rooms = useStore((s) => s.status?.rooms)
  const moveChat = useStore((s) => s.moveChat)
  const answerSuggestion = useStore((s) => s.answerSuggestion)
  const filingRoom = useStore((s) => s.status?.rooms.find((r) => r.id === s.newChatRoomId))
  const closeChat = useStore((s) => s.closeChat)
  const chatWide = useStore((s) => s.chatWide)
  const toggleChatWide = useStore((s) => s.toggleChatWide)

  const [draft, setDraft] = useState('')
  const bottom = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const busy = streaming !== undefined || startingChat

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, streaming?.text, streaming?.searching])

  const takeComposerDraft = useStore((s) => s.takeComposerDraft)
  useEffect(() => {
    // A new chat may start with text waiting (e.g. "Start a session on this" from a project page).
    setDraft(activeChatId === null ? (takeComposerDraft() ?? '') : '')
    input.current?.focus()
  }, [activeChatId, takeComposerDraft])

  const submit = (event?: FormEvent): void => {
    event?.preventDefault()
    const text = draft.trim()
    if (text === '' || busy) return
    setDraft('')
    // On failure the store shows the error; give the text back so it is not lost.
    send(text).catch(() => setDraft(text))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape' && draft === '' && !streaming) {
      event.preventDefault()
      closeChat()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  const empty = messages.length === 0 && !streaming

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-brass/25 px-5">
        <h1 className="min-w-0 truncate text-sm font-medium" title={chat?.title}>{chat?.title || 'New chat'}</h1>
        {room && chatWide && (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-paper/10 px-2.5 py-0.5 text-xs">
            <span className="inline-block size-2 rounded-full" style={{ backgroundColor: accentCss(room.accent) }} />
            {room.name}
          </span>
        )}
        {chat?.project && (
          <span className="max-w-[30%] shrink truncate rounded-full border border-brass/45 px-2.5 py-0.5 text-xs text-muted" title="Project">
            {chat.project.title}
          </span>
        )}
        {chat && rooms && (
          <label className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted">
            <span className={chatWide ? '' : 'sr-only'}>Move to room</span>
            <select
              value={chat.roomId ?? ''}
              onChange={(e) => e.target.value && void moveChat(chat.id, e.target.value)}
              className="rounded-md bg-ink-soft px-2 py-1 text-xs text-paper outline-none focus:ring-1 focus:ring-paper/30"
            >
              {chat.roomId === null && <option value="">Not sorted yet</option>}
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className={`flex shrink-0 items-center gap-1 ${chat && rooms ? '' : 'ml-auto'}`}>
          <button
            type="button"
            onClick={toggleChatWide}
            aria-pressed={chatWide}
            title={chatWide ? 'Show the palace beside the chat' : 'Give the chat the whole window'}
            aria-label={chatWide ? 'Show the palace beside the chat' : 'Give the chat the whole window'}
            className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-paper/10 hover:text-paper"
          >
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {chatWide ? <path d="M4 5h16v14H4zM13 5v14" /> : <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />}
            </svg>
          </button>
          <button
            type="button"
            onClick={closeChat}
            title="Close chat (Esc)"
            aria-label="Close chat"
            className="flex size-7 items-center justify-center rounded-md text-lg leading-none text-muted hover:bg-paper/10 hover:text-paper"
          >
            ×
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-5 py-6">
          {empty && (
            <p className="mt-24 text-center text-sm text-muted">
              {filingRoom && !chat
                ? `This chat will be filed in the ${filingRoom.name}.`
                : 'Ask anything. Each chat will find its room once there is enough to go on.'}
            </p>
          )}
          {messages.map((message) => (
            <Bubble key={message.id} message={message} />
          ))}
          {streaming && (
            <div className="max-w-[90%] rounded-2xl rounded-bl-sm bg-ink-soft px-4 py-3 text-sm" aria-live="polite">
              {streaming.text && <Answer text={streaming.text} />}
              <p className={`text-xs text-muted ${streaming.text ? 'mt-2' : ''}`}>
                {streaming.searching ? `Searching the web: ${streaming.searching}` : streaming.text ? 'Writing…' : 'Thinking…'}
              </p>
            </div>
          )}
          {error && (
            <p role="alert" className="rounded-md bg-red-950 px-3 py-2 text-sm text-red-200">
              {error}
            </p>
          )}
          <div ref={bottom} />
        </div>
      </div>

      {chat?.suggestion && (
        <div className="shrink-0 border-t border-brass/25 px-4 pt-3">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 rounded-lg bg-ink-soft px-4 py-3 text-sm">
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {chat.suggestion.existing
                  ? `This looks like "${chat.suggestion.title}" again. Add it to that project?`
                  : `This looks like a project: "${chat.suggestion.title}". Track it?`}
              </p>
              {chat.suggestion.nextStep && !chat.suggestion.existing && (
                <p className="mt-0.5 text-xs text-muted">Next step: {chat.suggestion.nextStep}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => void answerSuggestion(chat.id, true)}
              className="rounded-md bg-gold px-3 py-1.5 text-sm font-medium text-ink hover:bg-brass-light"
            >
              {chat.suggestion.existing ? 'Add to project' : 'Track'}
            </button>
            <button
              type="button"
              onClick={() => void answerSuggestion(chat.id, false)}
              className="rounded-md px-3 py-1.5 text-sm text-paper/80 hover:bg-paper/10"
            >
              Just a question
            </button>
          </div>
        </div>
      )}

      <form onSubmit={submit} className={`shrink-0 p-4 ${chat?.suggestion ? '' : 'border-t border-brass/25'}`}>
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            ref={input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={Math.min(8, Math.max(1, draft.split('\n').length))}
            placeholder="Message Claude"
            aria-label="Message"
            className="min-h-10 flex-1 resize-none rounded-lg bg-ink-soft px-3 py-2 text-sm text-paper outline-none placeholder:text-muted focus:ring-1 focus:ring-paper/30"
          />
          {streaming ? (
            <button
              type="button"
              onClick={() => void stop()}
              className="h-10 rounded-lg bg-red-900 px-4 text-sm font-medium text-red-50 hover:bg-red-800"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={draft.trim() === '' || busy}
              className="h-10 rounded-lg bg-gold px-4 text-sm font-medium text-ink hover:bg-brass-light disabled:opacity-40"
            >
              Send
            </button>
          )}
        </div>
      </form>
    </section>
  )
}
