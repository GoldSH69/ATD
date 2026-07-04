/** Shared DTO types for the electron layer. Keep in sync with src/types.ts
 *  (the app tsconfig only includes src/, so the shapes are duplicated here). */
export type ThemeMode = 'light' | 'dark';
export type LlmProviderKind = 'claude' | 'openai' | 'local';
export type DraftKind = 'post' | 'reply';
export type DraftStatus = 'draft' | 'scheduled' | 'posting' | 'posted' | 'failed';
export interface LlmSettings {
    provider: LlmProviderKind;
    claude: {
        apiKey: string;
        model: string;
    };
    openai: {
        apiKey: string;
        model: string;
    };
    local: {
        baseUrl: string;
        model: string;
        apiKey: string;
    };
}
export interface ThreadsSettings {
    accessToken: string;
    userId: string;
    username: string;
}
export interface StyleSettings {
    notes: string;
    samples: string[];
}
export interface AutoDraftSettings {
    enabled: boolean;
    intervalMinutes: number;
    maxPerRun: number;
}
export interface AppSettings {
    theme: ThemeMode;
    onboarded: boolean;
    topics: string[];
    llm: LlmSettings;
    threads: ThreadsSettings;
    style: StyleSettings;
    autoDraft: AutoDraftSettings;
}
export interface Draft {
    id: string;
    kind: DraftKind;
    text: string;
    topic?: string;
    sourceTitle?: string;
    sourceUrl?: string;
    replyToId?: string;
    replyToText?: string;
    replyToUsername?: string;
    status: DraftStatus;
    scheduledAt?: number;
    postedAt?: number;
    threadsMediaId?: string;
    permalink?: string;
    error?: string;
    createdAt: number;
    updatedAt: number;
}
export interface NewsItem {
    title: string;
    link: string;
    source: string;
    publishedAt: number | null;
    topic: string;
}
export interface ThreadsPost {
    id: string;
    text: string;
    timestamp: string;
    permalink?: string;
}
export interface UnansweredReply {
    id: string;
    text: string;
    username: string;
    timestamp: string;
    rootPostId: string;
    rootPostText: string;
}
export interface TestResult {
    ok: boolean;
    message: string;
}
export interface GenerateResult {
    ok: boolean;
    text: string;
    message: string;
}
