import type { OfficeState } from '../office/engine/officeState.js'
import type { SubagentCharacter } from '../hooks/useExtensionMessages.js'
import { TILE_SIZE } from '../office/types.js'
import { isSittingState } from '../office/engine/characters.js'
import { useRenderTick } from '../hooks/useRenderTick.js'

interface AgentLabelsProps {
  officeState: OfficeState
  agents: number[]
  agentStatuses: Record<number, string>
  containerRef: React.RefObject<HTMLDivElement | null>
  zoom: number
  panRef: React.RefObject<{ x: number; y: number }>
  subagentCharacters: SubagentCharacter[]
}

export function AgentLabels({
  officeState,
  agents,
  agentStatuses,
  containerRef,
  zoom,
  panRef,
  subagentCharacters,
}: AgentLabelsProps) {
  useRenderTick()

  const el = containerRef.current
  if (!el) return null
  const rect = el.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  // 計算裝置像素偏移（與 renderFrame 相同的計算，包含平移）
  const canvasW = Math.round(rect.width * dpr)
  const canvasH = Math.round(rect.height * dpr)
  const layout = officeState.getLayout()
  const mapW = layout.cols * TILE_SIZE * zoom
  const mapH = layout.rows * TILE_SIZE * zoom
  const deviceOffsetX = Math.floor((canvasW - mapW) / 2) + Math.round(panRef.current.x)
  const deviceOffsetY = Math.floor((canvasH - mapH) / 2) + Math.round(panRef.current.y)

  const selectedId = officeState.selectedAgentId
  const hoveredId = officeState.hoveredAgentId

  // 所有需要渲染標籤的角色 ID（一般代理 + 子代理）
  const allIds = [...agents, ...subagentCharacters.map((s) => s.id)]

  return (
    <>
      {allIds.map((id) => {
        const ch = officeState.characters.get(id)
        if (!ch) return null

        // 當非斷線的對話氣泡顯示時隱藏（讓氣泡單獨可見）
        if (ch.bubbleType && ch.bubbleType !== 'detached') return null
        // 懸停或選取時由 ToolOverlay 負責顯示完整資訊，此處不重複渲染
        if (selectedId === id || hoveredId === id) return null

        const status = agentStatuses[id]
        const isWaiting = status === 'waiting'
        const isActive = ch.isActive
        const isDetached = ch.isDetached

        let dotColor: string | null = null
        if (isDetached) {
          dotColor = 'var(--pixel-status-detached)'
        } else if (isWaiting) {
          dotColor = '#cca700'
        } else if (isActive) {
          dotColor = '#3794ff'
        }

        // 無狀態圓點 → 不渲染
        if (!dotColor) return null
        // 有表情顯示時隱藏圓點（表情已經傳達狀態資訊）
        if (ch.emoteType) return null

        // 精簡圓點位於角色頭頂上方（坐姿與站姿使用不同偏移）
        const isSitting = isSittingState(ch.state)
        const dotOffsetY = isSitting ? (14 - 42) : -34
        const screenX = (deviceOffsetX + ch.x * zoom) / dpr
        const screenY = (deviceOffsetY + (ch.y + dotOffsetY) * zoom) / dpr

        return (
          <div
            key={id}
            style={{
              position: 'absolute',
              left: screenX,
              top: screenY,
              transform: 'translateX(-50%)',
              pointerEvents: 'none',
              zIndex: 40,
            }}
          >
            <span
              className={isActive && !isWaiting ? 'pixel-agents-pulse' : undefined}
              style={{
                display: 'block',
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: dotColor,
              }}
            />
          </div>
        )
      })}
    </>
  )
}
