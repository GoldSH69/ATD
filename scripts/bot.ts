import * as fs from 'fs'
import * as path from 'path'
import { fetchGoogleNews } from './services/news'
import { generateContentWithGemini } from './services/gemini'
import { publishPost, type ThreadsConfig } from './services/threads'

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

async function main() {
  const args = process.argv.slice(2)
  const isDryRun = args.includes('--dry-run')

  console.log('🤖 AutoThreads 02:00 AM Batch Engine Starting...')

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
  const threadsAccessToken = process.env.THREADS_ACCESS_TOKEN || ''
  const threadsUserId = process.env.THREADS_USER_ID || ''

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

  const topicsList = config.topics.length > 0 ? config.topics : ['AI', '기술', '스타트업', '관계심리학', '생산성']
  const postingTimes = config.postingTimes || ['06:00', '11:30', '15:00', '18:00', '21:00']

  console.log(`🌅 Starting Early Morning Batch Generation for ${topicsList.length} topics...`)

  // Base date calculation for today KST
  const now = new Date()
  // Add 9h for KST if running on UTC server
  const kstOffsetMs = 9 * 60 * 60 * 1000
  const kstNow = new Date(now.getTime() + kstOffsetMs)

  const generatedCount = Math.min(5, topicsList.length)
  const newDrafts: DraftItem[] = []

  for (let i = 0; i < generatedCount; i++) {
    const topic = topicsList[i % topicsList.length]
    console.log(`\n🔍 Fetching context for Topic [${i + 1}/${generatedCount}]: "${topic}"...`)

    const newsList = await fetchGoogleNews(topic)
    const freshNews = newsList.filter((n) => !usedArticles.includes(n.title))
    const selectedNews = freshNews.length > 0 ? freshNews[0] : null

    let prompt = ''
    if (selectedNews) {
      console.log(`📰 Article: "${selectedNews.title}"`)
      usedArticles.push(selectedNews.title)
      prompt = `You are an engaging Threads creator named "${config.agentName}".
Topic: ${topic}
News Title: ${selectedNews.title}
News Source: ${selectedNews.source}

STRICT RULES:
1. MUST fit within a single mobile Threads screen (under 400 Korean characters).
2. Summarize 2-3 concise, clear lines explaining WHAT happened in the news so readers understand facts without clicking.
3. Add 1-2 lines of human perspective or why this topic matters.
4. The LAST LINE MUST be a CREATIVE, TOPIC-SPECIFIC question asking readers about their opinion or experience on this specific news item. NO generic "어떻게 생각하시나요?".
5. Output ONLY the final post body text in Korean.`
    } else {
      console.log(`💡 Non-news / Original Content Topic: "${topic}"`)
      prompt = `You are an engaging Threads creator named "${config.agentName}".
Topic: ${topic} (Relationship Psychology, Self-Improvement, Productivity, or Technology Insight)

STRICT RULES:
1. MUST fit within a single mobile Threads screen (under 400 Korean characters).
2. Start with a catchy headline or intriguing psychological/life principle.
3. Explain 2-3 concise, actionable lines with concrete wisdom or examples.
4. The LAST LINE MUST be a CREATIVE, TOPIC-SPECIFIC question directly related to this topic.
5. Make it sound 100% human, warm, and conversational. NO robotic prefixes.
6. Output ONLY the final post body text in Korean.`
    }

    let postText = ''
    if (geminiApiKey) {
      try {
        postText = await generateContentWithGemini(prompt, { apiKey: geminiApiKey })
      } catch (e) {
        postText = `💡 ${topic} 관련 시사점 리포트\n\n일상 속에서 접하는 다양한 이슈들을 새로운 시각으로 분석하고 생각할 거리를 남기는 내용입니다.\n\n여러분은 이 주제에 대해 어떻게 생각하시나요? 자유롭게 의견 남겨주세요!`
      }
    } else {
      postText = `💡 ${topic} 관련 시사점 리포트\n\n일상 속에서 접하는 다양한 이슈들을 새로운 시각으로 분석하고 생각할 거리를 남기는 내용입니다.\n\n여러분은 이 주제에 대해 어떻게 생각하시나요? 자유롭게 의견 남겨주세요!`
    }

    // Target Time Calculation with Random Jitter (±10 minutes)
    const targetTimeString = postingTimes[i % postingTimes.length] || '06:00'
    const [tHourStr, tMinStr] = targetTimeString.split(':')
    const tHour = parseInt(tHourStr, 10) || 6
    const tMin = parseInt(tMinStr, 10) || 0

    // Random jitter between -10 and +10 minutes
    const randomJitterMin = Math.floor(Math.random() * 21) - 10
    const targetKstDate = new Date(kstNow)
    targetKstDate.setHours(tHour, tMin + randomJitterMin, 0, 0)

    const isAuto = config.autoApprove === true
    const draftStatus = isAuto ? 'scheduled' : 'draft'

    const draftItem: DraftItem = {
      id: `draft-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      kind: 'post',
      text: postText,
      topic: topic,
      sourceTitle: selectedNews?.title,
      sourceUrl: selectedNews?.link,
      status: draftStatus,
      scheduledAt: targetKstDate.getTime(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    newDrafts.push(draftItem)
    drafts.unshift(draftItem)
    console.log(`✅ Draft [${i + 1}] Created (${draftStatus}): "${postText.slice(0, 40)}..." (Scheduled ~${targetTimeString} KST, jitter: ${randomJitterMin > 0 ? '+' : ''}${randomJitterMin}m)`)
  }

  if (usedArticles.length > 200) usedArticles = usedArticles.slice(-200)
  fs.writeFileSync(usedArticlesPath, JSON.stringify(usedArticles, null, 2))
  fs.writeFileSync(draftsPath, JSON.stringify(drafts, null, 2))

  const modeText = config.autoApprove ? '자동 승인(Auto Approve) 예약 완료' : '수동 승인(Manual Confirm) 대기'
  addLog('info', `🌅 새벽 02:00 일괄 포스트 ${newDrafts.length}개 생성 완료 (${modeText})`)
  fs.writeFileSync(logsPath, JSON.stringify(logs, null, 2))

  console.log(`\n🎉 Early Morning Batch Run Finished Successfully! Created ${newDrafts.length} posts.`)
}

main().catch((err) => {
  console.error('💥 Unhandled bot execution error:', err)
  process.exit(1)
})
