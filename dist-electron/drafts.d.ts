import type { Draft } from './types';
export declare function setDraftsChangedListener(cb: (drafts: Draft[]) => void): void;
export declare function allDrafts(): Draft[];
export declare function upsertDraft(input: unknown): Promise<Draft[]>;
export declare function deleteDraft(id: string): Promise<Draft[]>;
/** Patch a draft in place; returns the updated draft or null if missing. */
export declare function updateDraft(id: string, patch: Partial<Draft>): Promise<Draft | null>;
