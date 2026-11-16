/**
 * The environment the Claude Code subprocess gets.
 *
 * The SDK's `env` option replaces the child's environment outright, so this
 * is an allow-list: what a process needs to run, find the user's home and
 * reach the network, plus where the Claude Code login lives. Nothing else
 * from the app's own environment is passed on. In particular a shell that is
 * itself a Claude Code session sets `ANTHROPIC_BASE_URL`, `ANTHROPIC_*` keys
 * and many `CLAUDE_CODE_*` variables; inheriting those would make the app use
 * that session's login and endpoint instead of the user's own.
 */

/** Variables passed through unchanged when present. */
const ALLOWED = [
  // Finding programs and the user's home.
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'TEMP',
  'TMP',
  'LANG',
  'TZ',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'XDG_RUNTIME_DIR',
  // Windows basics.
  'PATHEXT',
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'WINDIR',
  'COMSPEC',
  'USERPROFILE',
  'USERNAME',
  'USERDOMAIN',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMW6432',
  'COMMONPROGRAMFILES',
  'COMPUTERNAME',
  'OS',
  'PROCESSOR_ARCHITECTURE',
  'NUMBER_OF_PROCESSORS',
  // Network: corporate proxies and certificates.
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  // Where the user's own Claude Code login is stored (read, never borrowed from a session).
  'CLAUDE_CONFIG_DIR'
]

export function sdkEnv(
  source: Record<string, string | undefined>,
  appVersion: string,
  platform: NodeJS.Platform = process.platform
): Record<string, string> {
  // Windows variable names are case-insensitive (`Path`, `SystemRoot`); elsewhere they are not.
  const fold = platform === 'win32' ? (name: string) => name.toUpperCase() : (name: string) => name
  const allowed = new Set(ALLOWED.map(fold))
  // Proxy variables are commonly lower-case on POSIX.
  if (platform !== 'win32') for (const name of ['http_proxy', 'https_proxy', 'no_proxy']) allowed.add(name)

  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue
    if (allowed.has(fold(name)) || name.startsWith('LC_')) env[name] = value
  }
  env['CLAUDE_AGENT_SDK_CLIENT_APP'] = `mind-palace/${appVersion}`
  return env
}
