import type { TestResult, ThreadsPost, UnansweredReply } from './types';
export interface ThreadsCfg {
    accessToken: string;
    userId: string;
}
export declare function testThreads(cfg: ThreadsCfg): Promise<TestResult & {
    username?: string;
    userId?: string;
}>;
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
export declare function fetchUnansweredReplies(cfg: ThreadsCfg): Promise<UnansweredReply[]>;
