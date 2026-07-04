import type { NewsItem } from './types'

/**
 * Topic news over multiple lightweight public sources. Each source degrades to
 * [] on failure so one flaky feed cannot break the whole News view.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

const MAX_ITEMS = 30
const SOURCE_LIMIT = 15

function decodeEntities(s: string): string {
  // &amp; is decoded LAST so nested entities (e.g. "&amp;lt;") resolve correctly.
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function tagText(block: string, tag: string): string {
  const m = block.match(
    new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`)
  )
  return m ? decodeEntities(m[1].trim()) : ''
}

async function fetchGoogleNews(topic: string): Promise<NewsItem[]> {
  const q = topic.trim()
  if (!q) return []
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal })
    if (!res.ok) return []
    // Body is consumed inside the same timeout window so a stalled stream cannot hang.
    const xml = await res.text()
    const items: NewsItem[] = []
    const seen = new Set<string>()
    const itemRe = /<item>([\s\S]*?)<\/item>/g
    let m: RegExpExecArray | null
    while ((m = itemRe.exec(xml)) !== null && items.length < MAX_ITEMS) {
      const block = m[1]
      let title = tagText(block, 'title')
      if (!title) continue
      const source = tagText(block, 'source')
      // Google News appends ' - SourceName' to titles; strip only when it matches.
      if (source && title.toLowerCase().endsWith(` - ${source}`.toLowerCase())) {
        title = title.slice(0, title.length - source.length - 3).trim()
      }
      if (!title) continue
      const key = title.toLowerCase().replace(/\s+/g, ' ').trim()
      if (seen.has(key)) continue
      seen.add(key)
      const pubDate = tagText(block, 'pubDate')
      const parsed = pubDate ? Date.parse(pubDate) : NaN
      items.push({
        title,
        link: tagText(block, 'link'),
        source,
        publishedAt: Number.isFinite(parsed) ? parsed : null,
        topic: q,
      })
    }
    return items
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

function normalizeStoryUrl(url: string): string {
  try {
    const u = new URL(url)
    u.hash = ''
    if (u.hostname.startsWith('www.')) u.hostname = u.hostname.slice(4)
    return u.toString().replace(/\/$/, '')
  } catch {
    return url.trim()
  }
}

function titleKey(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim()
}

interface HackerNewsHit {
  title?: string
  story_title?: string
  url?: string
  story_url?: string
  objectID?: string
  created_at?: string
}

async function fetchHackerNews(topic: string): Promise<NewsItem[]> {
  const q = topic.trim()
  if (!q) return []
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const url =
      `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(q)}` +
      `&tags=story&hitsPerPage=${SOURCE_LIMIT}`
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal })
    if (!res.ok) return []
    const data = (await res.json()) as { hits?: HackerNewsHit[] }
    const items: NewsItem[] = []
    const seen = new Set<string>()
    for (const hit of data.hits ?? []) {
      const title = (hit.title || hit.story_title || '').trim()
      if (!title) continue
      const objectId = (hit.objectID || '').trim()
      const link = (hit.url || hit.story_url || (objectId ? `https://news.ycombinator.com/item?id=${objectId}` : '')).trim()
      if (!link) continue
      const key = normalizeStoryUrl(link)
      if (seen.has(key)) continue
      seen.add(key)
      const parsed = hit.created_at ? Date.parse(hit.created_at) : NaN
      items.push({
        title,
        link,
        source: 'Hacker News',
        publishedAt: Number.isFinite(parsed) ? parsed : null,
        topic: q,
      })
    }
    return items
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

function mergeNews(sources: NewsItem[][]): NewsItem[] {
  const out: NewsItem[] = []
  const seenUrls = new Set<string>()
  const seenTitles = new Set<string>()
  for (const item of sources.flat()) {
    const urlKey = normalizeStoryUrl(item.link)
    const tKey = titleKey(item.title)
    if ((urlKey && seenUrls.has(urlKey)) || (tKey && seenTitles.has(tKey))) continue
    if (urlKey) seenUrls.add(urlKey)
    if (tKey) seenTitles.add(tKey)
    out.push(item)
  }
  return out
    .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
    .slice(0, MAX_ITEMS)
}

export async function fetchTopicNews(topic: string): Promise<NewsItem[]> {
  const q = topic.trim()
  if (!q) return []
  const [google, hackerNews] = await Promise.all([fetchGoogleNews(q), fetchHackerNews(q)])
  return mergeNews([google, hackerNews])
}
