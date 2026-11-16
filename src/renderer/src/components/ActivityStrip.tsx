import { useEffect, useMemo, useState } from 'react'
import { ago, type ActivityItem } from '@shared/agents'
import { useStore } from '../store'

const ICON: Record<ActivityItem['kind'], string> = {
  asked: '›',
  searching: '⌕',
  answered: '✓',
  stopped: '■',
  filed: '✉',
  project: '★',
  error: '!'
}

/** What just happened in the palace, newest first. Click a line to open its chat. */
export function ActivityStrip() {
  const activity = useStore((s) => s.activity)
  const rooms = useStore((s) => s.status?.rooms)
  const selectChat = useStore((s) => s.selectChat)
  const chats = useStore((s) => s.chats)
  const exists = useMemo(() => new Set(chats.map((c) => c.id)), [chats])
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(() => new Date().toISOString())

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date().toISOString()), 30_000)
    return () => window.clearInterval(id)
  }, [])
  useEffect(() => setNow(new Date().toISOString()), [activity])

  const shown = open ? activity : activity.slice(0, 1)

  return (
    <footer className="shrink-0 border-t border-brass/25 bg-ink-soft/50 px-5 py-1.5 text-xs" aria-label="Activity">
      <div className="flex items-start gap-3">
        <span className="pt-1 text-[10px] tracking-wide text-muted uppercase">Activity</span>
        {activity.length === 0 ? (
          <p className="py-1 text-muted">Nothing yet in this sitting. What happens in the rooms shows up here.</p>
        ) : (
          <ol className={`min-w-0 flex-1 ${open ? 'max-h-40 overflow-y-auto' : ''}`} aria-live="polite">
            {shown.map((item) => {
              const accent = rooms?.find((r) => r.id === item.roomId)?.accent ?? '#6b6f8a'
              const canOpen = item.chatId !== null && exists.has(item.chatId)
              return (
                <li key={item.id} className="activity-line flex items-center gap-2 py-1">
                  <span className="flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-ink" style={{ backgroundColor: accent }} aria-hidden="true">
                    {ICON[item.kind]}
                  </span>
                  {canOpen ? (
                    <button type="button" onClick={() => void selectChat(item.chatId)} className="min-w-0 truncate text-left text-paper/90 hover:text-paper hover:underline">
                      {item.text}
                    </button>
                  ) : (
                    <span className="min-w-0 truncate text-paper/90">{item.text}</span>
                  )}
                  <span className="shrink-0 text-muted">{ago(item.at, now)}</span>
                </li>
              )
            })}
          </ol>
        )}
        {activity.length > 1 && (
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="shrink-0 rounded px-1.5 py-1 text-muted hover:bg-paper/10 hover:text-paper">
            {open ? 'Hide' : `${activity.length - 1} more`}
          </button>
        )}
      </div>
    </footer>
  )
}
