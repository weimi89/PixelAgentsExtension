import { useState, useRef, useEffect } from 'react'
import { vscode, onServerMessage } from '../socketApi.js'
import { isSoundEnabled, setSoundEnabled } from '../notificationSound.js'
import { t } from '../i18n.js'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  isDebugMode: boolean
  onToggleDebugMode: () => void
  dayNightEnabled: boolean
  onToggleDayNight: () => void
  dayNightTimeOverride: number | null
  onDayNightTimeOverrideChange: (hour: number | null) => void
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

export function SettingsModal({ isOpen, onClose, isDebugMode, onToggleDebugMode, dayNightEnabled, onToggleDayNight, dayNightTimeOverride, onDayNightTimeOverrideChange }: SettingsModalProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const [soundLocal, setSoundLocal] = useState(isSoundEnabled)
  const importInputRef = useRef<HTMLInputElement>(null)

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

  // 監聽伺服器回傳的佈局資料，觸發瀏覽器下載
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
            vscode.postMessage({ type: 'setSoundEnabled', enabled: newVal })
          }}
          onMouseEnter={() => setHovered('sound')}
          onMouseLeave={() => setHovered(null)}
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
        <button
          onClick={onToggleDayNight}
          onMouseEnter={() => setHovered('daynight')}
          onMouseLeave={() => setHovered(null)}
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
