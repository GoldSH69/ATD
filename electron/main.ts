import { app, BrowserWindow, ipcMain, shell } from 'electron'
import * as path from 'path'
import { getSettings, setSettings } from './settings'
import { testLlm } from './llm'
import { generatePostDraft, generateReplyDraft } from './pipeline'
import { testThreads, scrapeRecentTexts, fetchUnansweredReplies } from './threadsApi'
import { startThreadsOAuth } from './threadsOAuth'
import { fetchTopicNews } from './news'
import { generateImageKeywords, searchImages } from './images'
import { allDrafts, upsertDraft, deleteDraft, setDraftsChangedListener } from './drafts'
import { startScheduler, postDraftNow } from './scheduler'
import type { AppSettings, Draft, LlmSettings } from './types'

// Two instances would race the scheduler and drafts store on the same files.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err))

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return false
  }
}

function createWindow(): BrowserWindow {
  const theme = getSettings().theme
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: theme === 'dark' ? '#0e0e0e' : '#ffffff',
    autoHideMenuBar: true,
    title: 'AutoThreads',
    icon: path.join(__dirname, '../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Any window.open / target=_blank goes to the system browser, never a child window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    const devUrl = process.env.VITE_DEV_SERVER_URL
    // Compare parsed origins, not string prefixes: "http://localhost:5174@evil.com"
    // startsWith-passes but resolves to evil.com, which would inherit the preload bridge.
    if (devUrl && sameOrigin(url, devUrl)) return
    e.preventDefault()
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
  return win
}

app.whenReady().then(() => {
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', async (_e, settings: AppSettings) => {
    await setSettings(settings)
  })

  ipcMain.handle('llm:test', (_e, llm: LlmSettings) => testLlm(llm))
  ipcMain.handle('llm:generate-post', (_e, input: Parameters<typeof generatePostDraft>[0]) =>
    generatePostDraft(input)
  )
  ipcMain.handle('llm:generate-reply', (_e, input: Parameters<typeof generateReplyDraft>[0]) =>
    generateReplyDraft(input)
  )

  ipcMain.handle('threads:test', (_e, cfg: { accessToken: string; userId: string }) =>
    testThreads(cfg)
  )
  ipcMain.handle('threads:oauth-start', (_e, cfg: Parameters<typeof startThreadsOAuth>[0]) =>
    startThreadsOAuth(cfg)
  )
  ipcMain.handle('threads:scrape-style', async (_e, count: number) => {
    const threads = getSettings().threads
    if (!threads.accessToken) {
      return { ok: false, samples: [], message: 'Threads API is not configured — save credentials in Settings first.' }
    }
    try {
      const limit = Math.max(1, Math.min(50, Math.floor(Number(count)) || 10))
      const samples = await scrapeRecentTexts(threads, limit)
      if (samples.length === 0) {
        return { ok: false, samples: [], message: 'No text posts found on this Threads account.' }
      }
      return { ok: true, samples, message: `Imported ${samples.length} recent posts as style samples.` }
    } catch (err) {
      return { ok: false, samples: [], message: errMsg(err) }
    }
  })
  ipcMain.handle('threads:unanswered', async () => {
    const threads = getSettings().threads
    if (!threads.accessToken) {
      return { ok: false, replies: [], message: 'Threads API is not configured — save credentials in Settings first.' }
    }
    try {
      const replies = await fetchUnansweredReplies(threads)
      return { ok: true, replies, message: '' }
    } catch (err) {
      return { ok: false, replies: [], message: errMsg(err) }
    }
  })

  ipcMain.handle('news:fetch', (_e, topic: string) => fetchTopicNews(String(topic ?? '').trim()))
  ipcMain.handle('images:keywords', (_e, input: Parameters<typeof generateImageKeywords>[0]) =>
    generateImageKeywords(input)
  )
  ipcMain.handle('images:search', (_e, query: string) => searchImages(String(query ?? '').trim()))

  ipcMain.handle('drafts:all', () => allDrafts())
  ipcMain.handle('drafts:upsert', (_e, draft: Draft) => upsertDraft(draft))
  ipcMain.handle('drafts:delete', (_e, id: string) => deleteDraft(id))
  ipcMain.handle('drafts:post-now', async (_e, id: string) => {
    const res = await postDraftNow(id)
    return { ...res, drafts: allDrafts() }
  })

  ipcMain.handle('app:open-external', (_e, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) return shell.openExternal(url)
    return Promise.resolve()
  })

  setDraftsChangedListener((drafts) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.webContents.isDestroyed()) win.webContents.send('drafts:changed', drafts)
    }
  })

  createWindow()
  startScheduler()

  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
