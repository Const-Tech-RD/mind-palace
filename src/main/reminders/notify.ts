import { Notification } from 'electron'
import type { ReminderItem, ReminderResponse } from '@shared/reminders'

/**
 * Shows the system notification for a reminder.
 *
 * Clicking it opens the project. On macOS it also carries Done and Snooze
 * buttons; Electron's notification buttons do not work on Windows, where the
 * same actions are in the app's reminder inbox.
 */
export function showReminderNotification(
  item: ReminderItem,
  onResponse: (reminderId: string, response: ReminderResponse) => void
): boolean {
  if (!Notification.isSupported()) return false
  const actions: ReminderResponse[] = process.platform === 'darwin' ? ['done', 'snooze'] : []
  const notification = new Notification({
    title: item.projectTitle,
    body: item.message,
    silent: false,
    ...(actions.length > 0
      ? {
          actions: [
            { type: 'button' as const, text: 'Done' },
            { type: 'button' as const, text: 'Snooze 2 weeks' }
          ],
          closeButtonText: 'Later'
        }
      : {})
  })
  notification.on('click', () => onResponse(item.id, 'open'))
  notification.on('action', (_event, index) => {
    const response = actions[index]
    if (response) onResponse(item.id, response)
  })
  notification.show()
  return true
}
