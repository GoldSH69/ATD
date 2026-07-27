"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
const electron_1 = require("electron");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * Minimal local database: one JSON file per key under userData/autothreads-db.
 * No native dependencies. Writes go to a unique temp file then rename (atomic
 * on the same volume); rename retries a few times because Windows AV/indexers
 * transiently lock freshly written files (EPERM/EBUSY).
 *
 * set() THROWS on failure — callers must know a save didn't land.
 */
class LocalDb {
    dir = null;
    writeSeq = 0;
    // Serializes writes per key: the rename-retry loop sleeps, so without this a
    // slower earlier write could rename its stale snapshot over a newer one.
    writeChains = new Map();
    ensureDir() {
        if (!this.dir) {
            this.dir = path.join(electron_1.app.getPath('userData'), 'autothreads-db');
            fs.mkdirSync(this.dir, { recursive: true });
        }
        return this.dir;
    }
    fileFor(key) {
        const safe = key.replace(/[^a-zA-Z0-9_-]/g, '_');
        return path.join(this.ensureDir(), `${safe}.json`);
    }
    get(key) {
        const file = this.fileFor(key);
        let raw;
        try {
            raw = fs.readFileSync(file, 'utf8');
        }
        catch {
            return null; // missing file = no value
        }
        try {
            return JSON.parse(raw);
        }
        catch (err) {
            // Corrupt data: quarantine instead of destroying, so it can be inspected.
            try {
                fs.renameSync(file, `${file}.corrupt`);
            }
            catch {
                // best effort
            }
            console.error(`[localdb] corrupt JSON for key "${key}" — quarantined`, err);
            return null;
        }
    }
    set(key, value) {
        // Snapshot the value now, but chain the actual write after any in-flight
        // write to the same key so on-disk order matches call order.
        const json = JSON.stringify(value);
        const prev = this.writeChains.get(key) ?? Promise.resolve();
        const run = prev.then(() => this.writeNow(key, json));
        // Keep the chain alive regardless of individual outcomes; drop it once idle.
        const chain = run.then(() => undefined, () => undefined);
        this.writeChains.set(key, chain);
        void chain.then(() => {
            if (this.writeChains.get(key) === chain)
                this.writeChains.delete(key);
        });
        return run;
    }
    async writeNow(key, json) {
        const file = this.fileFor(key);
        const tmp = `${file}.${process.pid}.${this.writeSeq++}.tmp`;
        try {
            await fs.promises.writeFile(tmp, json);
            let lastErr;
            for (let attempt = 0; attempt < 4; attempt++) {
                try {
                    await fs.promises.rename(tmp, file);
                    return true;
                }
                catch (err) {
                    lastErr = err;
                    await sleep(120 * (attempt + 1));
                }
            }
            throw lastErr;
        }
        catch (err) {
            try {
                await fs.promises.rm(tmp, { force: true });
            }
            catch {
                // best effort
            }
            console.error(`[localdb] write failed for key "${key}"`, err);
            throw err instanceof Error ? err : new Error(String(err));
        }
    }
    delete(key) {
        try {
            fs.rmSync(this.fileFor(key), { force: true });
            return true;
        }
        catch {
            return false;
        }
    }
}
exports.db = new LocalDb();
