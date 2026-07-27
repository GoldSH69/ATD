"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('api', {
    settingsGet: () => electron_1.ipcRenderer.invoke('settings:get'),
    settingsSet: (settings) => electron_1.ipcRenderer.invoke('settings:set', settings),
    llmTest: (llm) => electron_1.ipcRenderer.invoke('llm:test', llm),
    threadsOAuthStart: (cfg) => electron_1.ipcRenderer.invoke('threads:oauth-start', cfg),
    threadsTest: (cfg) => electron_1.ipcRenderer.invoke('threads:test', cfg),
    threadsScrapeStyle: (count) => electron_1.ipcRenderer.invoke('threads:scrape-style', count),
    newsFetch: (input) => electron_1.ipcRenderer.invoke('news:fetch', input),
    generatePost: (input) => electron_1.ipcRenderer.invoke('llm:generate-post', input),
    generateReply: (input) => electron_1.ipcRenderer.invoke('llm:generate-reply', input),
    imageKeywords: (input) => electron_1.ipcRenderer.invoke('images:keywords', input),
    imageSearch: (query) => electron_1.ipcRenderer.invoke('images:search', query),
    unansweredReplies: () => electron_1.ipcRenderer.invoke('threads:unanswered'),
    draftsAll: () => electron_1.ipcRenderer.invoke('drafts:all'),
    draftUpsert: (draft) => electron_1.ipcRenderer.invoke('drafts:upsert', draft),
    draftDelete: (id) => electron_1.ipcRenderer.invoke('drafts:delete', id),
    draftPostNow: (id) => electron_1.ipcRenderer.invoke('drafts:post-now', id),
    autopilotStatus: () => electron_1.ipcRenderer.invoke('autopilot:status'),
    autopilotSetRunning: (running) => electron_1.ipcRenderer.invoke('autopilot:set-running', running),
    autopilotRunNow: () => electron_1.ipcRenderer.invoke('autopilot:run-now'),
    openExternal: (url) => electron_1.ipcRenderer.invoke('app:open-external', url),
    onDraftsChanged: (cb) => electron_1.ipcRenderer.on('drafts:changed', (_e, drafts) => cb(drafts)),
    onAutopilotStatus: (cb) => electron_1.ipcRenderer.on('autopilot:status', (_e, status) => cb(status)),
});
