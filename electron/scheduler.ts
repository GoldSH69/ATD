import { db } from './localdb'
import { getSettings } from './settings'
import { allDrafts, updateDraft } from './drafts'
import { publishPost, publishReply } from './threadsApi'
import { runAutoDraft } from './pipeline'

const TICK_MS = 15_000
const FIRST_TICK_MS = 5_000
const LAST_RUN_KEY = 'autoDraftLastRun'
const MAX_CHARS = 500
/** Failed drafts (post or reply) are retried after this delay. */
const FAILED_RETRY_MS = 60_000

let started = false
// Posting and auto-drafting have independent guards so a slow auto-draft run
// (a local model can take minutes) never delays a due scheduled post.
let postingInFlight = false
let autoDraftInFlight = false

export function startScheduler(): void {
  if (started) return
  started = true
  void recoverInterrupted()
  setTimeout(() => tickAll(), FIRST_TICK_MS)
  setInterval(() => tickAll(), TICK_MS)
}

function tickAll(): void {
  void tickPosting()
  void tickAutoDraft()
}

/** A draft stuck in 'posting' means the app died mid-publish. It may or may not
 *  have reached Threads, so warn rather than silently inviting a duplicate. */
async function recoverInterrupted(): Promise<void> {
  try {
    for (const d of allDrafts()) {
      if (d.status === 'posting') {
        await updateDraft(d.id, {
          status: 'failed',
          error:
            'Interrupted while publishing — this post may already be live on Threads. Check your profile before retrying.',
        })
      }
    }
  } catch (err) {
    console.error('[scheduler] recovery failed', err)
  }
}

function isRetryableFailed(d: { status: string; updatedAt?: number; error?: string }): boolean {
  if (d.status !== 'failed') return false
  const updated = typeof d.updatedAt === 'number' ? d.updatedAt : 0
  if (Date.now() - updated < FAILED_RETRY_MS) return false
  // Permanent validation errors — don't spin forever.
  const err = (d.error ?? '').toLowerCase()
  if (/empty|exceeds the \d+-character|missing the post/i.test(err)) return false
  return true
}

async function tickPosting(): Promise<void> {
  if (postingInFlight) return
  postingInFlight = true
  try {
    const due = allDrafts().filter(isDue)
    const retries = allDrafts().filter(isRetryableFailed)
    const queue = [...due, ...retries]
    for (const d of queue) {
      // Re-check against the live cache: the user may have unscheduled or edited
      // this draft while an earlier publish in this loop was awaiting.
      const cur = allDrafts().find((x) => x.id === d.id)
      if (!cur) continue
      if (cur.status === 'scheduled' && !isDue(cur)) continue
      if (cur.status === 'failed' && !isRetryableFailed(cur)) continue
      if (cur.status !== 'scheduled' && cur.status !== 'failed') continue
      const res = await postDraftNow(d.id)
      if (!res.ok) console.error(`[scheduler] publish ${d.id} failed: ${res.message}`)
    }
  } catch (err) {
    console.error('[scheduler] posting tick failed', err)
  } finally {
    postingInFlight = false
  }
}

async function tickAutoDraft(): Promise<void> {
  if (autoDraftInFlight) return
  const settings = getSettings()
  if (!settings.autoDraft.enabled) return
  const lastRun = db.get<number>(LAST_RUN_KEY) ?? 0
  if (Date.now() - lastRun < settings.autoDraft.intervalMinutes * 60_000) return
  autoDraftInFlight = true
  try {
    // Stamp before running so a failing run waits a full interval instead of hot-looping.
    await db.set(LAST_RUN_KEY, Date.now())
    await runAutoDraft()
  } catch (err) {
    console.error('[scheduler] auto-draft tick failed', err)
  } finally {
    autoDraftInFlight = false
  }
}

function isDue(d: { status: string; scheduledAt?: number }): boolean {
  return d.status === 'scheduled' && typeof d.scheduledAt === 'number' && d.scheduledAt <= Date.now()
}

async function failDraft(id: string, message: string): Promise<{ ok: boolean; message: string }> {
  try {
    await updateDraft(id, { status: 'failed', error: message })
  } catch (err) {
    console.error(`[scheduler] could not persist failed status for ${id}`, err)
  }
  return { ok: false, message }
}

export async function postDraftNow(id: string): Promise<{ ok: boolean; message: string }> {
  const draft = allDrafts().find((d) => d.id === id)
  if (!draft) return { ok: false, message: 'Draft not found' }
  if (draft.status === 'posting') return { ok: false, message: 'Already posting' }
  if (draft.status === 'posted') return { ok: false, message: 'Already posted' }
  const text = typeof draft.text === 'string' ? draft.text.trim() : ''
  // Fail (not plain-return) so an empty or over-limit *scheduled* draft stops
  // being retried every tick and surfaces to the user instead.
  if (!text) return failDraft(id, 'Draft text is empty')
  if (text.length > MAX_CHARS) return failDraft(id, `Draft exceeds the ${MAX_CHARS}-character limit`)
  if (draft.kind === 'reply' && !draft.replyToId) {
    return failDraft(id, 'Reply draft is missing the post it replies to')
  }
  const { accessToken, userId } = getSettings().threads
  if (!accessToken) {
    return failDraft(id, 'Threads API is not configured — save credentials in Settings first.')
  }
  try {
    await updateDraft(id, { status: 'posting', error: undefined })
    const cfg = { accessToken, userId }
    const res =
      draft.kind === 'reply'
        ? await publishReply(cfg, text, draft.replyToId!)
        : await publishPost(cfg, text, draft.imageUrl)
    try {
      await updateDraft(id, {
        status: 'posted',
        postedAt: Date.now(),
        threadsMediaId: res.id,
        permalink: res.permalink,
        error: undefined,
      })
    } catch (err) {
      // Publish succeeded; report ok even if the status write failed, or a retry would double-post.
      console.error(`[scheduler] posted ${id} but could not persist status`, err)
    }
    return { ok: true, message: 'Posted to Threads' }
  } catch (err) {
    return failDraft(id, err instanceof Error ? err.message : String(err))
  }
}
