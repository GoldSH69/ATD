import { useEffect, useState } from 'react'
import { useApp } from '../store/appStore'
import { shellText } from '../i18n'
import { timeAgo } from '../util/format'
import type { Draft, NewsItem } from '../types'

export default function NewsView() {
  const settings = useApp((s) => s.settings)
  const setView = useApp((s) => s.setView)
  const upsertDraft = useApp((s) => s.upsertDraft)
  const selectDraft = useApp((s) => s.selectDraft)
  const toast = useApp((s) => s.toast)
  const text = shellText(settings?.language)

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
      toast('ok', `${text.drafts}: ${text.generateDraft}`)
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
          <div className="view-title">{text.news}</div>
        </div>
        <div className="view-body no-pad">
          <div className="empty">
            <div>{text.noTopics}</div>
            <button className="btn" onClick={() => setView('settings')}>
              {text.openSettings}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="view">
      <div className="view-header">
        <div className="view-title">{text.news}</div>
        <div className="view-sub">Google News + Hacker News · {topic}</div>
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
            {loading ? text.loading : text.refresh}
          </button>
        </div>
      </div>
      <div className="view-body no-pad">
        {loading ? (
          <div className="empty">{text.loadingNews}</div>
        ) : items.length === 0 ? (
          <div className="empty">{text.noNews}</div>
        ) : (
          <div className="news-table" role="table" aria-label="News">
            <div className="news-table-head" role="row">
              <span role="columnheader">Headline</span>
              <span role="columnheader">Source</span>
              <span role="columnheader">Age</span>
              <span role="columnheader">Actions</span>
            </div>
            {items.map((item, i) => (
              <div key={`${i}-${item.link}`} className="news-row" role="row">
                <div className="news-title" role="cell" title={item.title}>
                  {item.title}
                </div>
                <div className="news-source" role="cell" title={item.source}>
                  {item.source}
                </div>
                <div className="news-age" role="cell">
                  {item.publishedAt != null ? timeAgo(item.publishedAt) : ''}
                </div>
                <div className="news-actions" role="cell">
                  <button className="link" onClick={() => void window.api.openExternal(item.link)}>
                    {text.open}
                  </button>
                  <button
                    className="btn small"
                    disabled={generatingLink !== null}
                    onClick={() => void generateDraft(item)}
                  >
                    {generatingLink === item.link ? text.generating : text.generateDraft}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
