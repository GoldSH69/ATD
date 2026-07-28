import * as fs from 'fs'
import * as path from 'path'
import { fetchGoogleNews } from './services/news'
import { generateContentWithGemini } from './services/gemini'
import { publishPost, type ThreadsConfig } from './services/threads'

interface Config {
  enabled: boolean
  goLive: boolean
  intervalMinutes: number
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

const isDryRun = process.argv.includes('--dry-run')
const ONE_DAY_MS = 24 * 60 * 60 * 1000
const MIN_INTERVAL_MS = 60 * 60 * 1000 // Minimum 1 hour between live posts for safety

async function runBot() {
  console.log('🤖 AutoThreads GitHub Actions Bot started.')
  console.log(`Mode: ${isDryRun ? 'DRY-RUN (Simulated)' : 'LIVE (Posting enabled)'}`)

  const configPath = path.join(process.cwd(), 'data', 'config.json')
  const logsPath = path.join(process.cwd(), 'data', 'logs.json')
  const usedArticlesPath = path.join(process.cwd(), 'data', 'used_articles.json')

  if (!fs.existsSync(configPath)) {
    console.error('Config file data/config.json not found!')
    process.exit(1)
  }

  const config: Config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))

  if (!config.enabled && !isDryRun) {
    console.log('Bot is disabled in data/config.json. Exiting.')
    return
  }

  const geminiApiKey = process.env.GEMINI_API_KEY || ''
  const threadsAccessToken = process.env.THREADS_ACCESS_TOKEN || ''
  const threadsUserId = process.env.THREADS_USER_ID || 'me'

  let logs: LogEntry[] = []
  if (fs.existsSync(logsPath)) {
    try {
      logs = JSON.parse(fs.readFileSync(logsPath, 'utf-8'))
    } catch {
      logs = []
    }
  }

  let usedArticles: string[] = []
  if (fs.existsSync(usedArticlesPath)) {
    try {
      usedArticles = JSON.parse(fs.readFileSync(usedArticlesPath, 'utf-8'))
    } catch {
      usedArticles = []
    }
  }

  const addLog = (kind: LogEntry['kind'], message: string, permalink?: string) => {
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      at: Date.now(),
      kind,
      message,
      permalink,
    }
    logs.unshift(entry)
    if (logs.length > 100) logs = logs.slice(0, 100)
    console.log(`[${kind.toUpperCase()}] ${message}`)
  }

  // --- 🛡️ SAFETY GUARD 1: Daily Post Cap Check ---
  const posts24h = logs.filter(
    (l) => l.kind === 'post' && Date.now() - l.at < ONE_DAY_MS && !l.message.includes('Dry-run')
  )
  const maxPostsPerDay = config.maxPostsPerDay || 4

  if (!isDryRun && posts24h.length >= maxPostsPerDay) {
    addLog(
      'info',
      `🛡️ Safety Guard: Reached daily post cap (${posts24h.length}/${maxPostsPerDay} posts in last 24h). Skipping run to protect account safety.`
    )
    fs.writeFileSync(logsPath, JSON.stringify(logs, null, 2))
    return
  }

  // --- 🛡️ SAFETY GUARD 2: Minimum Interval Check ---
  const lastPost = logs.find((l) => l.kind === 'post' && !l.message.includes('Dry-run'))
  if (!isDryRun && lastPost && Date.now() - lastPost.at < MIN_INTERVAL_MS) {
    const elapsedMinutes = Math.floor((Date.now() - lastPost.at) / 60000)
    addLog(
      'info',
      `🛡️ Safety Guard: Only ${elapsedMinutes} minutes elapsed since last post. Enforcing minimum 60-minute interval. Skipping run.`
    )
    fs.writeFileSync(logsPath, JSON.stringify(logs, null, 2))
    return
  }

  // Pick a topic
  const topicsList = config.topics.length > 0 ? config.topics : ['AI', '기술', '생산성']
  const topic = topicsList[Math.floor(Math.random() * topicsList.length)]

  console.log(`🔍 Fetching news for topic: "${topic}"...`)
  const newsList = await fetchGoogleNews(topic)

  // Filter out articles that have already been posted
  const freshNews = newsList.filter((n) => !usedArticles.includes(n.title))

  if (freshNews.length === 0) {
    addLog('info', `No new unposted articles found for topic "${topic}". Skipping run.`)
    fs.writeFileSync(logsPath, JSON.stringify(logs, null, 2))
    return
  }

  const selectedNews = freshNews[Math.floor(Math.random() * freshNews.length)]
  console.log(`📰 Selected article: "${selectedNews.title}" (${selectedNews.source})`)

  if (!geminiApiKey) {
    const msg = 'GEMINI_API_KEY environment variable is not set.'
    if (isDryRun) {
      console.warn(`⚠️  ${msg} Skipping AI generation in dry-run.`)
      addLog('info', `[Dry-run] Selected article: ${selectedNews.title}`)
    } else {
      addLog('error', msg)
      fs.writeFileSync(logsPath, JSON.stringify(logs, null, 2))
      process.exit(1)
    }
    fs.writeFileSync(logsPath, JSON.stringify(logs, null, 2))
    return
  }

  const prompt = `You are an engaging Threads creator named "${config.agentName}" for "${config.creatorName}".
Goal: ${config.goal}
Tone: ${config.toneNotes}
Language: Korean (한국어)

Write a high-quality Threads post about this news story:
Topic: ${category}
News Title: ${selectedNews.title}
News Source: ${selectedNews.source}

STRICT FORMATTING & CONTENT RULES:
1. MUST fit within a single mobile Threads screen (under 400 characters).
2. DO NOT just quote the title. Explain 2-3 concise, clear lines summarizing WHAT happened in the news so readers understand the core facts without clicking.
3. Add 1-2 lines of human perspective or why this topic matters.
4. The LAST LINE MUST be a CREATIVE, TOPIC-SPECIFIC question that directly references the specific subject, product, technology, or joke in the news (e.g. asking readers about their specific experience or opinion on that exact topic). NEVER repeat generic boilerplate questions like "여러분은 어떻게 생각하시나요?".
5. NO robotic prefixes like "🤖 [AI 생성 포스트]". NO formal corporate jargon for casual/humor topics.
6. Output ONLY the final post body text in Korean.`



  console.log('🤖 Generating post content with Gemini API...')
  try {
    const postText = await generateContentWithGemini(prompt, { apiKey: geminiApiKey })
    console.log('\n--- Generated Post ---')
    console.log(postText)
    console.log('----------------------\n')

    if (isDryRun || !threadsAccessToken) {
      addLog('post', `[Dry-run / Preview] ${postText.slice(0, 80)}...`)
    } else if (config.goLive === false) {
      console.log('📝 Draft-only mode is enabled (goLive: false). Skipping live publication.')
      addLog('info', `📝 [Draft Mode / 컨펌 대기] AI가 포스트를 생성했습니다: "${postText.slice(0, 60)}..."`)
      usedArticles.push(selectedNews.title)
      if (usedArticles.length > 200) usedArticles = usedArticles.slice(-200)
      fs.writeFileSync(usedArticlesPath, JSON.stringify(usedArticles, null, 2))
    } else {
      console.log('🚀 Publishing post to Threads API...')
      const threadsConfig: ThreadsConfig = {
        accessToken: threadsAccessToken,
        userId: threadsUserId,
      }
      const res = await publishPost(threadsConfig, postText)
      addLog('post', `Successfully published post: "${postText.slice(0, 60)}..."`, res.permalink)

      // Save article to used_articles history
      usedArticles.push(selectedNews.title)
      if (usedArticles.length > 200) usedArticles = usedArticles.slice(-200)
      fs.writeFileSync(usedArticlesPath, JSON.stringify(usedArticles, null, 2))
    }

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    addLog('error', `Failed to generate or publish post: ${errorMsg}`)
  }

  fs.writeFileSync(logsPath, JSON.stringify(logs, null, 2))
  console.log('✅ Bot execution complete.')
}

runBot().catch((err) => {
  console.error('Fatal Bot Error:', err)
  process.exit(1)
})
