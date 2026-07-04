import { useApp } from '../store/appStore'
import type { ViewId } from '../types'

const NAV: { id: ViewId; label: string }[] = [
  { id: 'drafts', label: 'Drafts' },
  { id: 'news', label: 'News' },
  { id: 'replies', label: 'Replies' },
  { id: 'queue', label: 'Queue' },
]

export default function Sidebar() {
  const view = useApp((s) => s.view)
  const setView = useApp((s) => s.setView)
  const drafts = useApp((s) => s.drafts)
  const settings = useApp((s) => s.settings)
  const saveSettings = useApp((s) => s.saveSettings)

  const draftCount = drafts.filter((d) => d.status === 'draft').length
  const queueCount = drafts.filter((d) => d.status === 'scheduled' || d.status === 'posting').length

  const toggleTheme = () => {
    if (!settings) return
    void saveSettings({ ...settings, theme: settings.theme === 'dark' ? 'light' : 'dark' })
  }

  const countFor = (id: ViewId) =>
    id === 'drafts' ? draftCount : id === 'queue' ? queueCount : 0

  return (
    <aside className="sidebar">
      <div className="side-brand">AutoThreads</div>
      <nav className="side-nav">
        {NAV.map((item) => (
          <button
            key={item.id}
            className={`side-item${view === item.id ? ' active' : ''}`}
            onClick={() => setView(item.id)}
          >
            <span>{item.label}</span>
            {countFor(item.id) > 0 && <span className="side-count">{countFor(item.id)}</span>}
          </button>
        ))}
      </nav>
      <div className="side-footer">
        <button
          className={`side-item${view === 'settings' ? ' active' : ''}`}
          onClick={() => setView('settings')}
        >
          <span>Settings</span>
        </button>
        <button className="side-item" onClick={toggleTheme}>
          <span>{settings?.theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
        </button>
      </div>
    </aside>
  )
}
