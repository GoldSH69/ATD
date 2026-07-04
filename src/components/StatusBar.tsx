import { useApp } from '../store/appStore'

export default function StatusBar() {
  const settings = useApp((s) => s.settings)
  const drafts = useApp((s) => s.drafts)
  if (!settings) return null

  const llm = settings.llm
  const model =
    llm.provider === 'claude'
      ? llm.claude.model
      : llm.provider === 'openai'
        ? llm.openai.model
        : llm.local.model
  const llmReady =
    llm.provider === 'local' ? Boolean(llm.local.baseUrl) : Boolean(llm[llm.provider].apiKey)
  const threadsReady = Boolean(settings.threads.accessToken)
  const scheduled = drafts.filter((d) => d.status === 'scheduled').length
  const failed = drafts.filter((d) => d.status === 'failed').length

  return (
    <footer className="statusbar">
      <span className="status-item">
        LLM: {llm.provider} · {model}
        {!llmReady && ' (not configured)'}
      </span>
      <span className="status-sep">|</span>
      <span className="status-item">
        Threads: {threadsReady ? settings.threads.username ? `@${settings.threads.username}` : 'configured' : 'not configured'}
      </span>
      <span className="grow" />
      {failed > 0 && <span className="status-item">{failed} failed</span>}
      <span className="status-item">{scheduled} scheduled</span>
      <span className="status-item">{drafts.length} total</span>
    </footer>
  )
}
