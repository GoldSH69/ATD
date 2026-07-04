import type { LlmSettings, TestResult } from './types'

/** LLM provider adapters: Anthropic Claude, OpenAI, and any local
 *  OpenAI-compatible server (Ollama / LM Studio). */

const ANTHROPIC_VERSION = '2023-06-01'
const TEST_TIMEOUT_MS = 15_000
// Local models can be slow to load/generate, so generation gets a long leash.
const GEN_TIMEOUT_MS = 120_000

type Json = Record<string, unknown>
const asObj = (v: unknown): Json => (v !== null && typeof v === 'object' ? (v as Json) : {})
const snippet = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, 200)
const stripTrailingSlashes = (u: string): string => u.trim().replace(/\/+$/, '')

function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  if (err.message !== 'fetch failed') return err.message
  // Node's fetch buries the useful bit (e.g. ECONNREFUSED) in err.cause.
  const cause = asObj((err as Error & { cause?: unknown }).cause)
  if (typeof cause.code === 'string' && cause.code) return cause.code
  if (Array.isArray(cause.errors)) {
    for (const e of cause.errors) {
      const code = asObj(e).code
      if (typeof code === 'string' && code) return code
    }
  }
  if (typeof cause.message === 'string' && cause.message) return cause.message
  return err.message
}

interface HttpReply {
  ok: boolean
  status: number
  body: string
}

async function request(url: string, init: RequestInit, timeoutMs: number): Promise<HttpReply> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    // Body is consumed inside the same timeout window so a stalled stream cannot hang.
    const body = await res.text()
    return { ok: res.ok, status: res.status, body }
  } catch (err) {
    if (ctrl.signal.aborted) {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s (${url})`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

function validateHttpBase(base: string): string | null {
  try {
    const u = new URL(base)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Base URL must use http or https'
    return null
  } catch {
    return 'Base URL is not a valid URL'
  }
}

function httpMessage(label: string, status: number, body: string): string {
  const detail = snippet(body)
  if (status === 401 || status === 403) {
    return `${label}: invalid API key (HTTP ${status})${detail ? ` — ${detail}` : ''}`
  }
  return `${label}: request failed (HTTP ${status})${detail ? ` — ${detail}` : ''}`
}

function parseJson(label: string, status: number, body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    throw new Error(`${label}: unexpected non-JSON response (HTTP ${status}) — ${snippet(body)}`)
  }
}

/** Both Anthropic and OpenAI-style /models responses list models under data[]. */
function modelIds(data: unknown): string[] {
  const list = asObj(data).data
  if (!Array.isArray(list)) return []
  return list.map((m) => asObj(m).id).filter((id): id is string => typeof id === 'string')
}

async function testHosted(
  label: string,
  url: string,
  apiKey: string,
  headers: Record<string, string>
): Promise<TestResult> {
  if (!apiKey.trim()) return { ok: false, message: 'API key is required' }
  const res = await request(url, { headers }, TEST_TIMEOUT_MS)
  if (!res.ok) return { ok: false, message: httpMessage(label, res.status, res.body) }
  const count = modelIds(parseJson(label, res.status, res.body)).length
  return { ok: true, message: `Connected to ${label} — ${count} models available.` }
}

async function testLocal(local: LlmSettings['local']): Promise<TestResult> {
  const base = stripTrailingSlashes(local.baseUrl)
  if (!base) return { ok: false, message: 'Base URL is required' }
  const invalid = validateHttpBase(base)
  if (invalid) return { ok: false, message: invalid }
  const apiKey = local.apiKey.trim()
  const headers: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {}
  let res: HttpReply
  try {
    res = await request(`${base}/models`, { headers }, TEST_TIMEOUT_MS)
  } catch (err) {
    return {
      ok: false,
      message: `Could not reach ${base} — is the local LLM server running? (${describeError(err)})`,
    }
  }
  if (!res.ok) return { ok: false, message: httpMessage('Local LLM', res.status, res.body) }
  const ids = modelIds(parseJson('Local LLM', res.status, res.body))
  const model = local.model.trim()
  // Ollama lists models with a ":tag" suffix, so "llama3.1" matches "llama3.1:latest".
  const found = model !== '' && ids.some((id) => id === model || id.startsWith(`${model}:`))
  if (found) return { ok: true, message: `Connected to ${base} — model "${model}" is available.` }
  const listed =
    ids.length === 0
      ? 'no models listed'
      : `available: ${ids.slice(0, 5).join(', ')}${ids.length > 5 ? ', …' : ''}`
  return {
    ok: true,
    message: `Connected to ${base} — model "${model}" not found on server — ${listed}.`,
  }
}

export async function testLlm(llm: LlmSettings): Promise<TestResult> {
  try {
    switch (llm.provider) {
      case 'claude':
        return await testHosted('Anthropic', 'https://api.anthropic.com/v1/models', llm.claude.apiKey, {
          'x-api-key': llm.claude.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        })
      case 'openai':
        return await testHosted('OpenAI', 'https://api.openai.com/v1/models', llm.openai.apiKey, {
          authorization: `Bearer ${llm.openai.apiKey}`,
        })
      case 'local':
        return await testLocal(llm.local)
    }
  } catch (err) {
    return { ok: false, message: describeError(err) }
  }
}

async function generateClaude(
  cfg: LlmSettings['claude'],
  system: string,
  user: string
): Promise<string> {
  if (!cfg.apiKey.trim()) throw new Error('Anthropic API key is required')
  let res: HttpReply
  try {
    res = await request(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'x-api-key': cfg.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
        },
        // No temperature: current Anthropic models reject non-default sampling
        // params. 2048 tokens leaves headroom for models that think before answering.
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: 2048,
          system,
          messages: [{ role: 'user', content: user }],
        }),
      },
      GEN_TIMEOUT_MS
    )
  } catch (err) {
    throw new Error(`Anthropic: ${describeError(err)}`)
  }
  if (!res.ok) throw new Error(httpMessage('Anthropic', res.status, res.body))
  const blocks = asObj(parseJson('Anthropic', res.status, res.body)).content
  if (Array.isArray(blocks)) {
    for (const block of blocks) {
      const b = asObj(block)
      if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) return b.text.trim()
    }
  }
  throw new Error(`Anthropic: response had no text content — ${snippet(res.body)}`)
}

async function chatCompletion(
  label: string,
  url: string,
  headers: Record<string, string>,
  model: string,
  system: string,
  user: string,
  // OpenAI reasoning models reject max_tokens and non-default temperature, while
  // local OpenAI-compatible servers expect max_tokens — so the caller picks.
  sampling: Json
): Promise<string> {
  let res: HttpReply
  try {
    res = await request(
      url,
      {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          ...sampling,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      },
      GEN_TIMEOUT_MS
    )
  } catch (err) {
    throw new Error(`${label}: ${describeError(err)}`)
  }
  if (!res.ok) throw new Error(httpMessage(label, res.status, res.body))
  const choices = asObj(parseJson(label, res.status, res.body)).choices
  const first = Array.isArray(choices) && choices.length > 0 ? asObj(choices[0]) : {}
  const content = asObj(first.message).content
  if (typeof content === 'string' && content.trim()) return content.trim()
  throw new Error(`${label}: response had no message content — ${snippet(res.body)}`)
}

export async function generateText(llm: LlmSettings, system: string, user: string): Promise<string> {
  switch (llm.provider) {
    case 'claude':
      return generateClaude(llm.claude, system, user)
    case 'openai': {
      if (!llm.openai.apiKey.trim()) throw new Error('OpenAI API key is required')
      return chatCompletion(
        'OpenAI',
        'https://api.openai.com/v1/chat/completions',
        { authorization: `Bearer ${llm.openai.apiKey}` },
        llm.openai.model,
        system,
        user,
        { max_completion_tokens: 2048 }
      )
    }
    case 'local': {
      const base = stripTrailingSlashes(llm.local.baseUrl)
      if (!base) throw new Error('Local LLM base URL is required')
      const invalid = validateHttpBase(base)
      if (invalid) throw new Error(`Local LLM: ${invalid}`)
      const apiKey = llm.local.apiKey.trim()
      return chatCompletion(
        'Local LLM',
        `${base}/chat/completions`,
        apiKey ? { authorization: `Bearer ${apiKey}` } : {},
        llm.local.model,
        system,
        user,
        { max_tokens: 1024, temperature: 0.8 }
      )
    }
  }
}
