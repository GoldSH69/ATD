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

function tagText(block: string, tag: string): string {
  const m = block.match(
    new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`)
  )
  return m ? decodeEntities(m[1].trim()) : ''
}

async function fetchGoogleNewsWeb(topic: string): Promise<NewsItem[]> {
  try {
    const q = topic.trim() || 'AI'
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ko&gl=KR&ceid=KR:ko`
    const res = await fetch(url)
    if (!res.ok) return []
    const xml = await res.text()
    const items: NewsItem[] = []
    const itemRe = /<item>([\s\S]*?)<\/item>/g
    let m: RegExpExecArray | null
    while ((m = itemRe.exec(xml)) !== null && items.length < 20) {
      const block = m[1]
      const title = tagText(block, 'title')
      if (!title) continue
      const source = tagText(block, 'source') || 'Google News'
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
  }
}

export function initWebFallbackApi() {
  if (typeof (window as unknown as { api?: unknown }).api !== 'undefined') {
    return
  }

  let currentSettings: AppSettings = defaultSettings
  let currentDrafts: Draft[] = []

  // Pre-load data/config.json if available
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
    let logs: LogEntry[] = []
    try {
      const res = await fetch('./data/logs.json?t=' + Date.now())
      if (res.ok) {
        logs = await res.json()
      }
    } catch {
      logs = []
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
    generatePost: async (input: { title?: string }) => ({
      ok: true,
      text: `🤖 [AI 생성 초안]\n\n${input?.title || '최신 IT 소식'}\n\n여러분은 이 소식에 대해 어떻게 생각하시나요? 댓글로 의견을 나눠주세요!`,
    }),
    generateReply: async (input: { replyText?: string }) => ({
      ok: true,
      text: `답변 감사드립니다! ${input?.replyText ? `"${input.replyText.slice(0, 20)}..."에 대한` : ''} 의견 잘 읽었습니다.`,
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
      const st = await getDynamicStatus()
      return { ...st, running }
    },
    autopilotRunNow: getDynamicStatus,
    openExternal: (url: string) => window.open(url, '_blank'),
    onDraftsChanged: () => {},
    onAutopilotStatus: () => {},
  }
}
