import type { GenerateResult, ImageCandidate } from './types';
export declare function generateImageKeywords(input: {
    topic?: string;
    title?: string;
    text: string;
}): Promise<GenerateResult>;
export declare function searchImages(query: string): Promise<{
    ok: boolean;
    images: ImageCandidate[];
    message: string;
}>;
