import { useState } from 'react'
import { useApp } from '../store/appStore'
import type { Draft } from '../types'
import { fmtDateTime, snippet, timeAgo } from '../util/format'

const rank = (s: Draft['status']) => (s === 'scheduled' ? 0 : s === 'posting' ? 1 : 2)

export default function QueueView() {
  const drafts = useApp((s) => s.drafts)
  const upsertDraft = useApp((s) => s.upsertDraft)
  const deleteDraft = useApp((s) => s.deleteDraft)
  const toast = useApp((s) => s.toast)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const items = drafts
    .filter((d) => d.status === 'scheduled' || d.status === 'posting' || d.status === 'posted')
    .sort((a, b) =>
      a.status !== b.status
        ? rank(a.status) - rank(b.status)
        : a.status === 'scheduled'
          ? (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0)
          : a.status === 'posted'
            ? (b.postedAt ?? 0) - (a.postedAt ?? 0)
            : 0,
    )

  const postNow = async (id: string) => {
    setBusyId(id)
    try {
      const res = await window.api.draftPostNow(id)
      toast(res.ok ? 'ok' : 'err', res.message)
    } catch (err) {
      toast('err', err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  const unschedule = async (d: Draft) => {
    await upsertDraft({ ...d, status: 'draft', scheduledAt: undefined })
    toast('ok', 'Moved back to drafts')
  }

  const removePosted = async (id: string) => {
    if (confirmId !== id) {
      setConfirmId(id)
      return
    }
    setConfirmId(null)
    await deleteDraft(id)
  }

  return (
    <div className="view">
      <div className="view-header">
        <span className="view-title">Queue</span>
        <span className="view-sub">Scheduled and published posts</span>
      </div>
      <div className="view-body no-pad">
        {items.length === 0 ? (
          <div className="empty">Nothing queued. Schedule a draft from the Drafts view.</div>
        ) : (
          items.map((d) => {
            const permalink = d.permalink
            return (
              <div key={d.id} className="list-item">
                <div className="item-title">
                  <span>{snippet(d.text, 70)}</span>
                  <span className={`badge ${d.status}`}>{d.status}</span>
                </div>
                <div className="item-meta">
                  {d.kind === 'reply' && d.replyToUsername && <span>reply to @{d.replyToUsername}</span>}
                  {d.status === 'scheduled' && <span>posts {fmtDateTime(d.scheduledAt)}</span>}
                  {d.status === 'posted' && <span>posted {timeAgo(d.postedAt)}</span>}
                  {d.topic && <span>{d.topic}</span>}
                </div>
                <div className="row" style={{ marginTop: 6 }}>
                  {d.status === 'scheduled' && (
                    <>
                      <button
                        className="btn small"
                        disabled={busyId === d.id}
                        onClick={() => void postNow(d.id)}
                      >
                        {busyId === d.id ? 'Posting…' : 'Post now'}
                      </button>
                      <button
                        className="btn ghost small"
                        disabled={busyId === d.id}
                        onClick={() => void unschedule(d)}
                      >
                        Unschedule
                      </button>
                    </>
                  )}
                  {d.status === 'posting' && <span className="muted">publishing…</span>}
                  {d.status === 'posted' && (
                    <>
                      {permalink && (
                        <button className="link" onClick={() => void window.api.openExternal(permalink)}>
                          open ↗
                        </button>
                      )}
                      <button
                        className={confirmId === d.id ? 'btn danger small' : 'btn ghost small'}
                        onClick={() => void removePosted(d.id)}
                      >
                        {confirmId === d.id ? 'Confirm remove' : 'Remove'}
                      </button>
                    </>
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
