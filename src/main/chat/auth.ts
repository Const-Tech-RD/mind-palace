import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AuthState } from '@shared/chat'

/** Name of the macOS Keychain item Claude Code stores its login under. */
const KEYCHAIN_SERVICE = 'Claude Code-credentials'

function keychainItemExists(): Promise<boolean> {
  return new Promise((resolve) => {
    // Without -w or -g this only asks whether the item exists: the secret is
    // never read and macOS shows no prompt.
    execFile('/usr/bin/security', ['find-generic-password', '-s', KEYCHAIN_SERVICE], { timeout: 5000 }, (error) =>
      resolve(error === null)
    )
  })
}

/**
 * Whether a Claude Code login exists on this machine, without reading it.
 *
 * This is a presence check only. A login that exists can still be rejected
 * (expired, plan without access); that surfaces on the first message and is
 * tracked by the chat service.
 */
export async function findClaudeLogin(env: NodeJS.ProcessEnv = process.env): Promise<AuthState> {
  if (env['CLAUDE_CODE_OAUTH_TOKEN'] || env['ANTHROPIC_API_KEY'] || env['ANTHROPIC_AUTH_TOKEN']) {
    return { status: 'ok' }
  }
  const configDir = env['CLAUDE_CONFIG_DIR'] || join(homedir(), '.claude')
  if (existsSync(join(configDir, '.credentials.json'))) return { status: 'ok' }
  if (process.platform === 'darwin' && (await keychainItemExists())) return { status: 'ok' }
  return { status: 'missing' }
}
