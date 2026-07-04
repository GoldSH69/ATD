import { useEffect, useRef, useState } from 'react'
import { useApp } from '../store/appStore'
import type { Draft } from '../types'
import { fmtDateTime, snippet, timeAgo, toDatetimeLocal } from '../util/format'

const THREADS_CHAR_LIMIT = 500

type Busy = 'save' | 'schedule' | 'post' | null

function DraftEditor({ draft }: { draft: Draft }) {
  const upsertDraft = useApp((s) => s.upsertDraft)
  const deleteDraft = useApp((s) => s.deleteDraft)
  const selectDraft = useApp((s) => s.selectDraft)
  const toast = useApp((s) => s.toast)
  const [text, setText] = useState(draft.text)
  const [scheduleAt, setScheduleAt] = useState(() => toDatetimeLocal(Date.now() + 3600000))
  const [busy, setBusy] = useState<Busy>(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const delTimer = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (delTimer.current !== null) window.clearTimeout(delTimer.current)
    },
    [],
  )

  const dirty = text !== draft.text
  const over = text.length > THREADS_CHAR_LIMIT
  const sourceUrl = draft.sourceUrl

  const save = async () => {
    setBusy('save')
    await upsertDraft({ ...draft, text })
    setBusy(null)
  }

  const schedule = async () => {
    if (!text.trim()) {
      toast('err', 'Write something before scheduling')
      return
    }
    if (over) {
      toast('err', `Trim to ${THREADS_CHAR_LIMIT} characters before scheduling`)
      return
    }
    const ts = new Date(scheduleAt).getTime()
    if (!scheduleAt || Number.isNaN(ts)) {
      toast('err', 'Enter a valid schedule time')
      return
    }
    if (ts <= Date.now()) {
      toast('err', 'Schedule time must be in the future')
      return
    }
    setBusy('schedule')
    await upsertDraft({ ...draft, text, status: 'scheduled', scheduledAt: ts })
    setBusy(null)
    toast('ok', `Scheduled for ${fmtDateTime(ts)}`)
    selectDraft(null)
  }

  const postNow = async () => {
    setBusy('post')
    try {
      if (dirty) await upsertDraft({ ...draft, text })
      const res = await window.api.draftPostNow(draft.id)
      toast(res.ok ? 'ok' : 'err', res.message)
      if (res.ok) selectDraft(null)
    } catch (err) {
      toast('err', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const onDelete = () => {
    if (!confirmDel) {
      setConfirmDel(true)
      delTimer.current = window.setTimeout(() => setConfirmDel(false), 4000)
      return
    }
    if (delTimer.current !== null) window.clearTimeout(delTimer.current)
    void deleteDraft(draft.id)
  }

  return (
    <div className="editor-pane">
      {draft.kind === 'reply' && (
        <div className="editor-context">
          {`Replying to @${draft.replyToUsername ?? ''}: "${snippet(draft.replyToText ?? '', 140)}"`}
        </div>
      )}
      {draft.kind === 'post' && draft.sourceTitle && (
        <div className="editor-context">
          From news: {draft.sourceTitle}
          {sourceUrl && (
            <>
              {' · '}
              <button className="link" onClick={() => void window.api.openExternal(sourceUrl)}>
                open
              </button>
            </>
          )}
        </div>
      )}
      {draft.status === 'failed' && draft.error && (
        <div className="test-result err" style={{ margin: '10px 20px 0' }}>
          {draft.error}
        </div>
      )}
      <textarea
        className="editor-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Write your post…"
        autoFocus
      />
      <div className="editor-footer">
        <span className={`char-count${over ? ' over' : ''}`}>
          {text.length} / {THREADS_CHAR_LIMIT}
        </span>
        <div className="grow" />
        <button className="btn" disabled={!dirty || busy !== null} onClick={() => void save()}>
          {busy === 'save' ? 'Saving…' : 'Save'}
        </button>
        <input
          type="datetime-local"
          className="input"
          style={{ width: 'auto' }}
          value={scheduleAt}
          onChange={(e) => setScheduleAt(e.target.value)}
        />
        <button
          className="btn"
          disabled={!text.trim() || over || busy !== null}
          onClick={() => void schedule()}
        >
          {busy === 'schedule' ? 'Scheduling…' : 'Schedule'}
        </button>
        <button
          className="btn primary"
          disabled={!text.trim() || over || busy !== null}
          onClick={() => void postNow()}
        >
          {busy === 'post' ? 'Posting…' : 'Post now'}
        </button>
        <button
          className={`btn ${confirmDel ? 'danger' : 'ghost'}`}
          disabled={busy !== null}
          onClick={onDelete}
        >
          {confirmDel ? 'Confirm delete?' : 'Delete'}
        </button>
      </div>
    </div>
  )
}

export default function DraftsView() {
  const drafts = useApp((s) => s.drafts)
  const selectedDraftId = useApp((s) => s.selectedDraftId)
  const selectDraft = useApp((s) => s.selectDraft)
  const upsertDraft = useApp((s) => s.upsertDraft)
  const [creating, setCreating] = useState(false)

  const list = drafts
    .filter((d) => d.status === 'draft' || d.status === 'failed')
    .sort((a, b) => b.updatedAt - a.updatedAt)
  const failedCount = list.filter((d) => d.status === 'failed').length
  const selected = list.find((d) => d.id === selectedDraftId) ?? null

  const newDraft = async () => {
    if (creating) return // guard against a double-click creating two empty drafts
    setCreating(true)
    try {
      const now = Date.now()
      const draft: Draft = {
        id: crypto.randomUUID(),
        kind: 'post',
        text: '',
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      }
      await upsertDraft(draft)
      selectDraft(draft.id)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="view">
      <div className="view-header">
        <div className="view-title">Drafts</div>
        <div className="view-sub">
          {list.length} {list.length === 1 ? 'draft' : 'drafts'}
          {failedCount > 0 && ` · ${failedCount} failed`}
        </div>
        <div className="view-actions">
          <button className="btn small" disabled={creating} onClick={() => void newDraft()}>
            New draft
          </button>
        </div>
      </div>
      <div className="view-body no-pad">
        <div className="split">
          <div className="pane-list">
            {list.length === 0 ? (
              <div className="empty">
                <div>No drafts yet. Generate from News, answer Replies, or start one from scratch.</div>
                <button className="btn" disabled={creating} onClick={() => void newDraft()}>
                  New draft
                </button>
              </div>
            ) : (
              list.map((d) => (
                <button
                  key={d.id}
                  className={`list-item${d.id === selectedDraftId ? ' selected' : ''}`}
                  onClick={() => selectDraft(d.id)}
                >
                  <div className="item-title">
                    <span>{snippet(d.text || '(empty)', 60)}</span>
                    {d.kind === 'reply' && <span className="badge">reply</span>}
                    {d.status === 'failed' && <span className="badge failed">failed</span>}
                  </div>
                  <div className="item-meta">
                    <span>
                      {d.kind === 'reply' && d.replyToUsername
                        ? `reply to @${d.replyToUsername}`
                        : d.topic ?? ''}
                    </span>
                    <span>{timeAgo(d.updatedAt)}</span>
                  </div>
                  {d.status === 'failed' && d.error && <div className="item-snippet">{d.error}</div>}
                </button>
              ))
            )}
          </div>
          <div className="pane-detail">
            {selected ? (
              <DraftEditor key={selected.id} draft={selected} />
            ) : (
              <div className="empty">Select a draft to review</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
