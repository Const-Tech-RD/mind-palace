/**
 * The only module that talks to Claude.
 *
 * Model access goes through the Claude Agent SDK on the local Claude Code
 * login: no API key. Everything else in the app sees the small event stream
 * below, so moving to another way of calling the model is a change to this file.
 */
import { sdkEnv } from '@shared/sdkEnv'
import type { Options, SDKAssistantMessageError, SDKMessage } from '@anthropic-ai/claude-agent-sdk'

export type ClaudeEvent =
  /** The SDK session that holds this conversation; pass it back as `resume`. */
  | { type: 'session'; sessionId: string }
  | { type: 'delta'; text: string }
  | { type: 'searching'; query: string }
  /** The login was refused. Nothing more follows for this turn. */
  | { type: 'auth_error'; detail: string }
  | { type: 'result'; ok: true; tokensIn: number; tokensOut: number }
  | { type: 'result'; ok: false; error: string }

export interface AskParams {
  prompt: string
  model: string
  /** SDK session id from an earlier turn of the same chat. */
  resume?: string
  /** Folder the SDK keeps its session transcripts under. Must exist. */
  cwd: string
  abortController: AbortController
  appVersion: string
}

/** The one tool the model may use. No file, shell or code tools exist in this app. */
const WEB_SEARCH = 'WebSearch'

const SYSTEM_PROMPT = [
  'You are the assistant inside Mind Palace, a personal chat app on the user\'s own computer.',
  'Answer clearly and directly, in the language the user writes in.',
  'You can search the web. Do so when a question depends on current or checkable facts, and then cite the pages you relied on as markdown links.',
  'You have no access to files, a shell or code execution; if a request needs one, say so rather than pretending.'
].join(' ')

const AUTH_ERRORS: ReadonlySet<SDKAssistantMessageError> = new Set([
  'authentication_failed',
  'oauth_org_not_allowed',
  'account_on_hold',
  'verification_required',
  'billing_error'
])

const AUTH_ERROR_TEXT: Partial<Record<SDKAssistantMessageError, string>> = {
  authentication_failed: 'Claude did not accept the login on this machine.',
  oauth_org_not_allowed: 'This Claude account is not allowed to use Claude Code.',
  account_on_hold: 'This Claude account is on hold.',
  verification_required: 'This Claude account needs to be verified first.',
  billing_error: 'There is a billing problem on this Claude account.'
}

/** Credential sources that mean "an API key billed per use", not a Claude subscription. */
const API_KEY_SOURCES: ReadonlySet<string> = new Set(['ANTHROPIC_API_KEY', 'apiKeyHelper', '/login managed key'])

/**
 * What to tell the user when Claude refuses the login: the general reason,
 * Claude's own words, and, for an API-key login out of credit, what that means.
 */
export function describeAuthError(
  error: SDKAssistantMessageError,
  claudeText: string,
  apiKeySource: string | null
): string {
  const parts = [AUTH_ERROR_TEXT[error] ?? `Claude refused the request (${error}).`]
  const said = claudeText.trim()
  if (said) parts.push(`Claude said: "${said}".`)
  if (error === 'billing_error' && apiKeySource !== null && API_KEY_SOURCES.has(apiKeySource)) {
    parts.push(
      'The Claude Code login on this computer is an API account billed per use, not a Claude subscription. Sign in with your subscription, or add credit to that account.'
    )
  }
  return parts.join(' ')
}

function buildOptions(params: AskParams): Options {
  return {
    model: params.model,
    cwd: params.cwd,
    abortController: params.abortController,
    includePartialMessages: true,
    systemPrompt: SYSTEM_PROMPT,
    // `tools` is the set the model can see; `allowedTools` the set that runs
    // without asking. `dontAsk` denies anything not pre-approved instead of prompting.
    tools: [WEB_SEARCH],
    allowedTools: [WEB_SEARCH],
    permissionMode: 'dontAsk',
    // Isolation: none of the user's Claude Code settings, CLAUDE.md files,
    // hooks, skills or MCP servers are loaded into this app's chats.
    settingSources: [],
    mcpServers: {},
    env: sdkEnv(process.env, params.appVersion),
    ...(params.resume ? { resume: params.resume } : {})
  }
}

/**
 * Sends one user message and yields the answer as it is produced.
 * Aborting `abortController` ends the stream; the generator then returns
 * without a `result` event.
 */
export async function* ask(params: AskParams): AsyncGenerator<ClaudeEvent> {
  // The SDK is ESM-only; a dynamic import works from both CJS and ESM output.
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  const stream = query({ prompt: params.prompt, options: buildOptions(params) })

  let sessionId: string | null = null
  let apiKeySource: string | null = null
  let wroteText = false

  try {
    for await (const message of stream as AsyncIterable<SDKMessage>) {
      if (params.abortController.signal.aborted) return

      if (sessionId === null && 'session_id' in message && typeof message.session_id === 'string') {
        sessionId = message.session_id
        yield { type: 'session', sessionId }
      }

      switch (message.type) {
        case 'system': {
          if (message.subtype === 'init') apiKeySource = message.apiKeySource
          break
        }
        case 'stream_event': {
          if (message.parent_tool_use_id !== null) break
          const event = message.event
          if (event.type === 'content_block_start' && event.content_block.type === 'text' && wroteText) {
            // A new text block after a tool call: keep the paragraphs apart.
            yield { type: 'delta', text: '\n\n' }
          } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            wroteText = true
            yield { type: 'delta', text: event.delta.text }
          }
          break
        }
        case 'assistant': {
          if (message.error && AUTH_ERRORS.has(message.error)) {
            const said = message.message.content.map((block) => (block.type === 'text' ? block.text : '')).join(' ')
            yield { type: 'auth_error', detail: describeAuthError(message.error, said, apiKeySource) }
            return
          }
          if (message.parent_tool_use_id !== null) break
          for (const block of message.message.content) {
            if (block.type !== 'tool_use' || block.name !== WEB_SEARCH) continue
            const input = block.input as { query?: unknown } | null
            if (typeof input?.query === 'string') yield { type: 'searching', query: input.query }
          }
          break
        }
        case 'result': {
          if (message.subtype === 'success' && !message.is_error) {
            const usage = message.usage
            yield {
              type: 'result',
              ok: true,
              tokensIn:
                usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
              tokensOut: usage.output_tokens
            }
          } else {
            const detail = message.subtype === 'success' ? message.result : message.subtype
            yield { type: 'result', ok: false, error: detail || 'Claude could not finish the answer.' }
          }
          return
        }
        default:
          break
      }
    }
  } finally {
    // Make sure the CLI subprocess is gone whichever way the loop ended.
    stream.close()
  }
}

export type JsonAnswer =
  | { ok: true; value: unknown; tokensIn: number; tokensOut: number }
  | { ok: false; error: string }

/**
 * One question, one JSON answer matching `schema`. No tools, no session kept:
 * used for the classifier and other small background calls.
 */
export async function askJson(params: {
  prompt: string
  system: string
  schema: Record<string, unknown>
  model: string
  cwd: string
  appVersion: string
}): Promise<JsonAnswer> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  const options: Options = {
    model: params.model,
    cwd: params.cwd,
    systemPrompt: params.system,
    outputFormat: { type: 'json_schema', schema: params.schema },
    tools: [],
    permissionMode: 'dontAsk',
    settingSources: [],
    mcpServers: {},
    persistSession: false,
    env: sdkEnv(process.env, params.appVersion)
  }
  const stream = query({ prompt: params.prompt, options })
  let apiKeySource: string | null = null
  try {
    for await (const message of stream as AsyncIterable<SDKMessage>) {
      if (message.type === 'system' && message.subtype === 'init') {
        apiKeySource = message.apiKeySource
      } else if (message.type === 'assistant' && message.error) {
        const said = message.message.content.map((block) => (block.type === 'text' ? block.text : '')).join(' ')
        return { ok: false, error: describeAuthError(message.error, said, apiKeySource) }
      } else if (message.type === 'result') {
        if (message.subtype !== 'success' || message.is_error) {
          return { ok: false, error: message.subtype === 'success' ? message.result : message.subtype }
        }
        const usage = message.usage
        const tokensIn =
          usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
        let value: unknown = message.structured_output
        if (value === undefined || value === null) {
          // Older CLIs return the JSON as text; accept it with or without a code fence.
          const text = message.result.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
          try {
            value = JSON.parse(text)
          } catch {
            return { ok: false, error: 'Claude did not return JSON.' }
          }
        }
        return { ok: true, value, tokensIn, tokensOut: usage.output_tokens }
      }
    }
    return { ok: false, error: 'Claude ended without an answer.' }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    stream.close()
  }
}
