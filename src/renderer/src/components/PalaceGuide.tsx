import { useEffect, useState } from 'react'

const SEEN_KEY = 'mind-palace.guide-seen'

const TIPS: ReadonlyArray<{ title: string; body: string }> = [
  { title: 'This is your palace', body: 'Each room keeps one kind of chat. Click a room on the map, or its name at the top, to go in.' },
  { title: 'Things in a room do things', body: 'Inside a room, each glowing dot sits on something you can use: start a chat there, or see its projects, finished work and chats.' },
  { title: 'Put a chat where it belongs', body: 'Show the chat list, then drag a chat onto a room to file it there. Press ⌘K at any time to jump to a room, chat or project.' },
  { title: 'A grey room is asking for you', body: 'A room goes grey when one of its projects has been quiet for a week. Work on it, or pause, finish or drop it, and the light comes back.' }
]

const seen = (): boolean => {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return true
  }
}

/**
 * A short tour shown the first time the palace is opened, and again from the
 * "How it works" button. It sits in a corner and blocks nothing.
 */
export function usePalaceGuide(): { open: boolean; show: () => void; close: () => void } {
  const [open, setOpen] = useState(() => !seen())
  const close = (): void => {
    setOpen(false)
    try {
      window.localStorage.setItem(SEEN_KEY, '1')
    } catch {
      // Not remembered; it will show again next time.
    }
  }
  return { open, show: () => setOpen(true), close }
}

export function PalaceGuide({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0)
  const tip = TIPS[step]!
  const last = step === TIPS.length - 1

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <aside
      role="dialog"
      aria-label="How the palace works"
      data-testid="palace-guide"
      className="room-panel absolute right-3 bottom-3 z-30 w-72 max-w-[calc(100%-1.5rem)] rounded-xl border border-brass bg-paper p-3 text-ink shadow-[0_4px_14px_rgba(0,0,0,0.35)]"
    >
      <p className="text-[11px] font-bold tracking-wide text-ink-muted uppercase">
        How it works · {step + 1} of {TIPS.length}
      </p>
      <h3 className="mt-1 text-base font-semibold">{tip.title}</h3>
      <p className="mt-1 text-sm leading-snug">{tip.body}</p>
      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-xs text-ink-muted hover:bg-paper-shade">
          Skip
        </button>
        <span className="flex-1" />
        {step > 0 && (
          <button type="button" onClick={() => setStep(step - 1)} className="rounded-md border border-gold-deep/40 px-2.5 py-1 text-xs hover:bg-paper-shade">
            Back
          </button>
        )}
        <button
          type="button"
          onClick={() => (last ? onClose() : setStep(step + 1))}
          className="rounded-md bg-gold-deep px-3 py-1 text-xs font-semibold text-paper hover:bg-ink"
        >
          {last ? 'Got it' : 'Next'}
        </button>
      </div>
    </aside>
  )
}
