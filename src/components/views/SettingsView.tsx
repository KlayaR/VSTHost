import React from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { useStore } from '../../store/useStore'
import { sendEngineCommand } from '../../engine/engineBridge'

function setAutostart(enabled: boolean, minimized: boolean) {
  invoke('set_autostart', { enabled, minimized }).catch(e => console.error('[autostart]', e))
}

export default function SettingsView() {
  const {
    theme, toggleTheme, engineConnected, engineScanProgress,
    startWithWindows, startMinimized, closeToTray, autoBypass, setSetting,
    scanPaths, setScanPaths,
  } = useStore()

  // Scanning is driven by the engine; progress arrives via engineScanProgress
  const scanning = engineScanProgress !== null

  const triggerScan = () => sendEngineCommand({ cmd: 'scan_plugins', paths: scanPaths })

  const pickFolder = async () => {
    try {
      const dir = await open({ directory: true, multiple: false, title: 'Add a plugin scan folder' })
      if (typeof dir === 'string' && !scanPaths.includes(dir)) {
        setScanPaths([...scanPaths, dir])
      }
    } catch { /* dialog cancelled / unavailable */ }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{
        padding: '10px 16px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-surface)',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Settings</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
        <div style={{ maxWidth: 540, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>

          {/* Appearance */}
          <SettingsGroup title="Appearance">
            <ToggleRow
              label="Dark Mode"
              description="Switch between dark and light themes"
              value={theme === 'dark'}
              onChange={toggleTheme}
            />
          </SettingsGroup>

          {/* Behavior */}
          <SettingsGroup title="Behavior">
            <ToggleRow
              label="Start with Windows"
              description="Launch automatically when you log in"
              value={startWithWindows}
              onChange={() => { const v = !startWithWindows; setSetting('startWithWindows', v); setAutostart(v, startMinimized) }}
            />
            <ToggleRow
              label="Start minimized to tray"
              description="Launch VSTHost in background on startup"
              value={startMinimized}
              onChange={() => { const v = !startMinimized; setSetting('startMinimized', v); if (startWithWindows) setAutostart(true, v) }}
            />
            <ToggleRow
              label="Close to tray"
              description="Minimize to system tray instead of quitting"
              value={closeToTray}
              onChange={() => setSetting('closeToTray', !closeToTray)}
            />
            <ToggleRow
              label="Auto-bypass on mute"
              description="Bypass chain when microphone is muted"
              value={autoBypass}
              onChange={() => setSetting('autoBypass', !autoBypass)}
            />
          </SettingsGroup>

          {/* Plugin Scan Paths */}
          <SettingsGroup title="Plugin Scan Paths">
            <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {scanPaths.map((path, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    flex: 1,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 5,
                    padding: '5px 10px',
                    fontSize: 11,
                    color: 'var(--text-secondary)',
                    fontFamily: 'var(--mono)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {path}
                  </div>
                  <button
                    className="btn-icon"
                    onClick={() => setScanPaths(scanPaths.filter((_, j) => j !== i))}
                    style={{ color: 'var(--text-muted)', flexShrink: 0 }}
                  >
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                      <path d="M1 1l9 9M10 1L1 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              ))}
              <button
                className="btn btn-ghost"
                style={{ fontSize: 11, marginTop: 4, justifyContent: 'center' }}
                onClick={pickFolder}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M1 3a1 1 0 011-1h2.5l1 1.5H10a1 1 0 011 1V9a1 1 0 01-1 1H2a1 1 0 01-1-1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                </svg>
                Add Folder…
              </button>
              <button
                className={`btn btn-primary`}
                style={{ fontSize: 11, marginTop: 6, justifyContent: 'center', opacity: (scanning || !engineConnected) ? 0.6 : 1 }}
                onClick={triggerScan}
                disabled={scanning || !engineConnected}
              >
                {scanning ? (
                  <>
                    <span style={{ display: 'inline-block', width: 10, height: 10, border: '2px solid white', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
                    Scanning…
                  </>
                ) : engineConnected ? 'Scan for Plugins' : 'Engine offline'}
              </button>
              {scanning && engineScanProgress && (
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--mono)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {Math.round(engineScanProgress.progress * 100)}% · {engineScanProgress.plugin}
                </div>
              )}
            </div>
          </SettingsGroup>

          {/* About */}
          <SettingsGroup title="About">
            <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <InfoRow label="Version" value="1.0.0" />
              <InfoRow label="Engine" value="JUCE 8.0.4" />
              <InfoRow label="Format" value="VST3" />
              <InfoRow label="Platform" value="Windows" />
            </div>
          </SettingsGroup>

        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="section-header" style={{ marginBottom: 8 }}>{title}</div>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  )
}

function ToggleRow({ label, description, value, onChange }: { label: string; description: string; value: boolean; onChange: () => void }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '10px 14px',
      borderBottom: '1px solid var(--border)',
      cursor: 'pointer',
    }} onClick={onChange}>
      <div>
        <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{description}</div>
      </div>
      <Toggle value={value} />
    </div>
  )
}

function Toggle({ value }: { value: boolean }) {
  return (
    <div style={{
      width: 36, height: 20,
      borderRadius: 10,
      background: value ? 'var(--accent)' : 'var(--bg-elevated)',
      border: `1px solid ${value ? 'var(--accent)' : 'var(--border-light)'}`,
      position: 'relative',
      transition: 'background 0.2s, border-color 0.2s',
      flexShrink: 0,
    }}>
      <div style={{
        position: 'absolute',
        top: 2,
        left: value ? 16 : 2,
        width: 14, height: 14,
        borderRadius: '50%',
        background: 'white',
        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        transition: 'left 0.2s',
      }} />
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--mono)' }}>{value}</span>
    </div>
  )
}
