import { describe, expect, it } from 'vitest'
import { sdkEnv } from '../src/shared/sdkEnv'

describe('sdkEnv', () => {
  const host = {
    PATH: '/usr/bin',
    HOME: '/home/someone',
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:9999',
    ANTHROPIC_MODEL: 'something-else',
    CLAUDECODE: '1',
    CLAUDE_CODE_ENTRYPOINT: 'cli',
    CLAUDE_CODE_SESSION_ID: 'abc',
    CLAUDE_AGENT_SDK_CLIENT_APP: 'another-app/9',
    CLAUDECODE_LIKE: 'kept',
    UNSET: undefined
  }

  it('drops the variables of a Claude Code session the app was started from', () => {
    const env = sdkEnv(host, '0.1.0')
    for (const key of ['ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION_ID']) {
      expect(env).not.toHaveProperty(key)
    }
  })

  it('keeps everything else, and names this app', () => {
    const env = sdkEnv(host, '0.1.0')
    expect(env).toMatchObject({ PATH: '/usr/bin', HOME: '/home/someone', CLAUDECODE_LIKE: 'kept' })
    expect(env['CLAUDE_AGENT_SDK_CLIENT_APP']).toBe('mind-palace/0.1.0')
    expect(env).not.toHaveProperty('UNSET')
  })

  it('keeps a login the person chose on purpose', () => {
    const env = sdkEnv(
      { ANTHROPIC_API_KEY: 'k', ANTHROPIC_AUTH_TOKEN: 't', CLAUDE_CODE_OAUTH_TOKEN: 'o', CLAUDE_CONFIG_DIR: '/cfg' },
      '0.1.0'
    )
    expect(env).toMatchObject({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_AUTH_TOKEN: 't', CLAUDE_CODE_OAUTH_TOKEN: 'o', CLAUDE_CONFIG_DIR: '/cfg' })
  })
})
