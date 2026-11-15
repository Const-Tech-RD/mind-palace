import { useEffect } from 'react'
import { ChatView } from './components/ChatView'
import { Login } from './components/Login'
import { ProjectsView } from './components/ProjectsView'
import { Sidebar } from './components/Sidebar'
import { useStore } from './store'

/** The shell: chats by room on the left; the open chat or the projects panel on the right. */
export function App() {
  const auth = useStore((s) => s.auth)
  const appError = useStore((s) => s.appError)
  const init = useStore((s) => s.init)
  const checkAuth = useStore((s) => s.checkAuth)
  const handleEvent = useStore((s) => s.handleEvent)
  const view = useStore((s) => s.view)

  useEffect(() => {
    const unsubscribe = window.mindPalace.onChatEvent(handleEvent)
    void init()
    return unsubscribe
  }, [init, handleEvent])

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
      {view === 'projects' ? <ProjectsView /> : <ChatView />}
    </div>
  )
}
