import type { NewsItem, NewsSourceSettings } from './types';
export type NewsMode = 'news' | 'blogs';
export interface NewsFetchInput {
    query: string;
    mode?: NewsMode;
    sources?: NewsSourceSettings;
}
export declare function fetchTopicNews(input: string | NewsFetchInput): Promise<NewsItem[]>;
