import * as fs from 'fs'
import * as path from 'path'
import { generateContentWithGemini } from './services/gemini'
import { publishPost, getUnansweredReplies, replyToThread, type ThreadsConfig } from './services/threads'

interface Config {
  enabled: boolean
  autoApprove?: boolean
  autoReply?: boolean
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

  console.log('⏰ AutoThreads 20-Min Periodic Scheduler Bot Starting...')

  const rootDir = path.resolve(__dirname, '..')
  const dataDir = path.join(rootDir, 'data')
  const configPath = path.join(dataDir, 'config.json')
  const logsPath = path.join(dataDir, 'logs.json')
  const draftsPath = path.join(dataDir, 'drafts.json')

  if (!fs.existsSync(configPath)) {
    console.error('❌ Error: data/config.json file not found!')
    process.exit(1)
  }

  const config: Config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  let logs: LogEntry[] = fs.existsSync(logsPath) ? JSON.parse(fs.readFileSync(logsPath, 'utf8')) : []
  let drafts: DraftItem[] = fs.existsSync(draftsPath) ? JSON.parse(fs.readFileSync(draftsPath, 'utf8')) : []

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

  const now = Date.now()

  // 1. Check for due scheduled posts (scheduledAt <= now)
  const dueDraft = drafts.find(
    (d) => d.status === 'scheduled' && d.kind === 'post' && typeof d.scheduledAt === 'number' && d.scheduledAt <= now
  )

  if (dueDraft) {
    console.log(`🚀 Found scheduled post due for publication: "${dueDraft.text.slice(0, 45)}..."`)
    if (isDryRun || !threadsAccessToken) {
      console.log(`[Dry-run] Would publish scheduled post to Threads: "${dueDraft.text.slice(0, 50)}..."`)
      addLog('info', `[Dry-run] Scheduled post preview: ${dueDraft.text.slice(0, 50)}...`)
    } else {
      try {
        const threadsConfig: ThreadsConfig = { accessToken: threadsAccessToken, userId: threadsUserId }
        const res = await publishPost(threadsConfig, dueDraft.text)
        dueDraft.status = 'posted'
        dueDraft.updatedAt = Date.now()
        fs.writeFileSync(draftsPath, JSON.stringify(drafts, null, 2))
        addLog('post', `🚀 [예약 포스팅] 20분 주기 봇이 지정 시각 포스트 발행 성공: "${dueDraft.text.slice(0, 45)}..."`, res.permalink)
      } catch (err) {
        dueDraft.status = 'failed'
        fs.writeFileSync(draftsPath, JSON.stringify(drafts, null, 2))
        addLog('error', `Failed to publish scheduled post: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  } else {
    console.log('ℹ️ No due scheduled posts found at this 20-min interval.')
  }

  // 2. Check for Auto-Reply if enabled
  if (config.autoReply && threadsAccessToken && !isDryRun) {
    try {
      const threadsConfig: ThreadsConfig = { accessToken: threadsAccessToken, userId: threadsUserId }
      const unanswered = await getUnansweredReplies(threadsConfig)
      if (unanswered && unanswered.length > 0) {
        const replyItem = unanswered[0]
        console.log(`💬 Found unanswered comment: "${replyItem.text}" by @${replyItem.username}`)
        
        let replyBody = ''
        if (geminiApiKey) {
          const replyPrompt = `Reply politely and warmly to this Threads comment from user @${replyItem.username}: "${replyItem.text}". Keep it under 100 Korean characters. Sound friendly and engaging.`
          try {
            replyBody = await generateContentWithGemini(replyPrompt, { apiKey: geminiApiKey })
          } catch {
            replyBody = `좋은 의견 감사드립니다! @${replyItem.username}님, 생각 공유해 주셔서 큰 도움이 되었어요 🌿`
          }
        } else {
          replyBody = `좋은 의견 감사드립니다! @${replyItem.username}님, 생각 공유해 주셔서 큰 도움이 되었어요 🌿`
        }

        const resReply = await replyToThread(threadsConfig, replyItem.id, replyBody)
        addLog('reply', `💬 [자동 답글] @${replyItem.username}님 댓글에 자동 답글 게재 완료: "${replyBody.slice(0, 35)}..."`, resReply.permalink)
      }
    } catch {
      // Ignore reply errors gracefully
    }
  }

  fs.writeFileSync(logsPath, JSON.stringify(logs, null, 2))
  console.log('✅ Periodic scheduler execution complete.')
}

main().catch((err) => {
  console.error('💥 Unhandled scheduler execution error:', err)
  process.exit(1)
})
