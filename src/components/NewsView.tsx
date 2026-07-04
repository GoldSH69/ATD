import { useEffect, useState } from 'react'
import { useApp } from '../store/appStore'
import { timeAgo } from '../util/format'
import type { Draft, NewsItem } from '../types'

export default function NewsView() {
  const settings = useApp((s) => s.settings)
  const setView = useApp((s) => s.setView)
  const upsertDraft = useApp((s) => s.upsertDraft)
  const selectDraft = useApp((s) => s.selectDraft)
  const toast = useApp((s) => s.toast)

  const topics = settings?.topics ?? []
  const [picked, setPicked] = useState<string | null>(null)
  // fall back to the first topic when nothing picked or the pick was removed in settings
  const topic = picked && topics.includes(picked) ? picked : topics[0] ?? null

  const [items, setItems] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [generatingLink, setGeneratingLink] = useState<string | null>(null)

  useEffect(() => {
    if (!topic) return
    let stale = false
    setLoading(true)
    window.api
      .newsFetch(topic)
      .then((news) => {
        if (!stale) setItems(news)
      })
      .catch((err: unknown) => {
        if (stale) return
        setItems([])
        toast('err', `Failed to load news: ${err instanceof Error ? err.message : String(err)}`)
      })
      .finally(() => {
        if (!stale) setLoading(false)
      })
    return () => {
      stale = true
    }
  }, [topic, refreshKey, toast])

  const generateDraft = async (item: NewsItem) => {
    if (!topic || generatingLink) return
    setGeneratingLink(item.link)
    try {
      const res = await window.api.generatePost({
        topic,
        newsTitle: item.title,
        newsSource: item.source,
        newsUrl: item.link,
      })
      if (!res.ok) {
        toast('err', res.message)
        return
      }
      const now = Date.now()
      const draft: Draft = {
        id: crypto.randomUUID(),
        kind: 'post',
        text: res.text,
        topic,
        sourceTitle: item.title,
        sourceUrl: item.link,
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      }
      await upsertDraft(draft)
      selectDraft(draft.id)
      toast('ok', 'Draft created — review it in Drafts')
    } catch (err) {
      toast('err', `Failed to generate draft: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setGeneratingLink(null)
    }
  }

  if (topics.length === 0) {
    return (
      <div className="view">
        <div className="view-header">
          <div className="view-title">News</div>
        </div>
        <div className="view-body no-pad">
          <div className="empty">
            <div>No topics configured</div>
            <button className="btn" onClick={() => setView('settings')}>
              Open Settings
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="view">
      <div className="view-header">
        <div className="view-title">News</div>
        <div className="view-sub">Google News · {topic}</div>
        <div className="row">
          {topics.map((t) => (
            <button
              key={t}
              className={`chip selectable${t === topic ? ' on' : ''}`}
              onClick={() => setPicked(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="view-actions">
          <button className="btn" onClick={() => setRefreshKey((k) => k + 1)} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>
      <div className="view-body no-pad">
        {loading ? (
          <div className="empty">Loading news…</div>
        ) : items.length === 0 ? (
          <div className="empty">No news found for this topic.</div>
        ) : (
          items.map((item, i) => (
            <div key={`${i}-${item.link}`} className="list-item" style={{ cursor: 'default' }}>
              <div className="item-title">
                <span>{item.title}</span>
              </div>
              <div className="item-meta">
                <span>{item.source}</span>
                {item.publishedAt != null && <span>{timeAgo(item.publishedAt)}</span>}
                <button className="link" onClick={() => void window.api.openExternal(item.link)}>
                  open ↗
                </button>
                <button
                  className="btn small"
                  disabled={generatingLink !== null}
                  onClick={() => void generateDraft(item)}
                >
                  {generatingLink === item.link ? 'Generating…' : 'Generate draft'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
