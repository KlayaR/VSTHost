import React, { useEffect } from 'react'
import { useStore } from './store/useStore'
import { initEngineBridge, destroyEngineBridge } from './engine/engineBridge'
import { loadPersisted } from './engine/persistence'
import Sidebar from './components/Sidebar'
import TitleBar from './components/TitleBar'
import StudioView from './components/views/StudioView'
import SettingsView from './components/views/SettingsView'
import SavePresetModal from './components/modals/SavePresetModal'
import ShortcutsModal from './components/modals/ShortcutsModal'
import StatusBar from './components/StatusBar'
import TooltipLayer from './components/TooltipLayer'

export default function App() {
  // Granular selectors — never subscribe to the whole store, or the entire
  // tree re-renders on every 30fps level update.
  const activeSection   = useStore(s => s.activeSection)
  const theme           = useStore(s => s.theme)
  const toggleBypassAll = useStore(s => s.toggleBypassAll)
  const setShowSavePreset = useStore(s => s.setShowSavePreset)
  const showSavePreset  = useStore(s => s.showSavePreset)
  const showShortcuts   = useStore(s => s.showShortcuts)
  const setShowShortcuts = useStore(s => s.setShowShortcuts)

  // Restore persisted state, then connect to the engine. Levels, devices,
  // plugins, presets and the chain are all driven by real engine events.
  useEffect(() => {
    let cleanup = () => {}
    ;(async () => {
      await loadPersisted()
      await initEngineBridge()
      cleanup = destroyEngineBridge
    })()
    return () => cleanup()
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        setShowSavePreset(true)
      }
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault()
        toggleBypassAll()
      }
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        setShowShortcuts(true)
      }
      if (e.key === 'Escape') {
        setShowShortcuts(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleBypassAll, setShowSavePreset, setShowShortcuts])

  return (
    <div className={theme === 'light' ? 'theme-light' : ''} style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-base)' }}>
      <TitleBar />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar />
        <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {activeSection === 'studio' && <StudioView />}
          {activeSection === 'settings' && <SettingsView />}
        </main>
      </div>
      <StatusBar />
      {showSavePreset && <SavePresetModal />}
      {showShortcuts && <ShortcutsModal />}
      <ErrorToast />
      <TooltipLayer />
    </div>
  )
}

function ErrorToast() {
  const engineError = useStore(s => s.engineError)
  const setEngineError = useStore(s => s.setEngineError)
  React.useEffect(() => {
    if (engineError) {
      const t = setTimeout(() => setEngineError(null), 6000)
      return () => clearTimeout(t)
    }
  }, [engineError, setEngineError])
  if (!engineError) return null
  return (
    <div style={{
      position: 'fixed', bottom: 36, left: '50%', transform: 'translateX(-50%)',
      background: 'var(--bg-elevated)', border: '1px solid var(--red)',
      borderRadius: 8, padding: '10px 14px', maxWidth: 480, zIndex: 200,
      display: 'flex', alignItems: 'center', gap: 10,
      boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
    }}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
        <circle cx="8" cy="8" r="6.5" stroke="var(--red)" strokeWidth="1.4" />
        <path d="M8 4.5v4M8 11v.1" stroke="var(--red)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <span style={{ fontSize: 11.5, color: 'var(--text-primary)', lineHeight: 1.4 }}>{engineError}</span>
      <button className="btn-icon" onClick={() => setEngineError(null)} style={{ flexShrink: 0, color: 'var(--text-muted)' }}>
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M1 1l9 9M10 1L1 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
      </button>
    </div>
  )
}
