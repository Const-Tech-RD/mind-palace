import { useEffect, useState, type FormEvent } from 'react'
import { useSteward, type StewardStatus } from '../steward'

const STATUS: Record<StewardStatus, string> = {
  idle: 'Ready',
  preparing: 'Getting ready to hear you…',
  listening: 'Listening…',
  transcribing: 'Working out what you said…',
  thinking: 'Thinking…',
  speaking: 'Speaking…'
}

const MIC = 'M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v4M9 21h6'

/**
 * The steward: a voice assistant for the palace. A pill at the foot of the
 * window; opened, it shows what it heard and said, takes a typed order, and
 * has the microphone button. Cmd/Ctrl+J opens it and starts listening.
 */
export function Steward() {
  const { open, status, hearing, heard, said, pending, level, voice, error, language } = useSteward()
  const setOpen = useSteward((s) => s.setOpen)
  const setVoice = useSteward((s) => s.setVoice)
  const toggleListening = useSteward((s) => s.toggleListening)
  const order = useSteward((s) => s.order)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
        event.preventDefault()
        void useSteward.getState().toggleListening()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const busy = status === 'thinking' || status === 'transcribing' || status === 'preparing'
  const listening = status === 'listening'
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const text = draft.trim()
    if (text === '' || busy) return
    setDraft('')
    void order(text)
  }

  const micButton = (
    <button
      type="button"
      onClick={() => void toggleListening()}
      aria-label={listening ? 'Stop listening and send' : 'Talk to the steward'}
      aria-pressed={listening}
      title={listening ? 'Stop and send' : 'Talk (⌘J)'}
      className={`steward-mic relative flex size-9 shrink-0 items-center justify-center rounded-full ${listening ? 'bg-gold text-ink' : 'bg-raised text-paper hover:bg-brass/40'}`}
      style={listening ? { boxShadow: `0 0 0 ${Math.round(3 + level * 14)}px rgb(232 184 74 / 0.25)` } : undefined}
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={MIC} />
      </svg>
    </button>
  )

  if (!open) {
    return (
      <div className="pointer-events-none fixed bottom-10 left-1/2 z-40 -translate-x-1/2" data-testid="steward">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="pointer-events-auto flex items-center gap-2 rounded-full border border-brass/60 bg-walnut/95 py-1 pr-3 pl-1.5 text-xs text-paper shadow-lg hover:bg-raised"
        >
          <span className="flex size-6 items-center justify-center rounded-full bg-raised">
            <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={MIC} />
            </svg>
          </span>
          Steward
          <kbd className="rounded border border-brass/40 px-1 text-[10px] text-muted">⌘J</kbd>
        </button>
      </div>
    )
  }

  return (
    <section
      role="dialog"
      aria-label="Steward"
      data-testid="steward"
      data-status={status}
      data-language={language}
      className="room-panel fixed bottom-10 left-1/2 z-40 w-[min(30rem,calc(100%-2rem))] -translate-x-1/2 rounded-xl border border-brass bg-walnut/97 p-3 text-paper shadow-[0_8px_30px_rgba(0,0,0,0.5)]"
    >
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">Steward</h2>
        <span className="min-w-0 flex-1 truncate text-xs text-muted" role="status" data-testid="steward-status">
          {status === 'preparing' && hearing.state === 'loading' ? `Getting the speech model, once… ${hearing.progress}%` : STATUS[status]}
        </span>
        <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} className="size-3.5 accent-(--color-gold)" />
          Speak
        </label>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close the steward" className="shrink-0 rounded px-1.5 text-lg leading-none text-muted hover:bg-paper/10 hover:text-paper">
          ×
        </button>
      </div>

      {(heard || said) && (
        <div className="mt-2 space-y-1.5 text-sm">
          {heard && (
            <p className="text-muted" data-testid="steward-heard">
              <span className="text-[10px] tracking-wide uppercase">You</span> {heard}
            </p>
          )}
          {said && status !== 'thinking' && (
            <p data-testid="steward-said">
              <span className="text-[10px] tracking-wide text-gold uppercase">Steward</span> {said}
            </p>
          )}
        </div>
      )}
      {pending && status !== 'thinking' && (
        <div className="mt-2 flex items-center gap-2 rounded-lg bg-ink-soft px-2.5 py-1.5 text-xs" data-testid="steward-confirm">
          <span className="flex-1 text-muted">This cannot be undone. Say or type yes, or no.</span>
          <button type="button" onClick={() => void order(language === 'es' ? 'sí' : 'yes', language)} className="rounded-md bg-gold px-2.5 py-1 font-semibold text-ink hover:bg-brass-light">
            Yes
          </button>
          <button type="button" onClick={() => void order('no', language)} className="rounded-md border border-brass/50 px-2.5 py-1 hover:bg-raised">
            No
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 rounded-md bg-red-950 px-2.5 py-1.5 text-xs text-red-200">
          {error}
        </p>
      )}

      <form onSubmit={submit} className="mt-2 flex items-center gap-2">
        {micButton}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Say it, or type an order in English or Spanish"
          aria-label="Order for the steward"
          autoFocus
          className="h-9 min-w-0 flex-1 rounded-lg bg-ink px-3 text-sm text-paper outline-none placeholder:text-muted focus:ring-1 focus:ring-gold"
        />
        <button type="submit" disabled={draft.trim() === '' || busy} className="h-9 rounded-lg bg-gold px-3 text-sm font-semibold text-ink hover:bg-brass-light disabled:opacity-40">
          Send
        </button>
      </form>
      <p className="mt-1.5 text-[11px] text-muted">
        It acts only inside this app: rooms, chats, projects, reminders and the music. Your voice is transcribed on this Mac.
      </p>
    </section>
  )
}
