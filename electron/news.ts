import type { NewsItem, NewsSourceSettings } from './types'

/**
 * Topic news over multiple lightweight public sources. Each source degrades to
 * [] on failure so one flaky feed cannot break the whole News view.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

const MAX_ITEMS = 30
const SOURCE_LIMIT = 15

export type NewsMode = 'news' | 'blogs'

export interface NewsFetchInput {
  query: string
  mode?: NewsMode
  sources?: NewsSourceSettings
}

function decodeEntities(s: string): string {
  // &amp; is decoded LAST so nested entities (e.g. "&amp;lt;") resolve correctly.
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function attrText(block: string, attr: string): string {
  const m = block.match(new RegExp(`${attr}=["']([^"']+)["']`, 'i'))
  return m ? decodeEntities(m[1].trim()) : ''
}

function tagText(block: string, tag: string): string {
  const m = block.match(
    new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`)
  )
  return m ? decodeEntities(m[1].trim()) : ''
}

function resolveUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''
  try {
    return new URL(trimmed).toString()
  } catch {
    return ''
  }
}

function googleSearchQuery(topic: string, mode: NewsMode): string {
  if (mode === 'blogs') return `${topic} blog OR newsletter OR magazine OR analysis`
  return topic
}

async function fetchGoogleNews(topic: string, mode: NewsMode): Promise<NewsItem[]> {
  const q = topic.trim()
  if (!q) return []
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const search = googleSearchQuery(q, mode)
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(search)}&hl=en-US&gl=US&ceid=US:en`
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

async function fetchYahooNews(topic: string, mode: NewsMode): Promise<NewsItem[]> {
  const q = topic.trim()
  if (!q) return []
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const search = googleSearchQuery(q, mode)
    const url = `https://news.search.yahoo.com/rss?p=${encodeURIComponent(search)}`
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal })
    if (!res.ok) return []
    // Body is consumed inside the same timeout window so a stalled stream cannot hang.
    const xml = await res.text()
    const items: NewsItem[] = []
    const seen = new Set<string>()
    const itemRe = /<item>([\s\S]*?)<\/item>/g
    let m: RegExpExecArray | null
    while ((m = itemRe.exec(xml)) !== null && items.length < SOURCE_LIMIT) {
      const block = m[1]
      const title = tagText(block, 'title')
      const link = resolveUrl(tagText(block, 'link'))
      if (!title || !link) continue
      const key = normalizeStoryUrl(link)
      if (seen.has(key)) continue
      seen.add(key)
      const pubDate = tagText(block, 'pubDate')
      const parsed = pubDate ? Date.parse(pubDate) : NaN
      items.push({
        title,
        link,
        source: tagText(block, 'source') || 'Yahoo News',
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

async function fetchNaverNews(topic: string): Promise<NewsItem[]> {
  const q = topic.trim()
  if (!q) return []
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const url = `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(q)}&sort=1`
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      signal: ctrl.signal,
    })
    if (!res.ok) return []
    const html = await res.text()
    const items: NewsItem[] = []
    const seen = new Set<string>()
    const re =
      /<a\b(?=[^>]*data-heatmap-target=["']\.tit["'])[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/g
    let m: RegExpExecArray | null
    while ((m = re.exec(html)) !== null && items.length < SOURCE_LIMIT) {
      const link = resolveUrl(m[1])
      const title = stripTags(m[2])
      if (!link || !title) continue
      const key = normalizeStoryUrl(link)
      if (seen.has(key)) continue
      seen.add(key)
      items.push({ title, link, source: 'Naver News', publishedAt: null, topic: q })
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

function shouldSearchHackerNews(topic: string, mode: NewsMode): boolean {
  if (mode !== 'news') return false
  const q = topic.toLowerCase()
  return [
    'ai',
    'artificial intelligence',
    'developer',
    'engineering',
    'hacker',
    'local llm',
    'machine learning',
    'open source',
    'programming',
    'software',
    'startup',
    'technology',
  ].some((term) => q.includes(term))
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

function sourceUrl(template: string, topic: string): string {
  const raw = template.includes('{query}')
    ? template.replace(/\{query\}/g, encodeURIComponent(topic))
    : template
  return resolveUrl(raw)
}

function parseFeed(xml: string, sourceName: string, topic: string): NewsItem[] {
  const items: NewsItem[] = []
  const seen = new Set<string>()
  const push = (title: string, link: string, publishedText: string) => {
    const cleanTitle = stripTags(title)
    const cleanLink = resolveUrl(stripTags(link))
    if (!cleanTitle || !cleanLink) return
    const key = normalizeStoryUrl(cleanLink)
    if (seen.has(key)) return
    seen.add(key)
    const parsed = publishedText ? Date.parse(stripTags(publishedText)) : NaN
    items.push({
      title: cleanTitle,
      link: cleanLink,
      source: sourceName,
      publishedAt: Number.isFinite(parsed) ? parsed : null,
      topic,
    })
  }

  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/g
  let m: RegExpExecArray | null
  while ((m = itemRe.exec(xml)) !== null && items.length < SOURCE_LIMIT) {
    const block = m[1]
    push(tagText(block, 'title'), tagText(block, 'link'), tagText(block, 'pubDate') || tagText(block, 'dc:date'))
  }

  const entryRe = /<entry\b[^>]*>([\s\S]*?)<\/entry>/g
  while ((m = entryRe.exec(xml)) !== null && items.length < SOURCE_LIMIT) {
    const block = m[1]
    const linkTag = block.match(/<link\b[^>]*>/i)?.[0] ?? ''
    push(tagText(block, 'title'), attrText(linkTag, 'href') || tagText(block, 'link'), tagText(block, 'updated') || tagText(block, 'published'))
  }
  return items
}

async function fetchCustomSource(source: NewsSourceSettings['custom'][number], topic: string): Promise<NewsItem[]> {
  if (!source.enabled) return []
  const url = sourceUrl(source.url, topic)
  if (!url) return []
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal })
    if (!res.ok) return []
    const xml = await res.text()
    return parseFeed(xml, source.name, topic)
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

function defaultSources(): NewsSourceSettings {
  return { google: true, yahoo: false, hackerNews: true, naver: false, custom: [] }
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

export async function fetchTopicNews(input: string | NewsFetchInput): Promise<NewsItem[]> {
  const q = (typeof input === 'string' ? input : input.query).trim()
  const mode: NewsMode = typeof input === 'string' || input.mode !== 'blogs' ? 'news' : 'blogs'
  const sources = typeof input === 'string' ? defaultSources() : input.sources ?? defaultSources()
  if (!q) return []
  const jobs: Promise<NewsItem[]>[] = []
  if (sources.google) jobs.push(fetchGoogleNews(q, mode))
  if (sources.yahoo) jobs.push(fetchYahooNews(q, mode))
  if (sources.hackerNews && shouldSearchHackerNews(q, mode)) jobs.push(fetchHackerNews(q))
  if (sources.naver) jobs.push(fetchNaverNews(q))
  for (const source of sources.custom.filter((s) => s.enabled)) jobs.push(fetchCustomSource(source, q))
  return mergeNews(await Promise.all(jobs))
}
