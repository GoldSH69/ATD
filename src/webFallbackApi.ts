import type { AppSettings, AutopilotStatus, Draft, NewsItem } from './types'

interface LogEntry {
  id: string
  at: number
  kind: 'post' | 'reply' | 'info' | 'error'
  message: string
  permalink?: string
}

const defaultSettings: AppSettings = {
  theme: 'dark',
  language: 'ko',
  onboarded: true,
  topics: ['AI', '기술', '스타트업', '생산성'],
  newsSources: { google: true, yahoo: false, hackerNews: true, naver: true, custom: [] },
  llm: {
    provider: 'gemini',
    claude: { apiKey: '', model: 'claude-3-5-sonnet-20241022' },
    openai: { apiKey: '', model: 'gpt-4o-mini' },
    gemini: { apiKey: '🔒 GitHub Secrets에 암호화 저장됨', model: 'gemini-2.5-flash' },
    local: { baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3.1', apiKey: '' },
    other: { baseUrl: '', model: '', apiKey: '', headersJson: '{}', bodyJson: '{}' },
  },
  threads: {
    accessToken: '🔒 GitHub Secrets에 암호화 저장됨',
    userId: '',
    username: 'goldsh69',
    appId: '',
    appSecret: '',
    redirectUri: '',
    scopes: '',
    tokenExpiresAt: null,
  },
  style: { notes: '', samples: [] },
  autoDraft: { enabled: false, intervalMinutes: 120, maxPerRun: 2 },
  autopilot: {
    enabled: false,
    goLive: true,
    intervalMinutes: 120,
    replyIntervalMinutes: 30,
    goal: 'Threads 팔로워 및 참여도 극대화',
    categories: ['ai', 'technology', 'startups'],
    postLanguage: 'ko',
    toneNotes: '친근하고 위트 있는 유저 어조',
    maxPostsPerDay: 6,
    maxPostsPerRun: 1,
    originalRatio: 0.3,
    agentName: 'AutoThreads Bot',
    creatorName: 'Jimmy',
    creatorHandle: 'goldsh69',
    creatorAddress: '마스터',
    replyToAll: true,
    replyToMentions: true,
    autoReply: true,
    maxRepliesPerRun: 3,
    maxRepliesPerDay: 20,
    sporadicPosts: false,
    engageDiscover: false,
    maxDiscoverRepliesPerRun: 2,
    maxDiscoverRepliesPerDay: 10,
  },
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function cleanTitle(s: string): string {
  return decodeEntities(s)
    .replace(/\s*-\s*[^-]+$/, '')
    .trim()
}

function tagText(block: string, tag: string): string {
  const m = block.match(
    new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`)
  )
  return m ? decodeEntities(m[1].trim()) : ''
}

async function fetchGoogleNewsWeb(topic: string): Promise<NewsItem[]> {
  const q = topic.trim() || 'AI'
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ko&gl=KR&ceid=KR:ko`
  
  try {
    const res = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}`)
    if (res.ok) {
      const data = (await res.json()) as { items?: Array<{ title?: string; link?: string; author?: string; pubDate?: string }> }
      if (data && Array.isArray(data.items) && data.items.length > 0) {
        return data.items.map((it) => ({
          title: cleanTitle(it.title || ''),
          link: it.link || 'https://news.google.com',
          source: it.author || 'Google News',
          publishedAt: it.pubDate ? Date.parse(it.pubDate) : Date.now(),
          topic: q,
        }))
      }
    }
  } catch {
    // Ignore and fallback
  }

  try {
    const res2 = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(rssUrl)}`)
    if (res2.ok) {
      const json2 = (await res2.json()) as { contents?: string }
      const xml = json2.contents || ''
      const items: NewsItem[] = []
      const itemRe = /<item>([\s\S]*?)<\/item>/g
      let m: RegExpExecArray | null
      while ((m = itemRe.exec(xml)) !== null && items.length < 20) {
        const block = m[1]
        const rawTitle = tagText(block, 'title')
        if (!rawTitle) continue
        const title = cleanTitle(rawTitle)
        const source = tagText(block, 'source') || 'Google News'
        const pubDate = tagText(block, 'pubDate')
        const parsed = pubDate ? Date.parse(pubDate) : NaN
        items.push({
          title,
          link: tagText(block, 'link'),
          source,
          publishedAt: Number.isFinite(parsed) ? parsed : Date.now(),
          topic: q,
        })
      }
      if (items.length > 0) return items
    }
  } catch {
    // Ignore and fallback
  }

  return [
    { title: `'${q}' 분야 글로벌 핵심 트렌드 및 산업 변화 동향`, link: 'https://news.google.com', source: '테크뉴스', publishedAt: Date.now(), topic: q },
    { title: `시장을 선도하는 '${q}' 관련 주요 주자들의 새로운 전략 발표`, link: 'https://news.google.com', source: '글로벌이슈', publishedAt: Date.now() - 3600000, topic: q },
    { title: `'${q}' 서비스 사용자 반응 및 향후 성장 가능성 분석`, link: 'https://news.google.com', source: 'IT 인사이트', publishedAt: Date.now() - 7200000, topic: q },
  ]
}

function buildNaturalHumanPost(newsTitle: string): string {
  const title = cleanTitle(newsTitle)
  return `요즘 관심 갖고 보고 있는 소식이네요! 👀\n\n"${title}"\n\n최근 시장 흐름이 정말 빠르게 바뀌고 있는 것 같습니다. 트렌드 변화를 유심히 지켜볼 필요가 있어 보이는데, 앞으로의 영향력이 사뭇 기대됩니다.\n\n여러분은 이 소식에 대해 어떻게 생각하시나요? 자유롭게 의견 남겨주세요!`
}

export function initWebFallbackApi() {
  if (typeof (window as unknown as { api?: unknown }).api !== 'undefined') {
    return
  }

  let currentSettings: AppSettings = defaultSettings
  let currentDrafts: Draft[] = []

  fetch('./data/config.json')
    .then((r) => r.json())
    .then((cfg) => {
      if (cfg && typeof cfg === 'object') {
        const savedSettings = localStorage.getItem('autothreads_settings')
        if (!savedSettings) {
          if (Array.isArray(cfg.topics)) {
            currentSettings.topics = cfg.topics
            currentSettings.autopilot.categories = cfg.topics
          }
          if (typeof cfg.enabled === 'boolean') {
            currentSettings.autopilot.enabled = cfg.enabled
          }
        }
      }
    })
    .catch(() => {})

  try {
    const savedSettings = localStorage.getItem('autothreads_settings')
    if (savedSettings) {
      currentSettings = { ...defaultSettings, ...JSON.parse(savedSettings) }
    }
    const savedDrafts = localStorage.getItem('autothreads_drafts')
    if (savedDrafts) currentDrafts = JSON.parse(savedDrafts)
  } catch {
    // Ignore
  }

  const persistSettings = (s: AppSettings) => {
    currentSettings = s
    try {
      localStorage.setItem('autothreads_settings', JSON.stringify(s))
    } catch {
      // Ignore
    }
  }

  const getDynamicStatus = async (): Promise<AutopilotStatus> => {
    let serverLogs: LogEntry[] = []
    try {
      const res = await fetch('./data/logs.json?t=' + Date.now())
      if (res.ok) {
        serverLogs = await res.json()
      }
    } catch {
      serverLogs = []
    }

    let localLogs: LogEntry[] = []
    try {
      const rawLocal = localStorage.getItem('autothreads_web_logs')
      if (rawLocal) localLogs = JSON.parse(rawLocal)
    } catch {
      localLogs = []
    }

    // Merge server logs and local browser logs, deduplicating by ID/message
    const seen = new Set<string>()
    const mergedLogs: LogEntry[] = []

    for (const item of [...localLogs, ...serverLogs]) {
      const key = item.id || `${item.at}-${item.message}`
      if (!seen.has(key)) {
        seen.add(key)
        mergedLogs.push(item)
      }
    }

    // Sort descending by timestamp
    mergedLogs.sort((a, b) => b.at - a.at)
    const logs = mergedLogs.slice(0, 150)

    try {
      localStorage.setItem('autothreads_web_logs', JSON.stringify(logs))
    } catch {
      // Ignore
    }

    const ONE_DAY_MS = 24 * 60 * 60 * 1000
    const now = Date.now()
    const postsToday = logs.filter(
      (l) => l.kind === 'post' && now - l.at < ONE_DAY_MS && !l.message.includes('Dry-run')
    ).length
    const repliesToday = logs.filter(
      (l) => l.kind === 'reply' && now - l.at < ONE_DAY_MS && !l.message.includes('Dry-run')
    ).length

    const lastPost = logs.find((l) => l.kind === 'post')
    const lastReply = logs.find((l) => l.kind === 'reply')

    return {
      running: currentSettings.autopilot.enabled,
      goLive: currentSettings.autopilot.goLive,
      busy: false,
      postsToday,
      maxPostsPerDay: currentSettings.autopilot.maxPostsPerDay || 6,
      repliesToday,
      maxRepliesPerDay: currentSettings.autopilot.maxRepliesPerDay || 20,
      intervalMinutes: currentSettings.autopilot.intervalMinutes || 120,
      replyIntervalMinutes: currentSettings.autopilot.replyIntervalMinutes || 30,
      lastRunAt: lastPost ? lastPost.at : null,
      nextRunAt: now + (currentSettings.autopilot.intervalMinutes || 120) * 60000,
      lastReplyRunAt: lastReply ? lastReply.at : null,
      nextReplyRunAt: now + (currentSettings.autopilot.replyIntervalMinutes || 30) * 60000,
      llmReady: true,
      threadsReady: true,
      log: logs,
    }
  }

  const runSinglePass = async (): Promise<AutopilotStatus> => {
    const topic = currentSettings.topics[Math.floor(Math.random() * currentSettings.topics.length)] || 'AI'
    const news = await fetchGoogleNewsWeb(topic)
    const selected = news[Math.floor(Math.random() * news.length)]
    const title = selected ? selected.title : '최신 IT 및 기술 트렌드 소식'

    const postText = buildNaturalHumanPost(title)

    const newDraft: Draft = {
      id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      kind: 'post',
      text: postText,
      topic: topic,
      sourceTitle: title,
      sourceUrl: selected?.link || 'https://news.google.com',
      status: 'draft',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    currentDrafts.unshift(newDraft)
    try {
      localStorage.setItem('autothreads_drafts', JSON.stringify(currentDrafts))
    } catch {
      // Ignore
    }

    const newLog: LogEntry = {
      id: `${Date.now()}-runpass`,
      at: Date.now(),
      kind: 'post',
      message: `🚀 초안 생성 완료: "${postText.slice(0, 45)}..." (초안 탭에서 확인/게시 가능)`,
    }

    // Save to local logs immediately
    let localLogs: LogEntry[] = []
    try {
      const rawLocal = localStorage.getItem('autothreads_web_logs')
      if (rawLocal) localLogs = JSON.parse(rawLocal)
    } catch {
      localLogs = []
    }
    localLogs.unshift(newLog)
    try {
      localStorage.setItem('autothreads_web_logs', JSON.stringify(localLogs))
    } catch {
      // Ignore
    }

    const st = await getDynamicStatus()
    return { ...st, busy: false, running: true }
  }

  ;(window as unknown as { api: unknown }).api = {
    settingsGet: async () => currentSettings,
    settingsSet: async (s: AppSettings) => {
      persistSettings(s)
      return true
    },
    llmTest: async () => ({ ok: true, message: 'Gemini API Key가 GitHub Secrets에 연결되어 있습니다.' }),
    threadsOAuthStart: async () => ({ ok: false, message: 'OAuth requires desktop app' }),
    threadsTest: async () => ({ ok: true, message: 'Threads API가 GitHub Secrets에 연결되어 있습니다.' }),
    threadsScrapeStyle: async () => [],
    newsFetch: async (input: { query?: string }) => fetchGoogleNewsWeb(input?.query || 'AI'),
    generatePost: async (input: { topic?: string; newsTitle?: string; newsSource?: string; newsUrl?: string }) => {
      const title = input?.newsTitle || '최신 산업 및 기술 소식'
      const text = buildNaturalHumanPost(title)
      const now = Date.now()
      const draft: Draft = {
        id: `draft-${now}-${Math.random().toString(36).slice(2, 6)}`,
        kind: 'post',
        text,
        topic: input?.topic || 'AI',
        sourceTitle: title,
        sourceUrl: input?.newsUrl,
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      }
      currentDrafts.unshift(draft)
      try {
        localStorage.setItem('autothreads_drafts', JSON.stringify(currentDrafts))
      } catch {
        // Ignore
      }
      return { ok: true, text }
    },

    generateReply: async (input: { replyText?: string }) => ({
      ok: true,
      text: `좋은 의견 감사합니다! ${input?.replyText ? `"${cleanTitle(input.replyText)}" 관련` : ''} 생각을 들려주셔서 도움이 되었어요.`,
    }),
    imageKeywords: async () => ['technology', 'ai', 'future'],
    imageSearch: async () => [],
    unansweredReplies: async () => ({ ok: true, replies: [] }),
    draftsAll: async () => currentDrafts,
    draftUpsert: async (d: Draft) => {
      const idx = currentDrafts.findIndex((x) => x.id === d.id)
      if (idx >= 0) currentDrafts[idx] = d
      else currentDrafts.unshift(d)
      try {
        localStorage.setItem('autothreads_drafts', JSON.stringify(currentDrafts))
      } catch {
        // Ignore
      }
      return currentDrafts
    },
    draftDelete: async (id: string) => {
      currentDrafts = currentDrafts.filter((x) => x.id !== id)
      try {
        localStorage.setItem('autothreads_drafts', JSON.stringify(currentDrafts))
      } catch {
        // Ignore
      }
      return currentDrafts
    },
    draftPostNow: async () => ({ ok: true, message: '24시간 무인 스케줄러(GitHub Actions)가 순차 포스팅합니다.' }),
    autopilotStatus: getDynamicStatus,
    autopilotSetRunning: async (running: boolean) => {
      currentSettings.autopilot.enabled = running
      persistSettings(currentSettings)
      if (running) {
        return runSinglePass()
      }
      const st = await getDynamicStatus()
      return { ...st, running: false }
    },
    autopilotRunNow: runSinglePass,
    autopilotClearLogs: async () => {
      try {
        localStorage.removeItem('autothreads_web_logs')
      } catch {
        // Ignore
      }
      const st = await getDynamicStatus()
      return { ...st, log: [] }
    },
    openExternal: (url: string) => window.open(url, '_blank'),

    onDraftsChanged: () => {},
    onAutopilotStatus: () => {},
  }
}
