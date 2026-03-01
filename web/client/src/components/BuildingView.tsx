import { useState, useEffect, useRef, memo } from 'react'
import { vscode } from '../socketApi.js'
import { t } from '../i18n.js'
import type { FloorConfig } from '../types/messages.js'

interface BuildingViewProps {
  isOpen: boolean
  onClose: () => void
  floors: FloorConfig[]
  currentFloorId: string | null
  floorSummaries: Record<string, number>
  onSwitchFloor: (floorId: string) => void
}

const PANEL_WIDTH = 220

const panelStyle: React.CSSProperties = {
  position: 'fixed',
  left: 0,
  top: 0,
  bottom: 0,
  width: PANEL_WIDTH,
  zIndex: 50,
  background: 'var(--pixel-bg)',
  borderRight: '2px solid var(--pixel-border)',
  boxShadow: '4px 0 0 #0a0a14',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 10px',
  borderBottom: '2px solid var(--pixel-border)',
  flexShrink: 0,
}

const closeBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--pixel-close-text)',
  fontSize: '20px',
  cursor: 'pointer',
  padding: '2px 6px',
  borderRadius: 0,
}

const floorListStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '4px 0',
}

const floorItemBase: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '6px 10px',
  cursor: 'pointer',
  borderLeft: '3px solid transparent',
  fontSize: '20px',
  color: 'var(--pixel-text)',
  position: 'relative',
}

const floorItemActive: React.CSSProperties = {
  ...floorItemBase,
  background: 'var(--pixel-active-bg)',
  borderLeft: '3px solid var(--pixel-accent)',
}

const addBtnStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderTop: '2px solid var(--pixel-border)',
  flexShrink: 0,
}

const addBtnInner: React.CSSProperties = {
  width: '100%',
  padding: '5px 10px',
  fontSize: '20px',
  color: 'var(--pixel-text)',
  background: 'var(--pixel-btn-bg)',
  border: '2px solid transparent',
  borderRadius: 0,
  cursor: 'pointer',
  textAlign: 'center',
}

const dotStyle: React.CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: 'var(--pixel-status-active)',
  flexShrink: 0,
}

const deleteBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--pixel-close-hover)',
  fontSize: '18px',
  cursor: 'pointer',
  padding: '0 4px',
  borderRadius: 0,
  lineHeight: 1,
}

const renameInputStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)',
  border: '2px solid var(--pixel-border)',
  borderRadius: 0,
  color: 'var(--pixel-text)',
  fontSize: '20px',
  padding: '1px 4px',
  outline: 'none',
  width: '100%',
  maxWidth: 140,
}

function AgentDots({ count }: { count: number }) {
  if (count === 0) return null
  if (count <= 5) {
    return (
      <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
        {Array.from({ length: count }, (_, i) => (
          <span key={i} style={dotStyle} />
        ))}
      </div>
    )
  }
  return (
    <span style={{ fontSize: '18px', color: 'var(--pixel-status-active)', fontWeight: 'bold' }}>
      {count}
    </span>
  )
}

export const BuildingView = memo(function BuildingView({
  isOpen,
  onClose,
  floors,
  currentFloorId,
  floorSummaries,
  onSwitchFloor,
}: BuildingViewProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  // 高樓在上 — order 降序排列
  const sorted = [...floors].sort((a, b) => b.order - a.order)

  // Escape 關閉面板
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (renamingId) {
          setRenamingId(null)
          return
        }
        if (confirmDeleteId) {
          setConfirmDeleteId(null)
          return
        }
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose, renamingId, confirmDeleteId])

  // 重命名 input 自動聚焦
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingId])

  if (!isOpen) return null

  function startRename(floor: FloorConfig) {
    setRenamingId(floor.id)
    setRenameValue(floor.name)
    setConfirmDeleteId(null)
  }

  function commitRename() {
    if (renamingId && renameValue.trim()) {
      vscode.postMessage({ type: 'renameFloor', floorId: renamingId, name: renameValue.trim() })
    }
    setRenamingId(null)
  }

  function handleDelete(floorId: string) {
    if (floors.length <= 1) return
    if (confirmDeleteId === floorId) {
      vscode.postMessage({ type: 'removeFloor', floorId })
      setConfirmDeleteId(null)
    } else {
      setConfirmDeleteId(floorId)
    }
  }

  function handleAddFloor() {
    const nextOrder = Math.max(0, ...floors.map((f) => f.order)) + 1
    vscode.postMessage({ type: 'addFloor', name: `${nextOrder + 1}F` })
  }

  return (
    <div style={panelStyle}>
      {/* 標題列 */}
      <div style={headerStyle}>
        <span style={{ fontSize: '22px', color: 'var(--pixel-text)', fontWeight: 'bold' }}>
          {t.building}
        </span>
        <button
          style={closeBtnStyle}
          onClick={onClose}
          onMouseEnter={(e) => { (e.target as HTMLElement).style.color = 'var(--pixel-close-hover)' }}
          onMouseLeave={(e) => { (e.target as HTMLElement).style.color = 'var(--pixel-close-text)' }}
          title="關閉"
        >
          ✕
        </button>
      </div>

      {/* 樓層列表 */}
      <div style={floorListStyle}>
        {sorted.map((floor) => {
          const isActive = floor.id === currentFloorId
          const isHover = hovered === floor.id
          const agentCount = floorSummaries[floor.id] || 0
          const isRenaming = renamingId === floor.id
          const isConfirmingDelete = confirmDeleteId === floor.id

          return (
            <div
              key={floor.id}
              style={{
                ...(isActive ? floorItemActive : floorItemBase),
                background: isActive
                  ? 'var(--pixel-active-bg)'
                  : isHover
                    ? 'rgba(255,255,255,0.05)'
                    : 'transparent',
              }}
              onMouseEnter={() => setHovered(floor.id)}
              onMouseLeave={() => {
                setHovered(null)
                if (confirmDeleteId === floor.id) setConfirmDeleteId(null)
              }}
              onClick={() => {
                if (!isRenaming) onSwitchFloor(floor.id)
              }}
              onDoubleClick={() => startRename(floor)}
            >
              {/* 左側：樓層名稱或重命名 input */}
              <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                {isActive && (
                  <span style={{ fontSize: '16px', color: 'var(--pixel-accent)', flexShrink: 0 }}>▶</span>
                )}
                {isRenaming ? (
                  <input
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') setRenamingId(null)
                      e.stopPropagation()
                    }}
                    onBlur={commitRename}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                    style={renameInputStyle}
                  />
                ) : (
                  <span style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {floor.name}
                  </span>
                )}
              </div>

              {/* 右側：代理圓點 + 刪除按鈕 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <AgentDots count={agentCount} />
                {isHover && floors.length > 1 && !isRenaming && (
                  isConfirmingDelete ? (
                    <button
                      style={{ ...deleteBtnStyle, fontSize: '16px', color: '#fff', background: 'var(--pixel-danger-bg)', padding: '1px 6px' }}
                      onClick={(e) => { e.stopPropagation(); handleDelete(floor.id) }}
                      title={t.deleteFloorConfirm}
                    >
                      {t.yes}
                    </button>
                  ) : (
                    <button
                      style={deleteBtnStyle}
                      onClick={(e) => { e.stopPropagation(); handleDelete(floor.id) }}
                      title={t.removeFloor}
                    >
                      ✕
                    </button>
                  )
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* 新增樓層按鈕 */}
      <div style={addBtnStyle}>
        <button
          style={addBtnInner}
          onClick={handleAddFloor}
          onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'var(--pixel-btn-hover-bg)' }}
          onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'var(--pixel-btn-bg)' }}
        >
          + {t.addFloor}
        </button>
      </div>
    </div>
  )
})
