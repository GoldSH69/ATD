import { getSettings } from './settings'
import { generateText } from './llm'
import type { GenerateResult, ImageCandidate } from './types'

const TIMEOUT_MS = 12_000

const asObj = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'for',
  'from',
  'in',
  'into',
  'is',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
])

async function fetchJson(url: string): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'AutoThreads/0.1' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

export async function generateImageKeywords(input: {
  topic?: string
  title?: string
  text: string
}): Promise<GenerateResult> {
  const settings = getSettings()
  try {
    const system =
      'You create concise image-search keywords for editorial social posts. Output only 2 to 5 plain keywords, comma separated. No hashtags.'
    const user =
      `Topic: ${input.topic || 'unknown'}\n` +
      `Source title: ${input.title || 'none'}\n` +
      `Draft text: ${input.text || 'empty'}\n` +
      'Return search keywords for a relevant, non-clickbait image.'
    const raw = await generateText(settings.llm, system, user)
    const words = raw
      .replace(/["']/g, '')
      .split(/\n|;/)[0]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 5)
      .join(' ')
      .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
      .split(/\s+/)
      .filter(Boolean)
    const text = words.slice(0, 7).join(' ')
    return text ? { ok: true, text, message: '' } : { ok: false, text: '', message: 'No keywords returned' }
  } catch (err) {
    return { ok: false, text: '', message: err instanceof Error ? err.message : String(err) }
  }
}

function normalizedTerms(query: string): string[] {
  return query
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term.toLowerCase()))
}

function queryVariants(query: string): string[] {
  const terms = normalizedTerms(query)
  const variants = new Set<string>()
  const add = (value: string) => {
    const clean = value.replace(/\s+/g, ' ').trim()
    if (clean) variants.add(clean)
  }

  add(terms.slice(0, 7).join(' '))
  add(terms.slice(0, 4).join(' '))
  add(terms.slice(0, 3).join(' '))
  for (let i = 0; i <= terms.length - 3; i += 1) add(terms.slice(i, i + 3).join(' '))
  for (let i = 0; i <= terms.length - 2; i += 1) add(terms.slice(i, i + 2).join(' '))
  for (const term of terms) add(term)

  return [...variants].slice(0, 12)
}

async function searchCommons(query: string): Promise<ImageCandidate[]> {
    const url = new URL('https://commons.wikimedia.org/w/api.php')
    url.searchParams.set('action', 'query')
    url.searchParams.set('format', 'json')
    url.searchParams.set('origin', '*')
    url.searchParams.set('generator', 'search')
    url.searchParams.set('gsrnamespace', '6')
    url.searchParams.set('gsrsearch', query)
    url.searchParams.set('gsrlimit', '12')
    url.searchParams.set('prop', 'imageinfo')
    url.searchParams.set('iiprop', 'url|mime')
    url.searchParams.set('iiurlwidth', '640')
    const data = asObj(await fetchJson(url.toString()))
    const pages = asObj(asObj(data.query).pages)
    const images: ImageCandidate[] = []
    for (const page of Object.values(pages)) {
      const p = asObj(page)
      const info = Array.isArray(p.imageinfo) ? asObj(p.imageinfo[0]) : {}
      const mime = typeof info.mime === 'string' ? info.mime : ''
      const imageUrl = typeof info.url === 'string' ? info.url : ''
      const thumbUrl = typeof info.thumburl === 'string' ? info.thumburl : imageUrl
      if (!imageUrl || !thumbUrl || !mime.startsWith('image/')) continue
      images.push({
        url: imageUrl,
        thumbUrl,
        title: typeof p.title === 'string' ? p.title.replace(/^File:/, '') : 'Wikimedia image',
        source: 'Wikimedia Commons',
        pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(String(p.title || ''))}`,
      })
    }
    return images
}

export async function searchImages(query: string): Promise<{ ok: boolean; images: ImageCandidate[]; message: string }> {
  const q = query.trim()
  if (!q) return { ok: false, images: [], message: 'Image search query is required' }
  const variants = queryVariants(q)
  if (variants.length === 0) return { ok: false, images: [], message: 'Image search query is required' }
  try {
    const byUrl = new Map<string, ImageCandidate>()
    for (const variant of variants) {
      const images = await searchCommons(variant)
      for (const image of images) {
        if (!byUrl.has(image.url)) byUrl.set(image.url, image)
        if (byUrl.size >= 8) break
      }
      if (byUrl.size >= 8) break
    }
    const images = [...byUrl.values()]
    return images.length > 0
      ? { ok: true, images, message: '' }
      : { ok: false, images: [], message: 'No images found' }
  } catch (err) {
    return { ok: false, images: [], message: err instanceof Error ? err.message : String(err) }
  }
}
