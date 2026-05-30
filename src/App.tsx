import React, { useEffect } from 'react'
import { useStore } from './store/useStore'
import { initEngineBridge, destroyEngineBridge } from './engine/engineBridge'
import { loadPersisted } from './engine/persistence'
import { invoke } from '@tauri-apps/api/core'
import Sidebar from './components/Sidebar'
import TitleBar from './components/TitleBar'
import StudioView from './components/views/StudioView'
import SettingsView from './components/views/SettingsView'
import SavePresetModal from './components/modals/SavePresetModal'
import ShortcutsModal from './components/modals/ShortcutsModal'
import StatusBar from './components/StatusBar'
import TooltipLayer from './components/TooltipLayer'
import LoadingScreen from './components/LoadingScreen'

export default function App() {
  // Granular selectors — never subscribe to the whole store, or the entire
  // tree re-renders on every 30fps level update.
  const activeSection   = useStore(s => s.activeSection)
  const theme           = useStore(s => s.theme)
  const toggleBypassAll    = useStore(s => s.toggleBypassAll)
  const setShowSavePreset  = useStore(s => s.setShowSavePreset)
  const undo               = useStore(s => s.undo)
  const setUpdateAvailable = useStore(s => s.setUpdateAvailable)
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
      // Check for updates in background — silently ignore any failures.
      invoke<string | null>('check_update')
        .then(v => { if (v) setUpdateAvailable(v) })
        .catch(() => {})
    })()
    return () => cleanup()
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        undo()
      }
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
      // Number keys 1-9 → quick-switch presets
      if (/^[1-9]$/.test(e.key) && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLSelectElement)) {
        const { presets, loadPreset } = useStore.getState()
        const p = presets[parseInt(e.key, 10) - 1]
        if (p) { e.preventDefault(); loadPreset(p.id) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleBypassAll, setShowSavePreset, setShowShortcuts, undo])

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
      <WarningToast />
      <TooltipLayer />
      <LoadingScreen />
    </div>
  )
}

function Toast({ msg, color, onClose, bottom }: { msg: string; color: string; onClose: () => void; bottom: number }) {
  return (
    <div style={{
      position: 'fixed', bottom, left: '50%', transform: 'translateX(-50%)',
      background: 'var(--bg-elevated)', border: `1px solid ${color}`,
      borderRadius: 8, padding: '10px 14px', maxWidth: 520, zIndex: 200,
      display: 'flex', alignItems: 'center', gap: 10,
      boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
    }}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
        <circle cx="8" cy="8" r="6.5" stroke={color} strokeWidth="1.4" />
        <path d="M8 4.5v4M8 11v.1" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <span style={{ fontSize: 11.5, color: 'var(--text-primary)', lineHeight: 1.4 }}>{msg}</span>
      <button className="btn-icon" onClick={onClose} style={{ flexShrink: 0, color: 'var(--text-muted)' }}>
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M1 1l9 9M10 1L1 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
      </button>
    </div>
  )
}

function ErrorToast() {
  const engineError    = useStore(s => s.engineError)
  const setEngineError = useStore(s => s.setEngineError)
  React.useEffect(() => {
    if (engineError) { const t = setTimeout(() => setEngineError(null), 8000); return () => clearTimeout(t) }
  }, [engineError, setEngineError])
  if (!engineError) return null
  return <Toast msg={engineError} color="var(--red)" onClose={() => setEngineError(null)} bottom={36} />
}

function WarningToast() {
  const engineWarning    = useStore(s => s.engineWarning)
  const setEngineWarning = useStore(s => s.setEngineWarning)
  React.useEffect(() => {
    if (engineWarning) { const t = setTimeout(() => setEngineWarning(null), 10000); return () => clearTimeout(t) }
  }, [engineWarning, setEngineWarning])
  if (!engineWarning) return null
  return <Toast msg={engineWarning} color="var(--yellow)" onClose={() => setEngineWarning(null)} bottom={90} />
}
