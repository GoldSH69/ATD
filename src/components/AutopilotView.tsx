import { useEffect, useRef, useState } from 'react'
import { useApp } from '../store/appStore'
import { AUTOPILOT_CATEGORIES, AUTOPILOT_DEFAULT_CATEGORIES, AUTOPILOT_POPULAR_CATEGORY_IDS } from '../types'
import type { AppSettings, AutopilotSettings, PostLanguageMode } from '../types'
import { timeAgo } from '../util/format'

/**
 * Full-Auto ("autopilot") control room. Configure the agent's goal, niches,
 * persona, cadence, and safety caps, then Launch it to run autonomously.
 * All copy is bilingual EN/KO (falls back to EN for other UI languages).
 */
export default function AutopilotView() {
  const settings = useApp((s) => s.settings) as AppSettings
  const status = useApp((s) => s.autopilot)
  const saveSettings = useApp((s) => s.saveSettings)
  const setRunning = useApp((s) => s.setAutopilotRunning)
  const runNow = useApp((s) => s.runAutopilotNow)
  const setView = useApp((s) => s.setView)
  const toast = useApp((s) => s.toast)

  const ko = settings.language === 'ko'
  const t = (en: string, kr: string) => (ko ? kr : en)

  const [form, setForm] = useState<AutopilotSettings>(settings.autopilot)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [customCat, setCustomCat] = useState('')
  const [now, setNow] = useState(Date.now())

  // Follow external config changes only while the form has no local edits.
  useEffect(() => {
    if (!dirty) setForm(settings.autopilot)
  }, [settings.autopilot, dirty])

  // Live clock for the "next run" countdown.
  const timerRef = useRef<number | null>(null)
  useEffect(() => {
    timerRef.current = window.setInterval(() => setNow(Date.now()), 1000)
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [])

  const running = status?.running ?? false
  const busy = status?.busy ?? false

  const edit = (patch: Partial<AutopilotSettings>) => {
    setForm((f) => ({ ...f, ...patch }))
    setDirty(true)
  }

  const num = (v: number, min: number, max: number, fallback: number) => {
    if (!Number.isFinite(v)) return fallback
    return Math.min(max, Math.max(min, Math.round(v)))
  }

  // Persist config, keeping the run-state under the exclusive control of the
  // Launch/Stop button (never toggled by a config save).
  const persist = async (): Promise<boolean> => {
    setSaving(true)
    const enabled = status?.running ?? form.enabled
    const ok = await saveSettings({ ...settings, autopilot: { ...form, enabled } })
    setSaving(false)
    if (ok) setDirty(false)
    return ok
  }

  const save = async () => {
    if (await persist()) toast('ok', t('Autopilot settings saved', '자동 설정을 저장했습니다'))
  }

  const launch = async () => {
    setLaunching(true)
    try {
      if (dirty && !(await persist())) return
      await setRunning(true)
      toast('ok', t('Full-Auto launched', '완전 자동을 시작했습니다'))
    } finally {
      setLaunching(false)
    }
  }

  const stop = async () => {
    setLaunching(true)
    try {
      await setRunning(false)
      toast('ok', t('Full-Auto stopped', '완전 자동을 중지했습니다'))
    } finally {
      setLaunching(false)
    }
  }

  const runOnce = async () => {
    if (dirty && !(await persist())) return
    toast('ok', t('Running one pass now…', '지금 한 번 실행합니다…'))
    await runNow()
  }

  const toggleCategory = (id: string) =>
    edit({
      categories: form.categories.includes(id)
        ? form.categories.filter((c) => c !== id)
        : [...form.categories, id],
    })

  const selectPopular = () => edit({ categories: [...AUTOPILOT_DEFAULT_CATEGORIES] })
  const selectAllPopular = () => edit({ categories: [...AUTOPILOT_POPULAR_CATEGORY_IDS] })

  const addCustomCat = () => {
    const c = customCat.trim().toLowerCase()
    if (!c) return
    if (!form.categories.includes(c)) edit({ categories: [...form.categories, c] })
    setCustomCat('')
  }

  const popularCats = AUTOPILOT_CATEGORIES.filter((c) => c.popular)
  const moreCats = AUTOPILOT_CATEGORIES.filter((c) => !c.popular)

  const nextRunLabel = (): string => {
    if (!running) return t('Paused', '일시정지')
    if (busy) return t('Thinking…', '생각하는 중…')
    if (!status?.nextRunAt) return '—'
    const ms = status.nextRunAt - now
    if (ms <= 0) return t('Any moment…', '곧 실행')
    const mins = Math.floor(ms / 60000)
    const secs = Math.floor((ms % 60000) / 1000)
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
  }

  const langOptions: { id: PostLanguageMode; label: string }[] = [
    { id: 'match', label: t('Match source', '원문 언어') },
    { id: 'ko', label: t('Korean', '한국어') },
    { id: 'en', label: t('English', '영어') },
    { id: 'ui', label: t('App language', '앱 언어') },
  ]

  const logKindLabel = (k: string): string =>
    k === 'post'
      ? t('POST', '게시')
      : k === 'reply'
        ? t('REPLY', '답글')
        : k === 'skip'
          ? t('SKIP', '건너뜀')
          : k === 'error'
            ? t('ERROR', '오류')
            : t('INFO', '정보')

  return (
    <div className="view">
      <div className="view-header">
        <span className="view-title">{t('Full-Auto', '완전 자동')}</span>
        <span className="view-sub">
          {t(
            'The agent decides and acts on its own — posting and replying without you.',
            '에이전트가 스스로 판단하고 게시·답글을 자동으로 수행합니다.',
          )}
        </span>
        <div className="view-actions">
          <button className="btn ghost" disabled={saving || launching} onClick={() => void save()}>
            {saving ? t('Saving…', '저장 중…') : t('Save', '저장')}
          </button>
          <button className="btn" disabled={launching || busy} onClick={() => void runOnce()}>
            {t('Run once now', '지금 한 번 실행')}
          </button>
          {running ? (
            <button className="btn danger" disabled={launching} onClick={() => void stop()}>
              {launching ? '…' : t('Stop', '중지')}
            </button>
          ) : (
            <button className="btn primary" disabled={launching} onClick={() => void launch()}>
              {launching ? t('Launching…', '시작 중…') : t('Launch Full-Auto', '완전 자동 시작')}
            </button>
          )}
        </div>
      </div>

      <div className="view-body">
        <div className="settings-wrap">
          {/* live status */}
          <div className={`ap-status ${running ? 'live' : ''}`}>
            <div className="ap-stat">
              <span className="ap-stat-k">{t('Status', '상태')}</span>
              <span className="ap-stat-v">
                {running ? (
                  <>
                    <span className="side-live inline" /> {busy ? t('Working', '작동 중') : t('Running', '실행 중')}
                  </>
                ) : (
                  t('Paused', '일시정지')
                )}
              </span>
            </div>
            <div className="ap-stat">
              <span className="ap-stat-k">{t('Posts today', '오늘 게시')}</span>
              <span className="ap-stat-v">
                {status?.postsToday ?? 0} / {status?.maxPostsPerDay ?? form.maxPostsPerDay}
              </span>
            </div>
            <div className="ap-stat">
              <span className="ap-stat-k">{t('Replies today', '오늘 답글')}</span>
              <span className="ap-stat-v">
                {status?.repliesToday ?? 0} / {status?.maxRepliesPerDay ?? form.maxRepliesPerDay}
              </span>
            </div>
            <div className="ap-stat">
              <span className="ap-stat-k">{t('Next run', '다음 실행')}</span>
              <span className="ap-stat-v">{nextRunLabel()}</span>
            </div>
            <div className="ap-stat">
              <span className="ap-stat-k">{t('Mode', '모드')}</span>
              <span className="ap-stat-v">
                {form.goLive ? t('Live', '실시간 게시') : t('Draft only', '초안만')}
              </span>
            </div>
          </div>

          {(status && (!status.llmReady || !status.threadsReady)) && (
            <div className="ap-warn">
              {!status.llmReady && <div>{t('AI provider is not configured.', 'AI 제공자가 설정되지 않았습니다.')}</div>}
              {!status.threadsReady && <div>{t('Threads access token is missing.', 'Threads 액세스 토큰이 없습니다.')}</div>}
              <button className="btn small" onClick={() => setView('settings')}>
                {t('Open Settings', '설정 열기')}
              </button>
            </div>
          )}

          {/* goal */}
          <div className="section">
            <div className="section-title">{t('Goal', '목표')}</div>
            <div className="section-desc">
              {t('What is the agent trying to achieve? Drives every decision.', '에이전트가 달성하려는 목표입니다. 모든 판단의 기준이 됩니다.')}
            </div>
            <textarea
              className="textarea"
              value={form.goal}
              onChange={(e) => edit({ goal: e.target.value })}
              placeholder={t('e.g. Grow an engaged following with relatable, funny takes.', '예: 공감되고 재미있는 글로 팔로워와 참여를 늘리기')}
            />
          </div>

          {/* categories */}
          <div className="section">
            <div className="section-title">{t('Topics / niches', '주제 / 분야')}</div>
            <div className="section-desc">
              {t(
                'What the agent posts about. Popular Threads niches (AI, tech, builders…) are listed first — the agent writes in that niche’s native voice.',
                '에이전트가 다룰 주제입니다. Threads에서 잘 되는 인기 분야(AI, 기술, 빌더 등)를 먼저 보여 주며, 해당 분야 톤으로 글을 씁니다.'
              )}
            </div>
            <div className="row" style={{ marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
              <button className="btn" onClick={selectPopular} type="button">
                {t('Use popular defaults (AI-first)', '인기 기본값 (AI 우선)')}
              </button>
              <button className="btn" onClick={selectAllPopular} type="button">
                {t('Select all popular', '인기 분야 전체 선택')}
              </button>
            </div>
            <div className="ap-cat-group-label">{t('Popular on Threads', 'Threads 인기 분야')}</div>
            <div className="row ap-chips">
              {popularCats.map((c) => (
                <button
                  key={c.id}
                  className={`chip selectable popular${form.categories.includes(c.id) ? ' on' : ''}`}
                  onClick={() => toggleCategory(c.id)}
                >
                  {ko ? c.ko : c.en}
                </button>
              ))}
            </div>
            <div className="ap-cat-group-label" style={{ marginTop: 12 }}>
              {t('More niches', '기타 분야')}
            </div>
            <div className="row ap-chips">
              {moreCats.map((c) => (
                <button
                  key={c.id}
                  className={`chip selectable${form.categories.includes(c.id) ? ' on' : ''}`}
                  onClick={() => toggleCategory(c.id)}
                >
                  {ko ? c.ko : c.en}
                </button>
              ))}
              {form.categories
                .filter((c) => !AUTOPILOT_CATEGORIES.some((p) => p.id === c))
                .map((c) => (
                  <span key={c} className="chip on">
                    {c}
                    <button className="chip-x" onClick={() => toggleCategory(c)} aria-label={`Remove ${c}`}>
                      ×
                    </button>
                  </span>
                ))}
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <input
                className="input grow"
                placeholder={t('Add a custom topic', '직접 주제 추가')}
                value={customCat}
                onChange={(e) => setCustomCat(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addCustomCat()
                  }
                }}
              />
              <button className="btn" onClick={addCustomCat}>
                {t('Add', '추가')}
              </button>
            </div>
          </div>

          {/* language */}
          <div className="section">
            <div className="section-title">{t('Post language', '게시 언어')}</div>
            <div className="section-desc">
              {t('What language the agent writes posts and replies in.', '게시물과 답글을 작성할 언어입니다.')}
            </div>
            <div className="seg">
              {langOptions.map((o) => (
                <button
                  key={o.id}
                  className={form.postLanguage === o.id ? 'on' : ''}
                  onClick={() => edit({ postLanguage: o.id })}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* persona */}
          <div className="section">
            <div className="section-title">{t('Personality', '페르소나')}</div>
            <div className="section-desc">
              {t('Who the agent is, who made it, and how it treats its creator.', '에이전트의 정체성, 제작자, 제작자를 대하는 방식입니다.')}
            </div>
            <div className="row">
              <div className="field grow">
                <span className="field-label">{t('Agent name', '에이전트 이름')}</span>
                <input
                  className="input"
                  value={form.agentName}
                  onChange={(e) => edit({ agentName: e.target.value })}
                  placeholder={t('optional persona name', '선택: 페르소나 이름')}
                />
              </div>
              <div className="field grow">
                <span className="field-label">{t('Created by', '제작자')}</span>
                <input
                  className="input"
                  value={form.creatorName}
                  onChange={(e) => edit({ creatorName: e.target.value })}
                  placeholder={t('your name / brand', '이름 / 브랜드')}
                />
              </div>
            </div>
            <div className="row">
              <div className="field grow">
                <span className="field-label">{t('Creator @handle', '제작자 @핸들')}</span>
                <input
                  className="input mono"
                  value={form.creatorHandle}
                  onChange={(e) => edit({ creatorHandle: e.target.value })}
                  placeholder="masteruser"
                />
                <span className="hint">
                  {t('Replies from this handle get special treatment.', '이 핸들의 답글은 특별하게 응대합니다.')}
                </span>
              </div>
              <div className="field grow">
                <span className="field-label">{t('Address creator as', '제작자 호칭')}</span>
                <input
                  className="input"
                  value={form.creatorAddress}
                  onChange={(e) => edit({ creatorAddress: e.target.value })}
                  placeholder="Master"
                />
              </div>
            </div>
            <div className="field">
              <span className="field-label">{t('Tone notes', '톤 메모')}</span>
              <textarea
                className="textarea"
                value={form.toneNotes}
                onChange={(e) => edit({ toneNotes: e.target.value })}
                placeholder={t('extra personality guidance (optional)', '추가 성격 가이드 (선택)')}
              />
            </div>
          </div>

          {/* cadence & caps */}
          <div className="section">
            <div className="section-title">{t('Cadence & limits', '주기 & 한도')}</div>
            <div className="section-desc">
              {t('How often it thinks and how much it may post. Keeps it from spamming.', '얼마나 자주 판단하고 얼마나 게시할지 정합니다. 도배를 방지합니다.')}
            </div>
            <div className="row">
              <div className="field grow">
                <span className="field-label">{t('Think every (min)', '실행 주기(분)')}</span>
                <input
                  className="input"
                  type="number"
                  min={5}
                  value={form.intervalMinutes}
                  onChange={(e) => edit({ intervalMinutes: e.target.valueAsNumber })}
                  onBlur={() => edit({ intervalMinutes: num(form.intervalMinutes, 5, 1440, 60) })}
                />
              </div>
              <div className="field grow">
                <span className="field-label">{t('Max posts / run', '실행당 최대 게시')}</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={10}
                  value={form.maxPostsPerRun}
                  onChange={(e) => edit({ maxPostsPerRun: e.target.valueAsNumber })}
                  onBlur={() => edit({ maxPostsPerRun: num(form.maxPostsPerRun, 1, 10, 1) })}
                />
              </div>
              <div className="field grow">
                <span className="field-label">{t('Max posts / day', '하루 최대 게시')}</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={96}
                  value={form.maxPostsPerDay}
                  onChange={(e) => edit({ maxPostsPerDay: e.target.valueAsNumber })}
                  onBlur={() => edit({ maxPostsPerDay: num(form.maxPostsPerDay, 1, 96, 6) })}
                />
              </div>
            </div>
            <div className="field">
              <span className="field-label">
                {t('Original vs news', '오리지널 vs 뉴스')}: {form.originalRatio}% {t('original', '오리지널')}
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={form.originalRatio}
                onChange={(e) => edit({ originalRatio: e.target.valueAsNumber })}
              />
              <span className="hint">
                {t(
                  'Higher = more funny/human original posts; lower = more news reactions.',
                  '높을수록 재미있는 오리지널 글, 낮을수록 뉴스 반응 위주.',
                )}
              </span>
            </div>
          </div>

          {/* replies */}
          <div className="section">
            <div className="section-title">{t('Replies', '답글')}</div>
            <div className="section-desc">
              {t('Scan your posts and answer every unanswered reply, in context.', '내 게시물의 미답변 답글을 문맥에 맞게 모두 응대합니다.')}
            </div>
            <div className="field">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={form.replyToAll}
                  onChange={(e) => edit({ replyToAll: e.target.checked })}
                />
                <span>{t('Reply to all incoming replies', '들어오는 모든 답글에 응대')}</span>
              </label>
            </div>
            {form.replyToAll && (
              <>
                <div className="field">
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={form.autoReply}
                      onChange={(e) => edit({ autoReply: e.target.checked })}
                    />
                    <span>{t('Publish replies automatically (off = draft them)', '답글 자동 게시 (끄면 초안으로)')}</span>
                  </label>
                </div>
                <div className="row">
                  <div className="field grow">
                    <span className="field-label">{t('Max replies / run', '실행당 최대 답글')}</span>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      max={25}
                      value={form.maxRepliesPerRun}
                      onChange={(e) => edit({ maxRepliesPerRun: e.target.valueAsNumber })}
                      onBlur={() => edit({ maxRepliesPerRun: num(form.maxRepliesPerRun, 1, 25, 5) })}
                    />
                  </div>
                  <div className="field grow">
                    <span className="field-label">{t('Max replies / day', '하루 최대 답글')}</span>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      max={300}
                      value={form.maxRepliesPerDay}
                      onChange={(e) => edit({ maxRepliesPerDay: e.target.valueAsNumber })}
                      onBlur={() => edit({ maxRepliesPerDay: num(form.maxRepliesPerDay, 1, 300, 40) })}
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          {/* publishing safety */}
          <div className="section">
            <div className="section-title">{t('Publishing', '게시 방식')}</div>
            <div className="section-desc">
              {t('Live posts go straight to your Threads account. Draft-only is a safety valve.', '실시간 게시는 Threads 계정에 바로 올라갑니다. 초안 모드는 안전장치입니다.')}
            </div>
            <div className="field">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={form.goLive}
                  onChange={(e) => edit({ goLive: e.target.checked })}
                />
                <span>{t('Publish live to Threads', 'Threads에 실시간 게시')}</span>
              </label>
              {!form.goLive && (
                <span className="hint">
                  {t('Off: the agent decides everything but only writes drafts for your review.', '끔: 에이전트가 모두 판단하되 검토용 초안만 작성합니다.')}
                </span>
              )}
            </div>
          </div>

          {/* activity log */}
          <div className="section">
            <div className="section-title">{t('Activity', '활동 로그')}</div>
            <div className="ap-log">
              {!status || status.log.length === 0 ? (
                <div className="hint">{t('No activity yet. Launch to begin.', '아직 활동이 없습니다. 시작해 보세요.')}</div>
              ) : (
                status.log.map((e) => (
                  <div key={e.id} className={`ap-log-row ${e.kind}`}>
                    <span className={`ap-log-kind ${e.kind}`}>{logKindLabel(e.kind)}</span>
                    <span className="ap-log-msg">{e.message}</span>
                    {e.permalink && (
                      <button className="link" onClick={() => void window.api.openExternal(e.permalink!)}>
                        {t('open', '열기')}
                      </button>
                    )}
                    <span className="ap-log-time">{timeAgo(e.at)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
