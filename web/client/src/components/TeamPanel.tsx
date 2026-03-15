import { useState, useEffect, useMemo, memo } from 'react'
import { TEAM_COLORS } from '../constants.js'
import { t } from '../i18n.js'

interface TeamPanelProps {
  isOpen: boolean
  onClose: () => void
  /** agentId -> teamName */
  agentTeams: Record<number, string>
  /** agentId -> projectName */
  agentProjects: Record<number, string>
  /** 所有活躍 agent ID */
  agents: number[]
  /** 選取的團隊篩選（null = 全部） */
  selectedTeamFilter: string | null
  onTeamFilterChange: (teamName: string | null) => void
}

/** 為團隊名稱分配一致的顏色（基於名稱的哈希） */
function getTeamColor(teamName: string): string {
  let hash = 0
  for (let i = 0; i < teamName.length; i++) {
    hash = ((hash << 5) - hash + teamName.charCodeAt(i)) | 0
  }
  return TEAM_COLORS[Math.abs(hash) % TEAM_COLORS.length]
}

export const TeamPanel = memo(function TeamPanel({
  isOpen,
  onClose,
  agentTeams,
  agentProjects,
  agents,
  selectedTeamFilter,
  onTeamFilterChange,
}: TeamPanelProps) {
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

  // 建構團隊資料
  const teamData = useMemo(() => {
    const teams: Record<string, { color: string; members: Array<{ id: number; projectName?: string }> }> = {}
    const noTeamMembers: Array<{ id: number; projectName?: string }> = []

    for (const id of agents) {
      const teamName = agentTeams[id]
      if (teamName) {
        if (!teams[teamName]) {
          teams[teamName] = { color: getTeamColor(teamName), members: [] }
        }
        teams[teamName].members.push({ id, projectName: agentProjects[id] })
      } else {
        noTeamMembers.push({ id, projectName: agentProjects[id] })
      }
    }

    return { teams, noTeamMembers }
  }, [agents, agentTeams, agentProjects])

  if (!isOpen) return null

  const teamNames = Object.keys(teamData.teams).sort()

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
        aria-label={t.allTeams}
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
          minWidth: 260,
          maxWidth: 380,
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
            {t.allTeams}
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

        {/* 篩選按鈕列 */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '4px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <button
            onClick={() => onTeamFilterChange(null)}
            style={{
              padding: '2px 8px',
              fontSize: '18px',
              background: selectedTeamFilter === null ? 'var(--pixel-active-bg)' : 'var(--pixel-btn-bg)',
              border: selectedTeamFilter === null ? '2px solid var(--pixel-accent)' : '2px solid transparent',
              borderRadius: 0,
              color: 'var(--pixel-text)',
              cursor: 'pointer',
            }}
          >
            {t.filterByTeam}: --
          </button>
          {teamNames.map((name) => (
            <button
              key={name}
              onClick={() => onTeamFilterChange(selectedTeamFilter === name ? null : name)}
              style={{
                padding: '2px 8px',
                fontSize: '18px',
                background: selectedTeamFilter === name ? 'var(--pixel-active-bg)' : 'var(--pixel-btn-bg)',
                border: selectedTeamFilter === name ? `2px solid ${teamData.teams[name].color}` : '2px solid transparent',
                borderRadius: 0,
                color: teamData.teams[name].color,
                cursor: 'pointer',
              }}
            >
              {name}
            </button>
          ))}
        </div>

        {/* 團隊列表 */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '4px 0' }}>
          {teamNames.length === 0 && teamData.noTeamMembers.length === agents.length ? (
            <div style={{ padding: '12px 10px', fontSize: '18px', color: 'rgba(255,255,255,0.3)', textAlign: 'center' }}>
              {t.noTeam}
            </div>
          ) : (
            <>
              {teamNames.map((name) => {
                const team = teamData.teams[name]
                return (
                  <div key={name} style={{ marginBottom: 6 }}>
                    {/* 團隊標題 */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '4px 10px',
                      borderBottom: '1px solid rgba(255,255,255,0.06)',
                    }}>
                      {/* 色點 */}
                      <span style={{
                        width: 8,
                        height: 8,
                        background: team.color,
                        flexShrink: 0,
                      }} />
                      <span style={{ fontSize: '20px', color: team.color, fontWeight: 'bold', flex: 1 }}>
                        {name}
                      </span>
                      <span style={{ fontSize: '16px', color: 'rgba(255,255,255,0.4)' }}>
                        {team.members.length} {t.teamMembers}
                      </span>
                    </div>
                    {/* 成員列表 */}
                    {team.members.map((m) => (
                      <div key={m.id} style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '3px 10px 3px 26px',
                        fontSize: '18px',
                      }}>
                        <span style={{ color: 'var(--pixel-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          #{m.id} {m.projectName || ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )
              })}
              {/* 無團隊成員 */}
              {teamData.noTeamMembers.length > 0 && (
                <div style={{ marginBottom: 6 }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '4px 10px',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                  }}>
                    <span style={{
                      width: 8,
                      height: 8,
                      background: 'rgba(255,255,255,0.2)',
                      flexShrink: 0,
                    }} />
                    <span style={{ fontSize: '20px', color: 'rgba(255,255,255,0.4)', flex: 1 }}>
                      {t.noTeam}
                    </span>
                    <span style={{ fontSize: '16px', color: 'rgba(255,255,255,0.3)' }}>
                      {teamData.noTeamMembers.length} {t.teamMembers}
                    </span>
                  </div>
                  {teamData.noTeamMembers.map((m) => (
                    <div key={m.id} style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '3px 10px 3px 26px',
                      fontSize: '18px',
                    }}>
                      <span style={{ color: 'rgba(255,255,255,0.4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        #{m.id} {m.projectName || ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
})
