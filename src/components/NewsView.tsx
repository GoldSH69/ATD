import { useEffect, useState } from 'react'
import { useApp } from '../store/appStore'
import { shellText } from '../i18n'
import { timeAgo } from '../util/format'
import type { Draft, NewsItem } from '../types'

type NewsMode = 'news' | 'blogs'

interface NewsOption {
  id: string
  label: string
  query: string
  group: 'custom' | 'category'
}

const CATEGORY_OPTIONS: NewsOption[] = [
  { id: 'cat-ai', label: 'AI', query: 'artificial intelligence', group: 'category' },
  { id: 'cat-technology', label: 'Technology', query: 'technology', group: 'category' },
  { id: 'cat-startups', label: 'Startups', query: 'startups', group: 'category' },
  { id: 'cat-science', label: 'Science', query: 'science', group: 'category' },
  { id: 'cat-fashion', label: 'Fashion', query: 'fashion', group: 'category' },
  { id: 'cat-lifestyle', label: 'Lifestyle', query: 'lifestyle', group: 'category' },
  { id: 'cat-health', label: 'Health', query: 'health wellness', group: 'category' },
  { id: 'cat-finance', label: 'Finance', query: 'finance markets', group: 'category' },
  { id: 'cat-business', label: 'Business', query: 'business', group: 'category' },
  { id: 'cat-travel', label: 'Travel', query: 'travel', group: 'category' },
  { id: 'cat-food', label: 'Food', query: 'food restaurants', group: 'category' },
  { id: 'cat-beauty', label: 'Beauty', query: 'beauty skincare', group: 'category' },
  { id: 'cat-design', label: 'Design', query: 'design', group: 'category' },
  { id: 'cat-gaming', label: 'Gaming', query: 'gaming', group: 'category' },
  { id: 'cat-entertainment', label: 'Entertainment', query: 'entertainment', group: 'category' },
  { id: 'cat-sports', label: 'Sports', query: 'sports', group: 'category' },
]

export default function NewsView() {
  const settings = useApp((s) => s.settings)
  const setView = useApp((s) => s.setView)
  const upsertDraft = useApp((s) => s.upsertDraft)
  const selectDraft = useApp((s) => s.selectDraft)
  const toast = useApp((s) => s.toast)
  const text = shellText(settings?.language)

  const topics = settings?.topics ?? []
  const customOptions: NewsOption[] = topics.map((t) => ({
    id: `custom-${t.toLowerCase()}`,
    label: t,
    query: t,
    group: 'custom',
  }))
  const allOptions = [...customOptions, ...CATEGORY_OPTIONS]
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [mode, setMode] = useState<NewsMode>('news')
  // fall back to the first saved topic; otherwise use the first curated category.
  const pickedOption = allOptions.find((opt) => opt.id === pickedId) ?? allOptions[0] ?? null
  const topic = pickedOption?.query ?? null
  const topicLabel = pickedOption?.label ?? null

  const [items, setItems] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [generatingLink, setGeneratingLink] = useState<string | null>(null)

  useEffect(() => {
    if (!topic) return
    let stale = false
    setLoading(true)
    window.api
      .newsFetch({ query: topic, mode, sources: settings?.newsSources })
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
  }, [mode, topic, refreshKey, toast])

  const generateDraft = async (item: NewsItem) => {
    if (!topicLabel || generatingLink) return
    setGeneratingLink(item.link)
    try {
      const res = await window.api.generatePost({
        topic: topicLabel,
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
        topic: topicLabel,
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

  if (allOptions.length === 0) {
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
        <div className="view-sub">
          {mode === 'blogs' ? 'Google News RSS blog search' : 'Google News RSS + selective Hacker News'} · {topicLabel}
        </div>
        <div className="seg">
          <button className={mode === 'news' ? 'on' : ''} onClick={() => setMode('news')}>
            News
          </button>
          <button className={mode === 'blogs' ? 'on' : ''} onClick={() => setMode('blogs')}>
            Blogs
          </button>
        </div>
        {customOptions.length > 0 && (
          <div className="topic-group">
            <span className="topic-group-label">My topics</span>
            <div className="row">
              {customOptions.map((option) => (
                <button
                  key={option.id}
                  className={`chip selectable${option.id === pickedOption?.id ? ' on' : ''}`}
                  onClick={() => setPickedId(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="topic-group">
          <span className="topic-group-label">Categories</span>
          <div className="row">
            {CATEGORY_OPTIONS.map((option) => (
              <button
                key={option.id}
                className={`chip selectable${option.id === pickedOption?.id ? ' on' : ''}`}
                onClick={() => setPickedId(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
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
