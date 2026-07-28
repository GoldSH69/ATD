import * as fs from 'fs'
import * as path from 'path'
import { fetchGoogleNews } from './services/news'
import { generateContentWithGemini } from './services/gemini'
import { publishPost, type ThreadsConfig } from './services/threads'

interface Config {
  enabled: boolean
  goLive: boolean
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

async function main() {
  const args = process.argv.slice(2)
  const isDryRun = args.includes('--dry-run')

  console.log('🤖 AutoThreads Bot Engine Starting...')

  const rootDir = path.resolve(__dirname, '..')
  const dataDir = path.join(rootDir, 'data')
  const configPath = path.join(dataDir, 'config.json')
  const logsPath = path.join(dataDir, 'logs.json')
  const usedArticlesPath = path.join(dataDir, 'used_articles.json')

  if (!fs.existsSync(configPath)) {
    console.error('❌ Error: data/config.json file not found!')
    process.exit(1)
  }

  const config: Config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  let logs: LogEntry[] = fs.existsSync(logsPath) ? JSON.parse(fs.readFileSync(logsPath, 'utf8')) : []
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

  // Safety Caps Guard: Max 4 posts per 24 hours
  const ONE_DAY_MS = 24 * 60 * 60 * 1000
  const now = Date.now()
  const postsLast24h = logs.filter(
    (l) => l.kind === 'post' && now - l.at < ONE_DAY_MS && !l.message.includes('Dry-run') && !l.message.includes('초안')
  ).length

  if (postsLast24h >= config.maxPostsPerDay) {
    console.log(`🛡️  Safety Cap Reached: ${postsLast24h}/${config.maxPostsPerDay} posts published in the last 24h. Skipping run.`)
    addLog('info', `Safety cap reached (${postsLast24h}/${config.maxPostsPerDay} posts/24h). Skipping run.`)
    fs.writeFileSync(logsPath, JSON.stringify(logs, null, 2))
    process.exit(0)
  }

  // Safety Interval Guard: Min 60 minutes between posts
  const MIN_INTERVAL_MS = 60 * 60 * 1000
  const lastPostLog = logs.find((l) => l.kind === 'post' && !l.message.includes('Dry-run') && !l.message.includes('초안'))
  if (lastPostLog && now - lastPostLog.at < MIN_INTERVAL_MS) {
    const minLeft = Math.ceil((MIN_INTERVAL_MS - (now - lastPostLog.at)) / 60000)
    console.log(`🛡️  Minimum post interval safety guard: Last post was ${Math.round((now - lastPostLog.at) / 60000)}m ago. Must wait ${minLeft}m.`)
    addLog('info', `Minimum post interval guard (must wait ${minLeft}m). Skipping run.`)
    fs.writeFileSync(logsPath, JSON.stringify(logs, null, 2))
    process.exit(0)
  }

  const topicsList = config.topics.length > 0 ? config.topics : ['AI', '기술', '관계심리학', '생산성']
  const shuffledTopics = [...topicsList].sort(() => 0.5 - Math.random())

  let selectedNews: { title: string; source: string } | null = null
  let selectedTopic = ''

  for (const t of shuffledTopics) {
    console.log(`🔍 Checking news for topic: "${t}"...`)
    const newsList = await fetchGoogleNews(t)
    const freshNews = newsList.filter((n) => !usedArticles.includes(n.title))
    if (freshNews.length > 0) {
      selectedNews = freshNews[Math.floor(Math.random() * freshNews.length)]
      selectedTopic = t
      break
    }
  }

  let prompt = ''
  if (selectedNews) {
    console.log(`📰 Selected article for "${selectedTopic}": "${selectedNews.title}" (${selectedNews.source})`)
    prompt = `You are an engaging Threads creator named "${config.agentName}" for "${config.creatorName}".
Goal: ${config.goal}
Tone: ${config.toneNotes}
Language: Korean (한국어)

Write a high-quality Threads post about this news story:
Topic: ${selectedTopic}
News Title: ${selectedNews.title}
News Source: ${selectedNews.source}

STRICT FORMATTING & CONTENT RULES:
1. MUST fit within a single mobile Threads screen (under 400 characters).
2. DO NOT just quote the title. Explain 2-3 concise, clear lines summarizing WHAT happened in the news so readers understand the core facts without clicking.
3. Add 1-2 lines of human perspective or why this topic matters.
4. The LAST LINE MUST be a CREATIVE, TOPIC-SPECIFIC question that directly references the specific subject in the news. NEVER use boilerplate questions like "여러분은 어떻게 생각하시나요?".
5. NO robotic prefixes like "🤖 [AI 생성 포스트]". NO formal corporate jargon for casual/humor topics.
6. Output ONLY the final post body text in Korean.`
  } else {
    selectedTopic = shuffledTopics[0] || '관계심리학'
    console.log(`💡 No news found or non-news topic selected ("${selectedTopic}"). Generating AI Original Content Post...`)
    prompt = `You are an engaging Threads creator named "${config.agentName}" for "${config.creatorName}".
Goal: ${config.goal}
Tone: ${config.toneNotes}
Language: Korean (한국어)

Write a high-quality, highly engaging ORIGINAL Threads post (NOT a news post) about the topic: "${selectedTopic}" (e.g. Relationship Psychology, Human Nature, Productivity, Self-Improvement, or Life Advice).

STRICT FORMATTING & CONTENT RULES:
1. MUST fit within a single mobile Threads screen (under 400 characters).
2. Start with a catchy headline or intriguing psychological/life insight.
3. Explain 2-3 concise, actionable lines with concrete principles, examples, or wisdom that readers can immediately relate to.
4. The LAST LINE MUST be a CREATIVE, TOPIC-SPECIFIC question asking readers about their personal experience or opinion on this specific topic.
5. Make it sound 100% human, warm, and conversational. NO robotic prefixes.
6. Output ONLY the final post body text in Korean.`
  }

  if (!geminiApiKey) {
    const msg = 'GEMINI_API_KEY environment variable is not set.'
    if (isDryRun) {
      console.warn(`⚠️  ${msg} Skipping AI generation in dry-run.`)
      addLog('info', `[Dry-run] Topic: ${selectedTopic}`)
    } else {
      addLog('error', msg)
      fs.writeFileSync(logsPath, JSON.stringify(logs, null, 2))
      process.exit(1)
    }
    fs.writeFileSync(logsPath, JSON.stringify(logs, null, 2))
    return
  }

  console.log('🤖 Generating post content with Gemini API...')
  try {
    const postText = await generateContentWithGemini(prompt, { apiKey: geminiApiKey })
    console.log('\n--- Generated Post ---')
    console.log(postText)
    console.log('----------------------\n')

    if (isDryRun || !threadsAccessToken) {
      addLog('info', `[Dry-run / Preview] ${postText.slice(0, 80)}...`)
    } else if (config.goLive === false) {
      console.log('📝 Draft-only mode is enabled (goLive: false). Skipping live publication.')
      addLog('info', `📝 [Draft Mode / 컨펌 대기] AI가 포스트를 생성했습니다: "${postText.slice(0, 60)}..."`)
      if (selectedNews) {
        usedArticles.push(selectedNews.title)
        if (usedArticles.length > 200) usedArticles = usedArticles.slice(-200)
        fs.writeFileSync(usedArticlesPath, JSON.stringify(usedArticles, null, 2))
      }
    } else {
      console.log('🚀 Publishing post to Threads API...')
      const threadsConfig: ThreadsConfig = {
        accessToken: threadsAccessToken,
        userId: threadsUserId,
      }
      const res = await publishPost(threadsConfig, postText)
      addLog('post', `Successfully published post: "${postText.slice(0, 60)}..."`, res.permalink)

      if (selectedNews) {
        usedArticles.push(selectedNews.title)
        if (usedArticles.length > 200) usedArticles = usedArticles.slice(-200)
        fs.writeFileSync(usedArticlesPath, JSON.stringify(usedArticles, null, 2))
      }
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    addLog('error', `Failed to generate or publish post: ${errorMsg}`)
  }

  fs.writeFileSync(logsPath, JSON.stringify(logs, null, 2))
  console.log('✅ AutoThreads Bot execution complete.')
}

main().catch((err) => {
  console.error('💥 Unhandled bot execution error:', err)
  process.exit(1)
})
