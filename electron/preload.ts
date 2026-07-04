import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSet: (settings: unknown) => ipcRenderer.invoke('settings:set', settings),
  llmTest: (llm: unknown) => ipcRenderer.invoke('llm:test', llm),
  threadsOAuthStart: (cfg: unknown) => ipcRenderer.invoke('threads:oauth-start', cfg),
  threadsTest: (cfg: unknown) => ipcRenderer.invoke('threads:test', cfg),
  threadsScrapeStyle: (count: number) => ipcRenderer.invoke('threads:scrape-style', count),
  newsFetch: (topic: string) => ipcRenderer.invoke('news:fetch', topic),
  generatePost: (input: unknown) => ipcRenderer.invoke('llm:generate-post', input),
  generateReply: (input: unknown) => ipcRenderer.invoke('llm:generate-reply', input),
  imageKeywords: (input: unknown) => ipcRenderer.invoke('images:keywords', input),
  imageSearch: (query: string) => ipcRenderer.invoke('images:search', query),
  unansweredReplies: () => ipcRenderer.invoke('threads:unanswered'),
  draftsAll: () => ipcRenderer.invoke('drafts:all'),
  draftUpsert: (draft: unknown) => ipcRenderer.invoke('drafts:upsert', draft),
  draftDelete: (id: string) => ipcRenderer.invoke('drafts:delete', id),
  draftPostNow: (id: string) => ipcRenderer.invoke('drafts:post-now', id),
  openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url),
  onDraftsChanged: (cb: (drafts: unknown) => void) =>
    ipcRenderer.on('drafts:changed', (_e, drafts) => cb(drafts)),
})
