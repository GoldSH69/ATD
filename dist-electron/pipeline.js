"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generatePostDraft = generatePostDraft;
exports.generateReplyDraft = generateReplyDraft;
exports.runAutoDraft = runAutoDraft;
const localdb_1 = require("./localdb");
const settings_1 = require("./settings");
const llm_1 = require("./llm");
const news_1 = require("./news");
const drafts_1 = require("./drafts");
const MAX_CHARS = 500;
const USED_LINKS_KEY = 'usedNewsLinks';
const TOPIC_IDX_KEY = 'autoDraftTopicIdx';
function unconfiguredMessage(llm) {
    if (llm.provider === 'claude' && !llm.claude.apiKey.trim())
        return 'Claude API key is missing — configure in Settings.';
    if (llm.provider === 'openai' && !llm.openai.apiKey.trim())
        return 'OpenAI API key is missing — configure in Settings.';
    if (llm.provider === 'local' && !llm.local.baseUrl.trim())
        return 'Local LLM base URL is missing — configure in Settings.';
    return null;
}
function buildSystemPrompt(style) {
    const lines = [
        "You ghost-write posts for Threads (Meta's microblogging platform).",
        'Rules:',
        `- Maximum ${MAX_CHARS} characters.`,
        '- Plain conversational text.',
        '- No hashtags unless the style notes ask for them.',
        '- No emojis unless the style samples use them.',
        '- Output ONLY the post text — no quotes, no preamble, no explanations.',
    ];
    const notes = style.notes.trim();
    if (notes)
        lines.push('', `Style notes from the author: ${notes}`);
    const samples = style.samples.map((s) => s.trim()).filter(Boolean).slice(0, 8);
    if (samples.length > 0) {
        lines.push('', "Examples of the author's voice:");
        for (const sample of samples)
            lines.push('---', sample);
    }
    return lines.join('\n');
}
function cleanOutput(raw) {
    let text = raw.trim();
    for (const [open, close] of [['"', '"'], ["'", "'"], ['“', '”'], ['‘', '’']]) {
        if (text.length >= 2 && text.startsWith(open) && text.endsWith(close)) {
            text = text.slice(1, -1).trim();
            break;
        }
    }
    text = text.replace(/^(?:post|reply)\s*:\s*/i, '');
    text = text.replace(/\n{3,}/g, '\n\n').trim();
    if (text.length > MAX_CHARS) {
        const head = text.slice(0, MAX_CHARS - 3);
        const atBoundary = head.replace(/\s+\S*$/, '').trimEnd();
        text = (atBoundary || head) + '…';
    }
    return text;
}
async function runGeneration(settings, userPrompt) {
    try {
        const raw = await (0, llm_1.generateText)(settings.llm, buildSystemPrompt(settings.style), userPrompt);
        const text = cleanOutput(raw);
        if (!text)
            return { ok: false, text: '', message: 'Model returned empty text' };
        return { ok: true, text, message: '' };
    }
    catch (err) {
        return { ok: false, text: '', message: err instanceof Error ? err.message : String(err) };
    }
}
async function generatePostDraft(input) {
    const settings = (0, settings_1.getSettings)();
    const missing = unconfiguredMessage(settings.llm);
    if (missing)
        return { ok: false, text: '', message: missing };
    let user = `Write a Threads post about ${input.topic}.`;
    if (input.newsTitle) {
        const source = input.newsSource ? ` (${input.newsSource})` : '';
        user += ` React to this news headline: "${input.newsTitle}"${source}. Add one insightful angle or opinion, not a summary.`;
    }
    return runGeneration(settings, user);
}
async function generateReplyDraft(input) {
    const settings = (0, settings_1.getSettings)();
    const missing = unconfiguredMessage(settings.llm);
    if (missing)
        return { ok: false, text: '', message: missing };
    const user = `The author posted: "${input.rootPostText}". @${input.replyUsername} replied: "${input.replyText}". ` +
        `Write the author's reply — helpful, in-voice, under ${MAX_CHARS} chars.`;
    return runGeneration(settings, user);
}
/** One auto-draft pass: next topic (round-robin), fresh news, drafts. Never throws. */
async function runAutoDraft() {
    let created = 0;
    try {
        const settings = (0, settings_1.getSettings)();
        const topics = settings.topics;
        if (topics.length === 0)
            return 0;
        const rawIdx = localdb_1.db.get(TOPIC_IDX_KEY);
        const idx = typeof rawIdx === 'number' && Number.isFinite(rawIdx) ? Math.abs(Math.floor(rawIdx)) : 0;
        const topic = topics[idx % topics.length];
        await localdb_1.db.set(TOPIC_IDX_KEY, (idx + 1) % topics.length);
        const news = await (0, news_1.fetchTopicNews)(topic);
        const usedList = (localdb_1.db.get(USED_LINKS_KEY) ?? []).filter((l) => typeof l === 'string');
        const used = new Set(usedList);
        const fresh = news
            .filter((n) => n.link && !used.has(n.link))
            .slice(0, settings.autoDraft.maxPerRun);
        for (const item of fresh) {
            const res = await generatePostDraft({
                topic,
                newsTitle: item.title,
                newsSource: item.source,
                newsUrl: item.link,
            });
            if (!res.ok) {
                console.error(`[pipeline] auto-draft generation failed for "${item.title}": ${res.message}`);
                continue;
            }
            const now = Date.now();
            await (0, drafts_1.upsertDraft)({
                id: crypto.randomUUID(),
                kind: 'post',
                text: res.text,
                topic,
                sourceTitle: item.title,
                sourceUrl: item.link,
                status: 'draft',
                createdAt: now,
                updatedAt: now,
            });
            // Mark used right after the draft lands, so a later failure in this loop
            // can't cause a duplicate draft for an already-drafted headline next run.
            used.add(item.link);
            await localdb_1.db.set(USED_LINKS_KEY, [...used].slice(-500));
            created++;
        }
    }
    catch (err) {
        console.error('[pipeline] auto-draft run failed', err);
    }
    return created;
}
