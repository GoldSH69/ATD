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
const TICK_MS = 10_000; // poll often so 5-min reply timer and 1-min retries fire promptly
const FIRST_TICK_MS = 3_000;
const RETRY_AFTER_MS = 60_000; // failed posts/replies re-attempt after 1 minute
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const AP_DAY = 'autopilotDay';
const AP_POSTS = 'autopilotPostsToday';
const AP_REPLIES = 'autopilotRepliesToday';
const AP_LAST_RUN = 'autopilotLastRun'; // last post/think pass
const AP_LAST_REPLY_RUN = 'autopilotLastReplyRun'; // last replies+mentions pass
const AP_LOG = 'autopilotLog';
const AP_USED_LINKS = 'autopilotUsedLinks';
const AP_ANSWERED = 'autopilotAnswered';
const AP_DISCOVER_ANSWERED = 'autopilotDiscoverAnswered';
const AP_DISCOVER_DAY = 'autopilotDiscoverDay';
const AP_DISCOVER_COUNT = 'autopilotDiscoverToday';
const LOG_LIMIT = 80;
/**
 * Category id → news search seed tuned for Threads-native niches.
 * Empty string = original content only (no news scrape) — e.g. pure humor.
 * Prefer queries that surface the kind of stories AI/tech Threads accounts riff on.
 */
const CATEGORY_QUERY = {
    ai: 'artificial intelligence AI ChatGPT OpenAI Claude Gemini LLM',
    technology: 'technology gadgets software',
    development: 'software engineering programming coding developers',
    startups: 'startups founders venture capital',
    productivity: 'productivity tools apps workflow',
    sidehustle: 'side hustle freelancing indie hacker online business',
    creator: 'creator economy influencers content creators monetization',
    career: 'career advice remote work jobs tech careers',
    crypto: 'cryptocurrency bitcoin ethereum web3',
    finance: 'personal finance markets investing',
    marketing: 'marketing growth hacking social media',
    humor: '',
    gaming: 'video games gaming industry esports',
    fitness: 'fitness workout health training',
    business: 'business entrepreneurship companies',
    science: 'science research breakthroughs',
    health: 'health wellness medicine',
    fashion: 'fashion style trends',
    beauty: 'beauty skincare makeup',
    lifestyle: 'lifestyle culture trends',
    food: 'food restaurants cooking',
    travel: 'travel destinations tourism',
    sports: 'sports games leagues',
    entertainment: 'entertainment celebrities culture',
    music: 'music artists albums',
    movies: 'movies TV shows streaming',
    books: 'books authors reading',
    design: 'design UX product design',
    environment: 'climate environment sustainability',
    education: 'education learning online courses',
};
let started = false;
/** Independent locks so a long post/LLM pass never blocks the reply timer. */
let postBusy = false;
let replyBusy = false;
let logSeq = 0;
let statusListener = null;
function setAutopilotStatusListener(cb) {
    statusListener = cb;
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const dayKey = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD (local)
const isBusy = () => postBusy || replyBusy;
function getInt(key) {
    const v = localdb_1.db.get(key);
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
/** Schedule the next pass ~1 minute from now (for failures). */
async function scheduleRetry(kind) {
    const ap = (0, settings_1.getSettings)().autopilot;
    const intervalMin = kind === 'post' ? ap.intervalMinutes : ap.replyIntervalMinutes;
    const key = kind === 'post' ? AP_LAST_RUN : AP_LAST_REPLY_RUN;
    // lastRun = now - interval + 1min  →  due again after 1 minute
    const stamp = Date.now() - intervalMin * 60_000 + RETRY_AFTER_MS;
    await localdb_1.db.set(key, stamp);
    log('info', `${kind === 'post' ? 'Post' : 'Reply'} failure — will retry in ~1 minute.`);
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
    const lastReplyRunAt = localdb_1.db.get(AP_LAST_REPLY_RUN) ?? null;
    const repliesEnabled = ap.replyToAll || ap.replyToMentions || ap.engageDiscover;
    const nextRunAt = ap.enabled
        ? (typeof lastRunAt === 'number' ? lastRunAt : Date.now()) + ap.intervalMinutes * 60_000
        : null;
    const nextReplyRunAt = ap.enabled && repliesEnabled
        ? (typeof lastReplyRunAt === 'number' ? lastReplyRunAt : Date.now()) +
            ap.replyIntervalMinutes * 60_000
        : null;
    return {
        running: ap.enabled,
        goLive: ap.goLive,
        busy: isBusy(),
        postsToday: posts,
        maxPostsPerDay: ap.maxPostsPerDay,
        repliesToday: replies,
        maxRepliesPerDay: ap.maxRepliesPerDay,
        intervalMinutes: ap.intervalMinutes,
        replyIntervalMinutes: ap.replyIntervalMinutes,
        lastRunAt: typeof lastRunAt === 'number' ? lastRunAt : null,
        nextRunAt,
        lastReplyRunAt: typeof lastReplyRunAt === 'number' ? lastReplyRunAt : null,
        nextReplyRunAt,
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
    const ap = (0, settings_1.getSettings)().autopilot;
    if (!ap.enabled)
        return;
    const now = Date.now();
    const lastPost = localdb_1.db.get(AP_LAST_RUN) ?? 0;
    const lastReply = localdb_1.db.get(AP_LAST_REPLY_RUN) ?? 0;
    // lastRun === 0 means "fire now" (launch / forced reset)
    const duePosts = !postBusy && (lastPost === 0 || now - lastPost >= ap.intervalMinutes * 60_000);
    // Reply timer also drives @mentions and optional discover engagement.
    const repliesOn = ap.replyToAll || ap.replyToMentions || ap.engageDiscover;
    const dueReplies = !replyBusy &&
        repliesOn &&
        (lastReply === 0 || now - lastReply >= ap.replyIntervalMinutes * 60_000);
    // Fire independently — a long post plan must not block the reply timer.
    if (duePosts)
        void runAutopilotPass('scheduled', { posts: true, replies: false });
    if (dueReplies)
        void runAutopilotPass('scheduled', { posts: false, replies: true });
}
/** Force one pass immediately (the "Run once now" button). Ignores the intervals. */
async function runAutopilotNow() {
    await runAutopilotPass('manual', { posts: true, replies: true });
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
    // Prefer configured niches; empty → popular AI-first defaults from settings.
    const cats = (settings.autopilot.categories.length > 0
        ? settings.autopilot.categories
        : ['ai', 'technology', 'startups', 'productivity', 'humor']).slice(0, 8);
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
    // "Here and there" — randomly skip some ticks so the account doesn't post like a clock.
    if (ap.sporadicPosts) {
        // ~45% chance to skip this post tick (still runs replies/mentions separately).
        if (Math.random() < 0.45) {
            log('skip', 'Sporadic posts: sitting this one out (looks more human).');
            return 0;
        }
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
        const preview = gen.text.length > 60 ? gen.text.slice(0, 59) + '…' : gen.text;
        if (!ap.goLive) {
            created++;
            void localdb_1.db.set(AP_POSTS, postsToday + created);
            log('post', `Drafted (review): ${preview}`);
        }
        else if (res.ok) {
            created++;
            void localdb_1.db.set(AP_POSTS, postsToday + created);
            log('post', `Posted: ${preview}`, res.permalink);
        }
        else {
            log('error', `Publish failed: ${res.message}`);
            await scheduleRetry('post');
        }
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
    if (!ap.replyToAll && !ap.replyToMentions && !ap.engageDiscover) {
        log('skip', 'Reply scanning is off (enable replies, @mentions, and/or discover).');
        return 0;
    }
    const remainingDay = ap.maxRepliesPerDay - repliesToday;
    if (remainingDay <= 0) {
        log('skip', `Daily reply budget reached (${repliesToday}/${ap.maxRepliesPerDay}).`);
        return 0;
    }
    let sent = 0;
    let failures = 0;
    let replies = [];
    if (ap.replyToAll || ap.replyToMentions) {
        try {
            log('info', `Scanning replies${ap.replyToMentions ? ' + @mentions' : ''}…`);
            const fetched = await (0, threadsApi_1.fetchUnansweredEngagement)(settings.threads, {
                includeMentions: ap.replyToMentions,
            });
            if (fetched.mentionError) {
                log('error', fetched.mentionError);
            }
            replies = fetched.replies;
        }
        catch (err) {
            log('error', `Could not fetch replies/mentions: ${err instanceof Error ? err.message : String(err)}`);
            await scheduleRetry('reply');
            // Still try discover if enabled.
            if (ap.engageDiscover) {
                return runDiscoverPhase(repliesToday);
            }
            return 0;
        }
        replies = replies.filter((r) => {
            const kind = r.kind ?? 'reply';
            if (kind === 'mention')
                return ap.replyToMentions;
            return ap.replyToAll;
        });
        const mentionN = replies.filter((r) => r.kind === 'mention').length;
        const replyN = replies.length - mentionN;
        log('info', `Inbox: ${replyN} unanswered reply(ies), ${mentionN} @mention(s).`);
    }
    const answered = new Set((localdb_1.db.get(AP_ANSWERED) ?? []).filter((x) => typeof x === 'string'));
    // Only block targets we already successfully posted (or are posting right now).
    // Failed drafts must NOT block retries — that was why replies stopped after one error.
    const blockedIds = new Set((0, drafts_1.allDrafts)()
        .filter((d) => d.kind === 'reply' &&
        d.replyToId &&
        (d.status === 'posted' || d.status === 'posting' || (d.status === 'draft' && !(ap.goLive && ap.autoReply))))
        .map((d) => d.replyToId));
    const handle = ap.creatorHandle.trim().toLowerCase();
    const budget = Math.min(ap.maxRepliesPerRun, remainingDay);
    log('info', `Found ${replies.length} candidate reply/mention(s).`);
    for (const r of replies) {
        if (sent >= budget)
            break;
        if (answered.has(r.id) || blockedIds.has(r.id))
            continue;
        const kind = r.kind === 'mention' ? 'mention' : 'reply';
        const label = kind === 'mention' ? 'mention' : 'reply';
        // Retry an existing failed draft for this target instead of re-generating.
        const failedExisting = (0, drafts_1.allDrafts)().find((d) => d.kind === 'reply' && d.replyToId === r.id && d.status === 'failed');
        if (failedExisting) {
            const res = await (0, scheduler_1.postDraftNow)(failedExisting.id);
            if (res.ok) {
                answered.add(r.id);
                void localdb_1.db.set(AP_ANSWERED, [...answered].slice(-1000));
                sent++;
                void localdb_1.db.set(AP_REPLIES, repliesToday + sent);
                const fresh = (0, drafts_1.allDrafts)().find((d) => d.id === failedExisting.id);
                log('reply', `Retried ${label} to @${r.username}.`, fresh?.permalink);
            }
            else {
                failures++;
                log('error', `${label} retry failed (@${r.username}): ${res.message}`);
            }
            await delay(800);
            continue;
        }
        const isCreator = handle !== '' && r.username.trim().toLowerCase() === handle;
        const contextText = await fetchReplyContext(r.text, r.rootPostText);
        const gen = await (0, pipeline_1.generateAutopilotReply)({
            replyText: r.text,
            replyUsername: r.username,
            rootPostText: r.rootPostText,
            contextText,
            isCreator,
            kind,
        });
        if (!gen.ok) {
            failures++;
            log('error', `${kind === 'mention' ? 'Mention' : 'Reply'} generation failed (@${r.username}): ${gen.message}`);
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
            topic: kind === 'mention' ? 'mention' : undefined,
            status: 'draft',
            createdAt: now,
            updatedAt: now,
        };
        const publishReply = ap.goLive && ap.autoReply;
        const res = await commitDraft(draft, publishReply);
        if (!publishReply) {
            // Draft-only: treat as handled so we don't re-draft every tick.
            answered.add(r.id);
            void localdb_1.db.set(AP_ANSWERED, [...answered].slice(-1000));
            sent++;
            void localdb_1.db.set(AP_REPLIES, repliesToday + sent);
            log('reply', `Drafted ${label} to @${r.username} (review).`);
        }
        else if (res.ok) {
            answered.add(r.id);
            void localdb_1.db.set(AP_ANSWERED, [...answered].slice(-1000));
            sent++;
            void localdb_1.db.set(AP_REPLIES, repliesToday + sent);
            log('reply', `Replied to ${label} from @${r.username}.`, res.permalink);
        }
        else {
            // Keep target eligible for retry — do NOT add to answered.
            failures++;
            log('error', `${label} publish failed (@${r.username}): ${res.message}`);
        }
        await delay(800);
    }
    if (sent === 0 && failures === 0)
        log('info', 'No new replies or mentions to answer.');
    if (failures > 0)
        await scheduleRetry('reply');
    // Optional: join random public threads in your niches (keyword search).
    if (ap.engageDiscover) {
        const discovered = await runDiscoverPhase(repliesToday + sent);
        sent += discovered;
    }
    return sent;
}
/** Reply to a few random public posts found via keyword search in configured niches. */
async function runDiscoverPhase(repliesTodaySoFar) {
    const settings = (0, settings_1.getSettings)();
    const ap = settings.autopilot;
    if (!ap.engageDiscover || ap.maxDiscoverRepliesPerRun <= 0)
        return 0;
    const today = dayKey();
    if (localdb_1.db.get(AP_DISCOVER_DAY) !== today) {
        void localdb_1.db.set(AP_DISCOVER_DAY, today);
        void localdb_1.db.set(AP_DISCOVER_COUNT, 0);
    }
    const discoverToday = getInt(AP_DISCOVER_COUNT);
    const remainingDiscover = ap.maxDiscoverRepliesPerDay - discoverToday;
    const remainingGlobal = ap.maxRepliesPerDay - repliesTodaySoFar;
    const budget = Math.min(ap.maxDiscoverRepliesPerRun, remainingDiscover, remainingGlobal);
    if (budget <= 0) {
        log('skip', 'Discover reply budget reached for today.');
        return 0;
    }
    const cats = ap.categories.length > 0 ? ap.categories : ['ai', 'technology', 'startups', 'productivity'];
    // Pick 1–2 niche keywords for this tick.
    const shuffled = [...cats].sort(() => Math.random() - 0.5).slice(0, 2);
    const usedDiscover = new Set((localdb_1.db.get(AP_DISCOVER_ANSWERED) ?? []).filter((x) => typeof x === 'string'));
    const myHandle = (settings.threads.username || '').toLowerCase();
    const candidates = [];
    for (const cat of shuffled) {
        const q = categoryQuery(cat) || cat;
        if (!q)
            continue;
        // Use a short keyword (first 1–3 words) for better search quality.
        const keyword = q.split(/\s+/).slice(0, 3).join(' ');
        const res = await (0, threadsApi_1.searchKeywordPosts)(settings.threads, keyword, 12);
        if (!res.ok) {
            log('error', `Discover search "${keyword}": ${res.message}`);
            continue;
        }
        for (const p of res.posts) {
            if (usedDiscover.has(p.id))
                continue;
            if (myHandle && p.username.toLowerCase() === myHandle)
                continue;
            candidates.push({ id: p.id, text: p.text, username: p.username });
        }
    }
    if (candidates.length === 0) {
        log('info', 'Discover: no fresh public posts found for this tick.');
        return 0;
    }
    // Random sample.
    const picks = [...candidates].sort(() => Math.random() - 0.5).slice(0, budget);
    log('info', `Discover: engaging ${picks.length} public post(s) in niches [${shuffled.join(', ')}].`);
    let sent = 0;
    let failures = 0;
    for (const p of picks) {
        const gen = await (0, pipeline_1.generateAutopilotReply)({
            replyText: p.text,
            replyUsername: p.username,
            rootPostText: p.text,
            isCreator: false,
            kind: 'discover',
        });
        if (!gen.ok) {
            failures++;
            log('error', `Discover reply gen failed (@${p.username}): ${gen.message}`);
            continue;
        }
        const now = Date.now();
        const draft = {
            id: crypto.randomUUID(),
            kind: 'reply',
            text: gen.text,
            replyToId: p.id,
            replyToText: p.text,
            replyToUsername: p.username,
            topic: 'discover',
            status: 'draft',
            createdAt: now,
            updatedAt: now,
        };
        const publish = ap.goLive && ap.autoReply;
        const res = await commitDraft(draft, publish);
        usedDiscover.add(p.id);
        void localdb_1.db.set(AP_DISCOVER_ANSWERED, [...usedDiscover].slice(-500));
        if (!publish) {
            sent++;
            log('reply', `Drafted discover reply to @${p.username}.`);
        }
        else if (res.ok) {
            sent++;
            log('reply', `Discover replied to @${p.username}.`, res.permalink);
        }
        else {
            failures++;
            log('error', `Discover publish failed (@${p.username}): ${res.message}`);
        }
        await delay(1000);
    }
    if (sent > 0) {
        void localdb_1.db.set(AP_DISCOVER_COUNT, discoverToday + sent);
        void localdb_1.db.set(AP_REPLIES, getInt(AP_REPLIES) + sent);
    }
    if (failures > 0)
        await scheduleRetry('reply');
    return sent;
}
async function runAutopilotPass(reason, phases) {
    if (!phases.posts && !phases.replies)
        return;
    // Independent locks: post work and reply work can overlap.
    if (phases.posts && postBusy)
        phases = { ...phases, posts: false };
    if (phases.replies && replyBusy)
        phases = { ...phases, replies: false };
    if (!phases.posts && !phases.replies)
        return;
    if (phases.posts)
        postBusy = true;
    if (phases.replies)
        replyBusy = true;
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
        const { posts, replies } = rolloverDaily();
        const parts = [];
        if (phases.posts)
            parts.push('posts');
        if (phases.replies)
            parts.push('replies/mentions');
        log('info', `${parts.join(' + ')} (${reason}) — ${posts}/${settings.autopilot.maxPostsPerDay} posts, ${replies}/${settings.autopilot.maxRepliesPerDay} replies today.`);
        const now = Date.now();
        // Run phases (possibly both). Stamp each timer when that phase starts.
        const jobs = [];
        if (phases.posts) {
            jobs.push((async () => {
                await localdb_1.db.set(AP_LAST_RUN, now);
                await runPostPhase(posts);
            })());
        }
        if (phases.replies) {
            jobs.push((async () => {
                await localdb_1.db.set(AP_LAST_REPLY_RUN, now);
                await runReplyPhase(getInt(AP_REPLIES));
            })());
        }
        await Promise.all(jobs);
    }
    catch (err) {
        log('error', `Autopilot pass failed: ${err instanceof Error ? err.message : String(err)}`);
        if (phases.replies)
            await scheduleRetry('reply');
        if (phases.posts)
            await scheduleRetry('post');
    }
    finally {
        if (phases.posts)
            postBusy = false;
        if (phases.replies)
            replyBusy = false;
        broadcastStatus();
    }
}
