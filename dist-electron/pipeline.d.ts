import type { AppSettings, GenerateResult } from './types';
export declare function unconfiguredMessage(llm: AppSettings['llm']): string | null;
export declare function generatePostDraft(input: {
    topic: string;
    newsTitle?: string;
    newsSource?: string;
    newsUrl?: string;
}): Promise<GenerateResult>;
export declare function generateReplyDraft(input: {
    replyText: string;
    replyUsername: string;
    rootPostText: string;
    kind?: 'reply' | 'mention';
}): Promise<GenerateResult>;
/** One auto-draft pass: next topic (round-robin), fresh news, drafts. Never throws. */
export declare function runAutoDraft(): Promise<number>;
export interface AutopilotPostInput {
    kind: 'news' | 'original';
    category?: string;
    angle?: string;
    newsTitle?: string;
    newsSource?: string;
}
export declare function generateAutopilotPost(input: AutopilotPostInput): Promise<GenerateResult>;
export interface AutopilotReplyInput {
    replyText: string;
    replyUsername: string;
    rootPostText: string;
    contextText?: string;
    isCreator: boolean;
    /** 'mention' = @mention; 'discover' = cold reply on a public post; default = reply on yours. */
    kind?: 'reply' | 'mention' | 'discover';
}
export declare function generateAutopilotReply(input: AutopilotReplyInput): Promise<GenerateResult>;
export interface AutopilotCandidate {
    index: number;
    title: string;
    source: string;
    category: string;
}
export interface AutopilotPlanItem {
    kind: 'news' | 'original';
    index?: number;
    category?: string;
    angle?: string;
}
/**
 * Ask the LLM to decide what to post right now. It may return zero posts.
 * Falls back to a heuristic plan if the model's output is not usable JSON.
 */
export declare function decideAutopilotPlan(input: {
    candidates: AutopilotCandidate[];
    maxPosts: number;
    postsToday: number;
}): Promise<{
    items: AutopilotPlanItem[];
    reasoning: string;
    usedFallback: boolean;
}>;
