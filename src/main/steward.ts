/**
 * The steward's ears and brain, in the main process.
 *
 * Hearing is Whisper running on this computer (through transformers.js and
 * its native ONNX runtime): the recording never leaves the machine. The model
 * is downloaded once from Hugging Face, the first time voice is turned on,
 * into the app's own folder. The brain is one call to the small Claude model
 * that turns an order into a spoken reply and a list of in-app actions.
 */
import { mkdirSync } from 'node:fs'
import { buildStewardPrompt, STEWARD_SCHEMA, STEWARD_SYSTEM, type StewardContext, type StewardLanguage } from '@shared/steward'
import type { HearingStatus } from '@shared/ipc'
import type { JsonAnswer } from './chat/claude'

/** Multilingual Whisper, base size, 8-bit: about 80 MB on disk, fast enough on a laptop, good in Spanish and English. */
const MODEL = 'Xenova/whisper-base'
const SAMPLE_RATE = 16_000
/** Longer than this is not an order; it is also Whisper's window. */
const MAX_SECONDS = 30

/** The parts of the transformers.js pipeline this module uses. */
interface Transcriber {
  (audio: Float32Array, options: Record<string, unknown>): Promise<{ text: string } | Array<{ text: string }>>
  processor: (audio: Float32Array) => Promise<{ input_features: unknown }>
  model: (inputs: Record<string, unknown>) => Promise<{ logits: { data: Float32Array; dims: number[] } }>
  tokenizer: { convert_tokens_to_ids: (tokens: string[]) => number[] }
}
type TensorMaker = new (type: string, data: BigInt64Array, dims: number[]) => unknown

export function createSteward(deps: {
  modelsDir: string
  askModel: (prompt: string, system: string, schema: Record<string, unknown>) => Promise<JsonAnswer>
  log?: (message: string) => void
}) {
  const log = deps.log ?? (() => {})
  let status: HearingStatus = { state: 'absent', progress: 0, detail: null }
  let loading: Promise<Transcriber> | null = null
  let Tensor: TensorMaker | null = null

  /** Loads Whisper, downloading it the first time. Safe to call again while it loads. */
  function prepare(): Promise<Transcriber> {
    if (loading) return loading
    status = { state: 'loading', progress: 0, detail: null }
    loading = (async () => {
      mkdirSync(deps.modelsDir, { recursive: true })
      const { env, pipeline, Tensor: tensor } = await import('@huggingface/transformers')
      Tensor = tensor as unknown as TensorMaker
      env.cacheDir = deps.modelsDir
      // Several files download at once; the bar follows the largest one in flight.
      const seen = new Map<string, number>()
      const transcriber = await pipeline('automatic-speech-recognition', MODEL, {
        dtype: 'q8',
        progress_callback: (event: { status?: string; file?: string; progress?: number }) => {
          if (event.status !== 'progress' || !event.file || typeof event.progress !== 'number') return
          seen.set(event.file, event.progress)
          const lowest = Math.min(...seen.values())
          status = { state: 'loading', progress: Math.round(lowest), detail: null }
        }
      })
      status = { state: 'ready', progress: 100, detail: null }
      log('steward: hearing is ready')
      return transcriber as unknown as Transcriber
    })().catch((error: unknown) => {
      loading = null
      const detail = error instanceof Error ? error.message : String(error)
      status = { state: 'error', progress: 0, detail }
      log(`steward: hearing failed to load: ${detail}`)
      throw error
    })
    return loading
  }

  return {
    hearing: (): HearingStatus => status,
    prepare(): HearingStatus {
      void prepare().catch(() => {})
      return status
    },
    /**
     * Words from a mono recording at 16 kHz, and whether they were Spanish or English.
     *
     * The library does not detect the language itself (it assumes English, which turns
     * Spanish speech into an English translation). So the model is asked first which of
     * the two language tokens it expects after the start token, and then transcribes in that one.
     */
    async transcribe(samples: Float32Array): Promise<{ text: string; language: StewardLanguage }> {
      const audio = samples.length > SAMPLE_RATE * MAX_SECONDS ? samples.subarray(0, SAMPLE_RATE * MAX_SECONDS) : samples
      // Under a third of a second there is nothing to hear.
      if (audio.length < SAMPLE_RATE / 3) return { text: '', language: 'en' }
      const transcriber = await prepare()
      let language: StewardLanguage = 'en'
      try {
        const [start, es, en] = transcriber.tokenizer.convert_tokens_to_ids(['<|startoftranscript|>', '<|es|>', '<|en|>']) as [number, number, number]
        const { input_features } = await transcriber.processor(audio)
        const out = await transcriber.model({ input_features, decoder_input_ids: new Tensor!('int64', BigInt64Array.from([BigInt(start)]), [1, 1]) })
        const vocabulary = out.logits.dims[out.logits.dims.length - 1]!
        const next = out.logits.data.subarray(out.logits.data.length - vocabulary)
        language = next[es]! > next[en]! ? 'es' : 'en'
      } catch (error) {
        log(`steward: language detection failed, assuming English: ${error instanceof Error ? error.message : String(error)}`)
      }
      const out = await transcriber(audio, { task: 'transcribe', language: language === 'es' ? 'spanish' : 'english', chunk_length_s: MAX_SECONDS })
      const text = (Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text).trim()
      // Whisper writes these for silence or noise; they are not orders.
      const noise = /^[\s\[\(]*(blank_audio|music|música|silence|silencio|applause|aplausos|inaudible)[\s\]\)]*\.?$/i.test(text)
      return { text: noise ? '' : text, language }
    },
    /** One order to the small model; the renderer checks the answer against the palace before acting. */
    async interpret(order: string, context: StewardContext): Promise<{ ok: true; reply: unknown } | { ok: false; error: string }> {
      const answer = await deps.askModel(buildStewardPrompt(order, context), STEWARD_SYSTEM, STEWARD_SCHEMA as unknown as Record<string, unknown>)
      return answer.ok ? { ok: true, reply: answer.value } : { ok: false, error: answer.error }
    }
  }
}
