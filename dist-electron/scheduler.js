"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startScheduler = startScheduler;
exports.postDraftNow = postDraftNow;
const localdb_1 = require("./localdb");
const settings_1 = require("./settings");
const drafts_1 = require("./drafts");
const threadsApi_1 = require("./threadsApi");
const pipeline_1 = require("./pipeline");
const TICK_MS = 30_000;
const FIRST_TICK_MS = 5_000;
const LAST_RUN_KEY = 'autoDraftLastRun';
const MAX_CHARS = 500;
let started = false;
// Posting and auto-drafting have independent guards so a slow auto-draft run
// (a local model can take minutes) never delays a due scheduled post.
let postingInFlight = false;
let autoDraftInFlight = false;
function startScheduler() {
    if (started)
        return;
    started = true;
    void recoverInterrupted();
    setTimeout(() => tickAll(), FIRST_TICK_MS);
    setInterval(() => tickAll(), TICK_MS);
}
function tickAll() {
    void tickPosting();
    void tickAutoDraft();
}
/** A draft stuck in 'posting' means the app died mid-publish. It may or may not
 *  have reached Threads, so warn rather than silently inviting a duplicate. */
async function recoverInterrupted() {
    try {
        for (const d of (0, drafts_1.allDrafts)()) {
            if (d.status === 'posting') {
                await (0, drafts_1.updateDraft)(d.id, {
                    status: 'failed',
                    error: 'Interrupted while publishing — this post may already be live on Threads. Check your profile before retrying.',
                });
            }
        }
    }
    catch (err) {
        console.error('[scheduler] recovery failed', err);
    }
}
async function tickPosting() {
    if (postingInFlight)
        return;
    postingInFlight = true;
    try {
        const due = (0, drafts_1.allDrafts)().filter(isDue);
        for (const d of due) {
            // Re-check against the live cache: the user may have unscheduled or edited
            // this draft while an earlier publish in this loop was awaiting.
            const cur = (0, drafts_1.allDrafts)().find((x) => x.id === d.id);
            if (!cur || !isDue(cur))
                continue;
            const res = await postDraftNow(d.id);
            if (!res.ok)
                console.error(`[scheduler] scheduled post ${d.id} failed: ${res.message}`);
        }
    }
    catch (err) {
        console.error('[scheduler] posting tick failed', err);
    }
    finally {
        postingInFlight = false;
    }
}
async function tickAutoDraft() {
    if (autoDraftInFlight)
        return;
    const settings = (0, settings_1.getSettings)();
    if (!settings.autoDraft.enabled)
        return;
    const lastRun = localdb_1.db.get(LAST_RUN_KEY) ?? 0;
    if (Date.now() - lastRun < settings.autoDraft.intervalMinutes * 60_000)
        return;
    autoDraftInFlight = true;
    try {
        // Stamp before running so a failing run waits a full interval instead of hot-looping.
        await localdb_1.db.set(LAST_RUN_KEY, Date.now());
        await (0, pipeline_1.runAutoDraft)();
    }
    catch (err) {
        console.error('[scheduler] auto-draft tick failed', err);
    }
    finally {
        autoDraftInFlight = false;
    }
}
function isDue(d) {
    return d.status === 'scheduled' && typeof d.scheduledAt === 'number' && d.scheduledAt <= Date.now();
}
async function failDraft(id, message) {
    try {
        await (0, drafts_1.updateDraft)(id, { status: 'failed', error: message });
    }
    catch (err) {
        console.error(`[scheduler] could not persist failed status for ${id}`, err);
    }
    return { ok: false, message };
}
async function postDraftNow(id) {
    const draft = (0, drafts_1.allDrafts)().find((d) => d.id === id);
    if (!draft)
        return { ok: false, message: 'Draft not found' };
    if (draft.status === 'posting')
        return { ok: false, message: 'Already posting' };
    if (draft.status === 'posted')
        return { ok: false, message: 'Already posted' };
    const text = typeof draft.text === 'string' ? draft.text.trim() : '';
    // Fail (not plain-return) so an empty or over-limit *scheduled* draft stops
    // being retried every tick and surfaces to the user instead.
    if (!text)
        return failDraft(id, 'Draft text is empty');
    if (text.length > MAX_CHARS)
        return failDraft(id, `Draft exceeds the ${MAX_CHARS}-character limit`);
    if (draft.kind === 'reply' && !draft.replyToId) {
        return failDraft(id, 'Reply draft is missing the post it replies to');
    }
    const { accessToken, userId } = (0, settings_1.getSettings)().threads;
    if (!accessToken) {
        return failDraft(id, 'Threads API is not configured — save credentials in Settings first.');
    }
    try {
        await (0, drafts_1.updateDraft)(id, { status: 'posting', error: undefined });
        const cfg = { accessToken, userId };
        const res = draft.kind === 'reply' ? await (0, threadsApi_1.publishReply)(cfg, text, draft.replyToId) : await (0, threadsApi_1.publishPost)(cfg, text);
        try {
            await (0, drafts_1.updateDraft)(id, {
                status: 'posted',
                postedAt: Date.now(),
                threadsMediaId: res.id,
                permalink: res.permalink,
                error: undefined,
            });
        }
        catch (err) {
            // Publish succeeded; report ok even if the status write failed, or a retry would double-post.
            console.error(`[scheduler] posted ${id} but could not persist status`, err);
        }
        return { ok: true, message: 'Posted to Threads' };
    }
    catch (err) {
        return failDraft(id, err instanceof Error ? err.message : String(err));
    }
}
