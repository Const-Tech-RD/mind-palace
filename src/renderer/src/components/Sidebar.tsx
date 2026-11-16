import { useMemo, type ReactNode } from 'react'
import { groupChatsByRoom } from '@shared/chat'
import { useStore } from '../store'

const icon = (path: ReactNode) => (
  <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {path}
  </svg>
)
const ICONS = {
  plus: icon(<path d="M12 5v14M5 12h14" />),
  palace: icon(<path d="M3 21h18M5 21V10l7-6 7 6v11M10 21v-6h4v6" />),
  projects: icon(<path d="M4 6h16M4 12h16M4 18h10" />),
  reminders: icon(<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 21h4" />),
  search: icon(<path d="M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM20 20l-4-4" />),
  chats: icon(<path d="M4 5h16v11H9l-5 4z" />)
}

/**
 * The side rail. Collapsed, it is a strip of icons and the palace has the
 * window; expanded, it also lists every chat by room.
 */
export function Sidebar() {
  const chats = useStore((s) => s.chats)
  const rooms = useStore((s) => s.status?.rooms)
  const activeChatId = useStore((s) => s.activeChatId)
  const streaming = useStore((s) => s.streaming)
  const version = useStore((s) => s.status?.version)
  const selectChat = useStore((s) => s.selectChat)
  const deleteChat = useStore((s) => s.deleteChat)
  const view = useStore((s) => s.view)
  const showProjects = useStore((s) => s.showProjects)
  const showReminders = useStore((s) => s.showReminders)
  const showPalace = useStore((s) => s.showPalace)
  const open = useStore((s) => s.railOpen)
  const toggleRail = useStore((s) => s.toggleRail)
  const setCommandOpen = useStore((s) => s.setCommandOpen)
  const somethingNew = useStore(
    (s) =>
      s.palace?.rooms.some((r) => !s.seenRooms.includes(r.id) && (r.newItems.length > 0 || r.newShell !== null)) ?? false
  )
  const waiting = useStore((s) => s.reminders.length)
  const answering = Object.keys(streaming).length > 0

  const groups = useMemo(() => groupChatsByRoom(chats, rooms ?? []), [chats, rooms])

  const label = (text: string) => <span className={open ? 'flex-1 truncate text-left' : 'sr-only'}>{text}</span>
  const item = (active: boolean) =>
    `relative mt-1 flex w-full items-center gap-2.5 rounded-md text-sm ${open ? 'px-3 py-1.5' : 'justify-center py-2'} ${
      active ? 'bg-white/10 text-paper' : 'text-paper/80 hover:bg-white/5'
    }`
  /** A badge beside the label when expanded, on the icon's corner when collapsed. */
  const badge = (collapsed: string) => (open ? '' : `absolute top-0.5 right-0.5 scale-75 ${collapsed}`)

  return (
    <aside
      className={`rail flex h-full shrink-0 flex-col border-r border-white/10 bg-ink-soft/60 ${open ? 'w-64' : 'w-14'}`}
      data-open={open}
    >
      <div className={open ? 'p-3' : 'p-2'}>
        <button
          type="button"
          onClick={() => void selectChat(null)}
          title={open ? undefined : 'New chat'}
          className={`flex w-full items-center justify-center gap-2 rounded-md bg-paper text-sm font-medium text-ink hover:bg-white ${
            open ? 'px-3 py-2' : 'py-2'
          }`}
        >
          {!open && ICONS.plus}
          <span className={open ? '' : 'sr-only'}>New chat</span>
        </button>
        <button
          type="button"
          onClick={() => void showPalace()}
          aria-current={view === 'palace' || view === 'chat' ? 'page' : undefined}
          title={open ? undefined : 'Palace'}
          className={`${item(view === 'palace' || view === 'chat')} ${open ? 'mt-2' : 'mt-3'}`}
        >
          {ICONS.palace}
          {label('Palace')}
          {somethingNew && (
            <span className={`rounded-full bg-amber-300 px-1.5 text-xs font-medium text-ink ${badge('')}`} aria-label="something new">
              New
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => void showProjects()}
          aria-current={view === 'projects' ? 'page' : undefined}
          title={open ? undefined : 'Projects'}
          className={item(view === 'projects')}
        >
          {ICONS.projects}
          {label('Projects')}
        </button>
        <button
          type="button"
          onClick={() => void showReminders()}
          aria-current={view === 'reminders' ? 'page' : undefined}
          title={open ? undefined : 'Reminders'}
          className={item(view === 'reminders')}
        >
          {ICONS.reminders}
          {label('Reminders')}
          {waiting > 0 && (
            <span className={`rounded-full bg-paper px-1.5 text-xs font-medium text-ink ${badge('')}`} aria-label={`${waiting} waiting`}>
              {waiting}
            </span>
          )}
        </button>
        <button type="button" onClick={() => setCommandOpen(true)} title={open ? undefined : 'Search (⌘K)'} className={item(false)}>
          {ICONS.search}
          {label('Search')}
          {open && <kbd className="rounded border border-white/15 px-1 text-[10px] text-muted">⌘K</kbd>}
        </button>
        <button
          type="button"
          onClick={toggleRail}
          aria-expanded={open}
          aria-controls="chat-list"
          title={open ? undefined : 'Show chats'}
          className={item(false)}
        >
          {ICONS.chats}
          {label(open ? 'Hide chats' : 'Show chats')}
          {!open && answering && <span className="absolute top-1 right-1 size-2 animate-pulse rounded-full bg-paper" aria-label="answering" />}
        </button>
      </div>

      {open && (
        <nav id="chat-list" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label="Chats">
          {groups.length === 0 && <p className="px-2 py-4 text-sm text-muted">No chats yet.</p>}
          {groups.map((group) => (
            <section key={group.id} className="mt-3 first:mt-0">
              <h2 className="flex items-center gap-2 px-2 py-1 text-xs font-medium tracking-wide text-muted uppercase">
                <span className="inline-block size-2 rounded-full" style={{ backgroundColor: group.accent }} />
                {group.name}
              </h2>
              <ul>
                {group.chats.map((chat) => {
                  const active = view === 'chat' && chat.id === activeChatId
                  return (
                    <li key={chat.id} className="group relative">
                      <button
                        type="button"
                        onClick={() => void selectChat(chat.id)}
                        aria-current={active ? 'true' : undefined}
                        className={`flex w-full items-center gap-2 rounded-md py-1.5 pr-8 pl-2 text-left text-sm ${
                          active ? 'bg-white/10 text-paper' : 'text-paper/80 hover:bg-white/5'
                        }`}
                      >
                        <span className="truncate">{chat.title || 'New chat'}</span>
                        {streaming[chat.id] && (
                          <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-paper" aria-label="answering" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Delete "${chat.title || 'New chat'}"? This cannot be undone.`)) {
                            void deleteChat(chat.id)
                          }
                        }}
                        aria-label={`Delete ${chat.title || 'chat'}`}
                        className="absolute top-1/2 right-1 hidden size-6 -translate-y-1/2 rounded text-muted hover:bg-white/10 hover:text-paper group-hover:block focus:block"
                      >
                        ×
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </nav>
      )}

      {open && (
        <footer className="border-t border-white/10 px-4 py-2 text-xs text-muted">
          Mind Palace{version ? ` · v${version}` : ''}
        </footer>
      )}
    </aside>
  )
}
