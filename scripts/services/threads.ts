export interface ThreadsConfig {
  accessToken: string
  userId: string
}

export interface UnansweredReply {
  id: string
  text: string
  username: string
  timestamp: string
  rootPostId: string
  rootPostText: string
  kind?: 'reply' | 'mention'
}

const BASE = 'https://graph.threads.net/v1.0'
const TIMEOUT_MS = 15000

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function apiFetch<T>(
  cfg: ThreadsConfig,
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
      const apiErr = (json as { error?: { message?: string } } | null)?.error
      throw new Error(`Threads API (${res.status}): ${apiErr?.message || body}`)
    }
    return json as T
  } finally {
    clearTimeout(timer)
  }
}

export async function publishPost(
  cfg: ThreadsConfig,
  text: string,
  imageUrl?: string
): Promise<{ id: string; permalink?: string }> {
  const userPath = cfg.userId.trim() && /^\d+$/.test(cfg.userId.trim()) ? cfg.userId.trim() : 'me'
  const createParams: Record<string, string> = imageUrl
    ? { media_type: 'IMAGE', image_url: imageUrl, text }
    : { media_type: 'TEXT', text }

  const created = await apiFetch<{ id: string }>(cfg, 'POST', `/${userPath}/threads`, createParams)
  if (!created.id) throw new Error('Threads API: Creation step returned no ID')

  // Wait 3 seconds cleanly for container processing
  await delay(3000)

  let published: { id: string } | null = null
  try {
    published = await apiFetch<{ id: string }>(cfg, 'POST', `/${userPath}/threads_publish`, {
      creation_id: created.id,
    })
  } catch (err) {
    console.error('Single publish attempt failed:', err)
    throw err
  }

  const mediaId = published?.id || created.id
  let permalink: string | undefined
  try {
    const media = await apiFetch<{ permalink?: string }>(cfg, 'GET', `/${mediaId}`, { fields: 'permalink' })
    permalink = media.permalink
  } catch {
    // Ignore
  }

  return { id: mediaId, permalink }
}

export async function replyToThread(
  cfg: ThreadsConfig,
  replyToId: string,
  text: string
): Promise<{ id: string; permalink?: string }> {
  return publishReply(cfg, text, replyToId)
}

export async function publishReply(
  cfg: ThreadsConfig,
  text: string,
  replyToId: string
): Promise<{ id: string; permalink?: string }> {
  const userPath = cfg.userId.trim() && /^\d+$/.test(cfg.userId.trim()) ? cfg.userId.trim() : 'me'
  const createParams: Record<string, string> = { media_type: 'TEXT', text, reply_to_id: replyToId }

  const created = await apiFetch<{ id: string }>(cfg, 'POST', `/${userPath}/threads`, createParams)
  if (!created.id) throw new Error('Threads API: Reply creation returned no ID')

  await delay(3000)

  const published = await apiFetch<{ id: string }>(cfg, 'POST', `/${userPath}/threads_publish`, {
    creation_id: created.id,
  })

  return { id: published?.id || created.id }
}

export async function getUnansweredReplies(cfg: ThreadsConfig): Promise<UnansweredReply[]> {
  return fetchUnansweredReplies(cfg)
}

export async function fetchUnansweredReplies(cfg: ThreadsConfig): Promise<UnansweredReply[]> {
  try {
    const res = await apiFetch<{
      data?: Array<{
        id: string
        text?: string
        username?: string
        timestamp?: string
      }>
    }>(cfg, 'GET', '/me/threads', { fields: 'id,text,username,timestamp' })

    const list: UnansweredReply[] = []
    if (res.data) {
      for (const item of res.data) {
        if (item.text && item.id) {
          // sample placeholder
        }
      }
    }
    return list
  } catch {
    return []
  }
}
