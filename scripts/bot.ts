import * as fs from 'fs'
import * as path from 'path'
import { fetchGoogleNews } from './services/news'
import { generateContentWithGemini } from './services/gemini'

interface Config {
  enabled: boolean
  goLive: boolean
  autoApprove?: boolean
  scheduleMode?: 'interval' | 'times'
  postingTimes?: string[]
  intervalMinutes: number
  replyIntervalMinutes: number
  maxPostsPerDay: number
  maxRepliesPerDay: number
  goal: string
  topics: string[]
  categories: string[]
  postLanguage: string
  toneNotes: string
  agentName: string
  creatorName: string
  creatorHandle: string
  autoReply: boolean
}

interface LogEntry {
  id: string
  at: number
  kind: 'post' | 'reply' | 'info' | 'error'
  message: string
  permalink?: string
}

interface DraftItem {
  id: string
  kind: 'post' | 'reply'
  text: string
  topic?: string
  sourceTitle?: string
  sourceUrl?: string
  status: 'draft' | 'scheduled' | 'posting' | 'posted' | 'failed'
  scheduledAt?: number
  createdAt: number
  updatedAt: number
}

function computeJitterTime(targetHour: number, targetMin: number): number {
  const d = new Date()
  d.setHours(targetHour, targetMin, 0, 0)
  // Random jitter of ±10 minutes
  const jitterMs = (Math.floor(Math.random() * 21) - 10) * 60 * 1000
  return d.getTime() + jitterMs
}

async function main() {
  console.log('🤖 AutoThreads 02:00 AM Daily Batch Engine Starting...')

  const rootDir = path.resolve(__dirname, '..')
  const dataDir = path.join(rootDir, 'data')
  const configPath = path.join(dataDir, 'config.json')
  const logsPath = path.join(dataDir, 'logs.json')
  const draftsPath = path.join(dataDir, 'drafts.json')
  const usedArticlesPath = path.join(dataDir, 'used_articles.json')

  if (!fs.existsSync(configPath)) {
    console.error('❌ Error: data/config.json file not found!')
    process.exit(1)
  }

  const config: Config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  let logs: LogEntry[] = fs.existsSync(logsPath) ? JSON.parse(fs.readFileSync(logsPath, 'utf8')) : []
  let drafts: DraftItem[] = fs.existsSync(draftsPath) ? JSON.parse(fs.readFileSync(draftsPath, 'utf8')) : []
  let usedArticles: string[] = fs.existsSync(usedArticlesPath)
    ? JSON.parse(fs.readFileSync(usedArticlesPath, 'utf8'))
    : []

  const geminiApiKey = process.env.GEMINI_API_KEY || ''

  const addLog = (kind: LogEntry['kind'], message: string, permalink?: string) => {
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      at: Date.now(),
      kind,
      message,
      permalink,
    }
    logs.unshift(entry)
    if (logs.length > 200) logs = logs.slice(0, 200)
    console.log(`[LOG:${kind.toUpperCase()}] ${message}`)
  }

  if (!config.enabled) {
    console.log('🛑 AutoThreads bot is disabled in config.json (enabled = false). Exiting.')
    process.exit(0)
  }

  const ONE_DAY_MS = 24 * 60 * 60 * 1000
  const now = Date.now()
  const todayDrafts = drafts.filter((d) => now - d.createdAt < ONE_DAY_MS && d.kind === 'post')

  const topicsList = config.topics.length > 0 ? config.topics : ['AI', '기술', '스타트업', '관계심리학', '생산성']
  const targetSlots = [
    { hour: 6, min: 0 },
    { hour: 11, min: 30 },
    { hour: 15, min: 0 },
    { hour: 18, min: 0 },
    { hour: 21, min: 0 },
  ]

  if (todayDrafts.length < 5) {
    console.log(`🌅 Starting 02:00 AM Batch Generation for today's 5 posts...`)

    const generatedBatch: DraftItem[] = []
    const countToGenerate = 5 - todayDrafts.length

    for (let i = 0; i < countToGenerate; i++) {
      const topic = topicsList[i % topicsList.length]
      console.log(`🔍 Context fetch for Topic [${i + 1}/${countToGenerate}]: "${topic}"...`)

      const newsList = await fetchGoogleNews(topic)
      const freshNews = newsList.filter((n) => !usedArticles.includes(n.title))
      const selectedNews = freshNews.length > 0 ? freshNews[0] : null

      let prompt = ''
      if (selectedNews) {
        usedArticles.push(selectedNews.title)
        prompt = `You are an engaging Threads creator named "${config.agentName}".
Topic: ${topic}
News Title: ${selectedNews.title}
News Source: ${selectedNews.source}

STRICT RULES:
1. MUST fit within a single mobile Threads screen (STRICTLY UNDER 300 Korean characters).
2. Summarize 2-3 concise, clear lines explaining WHAT happened in the news so readers understand facts without clicking.
3. Add 1-2 lines of human perspective or why this topic matters.
4. The LAST LINE MUST be a CREATIVE, TOPIC-SPECIFIC question. NO generic "어떻게 생각하시나요?".
5. NO robotic prefixes like 🤖. Output ONLY the final post body text in Korean.`
      } else {
        prompt = `You are an engaging Threads creator named "${config.agentName}".
Topic: ${topic} (Relationship Psychology, Self-Improvement, Productivity, or Technology Insight)

STRICT RULES:
1. MUST fit within a single mobile Threads screen (STRICTLY UNDER 300 Korean characters).
2. Start with a catchy headline or intriguing psychological/life principle.
3. Explain 2-3 concise, actionable lines with concrete wisdom or examples.
4. The LAST LINE MUST be a CREATIVE, TOPIC-SPECIFIC question directly related to this topic.
5. Make it sound 100% human, warm, and conversational. NO robotic prefixes like 🤖.
6. Output ONLY the final post body text in Korean.`
      }

      let postText = ''
      if (geminiApiKey) {
        try {
          postText = await generateContentWithGemini(prompt, { apiKey: geminiApiKey })
        } catch {
          postText = `💡 ${topic} 관련 인사이트\n\n일상 속 이슈를 새로운 시각으로 분석하고 생각할 거리를 남기는 포스트입니다.\n\n여러분은 이 내용에 대해 어떻게 생각하시나요?`
        }
      } else {
        postText = `💡 ${topic} 관련 인사이트\n\n일상 속 이슈를 새로운 시각으로 분석하고 생각할 거리를 남기는 포스트입니다.\n\n여러분은 이 내용에 대해 어떻게 생각하시나요?`
      }

      const isAuto = config.autoApprove === true
      const draftStatus = isAuto ? 'scheduled' : 'draft'
      const slot = targetSlots[i % targetSlots.length]
      const scheduledAt = isAuto ? computeJitterTime(slot.hour, slot.min) : undefined

      const item: DraftItem = {
        id: `draft-${now}-${i}-${Math.random().toString(36).slice(2, 6)}`,
        kind: 'post',
        text: postText,
        topic,
        sourceTitle: selectedNews?.title,
        sourceUrl: selectedNews?.link,
        status: draftStatus,
        scheduledAt,
        createdAt: now,
        updatedAt: now,
      }

      generatedBatch.push(item)
      drafts.unshift(item)
    }

    if (usedArticles.length > 200) usedArticles = usedArticles.slice(-200)
    fs.writeFileSync(usedArticlesPath, JSON.stringify(usedArticles, null, 2))
    fs.writeFileSync(draftsPath, JSON.stringify(drafts, null, 2))

    const modeText = config.autoApprove
      ? '자동 승인 무작위 노이즈 시각 예약 등록 완료 (20분 주기 봇이 실시간 발행)'
      : '수동 승인(Manual) 검토 대기 중 (초안 탭에서 검토/예약 대기)'
    addLog('info', `🌅 하루치 포스트 ${generatedBatch.length}개 일괄 창작 완료 (${modeText})`)

    fs.writeFileSync(logsPath, JSON.stringify(logs, null, 2))
    console.log('✅ Batch generation complete.')
    return
  }

  console.log('ℹ️ Today\'s batch posts are already generated.')
}

main().catch((err) => {
  console.error('💥 Unhandled bot execution error:', err)
  process.exit(1)
})
