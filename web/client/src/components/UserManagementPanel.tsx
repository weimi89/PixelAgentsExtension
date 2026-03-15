import { useState, useEffect, useCallback } from 'react'
import { t } from '../i18n.js'

interface UserInfo {
  id: string
  username: string
  role: 'admin' | 'viewer'
  createdAt: string
  mustChangePassword: boolean
}

interface UserManagementPanelProps {
  isOpen: boolean
  onClose: () => void
  /** 目前使用者的 JWT token（用於 API 認證） */
  token: string | null
}

const panelStyle: React.CSSProperties = {
  position: 'fixed',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  zIndex: 60,
  background: 'var(--pixel-bg)',
  border: '2px solid var(--pixel-border)',
  borderRadius: 0,
  padding: '4px',
  boxShadow: 'var(--pixel-shadow)',
  minWidth: 360,
  maxWidth: 500,
  maxHeight: '80vh',
  overflow: 'auto',
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '4px 10px',
  borderBottom: '1px solid var(--pixel-border)',
  marginBottom: '4px',
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '5px 10px',
  borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
}

const btnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid rgba(255, 255, 255, 0.3)',
  borderRadius: 0,
  color: 'rgba(255, 255, 255, 0.7)',
  fontSize: '16px',
  cursor: 'pointer',
  padding: '2px 6px',
  marginLeft: 4,
}

export function UserManagementPanel({ isOpen, onClose, token }: UserManagementPanelProps) {
  const [users, setUsers] = useState<UserInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchUsers = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/users', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Unknown error' })) as { error?: string }
        setError(body.error || t.userLoadFailed)
        return
      }
      const data = await res.json() as { users: UserInfo[] }
      setUsers(data.users)
    } catch {
      setError(t.userLoadFailed)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (isOpen) {
      fetchUsers()
    }
  }, [isOpen, fetchUsers])

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

  const handleRoleChange = async (userId: string, newRole: 'admin' | 'viewer') => {
    if (!token) return
    try {
      const res = await fetch(`/api/auth/users/${userId}/role`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ role: newRole }),
      })
      if (res.ok) {
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u)),
        )
      }
    } catch {
      // 靜默失敗
    }
  }

  const handleDelete = async (userId: string, username: string) => {
    if (!token) return
    if (!window.confirm(t.userDeleteConfirm(username))) return
    try {
      const res = await fetch(`/api/auth/users/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        setUsers((prev) => prev.filter((u) => u.id !== userId))
      }
    } catch {
      // 靜默失敗
    }
  }

  return (
    <>
      {/* 遮罩 */}
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
      <div role="dialog" aria-modal="true" aria-label={t.userManagementPanel} style={panelStyle}>
        <div style={headerStyle}>
          <span style={{ fontSize: '24px', color: 'rgba(255, 255, 255, 0.9)' }}>
            {t.userManagementPanel}
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
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

        {loading && (
          <div style={{ padding: '10px', color: 'rgba(255, 255, 255, 0.5)', fontSize: '20px' }}>
            {t.loading}
          </div>
        )}

        {error && (
          <div style={{ padding: '10px', color: 'rgba(255, 100, 100, 0.8)', fontSize: '18px' }}>
            {error}
          </div>
        )}

        {!loading && !error && users.length === 0 && (
          <div style={{ padding: '10px', color: 'rgba(255, 255, 255, 0.4)', fontSize: '18px' }}>
            {t.noUsers}
          </div>
        )}

        {/* 表頭 */}
        {users.length > 0 && (
          <div
            style={{
              ...rowStyle,
              fontWeight: 'bold',
              color: 'rgba(255, 255, 255, 0.5)',
              fontSize: '16px',
              borderBottom: '1px solid var(--pixel-border)',
            }}
          >
            <span style={{ flex: 2 }}>{t.userUsername}</span>
            <span style={{ flex: 1, textAlign: 'center' }}>{t.userRole}</span>
            <span style={{ flex: 1, textAlign: 'right' }}>{t.userActions}</span>
          </div>
        )}

        {users.map((user) => (
          <div key={user.id} style={rowStyle}>
            <span
              style={{
                flex: 2,
                fontSize: '20px',
                color: 'rgba(255, 255, 255, 0.85)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {user.username}
            </span>
            <span style={{ flex: 1, textAlign: 'center' }}>
              <select
                value={user.role}
                onChange={(e) => handleRoleChange(user.id, e.target.value as 'admin' | 'viewer')}
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.3)',
                  borderRadius: 0,
                  color: 'rgba(255, 255, 255, 0.8)',
                  fontSize: '16px',
                  padding: '1px 4px',
                  cursor: 'pointer',
                }}
              >
                <option value="admin">{t.roleAdmin}</option>
                <option value="viewer">{t.roleViewer}</option>
              </select>
            </span>
            <span style={{ flex: 1, textAlign: 'right' }}>
              <button
                onClick={() => handleDelete(user.id, user.username)}
                style={{
                  ...btnStyle,
                  color: 'rgba(255, 100, 100, 0.8)',
                  borderColor: 'rgba(255, 100, 100, 0.3)',
                }}
              >
                {t.deleteUser}
              </button>
            </span>
          </div>
        ))}
      </div>
    </>
  )
}
