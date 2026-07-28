import type { TestResult, ThreadsPost, UnansweredReply } from './types';
export interface ThreadsCfg {
    accessToken: string;
    userId: string;
}
export declare function testThreads(cfg: ThreadsCfg): Promise<TestResult & {
    username?: string;
    userId?: string;
}>;
/** True when the media id is still addressable via the Graph API. */
export declare function threadsMediaExists(cfg: ThreadsCfg, mediaId: string): Promise<boolean>;
export declare function publishPost(cfg: ThreadsCfg, text: string, imageUrl?: string): Promise<{
    id: string;
    permalink?: string;
}>;
export declare function publishReply(cfg: ThreadsCfg, text: string, replyToId: string): Promise<{
    id: string;
    permalink?: string;
}>;
export declare function fetchMyPosts(cfg: ThreadsCfg, limit: number): Promise<ThreadsPost[]>;
export declare function scrapeRecentTexts(cfg: ThreadsCfg, count: number): Promise<string[]>;
/** A public Threads post found via keyword search (for discovery engagement). */
export interface DiscoverPost {
    id: string;
    text: string;
    username: string;
    timestamp: string;
    permalink?: string;
}
/**
 * Search public Threads posts by keyword.
 * Requires `threads_keyword_search`. Without advanced access, only the auth user's own posts return.
 */
export declare function searchKeywordPosts(cfg: ThreadsCfg, keyword: string, limit?: number): Promise<{
    ok: boolean;
    posts: DiscoverPost[];
    message: string;
}>;
export type MentionsFetchResult = {
    items: UnansweredReply[];
    /** Set when the Mentions API call failed (e.g. missing threads_manage_mentions). */
    error?: string;
};
/**
 * Public posts where another profile @mentioned you (Threads Mentions API).
 * Always queries `/me/mentions` (more reliable than a stored user id).
 * Requires `threads_manage_mentions` on the access token.
 */
export declare function fetchUnansweredMentions(cfg: ThreadsCfg): Promise<MentionsFetchResult>;
/**
 * Unanswered engagement: replies on your posts + (optional) @mentions of you.
 * Mentions require `threads_manage_mentions`; failures degrade to replies only
 * and surface `mentionError` for the UI/activity log.
 */
export declare function fetchUnansweredReplies(cfg: ThreadsCfg, opts?: {
    includeMentions?: boolean;
}): Promise<UnansweredReply[]>;
export declare function fetchUnansweredEngagement(cfg: ThreadsCfg, opts?: {
    includeMentions?: boolean;
}): Promise<{
    replies: UnansweredReply[];
    mentionError?: string;
}>;
