export interface NewsItem {
  title: string
  link: string
  source: string
  publishedAt: number | null
  topic: string
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

function decodeEntities(s: string): string {
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

export async function fetchGoogleNews(topic: string): Promise<NewsItem[]> {
  const q = topic.trim()
  if (!q) return []
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ko&gl=KR&ceid=KR:ko`
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal })
    if (!res.ok) return []
    const xml = await res.text()
    const items: NewsItem[] = []
    const seen = new Set<string>()
    const itemRe = /<item>([\s\S]*?)<\/item>/g
    let m: RegExpExecArray | null
    while ((m = itemRe.exec(xml)) !== null && items.length < 15) {
      const block = m[1]
      let title = tagText(block, 'title')
      if (!title) continue
      const source = tagText(block, 'source') || 'Google News'
      const pubDate = tagText(block, 'pubDate')
      const parsed = pubDate ? Date.parse(pubDate) : NaN
      items.push({
        title,
        link: tagText(block, 'link'),
        source,
        publishedAt: Number.isFinite(parsed) ? parsed : null,
        topic,
      })
    }
    return items
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}
