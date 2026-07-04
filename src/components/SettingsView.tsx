import { useEffect, useState } from 'react'
import { useApp } from '../store/appStore'
import type {
  AppSettings,
  AutoDraftSettings,
  LlmProviderKind,
  LlmSettings,
  TestResult,
  ThemeMode,
  ThreadsSettings,
} from '../types'
import { snippet } from '../util/format'

const THEMES: { id: ThemeMode; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
]

const PROVIDERS: { id: LlmProviderKind; label: string }[] = [
  { id: 'claude', label: 'Claude' },
  { id: 'openai', label: 'ChatGPT' },
  { id: 'local', label: 'Local LLM' },
]

export default function SettingsView() {
  // settings is loaded before any view renders, so the non-null cast is safe here
  const stored = useApp((s) => s.settings) as AppSettings
  const saveSettings = useApp((s) => s.saveSettings)
  const setShowOnboarding = useApp((s) => s.setShowOnboarding)
  const toast = useApp((s) => s.toast)

  const [form, setForm] = useState<AppSettings>(stored)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [threadsResult, setThreadsResult] = useState<TestResult | null>(null)
  const [llmResult, setLlmResult] = useState<TestResult | null>(null)
  const [testingThreads, setTestingThreads] = useState(false)
  const [testingLlm, setTestingLlm] = useState(false)
  const [importing, setImporting] = useState(false)
  const [topicInput, setTopicInput] = useState('')
  const [sampleInput, setSampleInput] = useState('')

  // follow external settings changes only while the form has no local edits
  useEffect(() => {
    if (!dirty) setForm(stored)
  }, [stored, dirty])

  const edit = (fn: (f: AppSettings) => AppSettings) => {
    setForm(fn)
    setDirty(true)
  }

  const setThreads = (patch: Partial<ThreadsSettings>) => {
    setThreadsResult(null)
    edit((f) => ({ ...f, threads: { ...f.threads, ...patch } }))
  }

  const setLlm = (fn: (l: LlmSettings) => LlmSettings) => {
    setLlmResult(null)
    edit((f) => ({ ...f, llm: fn(f.llm) }))
  }

  const setAuto = (patch: Partial<AutoDraftSettings>) =>
    edit((f) => ({ ...f, autoDraft: { ...f.autoDraft, ...patch } }))

  // Theme applies immediately (like the sidebar toggle) rather than staging in the
  // dirty form, so a Save of other fields can never revert a theme set elsewhere.
  const applyThemeNow = (theme: ThemeMode) => {
    setForm((f) => ({ ...f, theme }))
    const latest = useApp.getState().settings
    if (latest) void saveSettings({ ...latest, theme })
  }

  const save = async () => {
    setSaving(true)
    // Keep whatever theme is current in the store; theme is not part of this form's diff.
    const latest = useApp.getState().settings
    const ok = await saveSettings({ ...form, theme: latest?.theme ?? form.theme })
    setSaving(false)
    if (ok) {
      setDirty(false)
      toast('ok', 'Settings saved')
    }
  }

  const testThreads = async () => {
    setTestingThreads(true)
    setThreadsResult(null)
    try {
      const res = await window.api.threadsTest({
        accessToken: form.threads.accessToken,
        userId: form.threads.userId,
      })
      setThreadsResult({ ok: res.ok, message: res.message })
      if (res.ok) {
        const username = res.username ?? form.threads.username
        const userId = res.userId ?? form.threads.userId
        if (username !== form.threads.username || userId !== form.threads.userId)
          edit((f) => ({ ...f, threads: { ...f.threads, username, userId } }))
      }
    } catch (err) {
      setThreadsResult({ ok: false, message: err instanceof Error ? err.message : String(err) })
    }
    setTestingThreads(false)
  }

  const testLlm = async () => {
    setTestingLlm(true)
    setLlmResult(null)
    try {
      setLlmResult(await window.api.llmTest(form.llm))
    } catch (err) {
      setLlmResult({ ok: false, message: err instanceof Error ? err.message : String(err) })
    }
    setTestingLlm(false)
  }

  const importSamples = async () => {
    setImporting(true)
    try {
      const res = await window.api.threadsScrapeStyle(10)
      if (res.ok) {
        const fresh = res.samples.filter((s) => !form.style.samples.includes(s))
        if (fresh.length > 0)
          edit((f) => ({
            ...f,
            style: {
              ...f.style,
              samples: [...f.style.samples, ...fresh.filter((s) => !f.style.samples.includes(s))],
            },
          }))
        toast('ok', res.message)
      } else {
        toast('err', res.message)
      }
    } catch (err) {
      toast('err', err instanceof Error ? err.message : String(err))
    }
    setImporting(false)
  }

  const addTopic = () => {
    const t = topicInput.trim()
    if (!t) return
    if (!form.topics.some((x) => x.toLowerCase() === t.toLowerCase()))
      edit((f) => ({ ...f, topics: [...f.topics, t] }))
    setTopicInput('')
  }

  const removeTopic = (topic: string) =>
    edit((f) => ({ ...f, topics: f.topics.filter((t) => t !== topic) }))

  const addSample = () => {
    const s = sampleInput.trim()
    if (!s || form.style.samples.includes(s)) return
    edit((f) => ({ ...f, style: { ...f.style, samples: [...f.style.samples, s] } }))
    setSampleInput('')
  }

  const removeSample = (idx: number) =>
    edit((f) => ({ ...f, style: { ...f.style, samples: f.style.samples.filter((_, i) => i !== idx) } }))

  const clampAuto = () => {
    const intervalMinutes = Math.max(15, Math.round(form.autoDraft.intervalMinutes) || 15)
    const maxPerRun = Math.min(10, Math.max(1, Math.round(form.autoDraft.maxPerRun) || 1))
    if (intervalMinutes !== form.autoDraft.intervalMinutes || maxPerRun !== form.autoDraft.maxPerRun)
      setAuto({ intervalMinutes, maxPerRun })
  }

  return (
    <div className="view">
      <div className="view-header">
        <div className="view-title">Settings</div>
        {dirty && <span className="view-sub">Unsaved changes</span>}
        <div className="view-actions">
          <button className="btn ghost" onClick={() => setShowOnboarding(true)}>
            Setup wizard
          </button>
          <button className="btn primary" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      <div className="view-body">
        <div className="settings-wrap">
          <div className="section">
            <div className="section-title">Appearance</div>
            <div className="section-desc">Interface theme.</div>
            <div className="row">
              <div className="seg">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    className={form.theme === t.id ? 'on' : ''}
                    onClick={() => applyThemeNow(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="section">
            <div className="section-title">Threads API</div>
            <div className="section-desc">
              Create a Meta app with the Threads API use case to get a long-lived access token.{' '}
              <button
                className="btn ghost small"
                onClick={() => void window.api.openExternal('https://developers.facebook.com/docs/threads')}
              >
                Threads API docs
              </button>
            </div>
            <div className="field">
              <span className="field-label">Access token</span>
              <input
                className="input mono"
                type="password"
                value={form.threads.accessToken}
                onChange={(e) => setThreads({ accessToken: e.target.value })}
              />
            </div>
            <div className="field">
              <span className="field-label">User ID</span>
              <input
                className="input"
                value={form.threads.userId}
                onChange={(e) => setThreads({ userId: e.target.value })}
              />
              <span className="hint">Leave empty to use "me".</span>
            </div>
            <div className="row">
              <button className="btn" disabled={testingThreads} onClick={() => void testThreads()}>
                {testingThreads ? 'Testing…' : 'Test connection'}
              </button>
              {form.threads.username && <span className="muted">Connected as @{form.threads.username}</span>}
            </div>
            {threadsResult && (
              <div className={`test-result ${threadsResult.ok ? 'ok' : 'err'}`}>{threadsResult.message}</div>
            )}
          </div>

          <div className="section">
            <div className="section-title">AI provider</div>
            <div className="section-desc">Which model writes your drafts.</div>
            <div className="field">
              <div className="row">
                <div className="seg">
                  {PROVIDERS.map((p) => (
                    <button
                      key={p.id}
                      className={form.llm.provider === p.id ? 'on' : ''}
                      onClick={() => setLlm((l) => ({ ...l, provider: p.id }))}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {form.llm.provider === 'claude' && (
              <>
                <div className="field">
                  <span className="field-label">API key</span>
                  <input
                    className="input mono"
                    type="password"
                    value={form.llm.claude.apiKey}
                    onChange={(e) => setLlm((l) => ({ ...l, claude: { ...l.claude, apiKey: e.target.value } }))}
                  />
                </div>
                <div className="field">
                  <span className="field-label">Model</span>
                  <input
                    className="input"
                    placeholder="claude-sonnet-5"
                    value={form.llm.claude.model}
                    onChange={(e) => setLlm((l) => ({ ...l, claude: { ...l.claude, model: e.target.value } }))}
                  />
                </div>
              </>
            )}
            {form.llm.provider === 'openai' && (
              <>
                <div className="field">
                  <span className="field-label">API key</span>
                  <input
                    className="input mono"
                    type="password"
                    value={form.llm.openai.apiKey}
                    onChange={(e) => setLlm((l) => ({ ...l, openai: { ...l.openai, apiKey: e.target.value } }))}
                  />
                </div>
                <div className="field">
                  <span className="field-label">Model</span>
                  <input
                    className="input"
                    placeholder="gpt-4o-mini"
                    value={form.llm.openai.model}
                    onChange={(e) => setLlm((l) => ({ ...l, openai: { ...l.openai, model: e.target.value } }))}
                  />
                </div>
              </>
            )}
            {form.llm.provider === 'local' && (
              <>
                <div className="field">
                  <span className="field-label">Base URL</span>
                  <input
                    className="input mono"
                    value={form.llm.local.baseUrl}
                    onChange={(e) => setLlm((l) => ({ ...l, local: { ...l.local, baseUrl: e.target.value } }))}
                  />
                  <span className="hint">
                    OpenAI-compatible endpoint. Ollama: http://localhost:11434/v1, LM Studio:
                    http://localhost:1234/v1
                  </span>
                </div>
                <div className="field">
                  <span className="field-label">Model</span>
                  <input
                    className="input"
                    value={form.llm.local.model}
                    onChange={(e) => setLlm((l) => ({ ...l, local: { ...l.local, model: e.target.value } }))}
                  />
                </div>
                <div className="field">
                  <span className="field-label">API key</span>
                  <input
                    className="input"
                    type="password"
                    value={form.llm.local.apiKey}
                    onChange={(e) => setLlm((l) => ({ ...l, local: { ...l.local, apiKey: e.target.value } }))}
                  />
                  <span className="hint">Optional.</span>
                </div>
              </>
            )}
            <div className="row">
              <button className="btn" disabled={testingLlm} onClick={() => void testLlm()}>
                {testingLlm ? 'Testing…' : 'Test connection'}
              </button>
            </div>
            {llmResult && (
              <div className={`test-result ${llmResult.ok ? 'ok' : 'err'}`}>{llmResult.message}</div>
            )}
          </div>

          <div className="section">
            <div className="section-title">Topics</div>
            <div className="section-desc">News topics used for draft generation.</div>
            <div className="field">
              <div className="row">
                {form.topics.map((t) => (
                  <span key={t} className="chip">
                    {t}
                    <button className="chip-x" onClick={() => removeTopic(t)} aria-label={`Remove ${t}`}>
                      ×
                    </button>
                  </span>
                ))}
                {form.topics.length === 0 && <span className="hint">No topics yet.</span>}
              </div>
            </div>
            <div className="row">
              <input
                className="input grow"
                placeholder="Add a topic"
                value={topicInput}
                onChange={(e) => setTopicInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addTopic()
                  }
                }}
              />
              <button className="btn" onClick={addTopic}>
                Add
              </button>
            </div>
          </div>

          <div className="section">
            <div className="section-title">Writing style</div>
            <div className="field">
              <span className="field-label">Style notes</span>
              <textarea
                className="textarea"
                value={form.style.notes}
                onChange={(e) => edit((f) => ({ ...f, style: { ...f.style, notes: e.target.value } }))}
              />
              <span className="hint">Tone, voice, quirks. Included in every generation prompt.</span>
            </div>
            <div className="field">
              <span className="field-label">Samples</span>
              {form.style.samples.map((s, i) => (
                <div key={`${i}-${s.slice(0, 16)}`} className="row">
                  <span className="muted grow">{snippet(s)}</span>
                  <button className="chip-x" onClick={() => removeSample(i)} aria-label="Remove sample">
                    ×
                  </button>
                </div>
              ))}
              {form.style.samples.length === 0 && (
                <span className="hint">No samples yet. Add one below or import from Threads.</span>
              )}
            </div>
            <div className="field">
              <textarea
                className="textarea"
                placeholder="Paste a post that sounds like you"
                value={sampleInput}
                onChange={(e) => setSampleInput(e.target.value)}
              />
              <div className="row">
                <button className="btn" disabled={!sampleInput.trim()} onClick={addSample}>
                  Add sample
                </button>
                <button className="btn" disabled={importing} onClick={() => void importSamples()}>
                  {importing ? 'Importing…' : 'Import recent posts from Threads'}
                </button>
              </div>
            </div>
          </div>

          <div className="section">
            <div className="section-title">Automation</div>
            <div className="section-desc">
              Periodically pulls fresh news for your topics and drafts posts for review. Scheduled posts
              publish automatically; drafts always wait for your review.
            </div>
            <div className="field">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={form.autoDraft.enabled}
                  onChange={(e) => setAuto({ enabled: e.target.checked })}
                />
                <span>Auto-generate drafts</span>
              </label>
            </div>
            {form.autoDraft.enabled && (
              <div className="row">
                <div className="field grow">
                  <span className="field-label">Every N minutes</span>
                  <input
                    className="input"
                    type="number"
                    min={15}
                    value={form.autoDraft.intervalMinutes}
                    onChange={(e) => {
                      const n = e.target.valueAsNumber
                      if (!Number.isNaN(n)) setAuto({ intervalMinutes: n })
                    }}
                    onBlur={clampAuto}
                  />
                </div>
                <div className="field grow">
                  <span className="field-label">Max drafts per run</span>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={10}
                    value={form.autoDraft.maxPerRun}
                    onChange={(e) => {
                      const n = e.target.valueAsNumber
                      if (!Number.isNaN(n)) setAuto({ maxPerRun: n })
                    }}
                    onBlur={clampAuto}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
