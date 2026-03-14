import { useState, memo } from 'react'
import { SettingsModal } from './SettingsModal.js'
import { FloorSelector } from './FloorSelector.js'
import { useDeviceType } from '../hooks/useDeviceType.js'
import { t } from '../i18n.js'
import type { FloorConfig } from '../types/messages.js'
import type { RecordingState } from '../office/engine/recorder.js'

// ── 像素風格 SVG 圖示（18x18）─────────────────────────────
const S = 18
const iconStyle: React.CSSProperties = { display: 'block' }

/** 大樓 — 建築物輪廓 */
function IconBuilding() {
  return (
    <svg width={S} height={S} viewBox="0 0 18 18" fill="none" style={iconStyle}>
      <rect x="3" y="4" width="12" height="12" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <rect x="6" y="7" width="2" height="2" fill="currentColor" />
      <rect x="10" y="7" width="2" height="2" fill="currentColor" />
      <rect x="6" y="11" width="2" height="2" fill="currentColor" />
      <rect x="10" y="11" width="2" height="2" fill="currentColor" />
      <line x1="9" y1="2" x2="9" y2="4" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

/** 儀表板 — 長條圖 */
function IconDashboard() {
  return (
    <svg width={S} height={S} viewBox="0 0 18 18" fill="none" style={iconStyle}>
      <rect x="2" y="10" width="3" height="6" fill="currentColor" />
      <rect x="7" y="6" width="3" height="10" fill="currentColor" />
      <rect x="12" y="2" width="3" height="14" fill="currentColor" />
    </svg>
  )
}

/** 辦公室 — 螢幕 */
function IconOffice() {
  return (
    <svg width={S} height={S} viewBox="0 0 18 18" fill="none" style={iconStyle}>
      <rect x="2" y="3" width="14" height="10" rx="0" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <line x1="9" y1="13" x2="9" y2="16" stroke="currentColor" strokeWidth="1.5" />
      <line x1="5" y1="16" x2="13" y2="16" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

/** 工作 — 文件清單 */
function IconSessions() {
  return (
    <svg width={S} height={S} viewBox="0 0 18 18" fill="none" style={iconStyle}>
      <rect x="3" y="2" width="12" height="14" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <line x1="6" y1="6" x2="12" y2="6" stroke="currentColor" strokeWidth="1.5" />
      <line x1="6" y1="9" x2="12" y2="9" stroke="currentColor" strokeWidth="1.5" />
      <line x1="6" y1="12" x2="10" y2="12" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

/** 行為 — 滑桿 */
function IconBehavior() {
  return (
    <svg width={S} height={S} viewBox="0 0 18 18" fill="none" style={iconStyle}>
      <line x1="3" y1="5" x2="15" y2="5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="7" cy="5" r="2" fill="currentColor" />
      <line x1="3" y1="9" x2="15" y2="9" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="11" cy="9" r="2" fill="currentColor" />
      <line x1="3" y1="13" x2="15" y2="13" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="6" cy="13" r="2" fill="currentColor" />
    </svg>
  )
}

/** 空間 — 方格佈局 */
function IconTemplates() {
  return (
    <svg width={S} height={S} viewBox="0 0 18 18" fill="none" style={iconStyle}>
      <rect x="2" y="2" width="6" height="6" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <rect x="10" y="2" width="6" height="6" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <rect x="2" y="10" width="6" height="6" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <rect x="10" y="10" width="6" height="6" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  )
}

/** 佈局 — 鉛筆 */
function IconEdit() {
  return (
    <svg width={S} height={S} viewBox="0 0 18 18" fill="none" style={iconStyle}>
      <path d="M3 15L3 12L12 3L15 6L6 15Z" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <line x1="10" y1="5" x2="13" y2="8" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

/** 設定 — 齒輪 */
function IconSettings() {
  return (
    <svg width={S} height={S} viewBox="0 0 18 18" fill="none" style={iconStyle}>
      <circle cx="9" cy="9" r="3" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M9 2V4M9 14V16M2 9H4M14 9H16M4.2 4.2L5.6 5.6M12.4 12.4L13.8 13.8M13.8 4.2L12.4 5.6M5.6 12.4L4.2 13.8" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

interface BottomToolbarProps {
  isEditMode: boolean
  onToggleEditMode: () => void
  onOpenSessionPicker: () => void
  isDebugMode: boolean
  onToggleDebugMode: () => void
  floors: FloorConfig[]
  currentFloorId: string | null
  onSwitchFloor: (floorId: string) => void
  isBuildingViewOpen: boolean
  onToggleBuildingView: () => void
  dayNightEnabled: boolean
  onToggleDayNight: () => void
  dayNightTimeOverride: number | null
  onDayNightTimeOverrideChange: (hour: number | null) => void
  isDashboardView: boolean
  onToggleDashboardView: () => void
  uiScale: number
  onUiScaleChange: (scale: number) => void
  lanPeers: Array<{ name: string; host: string; port: number; agentCount: number }>
  isSettingsOpen: boolean
  onToggleSettings: () => void
  isBehaviorEditorOpen: boolean
  onToggleBehaviorEditor: () => void
  isTemplatesOpen: boolean
  onToggleTemplates: () => void
  // 錄製/回放
  recorderState: RecordingState
  recordingDuration: number
  playbackProgress: number
  onStartRecording: () => void
  onStopRecording: () => void
  onStopPlayback: () => void
  onOpenRecordingList: () => void
  onSeekPlayback: (progress: number) => void
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 10,
  left: 10,
  zIndex: 'var(--pixel-controls-z)',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  background: 'var(--pixel-bg)',
  border: '2px solid var(--pixel-border)',
  borderRadius: 0,
  padding: '4px 6px',
  boxShadow: 'var(--pixel-shadow)',
}

const btnBase: React.CSSProperties = {
  padding: '5px 10px',
  fontSize: '24px',
  color: 'var(--pixel-text)',
  background: 'var(--pixel-btn-bg)',
  border: '2px solid transparent',
  borderRadius: 0,
  cursor: 'pointer',
}

const btnActive: React.CSSProperties = {
  ...btnBase,
  background: 'var(--pixel-active-bg)',
  border: '2px solid var(--pixel-accent)',
}


export const BottomToolbar = memo(function BottomToolbar({
  isEditMode,
  onToggleEditMode,
  onOpenSessionPicker,
  isDebugMode,
  onToggleDebugMode,
  floors,
  currentFloorId,
  onSwitchFloor,
  isBuildingViewOpen,
  onToggleBuildingView,
  dayNightEnabled,
  onToggleDayNight,
  dayNightTimeOverride,
  onDayNightTimeOverrideChange,
  isDashboardView,
  onToggleDashboardView,
  uiScale,
  onUiScaleChange,
  lanPeers,
  isSettingsOpen,
  onToggleSettings,
  isBehaviorEditorOpen,
  onToggleBehaviorEditor,
  isTemplatesOpen,
  onToggleTemplates,
  recorderState,
  recordingDuration,
  playbackProgress,
  onStartRecording,
  onStopRecording,
  onStopPlayback,
  onOpenRecordingList,
  onSeekPlayback,
}: BottomToolbarProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const { isMobile } = useDeviceType()

  // 行動版用圖示、桌面版用文字的按鈕輔助函式
  const tbBtn = (key: string, text: string, tooltip: string, icon: React.ReactNode, onClick: () => void, isActive: boolean) => (
    <button
      key={key}
      onClick={onClick}
      onMouseEnter={() => setHovered(key)}
      onMouseLeave={() => setHovered(null)}
      aria-pressed={isActive || undefined}
      style={
        isActive
          ? { ...btnActive, padding: isMobile ? '6px' : btnActive.padding }
          : {
              ...btnBase,
              padding: isMobile ? '6px' : btnBase.padding,
              background: hovered === key ? 'var(--pixel-btn-hover-bg)' : btnBase.background,
            }
      }
      title={tooltip}
    >
      {isMobile ? icon : text}
    </button>
  )

  return (
    <div role="toolbar" aria-label={t.layout} className="pixel-bottom-toolbar" style={panelStyle}>
      {tbBtn('building', t.building, t.buildingPanel, <IconBuilding />, onToggleBuildingView, isBuildingViewOpen)}
      {tbBtn('dashboard', isDashboardView ? t.officeView : t.dashboard, t.dashboard, isDashboardView ? <IconOffice /> : <IconDashboard />, onToggleDashboardView, isDashboardView)}
      {tbBtn('sessions', t.sessions, t.browseSessions, <IconSessions />, onOpenSessionPicker, false)}
      {tbBtn('behavior', t.behavior, t.behaviorEditor, <IconBehavior />, onToggleBehaviorEditor, isBehaviorEditorOpen)}
      {tbBtn('templates', t.layoutTemplates, t.layoutTemplates, <IconTemplates />, onToggleTemplates, isTemplatesOpen)}
      {tbBtn('edit', t.layout, t.editOfficeLayout, <IconEdit />, onToggleEditMode, isEditMode)}
      <div style={{ position: 'relative' }}>
        {tbBtn('settings', t.settings, t.settings, <IconSettings />, onToggleSettings, isSettingsOpen)}
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={onToggleSettings}
          isDebugMode={isDebugMode}
          onToggleDebugMode={onToggleDebugMode}
          dayNightEnabled={dayNightEnabled}
          onToggleDayNight={onToggleDayNight}
          dayNightTimeOverride={dayNightTimeOverride}
          onDayNightTimeOverrideChange={onDayNightTimeOverrideChange}
          uiScale={uiScale}
          onUiScaleChange={onUiScaleChange}
          lanPeers={lanPeers}
        />
      </div>
      {/* 錄製/回放控制 */}
      <div style={{ borderLeft: '1px solid var(--pixel-border)', paddingLeft: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
        {recorderState === 'idle' && (
          <>
            <button
              onClick={onStartRecording}
              onMouseEnter={() => setHovered('rec')}
              onMouseLeave={() => setHovered(null)}
              style={{ ...btnBase, color: '#ff6b6b', background: hovered === 'rec' ? 'var(--pixel-btn-hover-bg)' : btnBase.background }}
              title={t.recording}
            >
              {'\u25CF'}
            </button>
            <button
              onClick={onOpenRecordingList}
              onMouseEnter={() => setHovered('reclist')}
              onMouseLeave={() => setHovered(null)}
              style={{ ...btnBase, background: hovered === 'reclist' ? 'var(--pixel-btn-hover-bg)' : btnBase.background }}
              title={t.recordingList}
            >
              {'\u25B6'}
            </button>
          </>
        )}
        {recorderState === 'recording' && (
          <>
            <button
              onClick={onStopRecording}
              style={{ ...btnBase, color: '#ff6b6b' }}
              title={t.stopRecording}
            >
              {'\u25A0'}
            </button>
            <span style={{ fontSize: '20px', color: '#ff6b6b', minWidth: 48 }}>
              {t.recordingDuration(recordingDuration)}
            </span>
          </>
        )}
        {recorderState === 'playing' && (
          <>
            <button
              onClick={onStopPlayback}
              style={{ ...btnBase, color: 'var(--pixel-accent)' }}
              title={t.stopPlayback}
            >
              {'\u25A0'}
            </button>
            <div
              style={{ width: 80, height: 12, background: 'var(--pixel-btn-bg)', border: '1px solid var(--pixel-border)', cursor: 'pointer', position: 'relative' }}
              onClick={e => {
                const rect = e.currentTarget.getBoundingClientRect()
                onSeekPlayback((e.clientX - rect.left) / rect.width)
              }}
            >
              <div style={{ width: `${playbackProgress * 100}%`, height: '100%', background: 'var(--pixel-accent)' }} />
            </div>
            <span style={{ fontSize: '18px', color: 'var(--pixel-text-dim)' }}>{t.playback}</span>
          </>
        )}
      </div>
      {!isBuildingViewOpen && (
        <FloorSelector
          floors={floors}
          currentFloorId={currentFloorId}
          onSwitchFloor={onSwitchFloor}
        />
      )}
    </div>
  )
})
