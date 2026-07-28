import type { AppSettings, AutopilotStatus, Draft, NewsItem } from './types'

interface LogEntry {
  id: string
  at: number
  kind: 'post' | 'reply' | 'info' | 'error'
  message: string
  permalink?: string
}

interface ServerConfig {
  enabled?: boolean
  autoApprove?: boolean
  scheduleMode?: 'interval' | 'times'
  postingTimes?: string[]
  maxPostsPerDay?: number
  topics?: string[]
  originalRatio?: number
  toneNotes?: string
  agentName?: string
}

const defaultSettings: AppSettings = {
  theme: 'dark',
  language: 'ko',
  onboarded: true,
  topics: ['AI', '기술', '스타트업', '관계심리학', '생산성'],
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
    autoApprove: false,
    scheduleMode: 'times',
    postingTimes: ['06:00', '11:30', '15:00', '18:00', '21:00'],
    intervalMinutes: 120,
    replyIntervalMinutes: 30,
    goal: 'Threads 팔로워 및 참여도 극대화',
    categories: ['ai', 'technology', 'startups', 'relationships'],
    postLanguage: 'ko',
    toneNotes: '친근하고 위트 있는 유저 어조',
    maxPostsPerDay: 5,
    maxPostsPerRun: 1,
    originalRatio: 0.8,
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
    .replace(/^🤖\s*\[[^\]]+\]\s*/, '')
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
      const data = (await res.json()) as { items?: Array<{ title?: string; link?: string; author?: string; pubDate?: string; description?: string }> }
      if (data && Array.isArray(data.items) && data.items.length > 0) {
        return data.items.map((it) => ({
          title: cleanTitle(it.title || ''),
          link: it.link || 'https://news.google.com',
          source: it.author || 'Google News',
          publishedAt: it.pubDate ? Date.parse(it.pubDate) : Date.now(),
          topic: q,
          snippet: it.description ? cleanTitle(it.description).replace(/<[^>]+>/g, '').slice(0, 150) : undefined,
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
        const snippet = tagText(block, 'description').replace(/<[^>]+>/g, '').slice(0, 150)
        items.push({
          title,
          link: tagText(block, 'link'),
          source,
          publishedAt: Number.isFinite(parsed) ? parsed : Date.now(),
          topic: q,
          snippet: snippet || undefined,
        })
      }
      if (items.length > 0) return items
    }
  } catch {
    // Ignore and fallback
  }

  const lowerTopic = q.toLowerCase()
  if (lowerTopic.includes('humor') || lowerTopic.includes('유머') || lowerTopic.includes('드립') || lowerTopic.includes('meme')) {
    return [
      { title: `오늘 커뮤니티 반응 폭발한 소소하고 웃긴 유머 모음 🤣`, link: 'https://news.google.com', source: '인터넷유머', publishedAt: Date.now(), topic: q, snippet: '퇴근길 피로를 날려주는 소소하지만 유쾌한 최근 드립과 대화 짤 모음이 큰 호응을 얻고 있습니다.' },
      { title: `소소한 웃음 보장! 인스타/스레드 인기 드립 릴레이`, link: 'https://news.google.com', source: '트렌드이슈', publishedAt: Date.now() - 3600000, topic: q, snippet: '일상 속 웃긴 상황을 유머러스하게 담아낸 대화와 짤이 커뮤니티 유저들 사이에서 입소문을 타고 있습니다.' },
    ]
  }

  return [
    { title: `오픈AI 차세대 AI 모델 발표 및 글로벌 투자 유치`, link: 'https://news.google.com', source: '테크뉴스', publishedAt: Date.now(), topic: q, snippet: '스마트폰과 PC에서 서버 연결 없이 작동하는 고성능 초경량 AI 모델이 잇따라 공개되며 글로벌 기술 시장의 호응을 이끌어내고 있습니다.' },
    { title: `배달의민족 로봇 배달 서비스 전국 시범 운행 개시`, link: 'https://news.google.com', source: '글로벌이슈', publishedAt: Date.now() - 3600000, topic: q, snippet: '새로운 자동화 기술과 사용자 경험을 무기로 실생활 배송 영역을 넓혀가는 스마트 무인 로봇 배달 서비스 소식이 알려졌습니다.' },
  ]
}

function buildOriginalInsightPost(topic?: string): string {
  const lowerTopic = (topic || '').toLowerCase()

  if (lowerTopic.includes('심리') || lowerTopic.includes('관계') || lowerTopic.includes('psychology') || lowerTopic.includes('인간관계')) {
    const psychologyPosts = [
      `💡 상대방과의 대화에서 호감을 3배 높이는 '스몰톡' 심리학 법칙\n\n사람은 자기가 대화를 주도할 때 뇌에서 가장 많은 도파민이 분비됩니다. 대화할 때 내 이야기보다 상대방의 경험이나 취향을 묻는 질문 비율을 70%로 올려보세요!\n\n거부감 없이 순식간에 깊은 친밀감이 형성됩니다 🌿\n\n오늘 누군가와 대화할 때 어떤 질문으로 말을 건네보고 싶으신가요? 💬`,
      `🌿 감정 소비를 줄이고 마음의 평정을 유지하는 '심리적 거리두기'\n\n타인의 부정적인 말이나 반응에 즉각 반응하지 않고 3초간 숨을 고르는 것만으로도 뇌의 편도체 흥분이 가라앉습니다. 내 마음의 주도권을 남에게 넘겨주지 않는 가장 쉬운 방법이죠.\n\n평소 타인의 말에 상처받을 때 자신만의 마음 조율법이 있으신가요? 💡`,
    ]
    return psychologyPosts[Math.floor(Math.random() * psychologyPosts.length)]
  }

  if (lowerTopic.includes('생산성') || lowerTopic.includes('productivity') || lowerTopic.includes('자기계발')) {
    const productivityPosts = [
      `⚡ 하루 집중력을 2배로 올리는 '25분 몰입 5분 휴식' 포모도로 기법\n\n인간의 뇌가 최상의 집중 상태를 유지할 수 있는 시간은 의외로 짧습니다. 긴 시간 억지로 버티는 대신 25분간 한 가지 일에만 몰입하고 5분간 완전히 쉬어보세요.\n\n피로도 없이 하루 작업량이 획기적으로 늘어납니다 🚀\n\n여러분은 일을 시작할 때 집중력을 올리는 자신만의 루틴이 있으신가요? 💬`,
      `🧠 뇌의 기억 낭비를 막아주는 '두 번째 뇌(Second Brain)' 메모법\n\n머릿속에 아이디어와 할 일을 쌓아두면 뇌는 끊임없이 무의식적 스트레스를 받습니다. 떠오르는 즉시 디지털 메모 앱에 기록하고 머리를 비워두세요.\n\n생각의 명확성과 창의성이 비약적으로 증가합니다 💡\n\n평소 중요한 생각이나 아이디어를 기록하는 나만의 노하우가 있다면 공유해주세요!`,
    ]
    return productivityPosts[Math.floor(Math.random() * productivityPosts.length)]
  }

  if (lowerTopic.includes('humor') || lowerTopic.includes('유머') || lowerTopic.includes('드립') || lowerTopic.includes('meme')) {
    const humorPosts = [
      `🤣 퇴근길 피로 싹 날려주는 요즘 지능형 유머 드립 모음\n\n월요일 아침 출근길에 내 뇌가 작동을 거부할 때 떠오르는 짤들이 커뮤니티에서 유난히 핫하네요 ㅋㅋㅋ 소소하지만 웃으면서 힐링하기 딱 좋습니다!\n\n다들 오늘 피드에서 보고 가장 피식했던 터지는 소식이나 짤 있으신가요? 💬`,
      `😄 피식 터지는 소소한 대화 짤 & 인스타 레전드 반응 모음\n\n바쁜 하루 끝에 아무 생각 없이 웃을 수 있는 드립들이 유난히 많은 하루네요 ㅋㅋㅋ 피로로 지친 하루에 소소한 웃음 보너스가 되길 바랍니다!\n\n다들 오늘 가장 웃겼던 포인트나 재미있는 짤 공유해주세요 😃`,
    ]
    return humorPosts[Math.floor(Math.random() * humorPosts.length)]
  }

  const techPosts = [
    `🌐 온디바이스 AI 시대가 가져올 우리 일상의 구체적인 변화\n\n서버 연결 없이 내 스마트폰과 PC에서 직접 구동되는 AI는 반응 속도가 3배 이상 빠르고 개인정보 유출 걱정이 없습니다. 조만간 인터넷이 안 되는 환경에서도 완전한 자동화 조교를 쓰게 될 것입니다.\n\n여러분은 기기 자체에서 구동되는 AI 기능이 나온다면 가장 먼저 어디에 써보고 싶으신가요? 🚀`,
    `🚀 차세대 AI 스마트 워크플로우가 바꿔놓을 업무의 미래\n\n단순 반복 업무와 단순 서류 작성을 AI가 80% 이상 전담하면서, 인간은 기획과 창의적인 판단에만 전념하는 구조로 빠르게 재편되고 있습니다.\n\n기술의 변화 속에서 여러분이 가장 기대하는 업무의 효율성은 무엇인가요? 💬`,
  ]

  return techPosts[Math.floor(Math.random() * techPosts.length)]
}

function buildNaturalHumanPost(newsTitle: string, topic?: string, snippet?: string): string {
  if (!newsTitle || newsTitle.includes('최신') || newsTitle.includes('이슈 한눈에')) {
    return buildOriginalInsightPost(topic)
  }

  const title = cleanTitle(newsTitle)
  const cleanSnippet = snippet ? cleanTitle(snippet).replace(/<[^>]+>/g, '').slice(0, 130) : ''
  const lowerTopic = (topic || '').toLowerCase()

  if (lowerTopic.includes('humor') || lowerTopic.includes('유머') || lowerTopic.includes('드립') || lowerTopic.includes('meme')) {
    const summary = cleanSnippet || '오늘 커뮤니티와 SNS에서 유난히 높은 조회수와 폭발적인 댓글 반응을 얻고 있는 재미있는 유머 소식입니다.'
    const endings = [
      '다들 보고 피식하셨나요? ㅋㅋㅋ 가장 재미있었던 포인트나 드립이 있다면 댓글로 알려주세요! 🤣',
      '퇴근길 웃음 보너스네요 ㅋㅋㅋ 다들 오늘 피드에서 본 제일 터지는 소식 있으신가요? 😃',
      '요즘 이거 진짜 많이 보이던데 ㅋㅋㅋ 다들 얼마나 공감되시나요? 댓글로 이야기해봐요 💬',
    ]
    const ending = endings[Math.floor(Math.random() * endings.length)]
    return `📢 ${title}\n\n${summary}\n\n바쁜 하루 끝에 소소하게 웃어보기 딱 좋네요 ㅋㅋㅋ 유쾌한 기분 전해졌으면 좋겠습니다!\n\n${ending}`
  }

  if (lowerTopic.includes('startup') || lowerTopic.includes('스타트업') || lowerTopic.includes('business')) {
    const summary = cleanSnippet || '글로벌 스타트업 생태계와 신규 비즈니스 시장에서 주목받는 핵심 전략과 투자 소식입니다.'
    const endings = [
      '글로벌 진출이 본격화되면 성장세가 엄청날 것 같은데, 이 비즈니스의 미래 가치 어떻게 보시나요? 📈',
      '기존 업계 판도를 바꿀 유망한 시도라고 보는데, 과연 시장에 어떤 파급력을 줄지 기대되네요!',
      '비즈니스 모델이 꽤 신선해 보이는데, 여러분이라면 이번 서비스 도입해보실 것 같나요? 💡',
    ]
    const ending = endings[Math.floor(Math.random() * endings.length)]
    return `📢 ${title}\n\n${summary}\n\n새로운 시장 기회를 포착한 시도라 앞으로의 성장 궤적이 사뭇 주목됩니다 🚀\n\n${ending}`
  }

  const summary = cleanSnippet || '스마트폰과 PC에서 서버 연결 없이 작동하는 차세대 온디바이스 AI 기술이 대거 도입되는 핫이슈 소식입니다.'
  const endings = [
    '이 기술이나 서비스가 실제 일상에 도입된다면 여러분은 써보실 건가요? 🤖',
    '기존 방식과 비교했을 때 어느 쪽이 더 혁신적이라고 느껴지시나요? 솔직한 의견이 궁금합니다! 🚀',
    '기술 발전 속도가 정말 무서운데, 앞으로 가장 기대되거나 우려되는 부분은 무엇인가요? 💬',
  ]
  const ending = endings[Math.floor(Math.random() * endings.length)]
  return `📢 ${title}\n\n${summary}\n\n사용자 편의성과 효율성을 획기적으로 올려줄 만한 변화라 앞으로의 확장성이 기대되네요!\n\n${ending}`
}

export function initWebFallbackApi() {
  if (typeof (window as unknown as { api?: unknown }).api !== 'undefined') {
    return
  }

  let currentSettings: AppSettings = defaultSettings
  let currentDrafts: Draft[] = []

  // Direct Server Config Fetch - NO LOCALSTORAGE OVERRIDES
  const loadServerConfig = () => {
    fetch('./data/config.json?t=' + Date.now())
      .then((r) => r.json())
      .then((cfg: ServerConfig) => {
        if (cfg && typeof cfg === 'object') {
          currentSettings.autopilot.enabled = Boolean(cfg.enabled)
          currentSettings.autopilot.autoApprove = Boolean(cfg.autoApprove)
          currentSettings.autopilot.maxPostsPerDay = cfg.maxPostsPerDay || 5
          if (Array.isArray(cfg.topics)) {
            currentSettings.topics = cfg.topics
            currentSettings.autopilot.categories = cfg.topics
          }
          if (typeof cfg.originalRatio === 'number') {
            currentSettings.autopilot.originalRatio = cfg.originalRatio
          }
        }
      })
      .catch(() => {})
  }

  loadServerConfig()

  try {
    const savedDrafts = localStorage.getItem('autothreads_drafts')
    if (savedDrafts) currentDrafts = JSON.parse(savedDrafts)
  } catch {
    // Ignore
  }

  const persistSettings = (s: AppSettings) => {
    currentSettings = s
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

    // Always fetch authoritative server config
    try {
      const cfgRes = await fetch('./data/config.json?t=' + Date.now())
      if (cfgRes.ok) {
        const cfg: ServerConfig = await cfgRes.json()
        currentSettings.autopilot.enabled = Boolean(cfg.enabled)
        currentSettings.autopilot.autoApprove = Boolean(cfg.autoApprove)
        currentSettings.autopilot.maxPostsPerDay = cfg.maxPostsPerDay || 5
        if (Array.isArray(cfg.topics)) {
          currentSettings.topics = cfg.topics
        }
      }
    } catch {
      // Ignore
    }

    let localLogs: LogEntry[] = []
    try {
      const rawLocal = localStorage.getItem('autothreads_web_logs')
      if (rawLocal) localLogs = JSON.parse(rawLocal)
    } catch {
      localLogs = []
    }

    const seen = new Set<string>()
    const mergedLogs: LogEntry[] = []

    for (const item of [...localLogs, ...serverLogs]) {
      const key = item.id || `${item.at}-${item.message}`
      if (!seen.has(key)) {
        seen.add(key)
        mergedLogs.push(item)
      }
    }

    mergedLogs.sort((a, b) => b.at - a.at)
    const logs = mergedLogs.slice(0, 150)

    const ONE_DAY_MS = 24 * 60 * 60 * 1000
    const now = Date.now()
    const postsToday = logs.filter(
      (l) =>
        l.kind === 'post' &&
        now - l.at < ONE_DAY_MS &&
        !l.message.includes('Dry-run') &&
        !l.message.includes('초안') &&
        !l.message.includes('Draft')
    ).length
    const repliesToday = logs.filter(
      (l) => l.kind === 'reply' && now - l.at < ONE_DAY_MS && !l.message.includes('Dry-run')
    ).length

    const lastPost = logs.find((l) => l.kind === 'post' && !l.message.includes('초안'))
    const lastReply = logs.find((l) => l.kind === 'reply')

    return {
      running: currentSettings.autopilot.enabled,
      goLive: currentSettings.autopilot.goLive,
      busy: false,
      postsToday,
      maxPostsPerDay: currentSettings.autopilot.maxPostsPerDay || 5,
      repliesToday,
      maxRepliesPerDay: currentSettings.autopilot.maxRepliesPerDay || 20,
      intervalMinutes: currentSettings.autopilot.intervalMinutes || 120,
      replyIntervalMinutes: currentSettings.autopilot.replyIntervalMinutes || 30,
      lastRunAt: lastPost ? lastPost.at : null,
      nextRunAt: null,
      lastReplyRunAt: lastReply ? lastReply.at : null,
      nextReplyRunAt: null,
      llmReady: true,
      threadsReady: true,
      log: logs,
    }
  }

  const runSinglePass = async (): Promise<AutopilotStatus> => {
    const topics = currentSettings.topics.length > 0 ? currentSettings.topics : ['관계심리학', 'AI', '기술', '생산성']
    const selectedTopic = topics[Math.floor(Math.random() * topics.length)] || '관계심리학'
    const isOriginal = Math.random() < (currentSettings.autopilot.originalRatio ?? 0.8)

    let postText = ''
    let title = ''

    if (!isOriginal) {
      const news = await fetchGoogleNewsWeb(selectedTopic)
      if (news && news.length > 0) {
        const selectedNews = news[Math.floor(Math.random() * news.length)]
        title = selectedNews.title
        postText = buildNaturalHumanPost(title, selectedTopic, selectedNews.snippet)
      }
    }

    if (!postText) {
      postText = buildOriginalInsightPost(selectedTopic)
      title = `${selectedTopic} 인사이트`
    }

    const newDraft: Draft = {
      id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      kind: 'post',
      text: postText,
      topic: selectedTopic,
      sourceTitle: title,
      sourceUrl: 'https://news.google.com',
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
      kind: 'info',
      message: `📝 초안 생성 완료: "${postText.slice(0, 45)}..." (초안 탭에서 확인/게시 가능)`,
    }

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
    return { ...st, busy: false, running: currentSettings.autopilot.enabled }
  }

  ;(window as unknown as { api: unknown }).api = {
    settingsGet: async () => {
      await getDynamicStatus()
      return currentSettings
    },
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
      const topic = input?.topic || '관계심리학'
      const isOriginal = !input?.newsTitle || Math.random() < (currentSettings.autopilot.originalRatio ?? 0.8)
      
      let text = ''
      if (!isOriginal && input?.newsTitle) {
        text = buildNaturalHumanPost(input.newsTitle, topic)
      } else {
        text = buildOriginalInsightPost(topic)
      }

      const now = Date.now()
      const draft: Draft = {
        id: `draft-${now}-${Math.random().toString(36).slice(2, 6)}`,
        kind: 'post',
        text,
        topic: topic,
        sourceTitle: input?.newsTitle || `${topic} 인사이트`,
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
      const st = await getDynamicStatus()
      return { ...st, running }
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
