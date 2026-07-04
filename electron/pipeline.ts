import { db } from './localdb'
import { getSettings } from './settings'
import { generateText } from './llm'
import { fetchTopicNews } from './news'
import { upsertDraft } from './drafts'
import type { AppSettings, GenerateResult, StyleSettings } from './types'

const MAX_CHARS = 500
const USED_LINKS_KEY = 'usedNewsLinks'
const TOPIC_IDX_KEY = 'autoDraftTopicIdx'

function unconfiguredMessage(llm: AppSettings['llm']): string | null {
  if (llm.provider === 'claude' && !llm.claude.apiKey.trim())
    return 'Claude API key is missing — configure in Settings.'
  if (llm.provider === 'openai' && !llm.openai.apiKey.trim())
    return 'OpenAI API key is missing — configure in Settings.'
  if (llm.provider === 'local' && !llm.local.baseUrl.trim())
    return 'Local LLM base URL is missing — configure in Settings.'
  return null
}

function buildSystemPrompt(style: StyleSettings): string {
  const lines = [
    "You ghost-write posts for Threads (Meta's microblogging platform).",
    'Rules:',
    `- Maximum ${MAX_CHARS} characters.`,
    '- Plain conversational text.',
    '- No hashtags unless the style notes ask for them.',
    '- No emojis unless the style samples use them.',
    '- Output ONLY the post text — no quotes, no preamble, no explanations.',
  ]
  const notes = style.notes.trim()
  if (notes) lines.push('', `Style notes from the author: ${notes}`)
  const samples = style.samples.map((s) => s.trim()).filter(Boolean).slice(0, 8)
  if (samples.length > 0) {
    lines.push('', "Examples of the author's voice:")
    for (const sample of samples) lines.push('---', sample)
  }
  return lines.join('\n')
}

function cleanOutput(raw: string): string {
  let text = raw.trim()
  for (const [open, close] of [['"', '"'], ["'", "'"], ['“', '”'], ['‘', '’']] as const) {
    if (text.length >= 2 && text.startsWith(open) && text.endsWith(close)) {
      text = text.slice(1, -1).trim()
      break
    }
  }
  text = text.replace(/^(?:post|reply)\s*:\s*/i, '')
  text = text.replace(/\n{3,}/g, '\n\n').trim()
  if (text.length > MAX_CHARS) {
    const head = text.slice(0, MAX_CHARS - 3)
    const atBoundary = head.replace(/\s+\S*$/, '').trimEnd()
    text = (atBoundary || head) + '…'
  }
  return text
}

async function runGeneration(settings: AppSettings, userPrompt: string): Promise<GenerateResult> {
  try {
    const raw = await generateText(settings.llm, buildSystemPrompt(settings.style), userPrompt)
    const text = cleanOutput(raw)
    if (!text) return { ok: false, text: '', message: 'Model returned empty text' }
    return { ok: true, text, message: '' }
  } catch (err) {
    return { ok: false, text: '', message: err instanceof Error ? err.message : String(err) }
  }
}

export async function generatePostDraft(input: {
  topic: string
  newsTitle?: string
  newsSource?: string
  newsUrl?: string
}): Promise<GenerateResult> {
  const settings = getSettings()
  const missing = unconfiguredMessage(settings.llm)
  if (missing) return { ok: false, text: '', message: missing }
  let user = `Write a Threads post about ${input.topic}.`
  if (input.newsTitle) {
    const source = input.newsSource ? ` (${input.newsSource})` : ''
    user += ` React to this news headline: "${input.newsTitle}"${source}. Add one insightful angle or opinion, not a summary.`
  }
  return runGeneration(settings, user)
}

export async function generateReplyDraft(input: {
  replyText: string
  replyUsername: string
  rootPostText: string
}): Promise<GenerateResult> {
  const settings = getSettings()
  const missing = unconfiguredMessage(settings.llm)
  if (missing) return { ok: false, text: '', message: missing }
  const user =
    `The author posted: "${input.rootPostText}". @${input.replyUsername} replied: "${input.replyText}". ` +
    `Write the author's reply — helpful, in-voice, under ${MAX_CHARS} chars.`
  return runGeneration(settings, user)
}

/** One auto-draft pass: next topic (round-robin), fresh news, drafts. Never throws. */
export async function runAutoDraft(): Promise<number> {
  let created = 0
  try {
    const settings = getSettings()
    const topics = settings.topics
    if (topics.length === 0) return 0
    const rawIdx = db.get<number>(TOPIC_IDX_KEY)
    const idx = typeof rawIdx === 'number' && Number.isFinite(rawIdx) ? Math.abs(Math.floor(rawIdx)) : 0
    const topic = topics[idx % topics.length]
    await db.set(TOPIC_IDX_KEY, (idx + 1) % topics.length)
    const news = await fetchTopicNews(topic)
    const usedList = (db.get<string[]>(USED_LINKS_KEY) ?? []).filter((l) => typeof l === 'string')
    const used = new Set(usedList)
    const fresh = news
      .filter((n) => n.link && !used.has(n.link))
      .slice(0, settings.autoDraft.maxPerRun)
    for (const item of fresh) {
      const res = await generatePostDraft({
        topic,
        newsTitle: item.title,
        newsSource: item.source,
        newsUrl: item.link,
      })
      if (!res.ok) {
        console.error(`[pipeline] auto-draft generation failed for "${item.title}": ${res.message}`)
        continue
      }
      const now = Date.now()
      await upsertDraft({
        id: crypto.randomUUID(),
        kind: 'post',
        text: res.text,
        topic,
        sourceTitle: item.title,
        sourceUrl: item.link,
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      })
      // Mark used right after the draft lands, so a later failure in this loop
      // can't cause a duplicate draft for an already-drafted headline next run.
      used.add(item.link)
      await db.set(USED_LINKS_KEY, [...used].slice(-500))
      created++
    }
  } catch (err) {
    console.error('[pipeline] auto-draft run failed', err)
  }
  return created
}
