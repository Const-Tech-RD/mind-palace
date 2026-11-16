import { useState } from 'react'
import { suggestionText } from '@shared/palace'
import type { Suggestion } from '@shared/suggest'
import { useStore } from '../store'

const chip = 'rounded-full px-3 py-1 text-xs font-semibold disabled:opacity-50'

/**
 * A room the palace could grow: its proposed name (editable), how many chats
 * are about it, and the two answers. Nothing is made until Materialize.
 */
export function RoomSuggestion({ suggestion, compact = false }: { suggestion: Suggestion; compact?: boolean }) {
  const materializeRoom = useStore((s) => s.materializeRoom)
  const dismissArea = useStore((s) => s.dismissArea)
  const [name, setName] = useState(suggestion.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const materialize = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const failed = await materializeRoom(suggestion.area, name.trim() || undefined)
    setBusy(false)
    if (failed) setError(failed)
  }

  return (
    <div
      className={`flex flex-col gap-2 rounded-lg border border-dashed border-gold/60 bg-walnut/90 px-3 py-2 shadow-lg backdrop-blur ${compact ? '' : 'w-60'}`}
      data-suggestion={suggestion.area}
      aria-busy={busy}
    >
      {!compact && <p className="text-[10px] font-semibold tracking-wide text-gold uppercase">A room could grow here</p>}
      <label className="flex flex-col gap-1 text-xs">
        <span className="sr-only">Room name</span>
        <input
          value={name}
          maxLength={40}
          onChange={(event) => setName(event.target.value)}
          disabled={busy}
          className="rounded border border-brass/50 bg-ink px-2 py-1 text-sm font-semibold text-paper"
        />
      </label>
      <p className="text-xs text-muted">{suggestionText({ ...suggestion, name: name.trim() || suggestion.name })} in the Mail room</p>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => void materialize()} disabled={busy} className={`${chip} bg-gold text-ink hover:bg-brass-light`}>
          {busy ? 'Furnishing…' : 'Materialize'}
        </button>
        <button
          type="button"
          onClick={() => void dismissArea(suggestion.area)}
          disabled={busy}
          className={`${chip} border border-brass/50 text-paper hover:bg-raised`}
        >
          Not now
        </button>
      </div>
      {error && (
        <p className="text-xs text-paper" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

/** "Find my rooms": the model sorts the Mail room's chats into areas of life. */
export function FindRooms() {
  const findRooms = useStore((s) => s.findRooms)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          setResult(null)
          void findRooms().then((line) => {
            setBusy(false)
            setResult(line)
          })
        }}
        className="rounded-full border border-brass/50 bg-walnut/85 px-3 py-1.5 text-xs text-paper shadow backdrop-blur hover:bg-raised disabled:opacity-60"
      >
        {busy ? 'Looking through the Mail room…' : 'Find my rooms'}
      </button>
      {result && (
        <span className="rounded-full bg-walnut/85 px-2 py-1 text-xs text-muted" role="status">
          {result}
        </span>
      )}
    </span>
  )
}

/** Renames a room the person made. */
export function RenameRoom({ roomId, name }: { roomId: string; name: string }) {
  const renameRoom = useStore((s) => s.renameRoom)
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(name)
  const [error, setError] = useState<string | null>(null)
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-full border border-brass/50 px-3 py-1.5 text-xs font-semibold hover:bg-raised">
        Rename
      </button>
    )
  }
  return (
    <form
      className="flex flex-wrap items-center gap-1.5"
      onSubmit={(event) => {
        event.preventDefault()
        void renameRoom(roomId, value).then((failed) => {
          setError(failed)
          if (!failed) setOpen(false)
        })
      }}
    >
      <label className="text-xs">
        <span className="sr-only">New name for the room</span>
        <input
          autoFocus
          value={value}
          maxLength={40}
          onChange={(event) => setValue(event.target.value)}
          className="rounded border border-brass/50 bg-ink px-2 py-1 text-sm text-paper"
        />
      </label>
      <button type="submit" className="rounded-full bg-gold px-3 py-1 text-xs font-semibold text-ink">
        Save
      </button>
      <button type="button" onClick={() => setOpen(false)} className="rounded-full border border-brass/50 px-3 py-1 text-xs">
        Cancel
      </button>
      {error && (
        <span className="text-xs text-paper" role="alert">
          {error}
        </span>
      )}
    </form>
  )
}
