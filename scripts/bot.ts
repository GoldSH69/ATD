import * as fs from 'fs'
import * as path from 'path'
import { fetchGoogleNews } from './services/news'
import { generateContentWithGemini } from './services/gemini'
import { publishPost, type ThreadsConfig } from './services/threads'

interface Config {
  enabled: boolean
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

async function runBot() {
  console.log('🤖 AutoThreads GitHub Actions Bot started.')
  console.log(`Mode: ${isDryRun ? 'DRY-RUN (Simulated)' : 'LIVE (Posting enabled)'}`)

  const configPath = path.join(process.cwd(), 'data', 'config.json')
  const logsPath = path.join(process.cwd(), 'data', 'logs.json')

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

  // Pick a random topic/category
  const topicsList = config.topics.length > 0 ? config.topics : ['AI', '기술', '생산성']
  const topic = topicsList[Math.floor(Math.random() * topicsList.length)]

  console.log(`🔍 Fetching news for topic: "${topic}"...`)
  const newsList = await fetchGoogleNews(topic)

  if (newsList.length === 0) {
    addLog('info', `No news articles found for topic "${topic}". Skipping run.`)
    fs.writeFileSync(logsPath, JSON.stringify(logs, null, 2))
    return
  }

  const selectedNews = newsList[Math.floor(Math.random() * newsList.length)]
  console.log(`📰 Selected article: "${selectedNews.title}" (${selectedNews.source})`)

  if (!geminiApiKey) {
    const msg = 'GEMINI_API_KEY environment variable is not set.'
    if (isDryRun) {
      console.warn(`⚠️  ${msg} Skipping AI generation in dry-run.`)
      addLog('info', `[Dry-run] Article selected: ${selectedNews.title}`)
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

Write a short, engaging Threads post (under 300 characters) about this news story:
Title: ${selectedNews.title}
Source: ${selectedNews.source}

Rules:
1. Make it sound natural, human, and conversational.
2. End with an open-ended question to invite comments.
3. Do NOT use hashtags or robotic corporate language.
4. Output ONLY the post body text in Korean.`

  console.log('🤖 Generating post content with Gemini API...')
  try {
    const postText = await generateContentWithGemini(prompt, { apiKey: geminiApiKey })
    console.log('\n--- Generated Post ---')
    console.log(postText)
    console.log('----------------------\n')

    if (isDryRun || !threadsAccessToken) {
      addLog('post', `[Dry-run / Preview] ${postText.slice(0, 80)}...`)
    } else {
      console.log('🚀 Publishing post to Threads API...')
      const threadsConfig: ThreadsConfig = {
        accessToken: threadsAccessToken,
        userId: threadsUserId,
      }
      const res = await publishPost(threadsConfig, postText)
      addLog('post', `Successfully published post: "${postText.slice(0, 60)}..."`, res.permalink)
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
