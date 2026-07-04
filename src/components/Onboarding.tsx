import { useState } from 'react'
import { useApp } from '../store/appStore'
import ThreadsTokenHelp from './ThreadsTokenHelp'
import type {
  AppSettings,
  AutoDraftSettings,
  LanguageCode,
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

const LANGUAGES: { id: LanguageCode; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Español' },
  { id: 'ko', label: '한국어' },
  { id: 'zh', label: '中文' },
  { id: 'ja', label: '日本語' },
  { id: 'fr', label: 'Français' },
  { id: 'de', label: 'Deutsch' },
  { id: 'pt', label: 'Português' },
]

const PROVIDERS: { id: LlmProviderKind; label: string }[] = [
  { id: 'claude', label: 'Claude' },
  { id: 'openai', label: 'ChatGPT' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'local', label: 'Local LLM' },
  { id: 'other', label: 'Other' },
]

type StepId = 'welcome' | 'provider' | 'threads' | 'topics' | 'style' | 'automation' | 'finish'

const STEPS: { id: StepId; label: string }[] = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'provider', label: 'AI provider' },
  { id: 'threads', label: 'Threads API' },
  { id: 'topics', label: 'Topics' },
  { id: 'style', label: 'Writing style' },
  { id: 'automation', label: 'Automation' },
  { id: 'finish', label: 'Finish' },
]

export default function Onboarding() {
  // settings is loaded before the modal renders, so the non-null cast is safe
  const stored = useApp((s) => s.settings) as AppSettings
  const saveSettings = useApp((s) => s.saveSettings)
  const setShowOnboarding = useApp((s) => s.setShowOnboarding)
  const toast = useApp((s) => s.toast)

  const [form, setForm] = useState<AppSettings>(stored)
  const [step, setStep] = useState(0)
  const [maxVisited, setMaxVisited] = useState(0)
  const [saving, setSaving] = useState(false)
  const [llmResult, setLlmResult] = useState<TestResult | null>(null)
  const [threadsResult, setThreadsResult] = useState<TestResult | null>(null)
  const [testingLlm, setTestingLlm] = useState(false)
  const [testingThreads, setTestingThreads] = useState(false)
  const [connectingThreads, setConnectingThreads] = useState(false)
  const [importing, setImporting] = useState(false)
  const [showTokenHelp, setShowTokenHelp] = useState(false)
  const [topicInput, setTopicInput] = useState('')
  const [sampleInput, setSampleInput] = useState('')

  const stepId = STEPS[step].id
  const isLast = step === STEPS.length - 1

  const setTheme = (theme: ThemeMode) => {
    setForm((f) => ({ ...f, theme }))
    document.documentElement.dataset.theme = theme // live preview; persisted on save
  }

  const setLlm = (fn: (l: LlmSettings) => LlmSettings) => {
    setLlmResult(null)
    setForm((f) => ({ ...f, llm: fn(f.llm) }))
  }

  const setThreads = (patch: Partial<ThreadsSettings>) => {
    setThreadsResult(null)
    setForm((f) => ({ ...f, threads: { ...f.threads, ...patch } }))
  }

  const setAuto = (patch: Partial<AutoDraftSettings>) =>
    setForm((f) => ({ ...f, autoDraft: { ...f.autoDraft, ...patch } }))

  const saveAndContinue = async () => {
    setSaving(true)
    const done = isLast
    const ok = await saveSettings({ ...form, onboarded: done ? true : form.onboarded })
    setSaving(false)
    if (!ok) return
    if (done) {
      setShowOnboarding(false)
      toast('ok', 'Setup complete. Head to News to generate your first draft.')
      return
    }
    const next = step + 1
    setStep(next)
    setMaxVisited((m) => Math.max(m, next))
  }

  const skip = async () => {
    document.documentElement.dataset.theme = stored.theme // discard theme preview
    const ok = await saveSettings({ ...stored, onboarded: true })
    if (ok) {
      setShowOnboarding(false)
      toast('ok', 'Setup skipped. You can rerun it anytime from Settings.')
    }
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

  const testThreads = async () => {
    setTestingThreads(true)
    setThreadsResult(null)
    try {
      const res = await window.api.threadsTest({
        accessToken: form.threads.accessToken,
        userId: form.threads.userId,
      })
      setThreadsResult({ ok: res.ok, message: res.message })
      if (res.ok)
        setForm((f) => ({
          ...f,
          threads: {
            ...f.threads,
            username: res.username ?? f.threads.username,
            userId: res.userId ?? f.threads.userId,
          },
        }))
    } catch (err) {
      setThreadsResult({ ok: false, message: err instanceof Error ? err.message : String(err) })
    }
    setTestingThreads(false)
  }

  const connectThreadsOAuth = async () => {
    setConnectingThreads(true)
    setThreadsResult(null)
    try {
      const res = await window.api.threadsOAuthStart({
        appId: form.threads.appId,
        appSecret: form.threads.appSecret,
        redirectUri: form.threads.redirectUri,
        scopes: form.threads.scopes,
      })
      setThreadsResult({ ok: res.ok, message: res.message })
      if (res.ok && res.accessToken)
        setForm((f) => ({
          ...f,
          threads: {
            ...f.threads,
            accessToken: res.accessToken || f.threads.accessToken,
            userId: res.userId || f.threads.userId,
            username: res.username || f.threads.username,
            tokenExpiresAt: res.tokenExpiresAt ?? f.threads.tokenExpiresAt,
          },
        }))
    } catch (err) {
      setThreadsResult({ ok: false, message: err instanceof Error ? err.message : String(err) })
    }
    setConnectingThreads(false)
  }

  const importSamples = async () => {
    setImporting(true)
    try {
      const res = await window.api.threadsScrapeStyle(10)
      if (res.ok) {
        setForm((f) => ({
          ...f,
          style: {
            ...f.style,
            samples: [...f.style.samples, ...res.samples.filter((s) => !f.style.samples.includes(s))],
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
      setForm((f) => ({ ...f, topics: [...f.topics, t] }))
    setTopicInput('')
  }

  const addSample = () => {
    const s = sampleInput.trim()
    if (!s || form.style.samples.includes(s)) return
    setForm((f) => ({ ...f, style: { ...f.style, samples: [...f.style.samples, s] } }))
    setSampleInput('')
  }

  const llmConfigured =
    form.llm.provider === 'local'
      ? Boolean(form.llm.local.baseUrl)
      : form.llm.provider === 'other'
        ? Boolean(form.llm.other.baseUrl)
        : Boolean(form.llm[form.llm.provider].apiKey)
  const activeModel =
    form.llm.provider === 'claude'
      ? form.llm.claude.model
      : form.llm.provider === 'openai'
        ? form.llm.openai.model
        : form.llm.provider === 'gemini'
          ? form.llm.gemini.model
          : form.llm.provider === 'other'
            ? form.llm.other.model || 'custom'
            : form.llm.local.model
  const providerLabel = PROVIDERS.find((p) => p.id === form.llm.provider)?.label ?? form.llm.provider

  return (
    <div className="modal-backdrop">
      <div className="ob-modal" role="dialog" aria-modal="true" aria-label="AutoThreads setup">
        <nav className="ob-nav">
          <div className="ob-nav-title">Setup</div>
          {STEPS.map((s, i) => (
            <button
              key={s.id}
              className={`ob-nav-item${i === step ? ' active' : ''}${i <= maxVisited ? '' : ' locked'}`}
              disabled={i > maxVisited}
              onClick={() => setStep(i)}
            >
              <span>{s.label}</span>
              {i < maxVisited && i !== step && <span className="ob-nav-check">✓</span>}
            </button>
          ))}
          <button className="link ob-skip" onClick={() => void skip()}>
            Skip setup
          </button>
        </nav>

        <div className="ob-content">
          <div className="ob-page" key={stepId}>
            {stepId === 'welcome' && (
              <>
                <div className="ob-title">Welcome to AutoThreads</div>
                <p className="ob-lede">
                  News-driven Threads drafts, written in your voice, reviewed by you. This setup walks
                  through everything the app needs and takes about two minutes.
                </p>
                <div className="field">
                  <span className="field-label">Appearance</span>
                  <div className="row">
                    <div className="seg">
                      {THEMES.map((t) => (
                        <button
                          key={t.id}
                          className={form.theme === t.id ? 'on' : ''}
                          onClick={() => setTheme(t.id)}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <span className="hint">White monotone or black monotone. Applies immediately.</span>
                </div>
                <div className="field">
                  <span className="field-label">Language</span>
                  <select
                    className="select"
                    value={form.language}
                    onChange={(e) => setForm((f) => ({ ...f, language: e.target.value as LanguageCode }))}
                  >
                    {LANGUAGES.map((language) => (
                      <option key={language.id} value={language.id}>
                        {language.label}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {stepId === 'provider' && (
              <>
                <div className="ob-title">Choose your model</div>
                <p className="ob-lede">
                  Drafts are written by Claude, ChatGPT, or a local model running on this machine.
                </p>
                <div className="field">
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
                      <span className="hint">From console.anthropic.com, starts with sk-ant.</span>
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
                      <span className="hint">From platform.openai.com.</span>
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
                {form.llm.provider === 'gemini' && (
                  <>
                    <div className="field">
                      <span className="field-label">API key</span>
                      <input
                        className="input mono"
                        type="password"
                        value={form.llm.gemini.apiKey}
                        onChange={(e) => setLlm((l) => ({ ...l, gemini: { ...l.gemini, apiKey: e.target.value } }))}
                      />
                      <span className="hint">Gemini API key from Google AI Studio.</span>
                    </div>
                    <div className="field">
                      <span className="field-label">Model</span>
                      <input
                        className="input"
                        placeholder="gemini-3.5-flash"
                        value={form.llm.gemini.model}
                        onChange={(e) => setLlm((l) => ({ ...l, gemini: { ...l.gemini, model: e.target.value } }))}
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
                        OpenAI-compatible endpoint. Jarvis: http://127.0.0.1:8080/v1/chat/completions,
                        Ollama: http://localhost:11434/v1, LM Studio: http://localhost:1234/v1
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
                {form.llm.provider === 'other' && (
                  <>
                    <div className="field">
                      <span className="field-label">Base URL</span>
                      <input
                        className="input mono"
                        placeholder="https://openrouter.ai/api/v1"
                        value={form.llm.other.baseUrl}
                        onChange={(e) => setLlm((l) => ({ ...l, other: { ...l.other, baseUrl: e.target.value } }))}
                      />
                    </div>
                    <div className="field">
                      <span className="field-label">Model</span>
                      <input
                        className="input"
                        value={form.llm.other.model}
                        onChange={(e) => setLlm((l) => ({ ...l, other: { ...l.other, model: e.target.value } }))}
                      />
                    </div>
                    <div className="field">
                      <span className="field-label">API key</span>
                      <input
                        className="input mono"
                        type="password"
                        value={form.llm.other.apiKey}
                        onChange={(e) => setLlm((l) => ({ ...l, other: { ...l.other, apiKey: e.target.value } }))}
                      />
                      <span className="hint">Optional if the endpoint does not require bearer auth.</span>
                    </div>
                    <div className="field">
                      <span className="field-label">Headers JSON</span>
                      <textarea
                        className="textarea mono"
                        value={form.llm.other.headersJson}
                        onChange={(e) => setLlm((l) => ({ ...l, other: { ...l.other, headersJson: e.target.value } }))}
                      />
                    </div>
                    <div className="field">
                      <span className="field-label">Request JSON</span>
                      <textarea
                        className="textarea mono"
                        value={form.llm.other.bodyJson}
                        onChange={(e) => setLlm((l) => ({ ...l, other: { ...l.other, bodyJson: e.target.value } }))}
                      />
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
              </>
            )}

            {stepId === 'threads' && (
              <>
                <div className="ob-title">Connect Threads</div>
                <p className="ob-lede">
                  Paste a Threads access token to publish and manage replies. Drafting works without it,
                  and OAuth app credentials are only needed if you want AutoThreads to run the OAuth flow.
                </p>
                <div className="field">
                  <div className="field-label-row">
                    <span className="field-label">Access token</span>
                    <button className="btn ghost small" onClick={() => setShowTokenHelp(true)}>
                      How to get token
                    </button>
                  </div>
                  <input
                    className="input mono"
                    type="password"
                    value={form.threads.accessToken}
                    onChange={(e) => setThreads({ accessToken: e.target.value })}
                  />
                </div>
                <details className="advanced-panel">
                  <summary>Advanced OAuth setup (optional)</summary>
                <div className="field">
                  <span className="field-label">App ID</span>
                  <input
                    className="input mono"
                    value={form.threads.appId}
                    onChange={(e) => setThreads({ appId: e.target.value })}
                  />
                </div>
                <div className="field">
                  <span className="field-label">App secret</span>
                  <input
                    className="input mono"
                    type="password"
                    value={form.threads.appSecret}
                    onChange={(e) => setThreads({ appSecret: e.target.value })}
                  />
                </div>
                <div className="field">
                  <span className="field-label">Redirect URI</span>
                  <input
                    className="input mono"
                    value={form.threads.redirectUri}
                    onChange={(e) => setThreads({ redirectUri: e.target.value })}
                  />
                  <span className="hint">Register this exact URI in the Meta app OAuth settings.</span>
                </div>
                <div className="field">
                  <span className="field-label">Scopes</span>
                  <input
                    className="input mono"
                    value={form.threads.scopes}
                    onChange={(e) => setThreads({ scopes: e.target.value })}
                  />
                </div>
                <div className="row">
                  <button className="btn" disabled={connectingThreads} onClick={() => void connectThreadsOAuth()}>
                    {connectingThreads ? 'Waiting for browser…' : 'Connect with Threads OAuth'}
                  </button>
                  {form.threads.tokenExpiresAt && (
                    <span className="muted">
                      Token expires {new Date(form.threads.tokenExpiresAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
                </details>
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
                  <button
                    className="btn ghost small"
                    onClick={() => void window.api.openExternal('https://developers.facebook.com/docs/threads')}
                  >
                    Threads API docs
                  </button>
                </div>
                {threadsResult && (
                  <div className={`test-result ${threadsResult.ok ? 'ok' : 'err'}`}>{threadsResult.message}</div>
                )}
              </>
            )}

            {stepId === 'topics' && (
              <>
                <div className="ob-title">Pick your topics</div>
                <p className="ob-lede">
                  The News view pulls fresh headlines for these topics, and auto-drafting rotates
                  through them.
                </p>
                <div className="field">
                  <div className="row">
                    {form.topics.map((t) => (
                      <span key={t} className="chip">
                        {t}
                        <button
                          className="chip-x"
                          onClick={() => setForm((f) => ({ ...f, topics: f.topics.filter((x) => x !== t) }))}
                          aria-label={`Remove ${t}`}
                        >
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
              </>
            )}

            {stepId === 'style' && (
              <>
                <div className="ob-title">Teach it your voice</div>
                <p className="ob-lede">
                  Style notes and sample posts are included in every generation prompt, so drafts sound
                  like you instead of a press release.
                </p>
                <div className="field">
                  <span className="field-label">Style notes</span>
                  <textarea
                    className="textarea"
                    placeholder="Short sentences. Dry humor. No hashtags, no exclamation marks."
                    value={form.style.notes}
                    onChange={(e) => setForm((f) => ({ ...f, style: { ...f.style, notes: e.target.value } }))}
                  />
                </div>
                <div className="field">
                  <span className="field-label">Samples</span>
                  {form.style.samples.map((s, i) => (
                    <div key={`${i}-${s.slice(0, 16)}`} className="row">
                      <span className="muted grow">{snippet(s)}</span>
                      <button
                        className="chip-x"
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            style: { ...f.style, samples: f.style.samples.filter((_, k) => k !== i) },
                          }))
                        }
                        aria-label="Remove sample"
                      >
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
                    <button
                      className="btn"
                      disabled={importing || !form.threads.accessToken}
                      onClick={() => void importSamples()}
                    >
                      {importing ? 'Importing…' : 'Import recent posts from Threads'}
                    </button>
                  </div>
                  {!form.threads.accessToken && (
                    <span className="hint">Importing needs the Threads connection from the previous step.</span>
                  )}
                </div>
              </>
            )}

            {stepId === 'automation' && (
              <>
                <div className="ob-title">Automation</div>
                <p className="ob-lede">
                  Optional: pull fresh news on a timer and draft posts for review. Nothing publishes
                  itself; only posts you schedule go out automatically.
                </p>
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
                      />
                    </div>
                  </div>
                )}
              </>
            )}

            {stepId === 'finish' && (
              <>
                <div className="ob-title">You're set</div>
                <p className="ob-lede">
                  Head to News and generate your first draft. Everything here can be changed later in
                  Settings.
                </p>
                <div className="ob-summary">
                  <div className="ob-summary-row">
                    <span className="k">Model</span>
                    <span>{llmConfigured ? `${providerLabel} · ${activeModel}` : 'Not configured'}</span>
                  </div>
                  <div className="ob-summary-row">
                    <span className="k">Threads</span>
                    <span>
                      {form.threads.accessToken
                        ? form.threads.username
                          ? `@${form.threads.username}`
                          : 'Token saved'
                        : 'Not connected'}
                    </span>
                  </div>
                  <div className="ob-summary-row">
                    <span className="k">Topics</span>
                    <span>{form.topics.length > 0 ? form.topics.join(', ') : 'None'}</span>
                  </div>
                  <div className="ob-summary-row">
                    <span className="k">Voice</span>
                    <span>
                      {form.style.notes || form.style.samples.length > 0
                        ? [
                            form.style.notes ? 'notes' : null,
                            form.style.samples.length > 0 ? `${form.style.samples.length} samples` : null,
                          ]
                            .filter(Boolean)
                            .join(', ')
                        : 'Default'}
                    </span>
                  </div>
                  <div className="ob-summary-row">
                    <span className="k">Auto-draft</span>
                    <span>
                      {form.autoDraft.enabled
                        ? `Every ${form.autoDraft.intervalMinutes} min, up to ${form.autoDraft.maxPerRun}`
                        : 'Off'}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="ob-footer">
            <button className="btn ghost" disabled={step === 0 || saving} onClick={() => setStep(step - 1)}>
              Previous
            </button>
            <button className="btn primary" disabled={saving} onClick={() => void saveAndContinue()}>
              {saving ? 'Saving…' : isLast ? 'Finish setup' : 'Save and continue'}
            </button>
          </div>
        </div>
      </div>
      {showTokenHelp && <ThreadsTokenHelp onClose={() => setShowTokenHelp(false)} />}
    </div>
  )
}
