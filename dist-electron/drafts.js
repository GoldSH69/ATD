"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setDraftsChangedListener = setDraftsChangedListener;
exports.allDrafts = allDrafts;
exports.upsertDraft = upsertDraft;
exports.deleteDraft = deleteDraft;
exports.updateDraft = updateDraft;
const localdb_1 = require("./localdb");
/**
 * Draft store, owned by the main process so the renderer and the scheduler
 * never race writes to the same file. All mutations flow through here; the
 * registered listener fans changes back out to the renderer.
 */
let cache = null;
let onChanged = null;
const KINDS = ['post', 'reply'];
const STATUSES = ['draft', 'scheduled', 'posting', 'posted', 'failed'];
const optStr = (v) => (typeof v === 'string' && v ? v : undefined);
const optNum = (v) => typeof v === 'number' && Number.isFinite(v) ? v : undefined;
/** Coerce untrusted renderer/IPC input into a well-typed Draft. Bad fields fall
 *  back to safe defaults so a malformed draft can never crash the scheduler. */
function sanitizeDraft(input) {
    const o = (input ?? {});
    const now = Date.now();
    const kind = KINDS.includes(o.kind) ? o.kind : 'post';
    const status = STATUSES.includes(o.status)
        ? o.status
        : 'draft';
    return {
        id: typeof o.id === 'string' && o.id ? o.id : crypto.randomUUID(),
        kind,
        text: typeof o.text === 'string' ? o.text : '',
        topic: optStr(o.topic),
        sourceTitle: optStr(o.sourceTitle),
        sourceUrl: optStr(o.sourceUrl),
        imageUrl: optStr(o.imageUrl),
        imageThumbUrl: optStr(o.imageThumbUrl),
        imageTitle: optStr(o.imageTitle),
        imagePageUrl: optStr(o.imagePageUrl),
        replyToId: optStr(o.replyToId),
        replyToText: optStr(o.replyToText),
        replyToUsername: optStr(o.replyToUsername),
        status,
        scheduledAt: optNum(o.scheduledAt),
        postedAt: optNum(o.postedAt),
        threadsMediaId: optStr(o.threadsMediaId),
        permalink: optStr(o.permalink),
        error: optStr(o.error),
        createdAt: optNum(o.createdAt) ?? now,
        updatedAt: now,
    };
}
function setDraftsChangedListener(cb) {
    onChanged = cb;
}
function allDrafts() {
    if (!cache)
        cache = localdb_1.db.get('drafts') ?? [];
    return cache;
}
async function persist() {
    const list = allDrafts();
    await localdb_1.db.set('drafts', list);
    onChanged?.(list);
    return list;
}
async function upsertDraft(input) {
    const draft = sanitizeDraft(input);
    const list = allDrafts();
    const i = list.findIndex((d) => d.id === draft.id);
    // The scheduler owns 'posting'/'posted' transitions; a racing renderer upsert
    // must not roll a draft back mid-publish (which would defeat the post guard).
    if (i >= 0 && (list[i].status === 'posting' || list[i].status === 'posted')) {
        return list;
    }
    if (i >= 0)
        list[i] = draft;
    else
        list.unshift(draft);
    return persist();
}
async function deleteDraft(id) {
    cache = allDrafts().filter((d) => d.id !== id);
    return persist();
}
/** Patch a draft in place; returns the updated draft or null if missing. */
async function updateDraft(id, patch) {
    const list = allDrafts();
    const i = list.findIndex((d) => d.id === id);
    if (i < 0)
        return null;
    list[i] = { ...list[i], ...patch, updatedAt: Date.now() };
    await persist();
    return list[i];
}
