/**
 * Minimal local database: one JSON file per key under userData/autothreads-db.
 * No native dependencies. Writes go to a unique temp file then rename (atomic
 * on the same volume); rename retries a few times because Windows AV/indexers
 * transiently lock freshly written files (EPERM/EBUSY).
 *
 * set() THROWS on failure — callers must know a save didn't land.
 */
declare class LocalDb {
    private dir;
    private writeSeq;
    private writeChains;
    private ensureDir;
    private fileFor;
    get<T>(key: string): T | null;
    set(key: string, value: unknown): Promise<boolean>;
    private writeNow;
    delete(key: string): boolean;
}
export declare const db: LocalDb;
export {};
