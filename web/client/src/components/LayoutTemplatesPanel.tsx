import { useState, useEffect } from 'react'
import { vscode, onServerMessage } from '../socketApi.js'
import { t } from '../i18n.js'

interface FloorInfo {
  id: string
  name: string
}

interface LayoutTemplatesPanelProps {
  isOpen: boolean
  onClose: () => void
  floors: FloorInfo[]
  currentFloorId: string | null
}

const templateNames: Record<string, string> = {
  'classic-office': t.templateClassicOffice,
  'open-plan': t.templateOpenPlan,
  'coworking': t.templateCoworking,
  'minimal': t.templateMinimal,
  'l-shape-studio': t.templateLShapeStudio,
  'maze-hall': t.templateMazeHall,
  'twin-wing': t.templateTwinWing,
  'ring-office': t.templateRingOffice,
  'cubicle-farm': t.templateCubicleFarm,
  'terraced': t.templateTerraced,
  'grand-plaza': t.templateGrandPlaza,
  'conference-center': t.templateConferenceCenter,
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

export function LayoutTemplatesPanel({ isOpen, onClose, floors, currentFloorId }: LayoutTemplatesPanelProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; cols: number; rows: number }>>([])
  const [confirmTemplate, setConfirmTemplate] = useState<{ templateId: string; floorId: string } | null>(null)
  const [selectedFloor, setSelectedFloor] = useState<string | null>(null)

  // 開啟時請求模板列表
  useEffect(() => {
    if (!isOpen) return
    vscode.postMessage({ type: 'requestLayoutTemplates' })
    setSelectedFloor(currentFloorId || (floors[0]?.id ?? null))
    setConfirmTemplate(null)
  }, [isOpen, currentFloorId, floors])

  // 監聽伺服器回傳
  useEffect(() => {
    const unsub = onServerMessage((data) => {
      const msg = data as Record<string, unknown>
      if (msg.type === 'layoutTemplatesList' && Array.isArray(msg.templates)) {
        setTemplates(msg.templates as Array<{ id: string; name: string; cols: number; rows: number }>)
      }
    })
    return unsub
  }, [])

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

  if (!isOpen) return null

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
          zIndex: 49,
        }}
      />
      {/* 置中彈出視窗 */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.layoutTemplates}
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
          minWidth: 280,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* 標題列 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '4px 10px',
            borderBottom: '1px solid var(--pixel-border)',
            marginBottom: '4px',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: '24px', color: 'rgba(255, 255, 255, 0.9)' }}>{t.layoutTemplates}</span>
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

        {/* 樓層選擇器 */}
        {floors.length > 1 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px 6px',
            flexShrink: 0,
            flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: '20px', color: 'rgba(255, 255, 255, 0.5)', marginRight: 4 }}>
              {t.templateTargetFloor}
            </span>
            {floors.map((floor) => (
              <button
                key={floor.id}
                onClick={() => setSelectedFloor(floor.id)}
                style={{
                  background: selectedFloor === floor.id ? 'rgba(90, 140, 255, 0.8)' : 'rgba(255, 255, 255, 0.08)',
                  border: selectedFloor === floor.id ? '2px solid rgba(90, 140, 255, 1)' : '2px solid rgba(255, 255, 255, 0.2)',
                  borderRadius: 0,
                  color: selectedFloor === floor.id ? '#fff' : 'rgba(255, 255, 255, 0.6)',
                  fontSize: '18px',
                  cursor: 'pointer',
                  padding: '2px 10px',
                }}
              >
                {floor.name || floor.id}
              </button>
            ))}
          </div>
        )}

        {/* 模板清單（可捲動） */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {templates.map((tmpl) => (
            <div key={tmpl.id} style={{ padding: '0 4px' }}>
              {confirmTemplate?.templateId === tmpl.id ? (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '6px 10px',
                }}>
                  <span style={{ fontSize: '18px', color: 'rgba(255, 200, 100, 0.9)' }}>
                    {t.templateConfirmLoad}
                  </span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => {
                        vscode.postMessage({ type: 'loadLayoutTemplate', templateId: tmpl.id, floorId: confirmTemplate.floorId })
                        setConfirmTemplate(null)
                        onClose()
                      }}
                      style={{
                        background: 'rgba(90, 140, 255, 0.8)',
                        border: 'none',
                        borderRadius: 0,
                        color: '#fff',
                        fontSize: '18px',
                        cursor: 'pointer',
                        padding: '2px 10px',
                      }}
                    >
                      {t.yes}
                    </button>
                    <button
                      onClick={() => setConfirmTemplate(null)}
                      style={{
                        background: 'rgba(255, 255, 255, 0.1)',
                        border: 'none',
                        borderRadius: 0,
                        color: 'rgba(255, 255, 255, 0.7)',
                        fontSize: '18px',
                        cursor: 'pointer',
                        padding: '2px 10px',
                      }}
                    >
                      {t.no}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmTemplate({ templateId: tmpl.id, floorId: selectedFloor || currentFloorId || floors[0]?.id || '1F' })}
                  onMouseEnter={() => setHovered(`tmpl-${tmpl.id}`)}
                  onMouseLeave={() => setHovered(null)}
                  style={{
                    ...menuItemBase,
                    fontSize: '22px',
                    background: hovered === `tmpl-${tmpl.id}` ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                  }}
                >
                  <span>{templateNames[tmpl.id] || tmpl.name}</span>
                  <span style={{ fontSize: '16px', color: 'rgba(255, 255, 255, 0.4)' }}>
                    {tmpl.cols}x{tmpl.rows}
                  </span>
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
