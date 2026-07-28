import type { AppSettings, AutopilotStatus, Draft } from './types'

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
    gemini: { apiKey: '', model: 'gemini-2.5-flash' },
    local: { baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3.1', apiKey: '' },
    other: { baseUrl: '', model: '', apiKey: '', headersJson: '{}', bodyJson: '{}' },
  },
  threads: {
    accessToken: '',
    userId: '',
    username: '',
    appId: '',
    appSecret: '',
    redirectUri: '',
    scopes: '',
    tokenExpiresAt: null,
  },
  style: { notes: '', samples: [] },
  autoDraft: { enabled: false, intervalMinutes: 120, maxPerRun: 2 },
  autopilot: {
    enabled: true,
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

const defaultStatus: AutopilotStatus = {
  running: true,
  goLive: true,
  busy: false,
  postsToday: 2,
  maxPostsPerDay: 6,
  repliesToday: 5,
  maxRepliesPerDay: 20,
  intervalMinutes: 120,
  replyIntervalMinutes: 30,
  lastRunAt: Date.now() - 3600000,
  nextRunAt: Date.now() + 3600000,
  lastReplyRunAt: Date.now() - 1800000,
  nextReplyRunAt: Date.now() + 1800000,
  llmReady: true,
  threadsReady: true,
  log: [],
}

export function initWebFallbackApi() {
  if (typeof (window as unknown as { api?: unknown }).api !== 'undefined') {
    return
  }

  let currentSettings: AppSettings = defaultSettings
  let currentDrafts: Draft[] = []

  // Try to load logs or config from data/ if available or localStorage
  try {
    const savedSettings = localStorage.getItem('autothreads_settings')
    if (savedSettings) currentSettings = JSON.parse(savedSettings)
    const savedDrafts = localStorage.getItem('autothreads_drafts')
    if (savedDrafts) currentDrafts = JSON.parse(savedDrafts)
  } catch {
    // Ignore
  }

  ;(window as unknown as { api: unknown }).api = {
    settingsGet: async () => currentSettings,
    settingsSet: async (s: AppSettings) => {
      currentSettings = s
      try {
        localStorage.setItem('autothreads_settings', JSON.stringify(s))
      } catch {
        // Ignore
      }
      return true
    },
    llmTest: async () => ({ ok: true, message: 'Web Fallback LLM Ready' }),
    threadsOAuthStart: async () => ({ ok: false, message: 'OAuth requires desktop app' }),
    threadsTest: async () => ({ ok: true, message: 'Threads Connected' }),
    threadsScrapeStyle: async () => [],
    newsFetch: async () => [],
    generatePost: async () => ({ ok: true, text: '샘플 포스트 초안입니다.' }),
    generateReply: async () => ({ ok: true, text: '샘플 답글입니다.' }),
    imageKeywords: async () => [],
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
    draftPostNow: async () => ({ ok: true, message: 'Posted' }),
    autopilotStatus: async () => defaultStatus,
    autopilotSetRunning: async (running: boolean) => ({ ...defaultStatus, running }),
    autopilotRunNow: async () => defaultStatus,
    openExternal: (url: string) => window.open(url, '_blank'),
    onDraftsChanged: () => {},
    onAutopilotStatus: () => {},
  }
}
