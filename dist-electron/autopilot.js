"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setAutopilotStatusListener = setAutopilotStatusListener;
exports.buildAutopilotStatus = buildAutopilotStatus;
exports.startAutopilot = startAutopilot;
exports.runAutopilotNow = runAutopilotNow;
const localdb_1 = require("./localdb");
const settings_1 = require("./settings");
const news_1 = require("./news");
const threadsApi_1 = require("./threadsApi");
const drafts_1 = require("./drafts");
const scheduler_1 = require("./scheduler");
const pipeline_1 = require("./pipeline");
/**
 * Full-Auto engine. Runs entirely in the main process on its own interval and,
 * when launched, decides on its own whether to post, what to post, and answers
 * replies — all without human intervention. Every side effect flows through the
 * same draft store + publisher the manual workflow uses, so autopilot activity
 * is visible in Drafts/Queue and shares the publish guards.
 */
const TICK_MS = 30_000;
const FIRST_TICK_MS = 8_000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const AP_DAY = 'autopilotDay';
const AP_POSTS = 'autopilotPostsToday';
const AP_REPLIES = 'autopilotRepliesToday';
const AP_LAST_RUN = 'autopilotLastRun';
const AP_LOG = 'autopilotLog';
const AP_USED_LINKS = 'autopilotUsedLinks';
const AP_ANSWERED = 'autopilotAnswered';
const LOG_LIMIT = 80;
// Category id -> news search seed. '' means "original content only, no news".
const CATEGORY_QUERY = {
    ai: 'artificial intelligence',
    development: 'software development',
    crypto: 'cryptocurrency',
    movies: 'movies and tv',
    humor: '',
};
let started = false;
let busy = false;
let logSeq = 0;
let statusListener = null;
function setAutopilotStatusListener(cb) {
    statusListener = cb;
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const dayKey = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD (local)
function getInt(key) {
    const v = localdb_1.db.get(key);
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
/** Reset the per-day counters when the local date rolls over. */
function rolloverDaily() {
    const today = dayKey();
    if (localdb_1.db.get(AP_DAY) !== today) {
        void localdb_1.db.set(AP_DAY, today);
        void localdb_1.db.set(AP_POSTS, 0);
        void localdb_1.db.set(AP_REPLIES, 0);
        return { posts: 0, replies: 0 };
    }
    return { posts: getInt(AP_POSTS), replies: getInt(AP_REPLIES) };
}
function readLog() {
    const raw = localdb_1.db.get(AP_LOG);
    return Array.isArray(raw) ? raw : [];
}
function log(kind, message, permalink) {
    const entry = {
        id: `${Date.now()}-${logSeq++}`,
        at: Date.now(),
        kind,
        message,
        ...(permalink ? { permalink } : {}),
    };
    const next = [entry, ...readLog()].slice(0, LOG_LIMIT);
    void localdb_1.db.set(AP_LOG, next);
    broadcastStatus();
}
function buildAutopilotStatus() {
    const settings = (0, settings_1.getSettings)();
    const ap = settings.autopilot;
    const today = dayKey();
    const sameDay = localdb_1.db.get(AP_DAY) === today;
    const posts = sameDay ? getInt(AP_POSTS) : 0;
    const replies = sameDay ? getInt(AP_REPLIES) : 0;
    const lastRunAt = localdb_1.db.get(AP_LAST_RUN) ?? null;
    const nextRunAt = ap.enabled
        ? (lastRunAt ?? Date.now()) + ap.intervalMinutes * 60_000
        : null;
    return {
        running: ap.enabled,
        goLive: ap.goLive,
        busy,
        postsToday: posts,
        maxPostsPerDay: ap.maxPostsPerDay,
        repliesToday: replies,
        maxRepliesPerDay: ap.maxRepliesPerDay,
        intervalMinutes: ap.intervalMinutes,
        lastRunAt: typeof lastRunAt === 'number' ? lastRunAt : null,
        nextRunAt,
        llmReady: (0, pipeline_1.unconfiguredMessage)(settings.llm) === null,
        threadsReady: Boolean(settings.threads.accessToken),
        log: readLog(),
    };
}
function broadcastStatus() {
    try {
        statusListener?.(buildAutopilotStatus());
    }
    catch (err) {
        console.error('[autopilot] status broadcast failed', err);
    }
}
function startAutopilot() {
    if (started)
        return;
    started = true;
    setTimeout(() => void maybeTick(), FIRST_TICK_MS);
    setInterval(() => void maybeTick(), TICK_MS);
}
async function maybeTick() {
    if (busy)
        return;
    const ap = (0, settings_1.getSettings)().autopilot;
    if (!ap.enabled)
        return;
    const lastRun = localdb_1.db.get(AP_LAST_RUN) ?? 0;
    if (Date.now() - lastRun < ap.intervalMinutes * 60_000)
        return;
    await runAutopilotPass('scheduled');
}
/** Force one pass immediately (the "Run once now" button). Ignores the interval. */
async function runAutopilotNow() {
    if (!busy)
        await runAutopilotPass('manual');
    return buildAutopilotStatus();
}
function categoryQuery(cat) {
    if (cat in CATEGORY_QUERY)
        return CATEGORY_QUERY[cat];
    return cat;
}
/** Pull fresh (unused) headlines across the configured niches. */
async function gatherCandidates() {
    const settings = (0, settings_1.getSettings)();
    const cats = (settings.autopilot.categories.length > 0 ? settings.autopilot.categories : ['technology']).slice(0, 6);
    const used = new Set((localdb_1.db.get(AP_USED_LINKS) ?? []).filter((x) => typeof x === 'string'));
    const out = [];
    let idx = 0;
    for (const cat of cats) {
        if (out.length >= 20)
            break;
        const q = categoryQuery(cat);
        if (!q)
            continue; // e.g. "humor" — original content only
        let news;
        try {
            news = await (0, news_1.fetchTopicNews)({ query: q, sources: settings.newsSources });
        }
        catch {
            continue;
        }
        for (const n of news.slice(0, 4)) {
            if (!n.link || used.has(n.link))
                continue;
            out.push({ index: idx++, title: n.title, source: n.source, category: cat, link: n.link });
            if (out.length >= 20)
                break;
        }
    }
    return out;
}
function markUsedLink(link) {
    const used = (localdb_1.db.get(AP_USED_LINKS) ?? []).filter((x) => typeof x === 'string');
    if (!used.includes(link))
        void localdb_1.db.set(AP_USED_LINKS, [...used, link].slice(-500));
}
/** Create the draft, then publish it when goLive; returns the resulting permalink. */
async function commitDraft(draft, goLive) {
    await (0, drafts_1.upsertDraft)(draft);
    if (!goLive)
        return { ok: true, message: 'drafted' };
    const res = await (0, scheduler_1.postDraftNow)(draft.id);
    const fresh = (0, drafts_1.allDrafts)().find((d) => d.id === draft.id);
    return { ...res, permalink: fresh?.permalink };
}
async function runPostPhase(postsToday) {
    const settings = (0, settings_1.getSettings)();
    const ap = settings.autopilot;
    const remainingDay = ap.maxPostsPerDay - postsToday;
    const budget = Math.min(ap.maxPostsPerRun, remainingDay);
    if (budget <= 0) {
        log('skip', `Daily post budget reached (${postsToday}/${ap.maxPostsPerDay}).`);
        return 0;
    }
    const rich = await gatherCandidates();
    const slim = rich.map((c) => ({
        index: c.index,
        title: c.title,
        source: c.source,
        category: c.category,
    }));
    const plan = await (0, pipeline_1.decideAutopilotPlan)({ candidates: slim, maxPosts: budget, postsToday });
    if (plan.reasoning)
        log('info', `Plan: ${plan.reasoning}${plan.usedFallback ? ' (fallback)' : ''}`);
    if (plan.items.length === 0) {
        log('skip', 'Decided not to post this round.');
        return 0;
    }
    let created = 0;
    for (const item of plan.items) {
        if (postsToday + created >= ap.maxPostsPerDay)
            break;
        const cand = item.kind === 'news' && typeof item.index === 'number' ? rich.find((c) => c.index === item.index) : undefined;
        const gen = await (0, pipeline_1.generateAutopilotPost)({
            kind: cand ? 'news' : 'original',
            category: item.category ?? cand?.category,
            angle: item.angle,
            newsTitle: cand?.title,
            newsSource: cand?.source,
        });
        if (!gen.ok) {
            log('error', `Post generation failed: ${gen.message}`);
            continue;
        }
        const now = Date.now();
        const draft = {
            id: crypto.randomUUID(),
            kind: 'post',
            text: gen.text,
            topic: item.category ?? cand?.category,
            sourceTitle: cand?.title,
            sourceUrl: cand?.link,
            status: 'draft',
            createdAt: now,
            updatedAt: now,
        };
        const res = await commitDraft(draft, ap.goLive);
        if (cand?.link)
            markUsedLink(cand.link);
        created++;
        void localdb_1.db.set(AP_POSTS, postsToday + created);
        const preview = gen.text.length > 60 ? gen.text.slice(0, 59) + '…' : gen.text;
        if (!ap.goLive)
            log('post', `Drafted (review): ${preview}`);
        else if (res.ok)
            log('post', `Posted: ${preview}`, res.permalink);
        else
            log('error', `Publish failed: ${res.message}`);
    }
    return created;
}
/** Grab a URL from the reply/root text and fetch a short text snippet for context. */
async function fetchReplyContext(replyText, rootText) {
    const m = `${replyText} ${rootText}`.match(/https?:\/\/[^\s"'<>]+/i);
    if (!m)
        return undefined;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
        const res = await fetch(m[0], { headers: { 'User-Agent': UA }, signal: ctrl.signal });
        if (!res.ok)
            return undefined;
        const type = res.headers.get('content-type') ?? '';
        if (!/text\/html|text\/plain|xml/i.test(type))
            return undefined;
        const body = await res.text();
        const text = body
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return text ? text.slice(0, 600) : undefined;
    }
    catch {
        return undefined;
    }
    finally {
        clearTimeout(timer);
    }
}
async function runReplyPhase(repliesToday) {
    const settings = (0, settings_1.getSettings)();
    const ap = settings.autopilot;
    if (!ap.replyToAll)
        return 0;
    const remainingDay = ap.maxRepliesPerDay - repliesToday;
    if (remainingDay <= 0) {
        log('skip', `Daily reply budget reached (${repliesToday}/${ap.maxRepliesPerDay}).`);
        return 0;
    }
    let replies;
    try {
        replies = await (0, threadsApi_1.fetchUnansweredReplies)(settings.threads);
    }
    catch (err) {
        log('error', `Could not fetch replies: ${err instanceof Error ? err.message : String(err)}`);
        return 0;
    }
    const answered = new Set((localdb_1.db.get(AP_ANSWERED) ?? []).filter((x) => typeof x === 'string'));
    const localReplyIds = new Set((0, drafts_1.allDrafts)().filter((d) => d.kind === 'reply' && d.replyToId).map((d) => d.replyToId));
    const handle = ap.creatorHandle.trim().toLowerCase();
    const budget = Math.min(ap.maxRepliesPerRun, remainingDay);
    let sent = 0;
    for (const r of replies) {
        if (sent >= budget)
            break;
        if (answered.has(r.id) || localReplyIds.has(r.id))
            continue;
        const isCreator = handle !== '' && r.username.trim().toLowerCase() === handle;
        const contextText = await fetchReplyContext(r.text, r.rootPostText);
        const gen = await (0, pipeline_1.generateAutopilotReply)({
            replyText: r.text,
            replyUsername: r.username,
            rootPostText: r.rootPostText,
            contextText,
            isCreator,
        });
        if (!gen.ok) {
            log('error', `Reply generation failed (@${r.username}): ${gen.message}`);
            continue;
        }
        const now = Date.now();
        const draft = {
            id: crypto.randomUUID(),
            kind: 'reply',
            text: gen.text,
            replyToId: r.id,
            replyToText: r.text,
            replyToUsername: r.username,
            status: 'draft',
            createdAt: now,
            updatedAt: now,
        };
        const publishReply = ap.goLive && ap.autoReply;
        const res = await commitDraft(draft, publishReply);
        answered.add(r.id);
        void localdb_1.db.set(AP_ANSWERED, [...answered].slice(-1000));
        sent++;
        void localdb_1.db.set(AP_REPLIES, repliesToday + sent);
        if (!publishReply)
            log('reply', `Drafted reply to @${r.username} (review).`);
        else if (res.ok)
            log('reply', `Replied to @${r.username}.`, res.permalink);
        else
            log('error', `Reply publish failed (@${r.username}): ${res.message}`);
        await delay(800); // gentle pacing so a burst of replies doesn't trip rate limits
    }
    if (sent === 0)
        log('info', 'No new replies to answer.');
    return sent;
}
async function runAutopilotPass(reason) {
    if (busy)
        return;
    busy = true;
    broadcastStatus();
    try {
        const settings = (0, settings_1.getSettings)();
        const missing = (0, pipeline_1.unconfiguredMessage)(settings.llm);
        if (missing) {
            log('error', missing);
            return;
        }
        if (!settings.threads.accessToken) {
            log('error', 'Threads API is not configured — add an access token in Settings.');
            return;
        }
        await localdb_1.db.set(AP_LAST_RUN, Date.now());
        const { posts, replies } = rolloverDaily();
        log('info', `Thinking… (${reason}) — ${posts}/${settings.autopilot.maxPostsPerDay} posts, ${replies}/${settings.autopilot.maxRepliesPerDay} replies today.`);
        await runPostPhase(posts);
        await runReplyPhase(getInt(AP_REPLIES));
    }
    catch (err) {
        log('error', `Autopilot pass failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    finally {
        busy = false;
        broadcastStatus();
    }
}
