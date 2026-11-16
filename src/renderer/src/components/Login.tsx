import { useState } from 'react'
import type { AuthState } from '@shared/chat'

/** Shown instead of the chat when there is no usable Claude Code login. */
export function Login({ auth, onRetry }: { auth: AuthState; onRetry: () => Promise<void> }) {
  const [checking, setChecking] = useState(false)
  const rejected = auth.status === 'rejected'

  const retry = async (): Promise<void> => {
    setChecking(true)
    try {
      await onRetry()
    } finally {
      setChecking(false)
    }
  }

  return (
    <main className="mx-auto flex h-full max-w-md flex-col justify-center gap-5 p-8">
      <h1 className="text-2xl font-semibold">{rejected ? 'Claude did not accept the login' : 'Sign in to Claude first'}</h1>
      <p className="text-sm leading-relaxed text-muted">
        {rejected
          ? auth.detail
          : 'Mind Palace talks to Claude through the Claude Code login on this computer, and there is none yet.'}
      </p>
      <div className="rounded-lg bg-ink-soft p-4 text-sm">
        <p className="text-muted">{rejected ? 'To sign in with another account, run in a terminal:' : 'In a terminal, run:'}</p>
        <pre className="mt-2 select-all font-mono text-paper">claude auth login --claudeai</pre>
      </div>
      <button
        type="button"
        onClick={() => void retry()}
        disabled={checking}
        className="self-start rounded-md bg-gold px-4 py-2 text-sm font-medium text-ink hover:bg-brass-light disabled:opacity-60"
      >
        {checking ? 'Checking…' : rejected ? 'Back to the chat' : 'I have signed in'}
      </button>
    </main>
  )
}
