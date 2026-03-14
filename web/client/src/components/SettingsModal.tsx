import { useState, useRef, useEffect } from 'react'
import { vscode, onServerMessage } from '../socketApi.js'
import { isSoundEnabled, setSoundEnabled, getSoundConfig, setSoundConfig } from '../notificationSound.js'
import type { SoundConfig } from '../notificationSound.js'
import { t } from '../i18n.js'

interface LanPeerInfo {
  name: string
  host: string
  port: number
  agentCount: number
}

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  isDebugMode: boolean
  onToggleDebugMode: () => void
  dayNightEnabled: boolean
  onToggleDayNight: () => void
  dayNightTimeOverride: number | null
  onDayNightTimeOverrideChange: (hour: number | null) => void
  uiScale: number
  onUiScaleChange: (scale: number) => void
  lanPeers: LanPeerInfo[]
}

const menuItemBase: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  padding: '6px 10px',
  fontSize: '24px',
  color: 'rgba(255, 255, 255, 0.8)',
  background: 'transparent',
  border: 'none',
  borderRadius: 0,
  cursor: 'pointer',
  textAlign: 'left',
}

export function SettingsModal({ isOpen, onClose, isDebugMode, onToggleDebugMode, dayNightEnabled, onToggleDayNight, dayNightTimeOverride, onDayNightTimeOverrideChange, uiScale, onUiScaleChange, lanPeers }: SettingsModalProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const [soundLocal, setSoundLocal] = useState(isSoundEnabled)
  const [soundCfg, setSoundCfg] = useState<SoundConfig>(getSoundConfig)
  const importInputRef = useRef<HTMLInputElement>(null)
  const [lanEnabled, setLanEnabled] = useState(false)
  const [lanName, setLanName] = useState('')
  const lanNameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Escape 鍵關閉
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // 監聽伺服器回傳的佈局資料，觸發瀏覽器下載；同時接收 settings 中的 LAN 設定
  useEffect(() => {
    const unsub = onServerMessage((data) => {
      const msg = data as Record<string, unknown>
      if (msg.type === 'exportLayoutData' && msg.layout) {
        const json = JSON.stringify(msg.layout, null, 2)
        const blob = new Blob([json], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'pixel-agents-layout.json'
        a.click()
        URL.revokeObjectURL(url)
      }
      if (msg.type === 'settingsLoaded') {
        if (typeof msg.lanDiscoveryEnabled === 'boolean') {
          setLanEnabled(msg.lanDiscoveryEnabled)
        }
        if (typeof msg.lanPeerName === 'string') {
          setLanName(msg.lanPeerName)
        }
      }
    })
    return unsub
  }, [])

  if (!isOpen) return null

  const handleExport = () => {
    vscode.postMessage({ type: 'requestExportLayout' })
  }

  const handleImport = () => {
    importInputRef.current?.click()
  }

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result as string) as Record<string, unknown>
        if (imported.version !== 1 || !Array.isArray(imported.tiles)) {
          console.error(t.invalidLayoutFile)
          return
        }
        vscode.postMessage({ type: 'saveLayout', layout: imported })
      } catch {
        console.error(t.parseLayoutFailed)
      }
    }
    reader.readAsText(file)
    // 重設輸入框以便重新匯入同一檔案
    e.target.value = ''
    onClose()
  }

  return (
    <>
      {/* 隱藏的檔案輸入，用於匯入 */}
      <input
        ref={importInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleFileSelected}
      />
      {/* 深色背景遮罩 — 點擊關閉 */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(0, 0, 0, 0.5)',
          zIndex: 49,
        }}
      />
      {/* 置中彈出視窗 */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.settings}
        className="pixel-modal-dialog"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 50,
          background: 'var(--pixel-bg)',
          border: '2px solid var(--pixel-border)',
          borderRadius: 0,
          padding: '4px',
          boxShadow: 'var(--pixel-shadow)',
          minWidth: 200,
        }}
      >
        {/* 標題列與關閉按鈕 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '4px 10px',
            borderBottom: '1px solid var(--pixel-border)',
            marginBottom: '4px',
          }}
        >
          <span style={{ fontSize: '24px', color: 'rgba(255, 255, 255, 0.9)' }}>{t.settings}</span>
          <button
            onClick={onClose}
            onMouseEnter={() => setHovered('close')}
            onMouseLeave={() => setHovered(null)}
            aria-label={t.closeAgent}
            style={{
              background: hovered === 'close' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
              border: 'none',
              borderRadius: 0,
              color: 'rgba(255, 255, 255, 0.6)',
              fontSize: '24px',
              cursor: 'pointer',
              padding: '0 4px',
              lineHeight: 1,
            }}
          >
            X
          </button>
        </div>
        {/* 選單項目 */}
        <button
          onClick={handleExport}
          onMouseEnter={() => setHovered('export')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'export' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          {t.exportLayout}
        </button>
        <button
          onClick={handleImport}
          onMouseEnter={() => setHovered('import')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'import' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          {t.importLayout}
        </button>
        <button
          onClick={() => {
            const newVal = !isSoundEnabled()
            setSoundEnabled(newVal)
            setSoundLocal(newVal)
            const updated = { ...getSoundConfig(), master: newVal }
            setSoundConfig(updated)
            setSoundCfg(updated)
            vscode.postMessage({ type: 'setSoundConfig', config: updated })
          }}
          onMouseEnter={() => setHovered('sound')}
          onMouseLeave={() => setHovered(null)}
          role="switch"
          aria-checked={soundLocal}
          style={{
            ...menuItemBase,
            background: hovered === 'sound' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          <span>{t.soundNotifications}</span>
          <span
            style={{
              width: 18,
              height: 18,
              border: '2px solid rgba(255, 255, 255, 0.5)',
              borderRadius: 0,
              background: soundLocal ? 'rgba(90, 140, 255, 0.8)' : 'transparent',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
              lineHeight: 1,
              color: '#fff',
            }}
          >
            {soundLocal ? 'X' : ''}
          </span>
        </button>
        {soundLocal && ([
          { key: 'waiting' as const, label: t.soundWaiting },
          { key: 'permission' as const, label: t.soundPermission },
          { key: 'turnComplete' as const, label: t.soundTurnComplete },
        ]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => {
              const updated = { ...getSoundConfig(), [key]: !soundCfg[key] }
              setSoundConfig(updated)
              setSoundCfg(updated)
              vscode.postMessage({ type: 'setSoundConfig', config: updated })
            }}
            onMouseEnter={() => setHovered(`sound-${key}`)}
            onMouseLeave={() => setHovered(null)}
            role="switch"
            aria-checked={soundCfg[key]}
            style={{
              ...menuItemBase,
              paddingLeft: 24,
              fontSize: '20px',
              background: hovered === `sound-${key}` ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
            }}
          >
            <span>{label}</span>
            <span
              style={{
                width: 18,
                height: 18,
                border: '2px solid rgba(255, 255, 255, 0.4)',
                borderRadius: 0,
                background: soundCfg[key] ? 'rgba(90, 140, 255, 0.8)' : 'transparent',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
                lineHeight: 1,
                color: '#fff',
              }}
            >
              {soundCfg[key] ? 'X' : ''}
            </span>
          </button>
        ))}
        <button
          onClick={onToggleDayNight}
          onMouseEnter={() => setHovered('daynight')}
          onMouseLeave={() => setHovered(null)}
          role="switch"
          aria-checked={dayNightEnabled}
          style={{
            ...menuItemBase,
            background: hovered === 'daynight' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          <span>{t.dayNightCycle}</span>
          <span
            style={{
              width: 18,
              height: 18,
              border: '2px solid rgba(255, 255, 255, 0.5)',
              borderRadius: 0,
              background: dayNightEnabled ? 'rgba(90, 140, 255, 0.8)' : 'transparent',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
              lineHeight: 1,
              color: '#fff',
            }}
          >
            {dayNightEnabled ? 'X' : ''}
          </span>
        </button>
        {dayNightEnabled && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 10px',
            }}
          >
            <span style={{ fontSize: '20px', color: 'rgba(255, 255, 255, 0.6)', whiteSpace: 'nowrap' }}>
              {t.timeOverride}
            </span>
            <input
              type="range"
              min={0}
              max={23}
              value={dayNightTimeOverride ?? new Date().getHours()}
              onChange={(e) => onDayNightTimeOverrideChange(Number(e.target.value))}
              style={{ flex: 1, accentColor: 'var(--pixel-accent)' }}
            />
            <span style={{ fontSize: '20px', color: 'rgba(255, 255, 255, 0.8)', minWidth: 30, textAlign: 'right' }}>
              {dayNightTimeOverride !== null ? `${dayNightTimeOverride}:00` : t.useRealTime}
            </span>
            {dayNightTimeOverride !== null && (
              <button
                onClick={() => onDayNightTimeOverrideChange(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'rgba(255, 255, 255, 0.6)',
                  cursor: 'pointer',
                  fontSize: '20px',
                  padding: '0 4px',
                }}
              >
                X
              </button>
            )}
          </div>
        )}
        {/* 區網發現 */}
        <div style={{ borderTop: '1px solid var(--pixel-border)', marginTop: '4px', paddingTop: '4px' }}>
          <button
            onClick={() => {
              const newVal = !lanEnabled
              setLanEnabled(newVal)
              vscode.postMessage({ type: 'setLanDiscoveryEnabled', enabled: newVal })
            }}
            onMouseEnter={() => setHovered('lan')}
            onMouseLeave={() => setHovered(null)}
            role="switch"
            aria-checked={lanEnabled}
            style={{
              ...menuItemBase,
              background: hovered === 'lan' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
            }}
          >
            <span>{t.lanDiscoveryEnabled}</span>
            <span
              style={{
                width: 18,
                height: 18,
                border: '2px solid rgba(255, 255, 255, 0.5)',
                borderRadius: 0,
                background: lanEnabled ? 'rgba(90, 140, 255, 0.8)' : 'transparent',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
                lineHeight: 1,
                color: '#fff',
              }}
            >
              {lanEnabled ? 'X' : ''}
            </span>
          </button>
          {lanEnabled && (
            <>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 10px',
                }}
              >
                <span style={{ fontSize: '20px', color: 'rgba(255, 255, 255, 0.6)', whiteSpace: 'nowrap' }}>
                  {t.lanPeerName}
                </span>
                <input
                  type="text"
                  value={lanName}
                  onChange={(e) => {
                    const val = e.target.value
                    setLanName(val)
                    // 防抖：500ms 後發送
                    if (lanNameTimerRef.current) clearTimeout(lanNameTimerRef.current)
                    lanNameTimerRef.current = setTimeout(() => {
                      if (val.trim()) {
                        vscode.postMessage({ type: 'setLanPeerName', name: val.trim() })
                      }
                    }, 500)
                  }}
                  style={{
                    flex: 1,
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '2px solid var(--pixel-border)',
                    borderRadius: 0,
                    color: 'rgba(255, 255, 255, 0.9)',
                    fontSize: '20px',
                    padding: '2px 6px',
                    outline: 'none',
                  }}
                />
              </div>
              <div style={{ padding: '4px 10px' }}>
                <span style={{ fontSize: '20px', color: 'rgba(255, 255, 255, 0.6)' }}>
                  {t.lanPeers}
                </span>
                {lanPeers.length === 0 ? (
                  <div style={{ fontSize: '18px', color: 'rgba(255, 255, 255, 0.4)', padding: '4px 0' }}>
                    {t.lanNoPeers}
                  </div>
                ) : (
                  <div style={{ marginTop: 4 }}>
                    {lanPeers.map((peer) => (
                      <div
                        key={`${peer.host}:${peer.port}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '3px 0',
                          fontSize: '18px',
                          color: 'rgba(255, 255, 255, 0.7)',
                        }}
                      >
                        <span>{peer.name}</span>
                        <span style={{ color: 'rgba(255, 255, 255, 0.4)', fontSize: '16px' }}>
                          {peer.host}:{peer.port} - {peer.agentCount} {t.lanAgentCount}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
          }}
        >
          <span style={{ fontSize: '24px', color: 'rgba(255, 255, 255, 0.8)', whiteSpace: 'nowrap' }}>
            {t.uiScale}
          </span>
          <input
            type="range"
            min={0.5}
            max={3}
            step={0.25}
            value={uiScale}
            onChange={(e) => onUiScaleChange(Number(e.target.value))}
            style={{ flex: 1, accentColor: 'var(--pixel-accent)' }}
          />
          <span style={{ fontSize: '20px', color: 'rgba(255, 255, 255, 0.8)', minWidth: 36, textAlign: 'right' }}>
            {uiScale}x
          </span>
        </div>
        <button
          onClick={() => {
            window.open(`${window.location.origin}${window.location.pathname}#/dashboard`, '_blank')
            onClose()
          }}
          onMouseEnter={() => setHovered('dashboard')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'dashboard' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          {t.openDashboard}
        </button>
        <button
          onClick={onToggleDebugMode}
          onMouseEnter={() => setHovered('debug')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...menuItemBase,
            background: hovered === 'debug' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
          }}
        >
          <span>{t.debugView}</span>
          {isDebugMode && (
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'rgba(90, 140, 255, 0.8)',
                flexShrink: 0,
              }}
            />
          )}
        </button>
      </div>
    </>
  )
}
