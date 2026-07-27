import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../store/appStore'
import { shellText } from '../i18n'
import type { Draft, UnansweredReply } from '../types'
import { snippet, timeAgo } from '../util/format'

export default function RepliesView() {
  const drafts = useApp((s) => s.drafts)
  const settings = useApp((s) => s.settings)
  const setView = useApp((s) => s.setView)
  const selectDraft = useApp((s) => s.selectDraft)
  const upsertDraft = useApp((s) => s.upsertDraft)
  const toast = useApp((s) => s.toast)
  const text = shellText(settings?.language)

  const [replies, setReplies] = useState<UnansweredReply[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.api.unansweredReplies()
      if (res.ok) {
        setReplies(res.replies)
      } else {
        setReplies(null)
        setError(res.message)
      }
    } catch (err) {
      setReplies(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const draftFor = (r: UnansweredReply): Draft | undefined =>
    drafts.find((d) => d.kind === 'reply' && d.replyToId === r.id)

  const generate = async (r: UnansweredReply) => {
    setBusyId(r.id)
    try {
      const res = await window.api.generateReply({
        replyText: r.text,
        replyUsername: r.username,
        rootPostText: r.rootPostText,
        kind: r.kind === 'mention' ? 'mention' : 'reply',
      })
      if (!res.ok) {
        toast('err', res.message)
        return
      }
      const now = Date.now()
      const draft: Draft = {
        id: crypto.randomUUID(),
        kind: 'reply',
        text: res.text,
        replyToId: r.id,
        replyToText: r.text,
        replyToUsername: r.username,
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      }
      await upsertDraft(draft)
      selectDraft(draft.id)
      toast('ok', text.draftReply)
    } catch (err) {
      toast('err', err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  // Drafts view only lists 'draft'/'failed'; scheduled/posting/posted live in Queue.
  const inDrafts = (d: Draft): boolean => d.status === 'draft' || d.status === 'failed'
  const goToDraft = (existing: Draft) => {
    selectDraft(existing.id)
    setView(inDrafts(existing) ? 'drafts' : 'queue')
  }
  const existingLabel = (d: Draft): string =>
    d.status === 'posted' ? text.posted : inDrafts(d) ? text.drafts : text.queue

  return (
    <div className="view">
      <div className="view-header">
        <span className="view-title">{text.replies}</span>
        <span className="view-sub">{text.repliesSubtitle}</span>
        <div className="view-actions">
          <button className="btn" disabled={loading} onClick={() => void load()}>
            {loading ? text.refreshing : text.refresh}
          </button>
        </div>
      </div>
      <div className="view-body no-pad stack-list">
        {loading ? (
          <div className="empty">{text.checkingThreads}</div>
        ) : error ? (
          <div className="empty">
            {error}
            {/configur/i.test(error) && (
              <div>
                <button className="btn" onClick={() => setView('settings')}>
                  {text.openSettings}
                </button>
              </div>
            )}
          </div>
        ) : !replies || replies.length === 0 ? (
          <div className="empty">{text.allCaughtUp}</div>
        ) : (
          replies.map((r) => {
            const existing = draftFor(r)
            return (
              <div className="list-item" key={r.id}>
                <div className="item-title">
                  <span>@{r.username}</span>
                  {r.kind === 'mention' && <span className="badge">mention</span>}
                  <span className="item-meta">{timeAgo(Date.parse(r.timestamp))}</span>
                </div>
                <div className="item-snippet">{r.text}</div>
                <div className="item-meta">
                  {r.kind === 'mention' ? 'mentioned you' : `on: ${snippet(r.rootPostText, 90)}`}
                </div>
                <div className="item-meta">
                  {existing ? (
                    <>
                      <span className="badge">{existingLabel(existing)}</span>
                      <button className="link" onClick={() => goToDraft(existing)}>
                        {inDrafts(existing) ? text.viewDraft : text.viewQueue}
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn small"
                      disabled={busyId === r.id}
                      onClick={() => void generate(r)}
                    >
                      {busyId === r.id ? text.generating : text.draftReply}
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
