export declare function startScheduler(): void;
export declare function postDraftNow(id: string): Promise<{
    ok: boolean;
    message: string;
}>;
