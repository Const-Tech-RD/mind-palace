import { REMINDER_RESPONSES, REMINDER_RESPONSE_LABEL, type ReminderItem } from '@shared/reminders'
import { accentCss } from '../theme'
import { useStore } from '../store'

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })

function ReminderCard({ item }: { item: ReminderItem }) {
  const room = useStore((s) => s.status?.rooms.find((r) => r.id === item.roomId))
  const respond = useStore((s) => s.respondToReminder)

  return (
    <li className="rounded-lg bg-ink-soft p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate font-medium">{item.projectTitle}</h3>
        {room && (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-paper/10 px-2.5 py-0.5 text-xs">
            <span className="inline-block size-2 rounded-full" style={{ backgroundColor: accentCss(room.accent) }} />
            {room.name}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-paper/90">{item.message}</p>
      <p className="mt-1 text-xs text-muted">
        Due {dateFormat.format(new Date(item.dueAt))}
        {item.notified ? ' · notified' : ' · no notification shown'}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {REMINDER_RESPONSES.map((response) => (
          <button
            key={response}
            type="button"
            onClick={() => void respond(item.id, response)}
            className={`rounded-md px-3 py-1 text-sm ${
              response === 'open' ? 'bg-gold font-medium text-ink hover:bg-brass-light' : 'bg-paper/10 text-paper hover:bg-paper/20'
            }`}
          >
            {REMINDER_RESPONSE_LABEL[response]}
          </button>
        ))}
      </div>
    </li>
  )
}

/** The in-app inbox: every reminder that has not been reacted to yet. */
export function RemindersView() {
  const reminders = useStore((s) => s.reminders)
  const notificationsOn = useStore((s) => s.notificationsOn)
  const setNotifications = useStore((s) => s.setNotifications)
  const appError = useStore((s) => s.appError)

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-brass/25 px-5">
        <h1 className="text-sm font-medium">Reminders</h1>
        <label className="flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={notificationsOn}
            onChange={(e) => void setNotifications(e.target.checked)}
            className="size-3.5 accent-white"
          />
          Show system notifications (at most two a day)
        </label>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-5 py-6">
          {appError && (
            <p role="alert" className="rounded-md bg-red-950 px-3 py-2 text-sm text-red-200">
              {appError}
            </p>
          )}
          {reminders.length === 0 ? (
            <p className="mt-24 text-center text-sm text-muted">
              Nothing waiting. A tracked project that goes quiet for three days will show up here.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {reminders.map((item) => (
                <ReminderCard key={item.id} item={item} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
