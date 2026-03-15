import { useState, useEffect, memo } from 'react'
import { t } from '../i18n.js'

/** 所有已定義的成就 ID（與伺服器 growthSystem.ts 同步） */
const ALL_ACHIEVEMENT_IDS = [
  'first_tool',
  'ten_tools',
  'hundred_tools',
  'thousand_tools',
  'level_5',
  'level_10',
  'level_25',
  'level_50',
  'five_sessions',
  'bash_user',
] as const

/** 成就描述（繁體中文 fallback + 英文透過 i18n） */
const ACHIEVEMENT_DESCRIPTIONS: Record<string, string> = {
  first_tool: '1',
  ten_tools: '10',
  hundred_tools: '100',
  thousand_tools: '1,000',
  level_5: 'Lv.5',
  level_10: 'Lv.10',
  level_25: 'Lv.25',
  level_50: 'Lv.50',
  five_sessions: '5',
  bash_user: 'Bash x10',
}

/** 成就對應的像素風格圖示字元 */
const ACHIEVEMENT_ICONS: Record<string, string> = {
  first_tool: '\u2726',       // ✦
  ten_tools: '\u2726\u2726',
  hundred_tools: '\u2605',    // ★
  thousand_tools: '\u2605\u2605',
  level_5: '\u25B2',          // ▲
  level_10: '\u25B2\u25B2',
  level_25: '\u25C6',         // ◆
  level_50: '\u25C6\u25C6',
  five_sessions: '\u2302',    // ⌂
  bash_user: '\u25BA',        // ►
}

interface AchievementPanelProps {
  isOpen: boolean
  onClose: () => void
  unlockedAchievements: string[]
}

export const AchievementPanel = memo(function AchievementPanel({ isOpen, onClose, unlockedAchievements }: AchievementPanelProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => setVisible(true))
    } else {
      setVisible(false)
    }
  }, [isOpen])

  // Escape 鍵關閉
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const unlockedSet = new Set(unlockedAchievements)

  return (
    <>
      {/* 背景遮罩 */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(0, 0, 0, 0.5)',
          zIndex: 59,
        }}
      />
      {/* 面板 */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.allAchievements}
        className="pixel-modal-dialog"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: visible ? 'translate(-50%, -50%)' : 'translate(-50%, -40%)',
          opacity: visible ? 1 : 0,
          transition: 'transform 0.2s ease-out, opacity 0.2s ease-out',
          zIndex: 60,
          background: 'var(--pixel-bg)',
          border: '2px solid var(--pixel-border)',
          borderRadius: 0,
          padding: '4px',
          boxShadow: 'var(--pixel-shadow)',
          minWidth: 280,
          maxWidth: 400,
          maxHeight: '80vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* 標題 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '4px 10px',
            borderBottom: '1px solid var(--pixel-border)',
            marginBottom: 4,
          }}
        >
          <span style={{ fontSize: '22px', color: 'var(--pixel-text)' }}>
            {t.allAchievements}
          </span>
          <span style={{ fontSize: '16px', color: 'rgba(255,255,255,0.4)' }}>
            {unlockedAchievements.length}/{ALL_ACHIEVEMENT_IDS.length}
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              borderRadius: 0,
              color: 'var(--pixel-close-text)',
              fontSize: '22px',
              cursor: 'pointer',
              padding: '0 4px',
              lineHeight: 1,
            }}
          >
            X
          </button>
        </div>
        {/* 成就列表 */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '4px 0' }}>
          {ALL_ACHIEVEMENT_IDS.map((id) => {
            const unlocked = unlockedSet.has(id)
            const name = t.achievementNames[id] || id
            const icon = ACHIEVEMENT_ICONS[id] || '\u2726'
            const desc = ACHIEVEMENT_DESCRIPTIONS[id] || ''

            return (
              <div
                key={id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '6px 10px',
                  opacity: unlocked ? 1 : 0.35,
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                }}
              >
                {/* 圖示 */}
                <span style={{
                  width: 28,
                  height: 28,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '18px',
                  background: unlocked ? 'var(--pixel-gold-dim, rgba(255, 215, 0, 0.3))' : 'rgba(255,255,255,0.05)',
                  border: unlocked ? '2px solid var(--pixel-gold, #ffd700)' : '2px solid rgba(255,255,255,0.1)',
                  color: unlocked ? 'var(--pixel-gold, #ffd700)' : 'var(--pixel-text-dim)',
                  flexShrink: 0,
                }}>
                  {icon}
                </span>
                {/* 名稱與描述 */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: '20px',
                    color: unlocked ? 'var(--pixel-text)' : 'var(--pixel-text-dim)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {name}
                  </div>
                  {desc && (
                    <div style={{ fontSize: '14px', color: 'rgba(255,255,255,0.35)', marginTop: 1 }}>
                      {desc}
                    </div>
                  )}
                </div>
                {/* 狀態 */}
                {unlocked ? (
                  <span style={{ fontSize: '16px', color: 'var(--pixel-gold, #ffd700)', flexShrink: 0 }}>
                    {'\u2713'}
                  </span>
                ) : (
                  <span style={{ fontSize: '14px', color: 'rgba(255,255,255,0.25)', flexShrink: 0 }}>
                    {t.locked}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
})
