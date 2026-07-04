"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('api', {
    settingsGet: () => electron_1.ipcRenderer.invoke('settings:get'),
    settingsSet: (settings) => electron_1.ipcRenderer.invoke('settings:set', settings),
    llmTest: (llm) => electron_1.ipcRenderer.invoke('llm:test', llm),
    threadsTest: (cfg) => electron_1.ipcRenderer.invoke('threads:test', cfg),
    threadsScrapeStyle: (count) => electron_1.ipcRenderer.invoke('threads:scrape-style', count),
    newsFetch: (topic) => electron_1.ipcRenderer.invoke('news:fetch', topic),
    generatePost: (input) => electron_1.ipcRenderer.invoke('llm:generate-post', input),
    generateReply: (input) => electron_1.ipcRenderer.invoke('llm:generate-reply', input),
    unansweredReplies: () => electron_1.ipcRenderer.invoke('threads:unanswered'),
    draftsAll: () => electron_1.ipcRenderer.invoke('drafts:all'),
    draftUpsert: (draft) => electron_1.ipcRenderer.invoke('drafts:upsert', draft),
    draftDelete: (id) => electron_1.ipcRenderer.invoke('drafts:delete', id),
    draftPostNow: (id) => electron_1.ipcRenderer.invoke('drafts:post-now', id),
    openExternal: (url) => electron_1.ipcRenderer.invoke('app:open-external', url),
    onDraftsChanged: (cb) => electron_1.ipcRenderer.on('drafts:changed', (_e, drafts) => cb(drafts)),
});
