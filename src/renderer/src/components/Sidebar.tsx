import { useMemo } from 'react'
import { groupChatsByRoom } from '@shared/chat'
import { useStore } from '../store'

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
  const somethingNew = useStore(
    (s) =>
      s.palace?.rooms.some((r) => !s.seenRooms.includes(r.id) && (r.newItems.length > 0 || r.newShell !== null)) ?? false
  )
  const waiting = useStore((s) => s.reminders.length)

  const groups = useMemo(() => groupChatsByRoom(chats, rooms ?? []), [chats, rooms])

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-white/10 bg-ink-soft/60">
      <div className="p-3">
        <button
          type="button"
          onClick={() => void selectChat(null)}
          className="w-full rounded-md bg-paper px-3 py-2 text-sm font-medium text-ink hover:bg-white"
        >
          New chat
        </button>
        <button
          type="button"
          onClick={() => void showPalace()}
          aria-current={view === 'palace' ? 'page' : undefined}
          className={`mt-2 flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left text-sm ${
            view === 'palace' ? 'bg-white/10 text-paper' : 'text-paper/80 hover:bg-white/5'
          }`}
        >
          Palace
          {somethingNew && (
            <span className="rounded-full bg-amber-300 px-1.5 text-xs font-medium text-ink" aria-label="something new">
              New
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => void showProjects()}
          aria-current={view === 'projects' ? 'page' : undefined}
          className={`mt-1 w-full rounded-md px-3 py-1.5 text-left text-sm ${
            view === 'projects' ? 'bg-white/10 text-paper' : 'text-paper/80 hover:bg-white/5'
          }`}
        >
          Projects
        </button>
        <button
          type="button"
          onClick={() => void showReminders()}
          aria-current={view === 'reminders' ? 'page' : undefined}
          className={`mt-1 flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left text-sm ${
            view === 'reminders' ? 'bg-white/10 text-paper' : 'text-paper/80 hover:bg-white/5'
          }`}
        >
          Reminders
          {waiting > 0 && (
            <span className="rounded-full bg-paper px-1.5 text-xs font-medium text-ink" aria-label={`${waiting} waiting`}>
              {waiting}
            </span>
          )}
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label="Chats">
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

      <footer className="border-t border-white/10 px-4 py-2 text-xs text-muted">
        Mind Palace{version ? ` · v${version}` : ''}
      </footer>
    </aside>
  )
}
