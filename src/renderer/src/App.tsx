import { useEffect } from 'react'
import { CommandBar } from './components/CommandBar'
import { ChatView } from './components/ChatView'
import { Login } from './components/Login'
import { PalaceView } from './components/PalaceView'
import { ProjectsView } from './components/ProjectsView'
import { ProjectPage } from './components/project/ProjectPage'
import { RemindersView } from './components/RemindersView'
import { Sidebar } from './components/Sidebar'
import { useStore } from './store'

/**
 * The shell: a side rail, and the palace as home. A chat opens as a panel
 * beside the palace, so the room it belongs to stays in view.
 */
export function App() {
  const auth = useStore((s) => s.auth)
  const appError = useStore((s) => s.appError)
  const init = useStore((s) => s.init)
  const checkAuth = useStore((s) => s.checkAuth)
  const handleEvent = useStore((s) => s.handleEvent)
  const handleAppEvent = useStore((s) => s.handleAppEvent)
  const view = useStore((s) => s.view)
  const chatWide = useStore((s) => s.chatWide)

  useEffect(() => {
    const offChat = window.mindPalace.onChatEvent(handleEvent)
    const offApp = window.mindPalace.onAppEvent(handleAppEvent)
    void init()
    return () => {
      offChat()
      offApp()
    }
  }, [init, handleEvent, handleAppEvent])

  if (auth === null) {
    return (
      <main className="flex h-full items-center justify-center p-8 text-sm text-muted">
        {appError ?? 'Starting…'}
      </main>
    )
  }
  if (auth.status !== 'ok') return <Login auth={auth} onRetry={checkAuth} />

  return (
    <div className="flex h-full">
      <Sidebar />
      {view === 'projects' ? (
        <ProjectsView />
      ) : view === 'project' ? (
        <ProjectPage />
      ) : view === 'reminders' ? (
        <RemindersView />
      ) : (
        <div className="flex h-full min-w-0 flex-1">
          {!(view === 'chat' && chatWide) && <PalaceView />}
          {view === 'chat' && (
            <div
              className={`chat-panel flex h-full min-w-0 border-l border-brass/25 bg-walnut ${
                chatWide ? 'flex-1' : 'w-[min(520px,58%)] shrink-0 shadow-[-12px_0_32px_rgba(0,0,0,0.35)]'
              }`}
              data-testid="chat-panel"
            >
              <ChatView />
            </div>
          )}
        </div>
      )}
      <CommandBar />
    </div>
  )
}
