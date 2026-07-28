import { useEffect, useRef, useState } from 'react'
import { useApp } from '../store/appStore'
import { shellText } from '../i18n'
import type { Draft, ImageCandidate } from '../types'
import { fmtDateTime, snippet, timeAgo, toDatetimeLocal } from '../util/format'

const THREADS_CHAR_LIMIT = 500

type Busy = 'save' | 'schedule' | 'post' | null

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length
}

function DraftEditor({ draft }: { draft: Draft }) {
  const settings = useApp((s) => s.settings)
  const upsertDraft = useApp((s) => s.upsertDraft)
  const deleteDraft = useApp((s) => s.deleteDraft)
  const selectDraft = useApp((s) => s.selectDraft)
  const toast = useApp((s) => s.toast)
  const textUi = shellText(settings?.language)
  const [text, setText] = useState(draft.text)
  const [image, setImage] = useState<ImageCandidate | null>(
    draft.imageUrl
      ? {
          url: draft.imageUrl,
          thumbUrl: draft.imageThumbUrl || draft.imageUrl,
          title: draft.imageTitle || 'Selected image',
          source: 'Selected image',
          pageUrl: draft.imagePageUrl || draft.imageUrl,
        }
      : null
  )
  const [imageQuery, setImageQuery] = useState('')
  const [imageOptions, setImageOptions] = useState<ImageCandidate[]>([])
  const [imageBusy, setImageBusy] = useState(false)
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

  const imageDirty =
    (image?.url || '') !== (draft.imageUrl || '') ||
    (image?.thumbUrl || '') !== (draft.imageThumbUrl || '') ||
    (image?.title || '') !== (draft.imageTitle || '') ||
    (image?.pageUrl || '') !== (draft.imagePageUrl || '')
  const dirty = text !== draft.text || imageDirty
  const over = text.length > THREADS_CHAR_LIMIT
  const words = wordCount(text)
  const postsNeeded = Math.max(1, Math.ceil(text.length / THREADS_CHAR_LIMIT))
  const sourceUrl = draft.sourceUrl

  const withDraftEdits = (patch: Partial<Draft> = {}): Draft => ({
    ...draft,
    ...patch,
    text,
    imageUrl: image?.url,
    imageThumbUrl: image?.thumbUrl,
    imageTitle: image?.title,
    imagePageUrl: image?.pageUrl,
  })

  const save = async () => {
    setBusy('save')
    await upsertDraft(withDraftEdits())
    setBusy(null)
  }

  const searchImages = async (query: string) => {
    const q = query.trim()
    if (!q) return
    setImageBusy(true)
    setImageOptions([])
    try {
      setImageQuery(q)
      const res = await window.api.imageSearch(q)
      if (!res.ok) {
        toast('err', res.message)
        return
      }
      setImageOptions(res.images)
    } catch (err) {
      toast('err', err instanceof Error ? err.message : String(err))
    } finally {
      setImageBusy(false)
    }
  }

  const suggestImages = async () => {
    setImageBusy(true)
    setImageOptions([])
    try {
      const keywordRes = await window.api.imageKeywords({
        topic: draft.topic,
        title: draft.sourceTitle,
        text,
      })
      const query = keywordRes.ok ? keywordRes.text : draft.topic || draft.sourceTitle || text.slice(0, 80)
      await searchImages(query)
    } catch (err) {
      toast('err', err instanceof Error ? err.message : String(err))
    } finally {
      setImageBusy(false)
    }
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
    await upsertDraft(withDraftEdits({ status: 'scheduled', scheduledAt: ts }))
    setBusy(null)
    toast('ok', `Scheduled for ${fmtDateTime(ts)}`)
    selectDraft(null)
  }

  const postNow = async () => {
    setBusy('post')
    try {
      if (dirty) await upsertDraft(withDraftEdits())
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
      {draft.kind === 'post' && (
        <div className="editor-context">
          {sourceUrl && sourceUrl.startsWith('http') && !sourceUrl.includes('news.google.com') ? (
            <>
              📰 뉴스 출처: {draft.sourceTitle || '관련 기사'}
              {' · '}
              <button className="link" onClick={() => void window.api.openExternal(sourceUrl)}>
                기사 원문 열기 (open)
              </button>
            </>
          ) : (
            <>✨ AI 오리지널 지식/인사이트 포스트</>
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
      <div className="image-picker">
        <div className="row">
          <button className="btn small" disabled={imageBusy} onClick={() => void suggestImages()}>
            {imageBusy ? textUi.findingImages : textUi.findOptionalImage}
          </button>
          <input
            className="input grow"
            value={imageQuery}
            placeholder={textUi.imageKeywords}
            onChange={(e) => setImageQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void searchImages(imageQuery)
              }
            }}
          />
          <button className="btn small" disabled={imageBusy || !imageQuery.trim()} onClick={() => void searchImages(imageQuery)}>
            {textUi.searchImages}
          </button>
          {image && (
            <button className="btn ghost small" onClick={() => setImage(null)}>
              {textUi.removeImage}
            </button>
          )}
        </div>
        {image && (
          <div className="selected-image">
            <img src={image.thumbUrl} alt="" />
            <div>
              <div>{image.title}</div>
              <button className="link" onClick={() => void window.api.openExternal(image.pageUrl)}>
                {textUi.source}
              </button>
            </div>
          </div>
        )}
        {imageOptions.length > 0 && (
          <div className="image-grid">
            {imageOptions.map((candidate) => (
              <button
                key={candidate.url}
                className={`image-card${image?.url === candidate.url ? ' selected' : ''}`}
                onClick={() => setImage(candidate)}
              >
                <img src={candidate.thumbUrl} alt="" />
                <span>{candidate.title}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="editor-footer">
        <span className={`draft-metrics${over ? ' over' : ''}`}>
          {text.length} / {THREADS_CHAR_LIMIT} {textUi.chars} · {words} {words === 1 ? textUi.word : textUi.words} ·{' '}
          {postsNeeded} {postsNeeded === 1 ? textUi.post : textUi.posts}
        </span>
        <div className="grow" />
        <button className="btn" disabled={!dirty || busy !== null} onClick={() => void save()}>
          {busy === 'save' ? textUi.saving : textUi.save}
        </button>
        <button
          className="btn"
          disabled={!text.trim() || over || busy !== null}
          onClick={() => {
            const ts = scheduleAt ? new Date(scheduleAt).getTime() : Date.now() + 10 * 60 * 1000
            setBusy('schedule')
            void upsertDraft(withDraftEdits({ status: 'scheduled', scheduledAt: ts })).then(() => {
              setBusy(null)
              toast('ok', `📅 20분 주기 봇 예약 완료 (${fmtDateTime(ts)})`)
              selectDraft(null)
            })
          }}
        >
          📅 20분 봇 예약 등록
        </button>
        <button
          className="btn primary"
          disabled={!text.trim() || over || busy !== null}
          onClick={() => void postNow()}
        >
          🚀 지금 즉시 게시
        </button>
        <button
          className={`btn ${confirmDel ? 'danger' : 'ghost'}`}
          disabled={busy !== null}
          onClick={onDelete}
        >
          {confirmDel ? textUi.confirmDelete : textUi.delete}
        </button>

      </div>
    </div>
  )
}

export default function DraftsView() {
  const settings = useApp((s) => s.settings)
  const drafts = useApp((s) => s.drafts)
  const selectedDraftId = useApp((s) => s.selectedDraftId)
  const selectDraft = useApp((s) => s.selectDraft)
  const upsertDraft = useApp((s) => s.upsertDraft)
  const [creating, setCreating] = useState(false)
  const textUi = shellText(settings?.language)

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
        <div className="view-title">{textUi.drafts}</div>
        <div className="view-sub">
          {list.length} {list.length === 1 ? textUi.drafts.toLowerCase() : textUi.drafts.toLowerCase()}
          {failedCount > 0 && ` · ${failedCount} ${textUi.failed}`}
        </div>
        <div className="view-actions">
          <button className="btn small" disabled={creating} onClick={() => void newDraft()}>
            {textUi.newDraft}
          </button>
        </div>
      </div>
      <div className="view-body no-pad">
        <div className="split">
          <div className="pane-list">
            {list.length === 0 ? (
              <div className="empty">
                <div>{textUi.noDrafts}</div>
                <button className="btn" disabled={creating} onClick={() => void newDraft()}>
                  {textUi.newDraft}
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
                    {d.kind === 'reply' && <span className="badge">{textUi.replies}</span>}
                    {d.status === 'failed' && <span className="badge failed">{textUi.failed}</span>}
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
              <div className="empty">{textUi.selectDraft}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
