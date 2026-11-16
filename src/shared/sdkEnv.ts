/**
 * The environment handed to the Claude Agent SDK's child process.
 *
 * When the app is started from inside a Claude Code session (a terminal it
 * opened, a dev run), that session's routing and identity variables are in the
 * app's own environment. Passed on, they make the SDK talk through that
 * session and use its login. So everything in the `ANTHROPIC_*`, `CLAUDE_CODE_*`
 * and `CLAUDE_AGENT_SDK_*` families is dropped, except the few a person sets on
 * purpose to choose a login.
 */
const KEEP = new Set(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR'])
const SESSION_FAMILY = /^(ANTHROPIC_|CLAUDE_CODE_|CLAUDE_AGENT_SDK_|CLAUDECODE$)/

export function sdkEnv(env: Readonly<Record<string, string | undefined>>, appVersion: string): Record<string, string> {
  const clean: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue
    if (SESSION_FAMILY.test(key) && !KEEP.has(key)) continue
    clean[key] = value
  }
  clean['CLAUDE_AGENT_SDK_CLIENT_APP'] = `mind-palace/${appVersion}`
  return clean
}
