"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const settings_1 = require("./settings");
const llm_1 = require("./llm");
const pipeline_1 = require("./pipeline");
const threadsApi_1 = require("./threadsApi");
const threadsOAuth_1 = require("./threadsOAuth");
const news_1 = require("./news");
const images_1 = require("./images");
const drafts_1 = require("./drafts");
const scheduler_1 = require("./scheduler");
const autopilot_1 = require("./autopilot");
const localdb_1 = require("./localdb");
// Two instances would race the scheduler and drafts store on the same files.
if (!electron_1.app.requestSingleInstanceLock()) {
    electron_1.app.quit();
}
const errMsg = (err) => (err instanceof Error ? err.message : String(err));
function sameOrigin(a, b) {
    try {
        return new URL(a).origin === new URL(b).origin;
    }
    catch {
        return false;
    }
}
function createWindow() {
    const theme = (0, settings_1.getSettings)().theme;
    const win = new electron_1.BrowserWindow({
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
    });
    // Any window.open / target=_blank goes to the system browser, never a child window.
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url))
            void electron_1.shell.openExternal(url);
        return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
        const devUrl = process.env.VITE_DEV_SERVER_URL;
        // Compare parsed origins, not string prefixes: "http://localhost:5174@evil.com"
        // startsWith-passes but resolves to evil.com, which would inherit the preload bridge.
        if (devUrl && sameOrigin(url, devUrl))
            return;
        e.preventDefault();
        if (/^https?:\/\//i.test(url))
            void electron_1.shell.openExternal(url);
    });
    const devUrl = process.env.VITE_DEV_SERVER_URL;
    if (devUrl) {
        void win.loadURL(devUrl);
    }
    else {
        void win.loadFile(path.join(__dirname, '../dist/index.html'));
    }
    return win;
}
electron_1.app.whenReady().then(() => {
    const broadcastAutopilot = (status) => {
        for (const win of electron_1.BrowserWindow.getAllWindows()) {
            if (!win.webContents.isDestroyed())
                win.webContents.send('autopilot:status', status);
        }
    };
    electron_1.ipcMain.handle('settings:get', () => (0, settings_1.getSettings)());
    electron_1.ipcMain.handle('settings:set', async (_e, settings) => {
        await (0, settings_1.setSettings)(settings);
        // Config (interval, caps, goal, persona) may have changed — refresh the UI status.
        broadcastAutopilot((0, autopilot_1.buildAutopilotStatus)());
    });
    electron_1.ipcMain.handle('autopilot:status', () => (0, autopilot_1.buildAutopilotStatus)());
    electron_1.ipcMain.handle('autopilot:set-running', async (_e, running) => {
        const settings = (0, settings_1.getSettings)();
        await (0, settings_1.setSettings)({ ...settings, autopilot: { ...settings.autopilot, enabled: running === true } });
        // Launching clears the last-run stamp so the first pass fires on the next tick
        // (within ~30s) instead of waiting a full interval.
        if (running === true)
            await localdb_1.db.set('autopilotLastRun', 0);
        const status = (0, autopilot_1.buildAutopilotStatus)();
        broadcastAutopilot(status);
        return status;
    });
    electron_1.ipcMain.handle('autopilot:run-now', () => (0, autopilot_1.runAutopilotNow)());
    electron_1.ipcMain.handle('llm:test', (_e, llm) => (0, llm_1.testLlm)(llm));
    electron_1.ipcMain.handle('llm:generate-post', (_e, input) => (0, pipeline_1.generatePostDraft)(input));
    electron_1.ipcMain.handle('llm:generate-reply', (_e, input) => (0, pipeline_1.generateReplyDraft)(input));
    electron_1.ipcMain.handle('threads:test', (_e, cfg) => (0, threadsApi_1.testThreads)(cfg));
    electron_1.ipcMain.handle('threads:oauth-start', (_e, cfg) => (0, threadsOAuth_1.startThreadsOAuth)(cfg));
    electron_1.ipcMain.handle('threads:scrape-style', async (_e, count) => {
        const threads = (0, settings_1.getSettings)().threads;
        if (!threads.accessToken) {
            return { ok: false, samples: [], message: 'Threads API is not configured — save credentials in Settings first.' };
        }
        try {
            const limit = Math.max(1, Math.min(50, Math.floor(Number(count)) || 10));
            const samples = await (0, threadsApi_1.scrapeRecentTexts)(threads, limit);
            if (samples.length === 0) {
                return { ok: false, samples: [], message: 'No text posts found on this Threads account.' };
            }
            return { ok: true, samples, message: `Imported ${samples.length} recent posts as style samples.` };
        }
        catch (err) {
            return { ok: false, samples: [], message: errMsg(err) };
        }
    });
    electron_1.ipcMain.handle('threads:unanswered', async () => {
        const threads = (0, settings_1.getSettings)().threads;
        if (!threads.accessToken) {
            return { ok: false, replies: [], message: 'Threads API is not configured — save credentials in Settings first.' };
        }
        try {
            const replies = await (0, threadsApi_1.fetchUnansweredReplies)(threads);
            return { ok: true, replies, message: '' };
        }
        catch (err) {
            return { ok: false, replies: [], message: errMsg(err) };
        }
    });
    electron_1.ipcMain.handle('news:fetch', (_e, input) => {
        if (typeof input === 'object' && input !== null) {
            const value = input;
            return (0, news_1.fetchTopicNews)({
                query: String(value.query ?? '').trim(),
                mode: value.mode === 'blogs' ? 'blogs' : 'news',
                sources: (0, settings_1.getSettings)().newsSources,
            });
        }
        return (0, news_1.fetchTopicNews)({ query: String(input ?? '').trim(), sources: (0, settings_1.getSettings)().newsSources });
    });
    electron_1.ipcMain.handle('images:keywords', (_e, input) => (0, images_1.generateImageKeywords)(input));
    electron_1.ipcMain.handle('images:search', (_e, query) => (0, images_1.searchImages)(String(query ?? '').trim()));
    electron_1.ipcMain.handle('drafts:all', () => (0, drafts_1.allDrafts)());
    electron_1.ipcMain.handle('drafts:upsert', (_e, draft) => (0, drafts_1.upsertDraft)(draft));
    electron_1.ipcMain.handle('drafts:delete', (_e, id) => (0, drafts_1.deleteDraft)(id));
    electron_1.ipcMain.handle('drafts:post-now', async (_e, id) => {
        const res = await (0, scheduler_1.postDraftNow)(id);
        return { ...res, drafts: (0, drafts_1.allDrafts)() };
    });
    electron_1.ipcMain.handle('app:open-external', (_e, url) => {
        if (typeof url === 'string' && /^https?:\/\//i.test(url))
            return electron_1.shell.openExternal(url);
        return Promise.resolve();
    });
    (0, drafts_1.setDraftsChangedListener)((drafts) => {
        for (const win of electron_1.BrowserWindow.getAllWindows()) {
            if (!win.webContents.isDestroyed())
                win.webContents.send('drafts:changed', drafts);
        }
    });
    (0, autopilot_1.setAutopilotStatusListener)(broadcastAutopilot);
    createWindow();
    (0, scheduler_1.startScheduler)();
    (0, autopilot_1.startAutopilot)();
    electron_1.app.on('second-instance', () => {
        const win = electron_1.BrowserWindow.getAllWindows()[0];
        if (win) {
            if (win.isMinimized())
                win.restore();
            win.focus();
        }
    });
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
electron_1.app.on('window-all-closed', () => {
    electron_1.app.quit();
});
