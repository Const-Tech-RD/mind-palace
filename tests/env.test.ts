import { describe, expect, it } from 'vitest'
import { sdkEnv } from '../src/main/chat/env'

describe('sdkEnv', () => {
  const inherited = {
    PATH: '/usr/bin',
    HOME: '/home/me',
    LANG: 'es_DO.UTF-8',
    HTTPS_PROXY: 'http://proxy:8080',
    CLAUDE_CONFIG_DIR: '/home/me/.claude',
    // What a Claude Code terminal hands to anything launched from it.
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:9999',
    ANTHROPIC_API_KEY: 'sk-ant-borrowed',
    CLAUDE_CODE_OAUTH_TOKEN: 'borrowed',
    CLAUDE_CODE_SESSION_ID: 'abc',
    CLAUDECODE: '1',
    // Unrelated app secrets.
    GITHUB_TOKEN: 'ghp_x',
    AWS_SECRET_ACCESS_KEY: 'y'
  }

  it('keeps only allow-listed variables and adds the client id', () => {
    expect(sdkEnv(inherited, '1.2.3', 'linux')).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/me',
      LANG: 'es_DO.UTF-8',
      HTTPS_PROXY: 'http://proxy:8080',
      CLAUDE_CONFIG_DIR: '/home/me/.claude',
      CLAUDE_AGENT_SDK_CLIENT_APP: 'mind-palace/1.2.3'
    })
  })

  it('never passes on a Claude login or endpoint from the launching shell', () => {
    const keys = Object.keys(sdkEnv(inherited, '1.0.0', 'linux'))
    expect(keys.filter((k) => /^(ANTHROPIC_|CLAUDE_CODE_|CLAUDECODE)/.test(k))).toEqual([])
  })

  it('matches Windows names whatever their case, and keeps the spelling it found', () => {
    const env = sdkEnv(
      { Path: 'C:\\Windows', SystemRoot: 'C:\\Windows', APPDATA: 'C:\\x', ComSpec: 'cmd.exe', ProgramFiles: 'C:\\PF' },
      '1.0.0',
      'win32'
    )
    expect(env).toMatchObject({ Path: 'C:\\Windows', SystemRoot: 'C:\\Windows', APPDATA: 'C:\\x', ComSpec: 'cmd.exe' })
    expect(env['ProgramFiles']).toBe('C:\\PF')
  })

  it('is case-sensitive outside Windows', () => {
    expect(sdkEnv({ Path: '/x', path: '/y' }, '1.0.0', 'linux')).toEqual({
      CLAUDE_AGENT_SDK_CLIENT_APP: 'mind-palace/1.0.0'
    })
  })

  it('keeps LC_* locale variables and skips unset values', () => {
    expect(sdkEnv({ LC_ALL: 'C', LC_TIME: 'es_DO', TMPDIR: undefined }, '1.0.0', 'darwin')).toEqual({
      LC_ALL: 'C',
      LC_TIME: 'es_DO',
      CLAUDE_AGENT_SDK_CLIENT_APP: 'mind-palace/1.0.0'
    })
  })
})
