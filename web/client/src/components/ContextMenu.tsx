import { useEffect, useRef, memo } from 'react'

export interface ContextMenuAction {
  label: string
  onClick: () => void
  disabled?: boolean
}

interface ContextMenuProps {
  x: number
  y: number
  actions: ContextMenuAction[]
  onClose: () => void
}

const itemStyle: React.CSSProperties = {
  padding: '6px 16px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  fontSize: '13px',
  color: 'var(--pixel-text)',
  background: 'transparent',
  border: 'none',
  width: '100%',
  textAlign: 'left',
  display: 'block',
}

const itemHoverBg = 'var(--pixel-btn-hover-bg)'

export const ContextMenu = memo(function ContextMenu({ x, y, actions, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  // 點擊外部或按 Escape 關閉
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  // 確保選單不超出視窗
  useEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.right > window.innerWidth) {
      el.style.left = `${x - rect.width}px`
    }
    if (rect.bottom > window.innerHeight) {
      el.style.top = `${y - rect.height}px`
    }
  }, [x, y])

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 9999,
        background: 'var(--pixel-bg)',
        border: '2px solid var(--pixel-border)',
        borderRadius: 0,
        boxShadow: 'var(--pixel-shadow)',
        padding: '4px 0',
        minWidth: 140,
      }}
    >
      {actions.map((action, i) => (
        <button
          key={i}
          style={{
            ...itemStyle,
            opacity: action.disabled ? 0.4 : 1,
            cursor: action.disabled ? 'default' : 'pointer',
          }}
          disabled={action.disabled}
          onClick={() => {
            action.onClick()
            onClose()
          }}
          onMouseEnter={(e) => {
            if (!action.disabled) (e.currentTarget as HTMLElement).style.background = itemHoverBg
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'transparent'
          }}
        >
          {action.label}
        </button>
      ))}
    </div>
  )
})
