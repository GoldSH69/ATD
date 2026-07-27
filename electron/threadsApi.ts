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

/** Prefer an explicit Threads user id; fall back to `me`. Wrong/stale user ids cause
 *  "The requested resource does not exist" on create/publish. */
const uid = (cfg: ThreadsCfg): string => {
  const id = cfg.userId.trim()
  // Threads media/user ids are numeric strings; reject obviously bad values.
  if (id && /^\d+$/.test(id)) return id
  return 'me'
}
const snippet = (body: string): string => body.replace(/\s+/g, ' ').trim().slice(0, 200) || '(empty body)'
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

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
// Meta often returns "does not exist" if publish runs immediately after create
// (common for replies). Wait + retry; see Threads two-step publish docs.
const isTransientPublishError = (err: unknown): boolean => {
  const m = errText(err)
  return /not ready|not found|not finished|not available|try again|temporarily|does not exist|in progress|processing/i.test(
    m
  )
}

const isMissingResourceError = (err: unknown): boolean => {
  const m = errText(err)
  return /does not exist|invalid.*id|unsupported get request/i.test(m)
}

/** True when the media id is still addressable via the Graph API. */
export async function threadsMediaExists(cfg: ThreadsCfg, mediaId: string): Promise<boolean> {
  if (!mediaId.trim()) return false
  try {
    const media = await apiGet<{ id?: string }>(cfg, `/${mediaId.trim()}`, { fields: 'id' })
    return typeof media.id === 'string' && media.id.length > 0
  } catch {
    return false
  }
}

/**
 * Two-step Threads publish against a specific user path (`me` or numeric id).
 * Waits after create before the first publish — immediate publish is a common
 * cause of "The requested resource does not exist" on replies.
 */
async function publishAgainstUser(
  cfg: ThreadsCfg,
  userPath: string,
  text: string,
  replyToId?: string,
  imageUrl?: string
): Promise<{ id: string; permalink?: string }> {
  const createParams: Record<string, string> = imageUrl
    ? { media_type: 'IMAGE', image_url: imageUrl, text }
    : { media_type: 'TEXT', text }
  if (replyToId) createParams.reply_to_id = replyToId

  let created: { id?: string }
  try {
    created = await apiPost<{ id?: string }>(cfg, `/${userPath}/threads`, createParams)
  } catch (err) {
    // Bad/expired image URLs often surface as "resource does not exist" — fall back to text.
    if (imageUrl && isMissingResourceError(err)) {
      return publishAgainstUser(cfg, userPath, text, replyToId, undefined)
    }
    throw err
  }
  if (typeof created.id !== 'string' || !created.id) {
    throw new Error('Threads API: create step returned no creation id')
  }

  // Give the container time to register before the first publish attempt.
  await delay(replyToId ? 2500 : 1200)

  let mediaId = ''
  let lastErr: unknown
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const published = await apiPost<{ id?: string }>(cfg, `/${userPath}/threads_publish`, {
        creation_id: created.id,
      })
      if (typeof published.id !== 'string' || !published.id) {
        throw new Error('Threads API: publish step returned no media id')
      }
      mediaId = published.id
      lastErr = undefined
      break
    } catch (err) {
      lastErr = err
      if (attempt >= 7 || !isTransientPublishError(err)) throw err
      // Back off: 2s, 3s, 4s… — containers sometimes need several seconds.
      await delay(2000 + attempt * 1000)
    }
  }
  if (!mediaId) {
    throw lastErr instanceof Error ? lastErr : new Error('Threads API: publish failed')
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

async function publish(
  cfg: ThreadsCfg,
  text: string,
  replyToId?: string,
  imageUrl?: string
): Promise<{ id: string; permalink?: string }> {
  const primary = uid(cfg)
  try {
    return await publishAgainstUser(cfg, primary, text, replyToId, imageUrl)
  } catch (err) {
    // Stale/wrong User ID in settings → "resource does not exist". Retry as `me`.
    if (primary !== 'me' && isMissingResourceError(err)) {
      console.warn(
        `[threads] publish via user id ${primary} failed (${errText(err)}); retrying as me`
      )
      return publishAgainstUser(cfg, 'me', text, replyToId, imageUrl)
    }
    throw err
  }
}

export async function publishPost(
  cfg: ThreadsCfg,
  text: string,
  imageUrl?: string
): Promise<{ id: string; permalink?: string }> {
  return publish(cfg, text, undefined, imageUrl)
}

export async function publishReply(
  cfg: ThreadsCfg,
  text: string,
  replyToId: string
): Promise<{ id: string; permalink?: string }> {
  const target = replyToId.trim()
  if (!target) throw new Error('Threads API: reply target id is empty')
  // Avoid create+publish round-trips against deleted/expired media ids.
  if (!(await threadsMediaExists(cfg, target))) {
    throw new Error(
      `Threads API: reply target ${target} no longer exists (deleted or expired). Skipping this reply.`
    )
  }
  try {
    return await publish(cfg, text, target)
  } catch (err) {
    const m = errText(err)
    // Surface the target id so the activity log is actionable.
    if (isMissingResourceError(err)) {
      throw new Error(
        `Threads API: could not publish reply to ${target} — ${m}. ` +
          'Often fixed by clearing a wrong User ID in Settings (leave blank) or waiting for the container to finish.'
      )
    }
    throw err
  }
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
  const me = myUsername.toLowerCase()
  if (!me) return false
  try {
    const data = await apiGet<{ data?: RawReply[] }>(cfg, `/${replyId}/replies`, {
      fields: 'id,username',
      limit: '50',
    })
    return (data.data ?? []).some((r) => (r.username ?? '').toLowerCase() === me)
  } catch {
    // If we cannot tell, assume unanswered — the UI de-dupes against local reply drafts.
    return false
  }
}

/** Replies on your own recent posts that you have not answered yet. */
async function fetchUnansweredPostReplies(cfg: ThreadsCfg): Promise<UnansweredReply[]> {
  const me = await apiGet<{ username?: string }>(cfg, '/me', { fields: 'id,username' })
  const myUsername = (typeof me.username === 'string' ? me.username : '').toLowerCase()
  const posts = await fetchMyPosts(cfg, 10)
  const out: UnansweredReply[] = []
  let probeBudget = ANSWER_PROBE_BUDGET
  // Sequential on purpose: parallel conversation fetches trip Meta rate limits.
  for (const post of posts) {
    const { items, topLevelOnly } = await fetchReplyMessages(cfg, post.id)
    const answeredIds = new Set<string>()
    for (const m of items) {
      const uname = (m.username ?? '').toLowerCase()
      if (uname && myUsername && uname === myUsername && typeof m.replied_to?.id === 'string') {
        answeredIds.add(m.replied_to.id)
      }
    }
    for (const m of items) {
      if (typeof m.id !== 'string' || !m.id) continue
      const uname = (m.username ?? '').toLowerCase()
      if (!uname || (myUsername && uname === myUsername)) continue
      if (answeredIds.has(m.id)) continue
      if (!topLevelOnly && m.replied_to?.id !== post.id) continue
      const text = typeof m.text === 'string' ? m.text : ''
      if (!text.trim()) continue
      // /conversation carries our answers inline; /replies does not, so probe.
      if (topLevelOnly && probeBudget > 0 && myUsername) {
        probeBudget--
        if (await isAnsweredByMe(cfg, m.id, myUsername)) continue
      }
      out.push({
        id: m.id,
        text,
        username: m.username!,
        timestamp: typeof m.timestamp === 'string' ? m.timestamp : '',
        rootPostId: post.id,
        rootPostText: post.text,
        kind: 'reply',
      })
    }
  }
  return out
}

/**
 * Public posts where another profile @mentioned you (Threads Mentions API).
 * Requires `threads_manage_mentions` on the access token. Returns [] if the
 * permission is missing or the call fails (so reply-only mode still works).
 */
export async function fetchUnansweredMentions(cfg: ThreadsCfg): Promise<UnansweredReply[]> {
  const me = await apiGet<{ id?: string; username?: string }>(cfg, '/me', { fields: 'id,username' })
  const myUsername = typeof me.username === 'string' ? me.username : ''
  const u = uid(cfg)
  let data: { data?: Array<Partial<RawReply> & { permalink?: string }> }
  try {
    data = await apiGet(cfg, `/${u}/mentions`, {
      fields: 'id,text,username,timestamp,permalink,is_reply,replied_to',
      limit: '25',
    })
  } catch (err) {
    // Common when the token was minted without threads_manage_mentions.
    console.warn(
      '[threads] mentions fetch failed (need threads_manage_mentions on the token?):',
      err instanceof Error ? err.message : err
    )
    return []
  }

  const out: UnansweredReply[] = []
  let probeBudget = ANSWER_PROBE_BUDGET
  for (const m of data.data ?? []) {
    if (typeof m.id !== 'string' || !m.id) continue
    const username = typeof m.username === 'string' ? m.username : ''
    if (!username || username === myUsername) continue
    const text = typeof m.text === 'string' ? m.text : ''
    if (!text.trim()) continue
    // Skip mentions we already answered under.
    if (probeBudget > 0) {
      probeBudget--
      if (await isAnsweredByMe(cfg, m.id, myUsername)) continue
    }
    out.push({
      id: m.id,
      text,
      username,
      timestamp: typeof m.timestamp === 'string' ? m.timestamp : '',
      // For mentions the media itself is the post to reply to.
      rootPostId: m.id,
      rootPostText: text,
      kind: 'mention',
    })
  }
  return out
}

/**
 * Unanswered engagement: replies on your posts + (optional) @mentions of you.
 * Mentions require `threads_manage_mentions`; failures degrade to replies only.
 */
export async function fetchUnansweredReplies(
  cfg: ThreadsCfg,
  opts?: { includeMentions?: boolean }
): Promise<UnansweredReply[]> {
  const includeMentions = opts?.includeMentions !== false
  const replies = await fetchUnansweredPostReplies(cfg)
  const mentions = includeMentions ? await fetchUnansweredMentions(cfg) : []
  const seen = new Set(replies.map((r) => r.id))
  const out = [...replies]
  for (const m of mentions) {
    if (seen.has(m.id)) continue
    seen.add(m.id)
    out.push(m)
  }
  const ts = (s: string): number => {
    const t = Date.parse(s)
    return Number.isNaN(t) ? 0 : t
  }
  out.sort((a, b) => ts(b.timestamp) - ts(a.timestamp))
  return out.slice(0, 50)
}
