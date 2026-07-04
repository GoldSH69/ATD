import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Minimal local database: one JSON file per key under userData/autothreads-db.
 * No native dependencies. Writes go to a unique temp file then rename (atomic
 * on the same volume); rename retries a few times because Windows AV/indexers
 * transiently lock freshly written files (EPERM/EBUSY).
 *
 * set() THROWS on failure — callers must know a save didn't land.
 */
class LocalDb {
  private dir: string | null = null
  private writeSeq = 0
  // Serializes writes per key: the rename-retry loop sleeps, so without this a
  // slower earlier write could rename its stale snapshot over a newer one.
  private writeChains = new Map<string, Promise<void>>()

  private ensureDir(): string {
    if (!this.dir) {
      this.dir = path.join(app.getPath('userData'), 'autothreads-db')
      fs.mkdirSync(this.dir, { recursive: true })
    }
    return this.dir
  }

  private fileFor(key: string): string {
    const safe = key.replace(/[^a-zA-Z0-9_-]/g, '_')
    return path.join(this.ensureDir(), `${safe}.json`)
  }

  get<T>(key: string): T | null {
    const file = this.fileFor(key)
    let raw: string
    try {
      raw = fs.readFileSync(file, 'utf8')
    } catch {
      return null // missing file = no value
    }
    try {
      return JSON.parse(raw) as T
    } catch (err) {
      // Corrupt data: quarantine instead of destroying, so it can be inspected.
      try {
        fs.renameSync(file, `${file}.corrupt`)
      } catch {
        // best effort
      }
      console.error(`[localdb] corrupt JSON for key "${key}" — quarantined`, err)
      return null
    }
  }

  set(key: string, value: unknown): Promise<boolean> {
    // Snapshot the value now, but chain the actual write after any in-flight
    // write to the same key so on-disk order matches call order.
    const json = JSON.stringify(value)
    const prev = this.writeChains.get(key) ?? Promise.resolve()
    const run = prev.then(() => this.writeNow(key, json))
    // Keep the chain alive regardless of individual outcomes; drop it once idle.
    const chain = run.then(
      () => undefined,
      () => undefined
    )
    this.writeChains.set(key, chain)
    void chain.then(() => {
      if (this.writeChains.get(key) === chain) this.writeChains.delete(key)
    })
    return run
  }

  private async writeNow(key: string, json: string): Promise<boolean> {
    const file = this.fileFor(key)
    const tmp = `${file}.${process.pid}.${this.writeSeq++}.tmp`
    try {
      await fs.promises.writeFile(tmp, json)
      let lastErr: unknown
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          await fs.promises.rename(tmp, file)
          return true
        } catch (err) {
          lastErr = err
          await sleep(120 * (attempt + 1))
        }
      }
      throw lastErr
    } catch (err) {
      try {
        await fs.promises.rm(tmp, { force: true })
      } catch {
        // best effort
      }
      console.error(`[localdb] write failed for key "${key}"`, err)
      throw err instanceof Error ? err : new Error(String(err))
    }
  }

  delete(key: string): boolean {
    try {
      fs.rmSync(this.fileFor(key), { force: true })
      return true
    } catch {
      return false
    }
  }
}

export const db = new LocalDb()
