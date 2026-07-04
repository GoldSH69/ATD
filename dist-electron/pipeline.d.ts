import type { GenerateResult } from './types';
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
}): Promise<GenerateResult>;
/** One auto-draft pass: next topic (round-robin), fresh news, drafts. Never throws. */
export declare function runAutoDraft(): Promise<number>;
