import { useEffect } from 'react'
import { useApp } from './store/appStore'
import Sidebar from './components/Sidebar'
import StatusBar from './components/StatusBar'
import Toasts from './components/Toasts'
import DraftsView from './components/DraftsView'
import NewsView from './components/NewsView'
import RepliesView from './components/RepliesView'
import QueueView from './components/QueueView'
import SettingsView from './components/SettingsView'
import Onboarding from './components/Onboarding'

export default function App() {
  const view = useApp((s) => s.view)
  const settings = useApp((s) => s.settings)
  const showOnboarding = useApp((s) => s.showOnboarding)
  const loadInitial = useApp((s) => s.loadInitial)

  useEffect(() => {
    void loadInitial()
  }, [loadInitial])

  if (!settings) {
    return <div className="app-loading">AutoThreads</div>
  }

  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        {view === 'drafts' && <DraftsView />}
        {view === 'news' && <NewsView />}
        {view === 'replies' && <RepliesView />}
        {view === 'queue' && <QueueView />}
        {view === 'settings' && <SettingsView />}
      </main>
      <StatusBar />
      {showOnboarding && <Onboarding />}
      <Toasts />
    </div>
  )
}
