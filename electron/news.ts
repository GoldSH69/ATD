import type { NewsItem } from './types'

/**
 * Topic news over Google News RSS, regex-parsed (no XML dependency).
 * Never throws — any network/parse failure degrades to [].
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

const MAX_ITEMS = 30

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

export async function fetchTopicNews(topic: string): Promise<NewsItem[]> {
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
