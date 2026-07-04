import type { TestResult, ThreadsPost, UnansweredReply } from './types'

/** Meta Threads Graph API client. All calls carry a 15s abort timeout. */

const BASE = 'https://graph.threads.net/v1.0'
const TIMEOUT_MS = 15000

export interface ThreadsCfg {
  accessToken: string
  userId: string
}

class ThreadsApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: number) {
    super(message)
    this.name = 'ThreadsApiError'
  }
}

const uid = (cfg: ThreadsCfg): string => cfg.userId.trim() || 'me'
const snippet = (body: string): string => body.replace(/\s+/g, ' ').trim().slice(0, 200) || '(empty body)'
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function apiFetch<T>(
  cfg: ThreadsCfg,
  method: 'GET' | 'POST',
  path: string,
  params: Record<string, string>
): Promise<T> {
  const qs = new URLSearchParams({ ...params, access_token: cfg.accessToken })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res =
      method === 'GET'
        ? await fetch(`${BASE}${path}?${qs}`, { signal: controller.signal })
        : await fetch(`${BASE}${path}`, { method: 'POST', body: qs, signal: controller.signal })
    const body = await res.text()
    let json: unknown = null
    try {
      json = body ? JSON.parse(body) : null
    } catch {
      json = null
    }
    if (!res.ok) {
      const apiErr = (json as { error?: { message?: string; code?: number } } | null)?.error
      if (apiErr && typeof apiErr.message === 'string') {
        throw new ThreadsApiError('Threads API: ' + apiErr.message, res.status, apiErr.code)
      }
      throw new ThreadsApiError(`Threads API: HTTP ${res.status} — ${snippet(body)}`, res.status)
    }
    if (json === null || typeof json !== 'object') {
      throw new ThreadsApiError(`Threads API: unexpected non-JSON response (HTTP ${res.status}) — ${snippet(body)}`, res.status)
    }
    return json as T
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`Threads API: request to ${path} timed out after ${TIMEOUT_MS / 1000}s`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

const apiGet = <T>(cfg: ThreadsCfg, path: string, params: Record<string, string>): Promise<T> =>
  apiFetch<T>(cfg, 'GET', path, params)
const apiPost = <T>(cfg: ThreadsCfg, path: string, params: Record<string, string>): Promise<T> =>
  apiFetch<T>(cfg, 'POST', path, params)

export async function testThreads(cfg: ThreadsCfg): Promise<TestResult & { username?: string; userId?: string }> {
  try {
    const me = await apiGet<{ id?: string; username?: string }>(cfg, '/me', { fields: 'id,username' })
    const username = typeof me.username === 'string' ? me.username : ''
    const userId = typeof me.id === 'string' ? me.id : ''
    return { ok: true, message: `Connected as @${username}`, username, userId }
  } catch (err) {
    let message = err instanceof Error ? err.message : String(err)
    if (err instanceof ThreadsApiError && (err.status === 401 || err.code === 190)) {
      message += ' (access token looks expired or invalid — generate a new one)'
    }
    return { ok: false, message }
  }
}

// Container may need a moment before threads_publish accepts it.
const isTransientPublishError = (err: unknown): boolean => {
  const m = err instanceof Error ? err.message : String(err)
  return /not ready|not found|not finished|not available|try again|temporarily/i.test(m)
}

async function publish(cfg: ThreadsCfg, text: string, replyToId?: string): Promise<{ id: string; permalink?: string }> {
  const u = uid(cfg)
  const createParams: Record<string, string> = { media_type: 'TEXT', text }
  if (replyToId) createParams.reply_to_id = replyToId
  const created = await apiPost<{ id?: string }>(cfg, `/${u}/threads`, createParams)
  if (typeof created.id !== 'string' || !created.id) {
    throw new Error('Threads API: create step returned no creation id')
  }
  let mediaId = ''
  for (let attempt = 0; ; attempt++) {
    try {
      const published = await apiPost<{ id?: string }>(cfg, `/${u}/threads_publish`, { creation_id: created.id })
      if (typeof published.id !== 'string' || !published.id) {
        throw new Error('Threads API: publish step returned no media id')
      }
      mediaId = published.id
      break
    } catch (err) {
      if (attempt >= 5 || !isTransientPublishError(err)) throw err
      await delay(2000)
    }
  }
  let permalink: string | undefined
  try {
    const media = await apiGet<{ permalink?: string }>(cfg, `/${mediaId}`, { fields: 'permalink' })
    if (typeof media.permalink === 'string' && media.permalink) permalink = media.permalink
  } catch {
    // best-effort: post succeeded, permalink stays undefined
  }
  return { id: mediaId, permalink }
}

export async function publishPost(cfg: ThreadsCfg, text: string): Promise<{ id: string; permalink?: string }> {
  return publish(cfg, text)
}

export async function publishReply(
  cfg: ThreadsCfg,
  text: string,
  replyToId: string
): Promise<{ id: string; permalink?: string }> {
  return publish(cfg, text, replyToId)
}

export async function fetchMyPosts(cfg: ThreadsCfg, limit: number): Promise<ThreadsPost[]> {
  const n = Math.max(1, Math.min(100, Math.floor(limit) || 1))
  const data = await apiGet<{ data?: Array<Partial<ThreadsPost>> }>(cfg, '/me/threads', {
    fields: 'id,text,timestamp,permalink',
    limit: String(n),
  })
  const posts: ThreadsPost[] = []
  for (const p of data.data ?? []) {
    if (typeof p.id !== 'string' || !p.id) continue
    posts.push({
      id: p.id,
      text: typeof p.text === 'string' ? p.text : '',
      timestamp: typeof p.timestamp === 'string' ? p.timestamp : '',
      permalink: typeof p.permalink === 'string' && p.permalink ? p.permalink : undefined,
    })
  }
  return posts
}

export async function scrapeRecentTexts(cfg: ThreadsCfg, count: number): Promise<string[]> {
  const n = Math.max(1, Math.floor(count) || 1)
  const posts = await fetchMyPosts(cfg, n * 2)
  return posts.map((p) => p.text).filter((t) => t.trim().length > 0).slice(0, n)
}

interface RawReply {
  id?: string
  text?: string
  username?: string
  timestamp?: string
  replied_to?: { id?: string }
}

/** /conversation returns the whole (flattened) tree; /replies only top-level replies. */
async function fetchReplyMessages(
  cfg: ThreadsCfg,
  postId: string
): Promise<{ items: RawReply[]; topLevelOnly: boolean }> {
  const params = { fields: 'id,text,username,timestamp,replied_to', limit: '100' }
  try {
    const data = await apiGet<{ data?: RawReply[] }>(cfg, `/${postId}/conversation`, params)
    return { items: data.data ?? [], topLevelOnly: false }
  } catch {
    const data = await apiGet<{ data?: RawReply[] }>(cfg, `/${postId}/replies`, params)
    return { items: data.data ?? [], topLevelOnly: true }
  }
}

// In /replies fallback mode the author's own answers sit one level deeper than
// the top-level list, so we probe each candidate's own replies to detect them.
// Bounded by a global budget so a busy account can't fan out into hundreds of calls.
const ANSWER_PROBE_BUDGET = 40

async function isAnsweredByMe(cfg: ThreadsCfg, replyId: string, myUsername: string): Promise<boolean> {
  try {
    const data = await apiGet<{ data?: RawReply[] }>(cfg, `/${replyId}/replies`, {
      fields: 'id,username',
      limit: '50',
    })
    return (data.data ?? []).some((r) => r.username === myUsername)
  } catch {
    // If we cannot tell, assume unanswered — the UI de-dupes against local reply drafts.
    return false
  }
}

export async function fetchUnansweredReplies(cfg: ThreadsCfg): Promise<UnansweredReply[]> {
  const me = await apiGet<{ username?: string }>(cfg, '/me', { fields: 'id,username' })
  const myUsername = typeof me.username === 'string' ? me.username : ''
  const posts = await fetchMyPosts(cfg, 10)
  const out: UnansweredReply[] = []
  let probeBudget = ANSWER_PROBE_BUDGET
  // Sequential on purpose: parallel conversation fetches trip Meta rate limits.
  for (const post of posts) {
    const { items, topLevelOnly } = await fetchReplyMessages(cfg, post.id)
    const answeredIds = new Set<string>()
    for (const m of items) {
      if (m.username === myUsername && typeof m.replied_to?.id === 'string') answeredIds.add(m.replied_to.id)
    }
    for (const m of items) {
      if (typeof m.id !== 'string' || !m.id) continue
      if (!m.username || m.username === myUsername) continue
      if (answeredIds.has(m.id)) continue
      if (!topLevelOnly && m.replied_to?.id !== post.id) continue
      const text = typeof m.text === 'string' ? m.text : ''
      if (!text.trim()) continue
      // /conversation carries our answers inline; /replies does not, so probe.
      if (topLevelOnly && probeBudget > 0) {
        probeBudget--
        if (await isAnsweredByMe(cfg, m.id, myUsername)) continue
      }
      out.push({
        id: m.id,
        text,
        username: m.username,
        timestamp: typeof m.timestamp === 'string' ? m.timestamp : '',
        rootPostId: post.id,
        rootPostText: post.text,
      })
    }
  }
  const ts = (s: string): number => {
    const t = Date.parse(s)
    return Number.isNaN(t) ? 0 : t
  }
  out.sort((a, b) => ts(b.timestamp) - ts(a.timestamp))
  return out.slice(0, 50)
}
