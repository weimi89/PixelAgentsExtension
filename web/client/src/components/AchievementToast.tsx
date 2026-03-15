import { useState, useEffect, memo } from 'react'
import { t } from '../i18n.js'

interface AchievementToastProps {
  achievementId: string
  onDismiss: () => void
}

export const AchievementToast = memo(function AchievementToast({ achievementId, onDismiss }: AchievementToastProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // 滑入
    const showRaf = requestAnimationFrame(() => setVisible(true))
    // 3 秒後自動消失
    const timer = setTimeout(() => {
      setVisible(false)
      setTimeout(onDismiss, 400)
    }, 3000)
    return () => {
      cancelAnimationFrame(showRaf)
      clearTimeout(timer)
    }
  }, [onDismiss])

  const name = t.achievementNames[achievementId] || achievementId

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: visible ? 16 : -80,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        background: 'var(--pixel-bg)',
        border: '2px solid var(--pixel-gold, #ffd700)',
        borderRadius: 0,
        padding: '8px 16px',
        boxShadow: '2px 2px 0px var(--pixel-gold-dim, rgba(255, 215, 0, 0.3))',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        transition: 'top 0.3s ease-out',
        pointerEvents: 'auto',
        cursor: 'pointer',
        minWidth: 200,
      }}
      onClick={() => {
        setVisible(false)
        setTimeout(onDismiss, 400)
      }}
    >
      {/* 獎盃圖示 */}
      <span style={{ fontSize: '28px', lineHeight: 1 }}>
        {'\u2605'}
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '16px', color: 'var(--pixel-gold, #ffd700)', fontWeight: 'bold' }}>
          {t.achievementUnlocked}
        </div>
        <div style={{ fontSize: '20px', color: 'var(--pixel-text)', marginTop: 2 }}>
          {name}
        </div>
      </div>
    </div>
  )
})
