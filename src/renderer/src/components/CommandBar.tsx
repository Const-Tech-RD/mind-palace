import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { searchCommands, type Command } from '@shared/commands'
import { useStore } from '../store'

const KIND_LABEL: Record<Command['kind'], string> = { action: 'Go', room: 'Room', project: 'Project', chat: 'Chat' }

/** Cmd+K: type to jump to any room, chat or project. */
export function CommandBar() {
  const open = useStore((s) => s.commandOpen)
  const setOpen = useStore((s) => s.setCommandOpen)

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(!useStore.getState().commandOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOpen])

  // Mounted only while open, so every opening starts from an empty search.
  return open ? <Palette /> : null
}

function Palette() {
  const setOpen = useStore((s) => s.setCommandOpen)
  const rooms = useStore((s) => s.status?.rooms)
  const chats = useStore((s) => s.chats)
  const projects = useStore((s) => s.projects)
  const selectChat = useStore((s) => s.selectChat)
  const showPalace = useStore((s) => s.showPalace)
  const showProjects = useStore((s) => s.showProjects)
  const showReminders = useStore((s) => s.showReminders)
  const startChatIn = useStore((s) => s.startChatIn)

  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const list = useRef<HTMLUListElement>(null)

  const results = useMemo(
    () => searchCommands(query, { rooms: rooms ?? [], chats, projects }),
    [query, rooms, chats, projects]
  )

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [index, results])

  const run = (command: Command | undefined): void => {
    if (!command) return
    setOpen(false)
    const t = command.target
    if (t.type === 'new-chat') void selectChat(null)
    else if (t.type === 'palace') void showPalace(null)
    else if (t.type === 'projects') void showProjects()
    else if (t.type === 'reminders') void showReminders()
    else if (t.type === 'room') void showPalace(t.roomId)
    else if (t.type === 'chat-in') startChatIn(t.roomId)
    else void selectChat(t.chatId)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setIndex((i) => (results.length === 0 ? 0 : (i + 1) % results.length))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setIndex((i) => (results.length === 0 ? 0 : (i - 1 + results.length) % results.length))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      run(results[index])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[14vh] backdrop-blur-sm" onMouseDown={() => setOpen(false)}>
      <div
        role="dialog"
        aria-label="Search"
        className="command-bar w-[min(560px,90vw)] overflow-hidden rounded-xl border border-white/15 bg-ink shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setIndex(0)
          }}
          onKeyDown={onKeyDown}
          placeholder="Jump to a room, chat or project"
          aria-label="Search rooms, chats and projects"
          role="combobox"
          aria-expanded="true"
          aria-controls="command-results"
          className="w-full border-b border-white/10 bg-transparent px-4 py-3 text-sm text-paper outline-none placeholder:text-muted"
        />
        <ul ref={list} id="command-results" role="listbox" className="max-h-80 overflow-y-auto p-1.5">
          {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">Nothing matches “{query}”.</li>}
          {results.map((command, i) => (
            <li
              key={command.id}
              role="option"
              aria-selected={i === index}
              onMouseEnter={() => setIndex(i)}
              onClick={() => run(command)}
              className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm ${
                i === index ? 'bg-white/10 text-paper' : 'text-paper/80'
              }`}
            >
              <span className="w-14 shrink-0 text-[10px] tracking-wide text-muted uppercase">{KIND_LABEL[command.kind]}</span>
              <span className="min-w-0 flex-1 truncate">{command.title}</span>
              <span className="shrink-0 truncate text-xs text-muted">{command.hint}</span>
            </li>
          ))}
        </ul>
        <p className="border-t border-white/10 px-4 py-1.5 text-[11px] text-muted">↑↓ to move · Enter to open · Esc to close</p>
      </div>
    </div>
  )
}
