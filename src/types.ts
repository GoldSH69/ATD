/** Shared application types. Keep in sync with electron/types.ts (the electron
 *  tsconfig only includes electron/, so the DTO shapes are duplicated there). */

export type ThemeMode = 'light' | 'dark'
export type LlmProviderKind = 'claude' | 'openai' | 'local'
export type DraftKind = 'post' | 'reply'
export type DraftStatus = 'draft' | 'scheduled' | 'posting' | 'posted' | 'failed'
export type ViewId = 'drafts' | 'news' | 'replies' | 'queue' | 'settings'

export interface LlmSettings {
  provider: LlmProviderKind
  claude: { apiKey: string; model: string }
  openai: { apiKey: string; model: string }
  local: { baseUrl: string; model: string; apiKey: string }
}

export interface ThreadsSettings {
  accessToken: string
  userId: string
  username: string
}

export interface StyleSettings {
  notes: string
  samples: string[]
}

export interface AutoDraftSettings {
  enabled: boolean
  intervalMinutes: number
  maxPerRun: number
}

export interface AppSettings {
  theme: ThemeMode
  onboarded: boolean
  topics: string[]
  llm: LlmSettings
  threads: ThreadsSettings
  style: StyleSettings
  autoDraft: AutoDraftSettings
}

export interface Draft {
  id: string
  kind: DraftKind
  text: string
  topic?: string
  sourceTitle?: string
  sourceUrl?: string
  replyToId?: string
  replyToText?: string
  replyToUsername?: string
  status: DraftStatus
  scheduledAt?: number
  postedAt?: number
  threadsMediaId?: string
  permalink?: string
  error?: string
  createdAt: number
  updatedAt: number
}

export interface NewsItem {
  title: string
  link: string
  source: string
  publishedAt: number | null
  topic: string
}

export interface UnansweredReply {
  id: string
  text: string
  username: string
  timestamp: string
  rootPostId: string
  rootPostText: string
}

export interface TestResult {
  ok: boolean
  message: string
}

export interface GenerateResult {
  ok: boolean
  text: string
  message: string
}

export interface Toast {
  id: number
  kind: 'ok' | 'err'
  text: string
}

/** The IPC bridge exposed by electron/preload.ts as window.api. */
export interface BridgeApi {
  settingsGet(): Promise<AppSettings>
  settingsSet(settings: AppSettings): Promise<void>
  llmTest(llm: LlmSettings): Promise<TestResult>
  threadsTest(cfg: { accessToken: string; userId: string }): Promise<TestResult & { username?: string; userId?: string }>
  threadsScrapeStyle(count: number): Promise<{ ok: boolean; samples: string[]; message: string }>
  newsFetch(topic: string): Promise<NewsItem[]>
  generatePost(input: {
    topic: string
    newsTitle?: string
    newsSource?: string
    newsUrl?: string
  }): Promise<GenerateResult>
  generateReply(input: {
    replyText: string
    replyUsername: string
    rootPostText: string
  }): Promise<GenerateResult>
  unansweredReplies(): Promise<{ ok: boolean; replies: UnansweredReply[]; message: string }>
  draftsAll(): Promise<Draft[]>
  draftUpsert(draft: Draft): Promise<Draft[]>
  draftDelete(id: string): Promise<Draft[]>
  draftPostNow(id: string): Promise<{ ok: boolean; message: string; drafts: Draft[] }>
  openExternal(url: string): Promise<void>
  onDraftsChanged(cb: (drafts: Draft[]) => void): void
}

export const DEFAULT_TOPICS = ['artificial intelligence', 'technology', 'startups']

export const LLM_DEFAULTS = {
  claudeModel: 'claude-sonnet-5',
  openaiModel: 'gpt-4o-mini',
  localBaseUrl: 'http://localhost:11434/v1',
  localModel: 'llama3.1',
} as const
