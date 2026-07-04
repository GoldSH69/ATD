import { safeStorage } from 'electron'
import { db } from './localdb'
import type { AppSettings } from './types'

/**
 * Settings store. Secrets (API keys, Threads access token) are encrypted at
 * rest with Electron safeStorage (DPAPI on Windows, Keychain on macOS) and
 * returned decrypted to callers. If decryption fails (e.g. the OS profile
 * changed), the secret degrades to '' so the user just re-enters it.
 */

const ENC_PREFIX = 'enc:v1:'

export function defaultSettings(): AppSettings {
  return {
    theme: 'dark',
    onboarded: false,
    topics: ['artificial intelligence', 'technology', 'startups'],
    llm: {
      provider: 'local',
      claude: { apiKey: '', model: 'claude-sonnet-5' },
      openai: { apiKey: '', model: 'gpt-4o-mini' },
      local: { baseUrl: 'http://localhost:11434/v1', model: 'llama3.1', apiKey: '' },
    },
    threads: { accessToken: '', userId: '', username: '' },
    style: { notes: '', samples: [] },
    autoDraft: { enabled: false, intervalMinutes: 120, maxPerRun: 2 },
  }
}

function encryptSecret(value: string): string {
  if (!value || value.startsWith(ENC_PREFIX)) return value
  try {
    if (!safeStorage.isEncryptionAvailable()) return value
    return ENC_PREFIX + safeStorage.encryptString(value).toString('base64')
  } catch {
    return value
  }
}

function decryptSecret(value: string): string {
  if (!value || !value.startsWith(ENC_PREFIX)) return value
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), 'base64'))
  } catch {
    return ''
  }
}

function mapSecrets(s: AppSettings, fn: (v: string) => string): AppSettings {
  return {
    ...s,
    llm: {
      ...s.llm,
      claude: { ...s.llm.claude, apiKey: fn(s.llm.claude.apiKey) },
      openai: { ...s.llm.openai, apiKey: fn(s.llm.openai.apiKey) },
      local: { ...s.llm.local, apiKey: fn(s.llm.local.apiKey) },
    },
    threads: { ...s.threads, accessToken: fn(s.threads.accessToken) },
  }
}

const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback)
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

/** Merge stored (possibly older-shaped) settings over defaults, field by field. */
function normalize(raw: Partial<AppSettings> | null): AppSettings {
  const d = defaultSettings()
  if (!raw || typeof raw !== 'object') return d
  // Only fall back to the seed topics when the key is absent (first run); an
  // explicitly-emptied list must persist so auto-draft stops on removed topics.
  const topics = strArr(raw.topics).map((t) => t.trim()).filter(Boolean)
  return {
    theme: raw.theme === 'light' ? 'light' : raw.theme === 'dark' ? 'dark' : d.theme,
    onboarded: raw.onboarded === true,
    topics: Array.isArray(raw.topics) ? topics : d.topics,
    llm: {
      provider:
        raw.llm?.provider === 'claude' || raw.llm?.provider === 'openai' || raw.llm?.provider === 'local'
          ? raw.llm.provider
          : d.llm.provider,
      claude: {
        apiKey: str(raw.llm?.claude?.apiKey, ''),
        model: str(raw.llm?.claude?.model, d.llm.claude.model) || d.llm.claude.model,
      },
      openai: {
        apiKey: str(raw.llm?.openai?.apiKey, ''),
        model: str(raw.llm?.openai?.model, d.llm.openai.model) || d.llm.openai.model,
      },
      local: {
        baseUrl: str(raw.llm?.local?.baseUrl, d.llm.local.baseUrl) || d.llm.local.baseUrl,
        model: str(raw.llm?.local?.model, d.llm.local.model) || d.llm.local.model,
        apiKey: str(raw.llm?.local?.apiKey, ''),
      },
    },
    threads: {
      accessToken: str(raw.threads?.accessToken, ''),
      userId: str(raw.threads?.userId, '').trim(),
      username: str(raw.threads?.username, ''),
    },
    style: { notes: str(raw.style?.notes, ''), samples: strArr(raw.style?.samples) },
    autoDraft: {
      enabled: raw.autoDraft?.enabled === true,
      intervalMinutes: Math.max(15, Number(raw.autoDraft?.intervalMinutes) || d.autoDraft.intervalMinutes),
      maxPerRun: Math.min(10, Math.max(1, Number(raw.autoDraft?.maxPerRun) || d.autoDraft.maxPerRun)),
    },
  }
}

export function getSettings(): AppSettings {
  const stored = normalize(db.get<Partial<AppSettings>>('settings'))
  return mapSecrets(stored, decryptSecret)
}

export async function setSettings(settings: AppSettings): Promise<void> {
  const clean = normalize(settings)
  await db.set('settings', mapSecrets(clean, encryptSecret))
}
