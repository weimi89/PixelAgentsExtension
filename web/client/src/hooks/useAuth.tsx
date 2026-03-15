import { useState, useEffect, useCallback, createContext, useContext, useRef } from 'react'
import type { ReactNode } from 'react'
import { onServerMessage, emitRaw, setAuthToken, reconnectWithAuth } from '../socketApi.js'

// ── 型別定義 ─────────────────────────────────────────────────────

export type AuthRole = 'admin' | 'member' | 'anonymous'

interface AuthState {
  role: AuthRole
  username: string | null
  /** P3.4: 使用者 ID（用於代理所有權比較） */
  userId: string | null
  token: string | null
  isAuthenticated: boolean
}

interface AuthContextValue extends AuthState {
  /** 帳號密碼登入 */
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string; mustChangePassword?: boolean; apiKey?: string }>
  /** API Key 登入 */
  loginWithApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  /** 註冊新帳號 */
  register: (username: string, password: string) => Promise<{ success: boolean; error?: string; apiKey?: string }>
  /** 登出 */
  logout: () => void
  /** 變更密碼 */
  changePassword: (oldPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>
  /** 取得 API Key */
  getApiKey: () => Promise<{ success: boolean; apiKey?: string; error?: string }>
  /** 重新生成 API Key */
  regenerateApiKey: () => Promise<{ success: boolean; apiKey?: string; error?: string }>
}

// ── localStorage 鍵 ──────────────────────────────────────────────

const TOKEN_KEY = 'pixel-agents-token'
const ACCESS_TOKEN_KEY = 'pixel-agents-access-token'
const REFRESH_TOKEN_KEY = 'pixel-agents-refresh-token'
const USERNAME_KEY = 'pixel-agents-username'
const ROLE_KEY = 'pixel-agents-role'
const USERID_KEY = 'pixel-agents-userid'

/** Access token 自動刷新提前量（秒） */
const TOKEN_REFRESH_BEFORE_EXPIRY_SEC = 60

// ── Context ──────────────────────────────────────────────────────

const defaultContextValue: AuthContextValue = {
  role: 'anonymous',
  username: null,
  userId: null,
  token: null,
  isAuthenticated: false,
  login: async () => ({ success: false }),
  loginWithApiKey: async () => ({ success: false }),
  register: async () => ({ success: false }),
  logout: () => {},
  changePassword: async () => ({ success: false }),
  getApiKey: async () => ({ success: false }),
  regenerateApiKey: async () => ({ success: false }),
}

const AuthContext = createContext<AuthContextValue>(defaultContextValue)

// ── 工具函式 ─────────────────────────────────────────────────────

/** 從 localStorage 恢復已儲存的認證狀態 */
function loadStoredAuth(): { token: string | null; username: string | null; userId: string | null; role: AuthRole } {
  try {
    const token = localStorage.getItem(TOKEN_KEY)
    const username = localStorage.getItem(USERNAME_KEY)
    const userId = localStorage.getItem(USERID_KEY)
    const role = (localStorage.getItem(ROLE_KEY) as AuthRole) || 'anonymous'
    return { token, username, userId, role: token ? role : 'anonymous' }
  } catch {
    return { token: null, username: null, userId: null, role: 'anonymous' }
  }
}

/** 儲存認證資訊至 localStorage */
function saveAuth(token: string, username: string, role: AuthRole, userId?: string, accessToken?: string, refreshToken?: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(USERNAME_KEY, username)
    localStorage.setItem(ROLE_KEY, role)
    if (userId) localStorage.setItem(USERID_KEY, userId)
    if (accessToken) localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
    if (refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
  } catch { /* 忽略 localStorage 不可用的情況 */ }
}

/** 清除 localStorage 中的認證資訊 */
function clearAuth(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(ACCESS_TOKEN_KEY)
    localStorage.removeItem(REFRESH_TOKEN_KEY)
    localStorage.removeItem(USERNAME_KEY)
    localStorage.removeItem(ROLE_KEY)
    localStorage.removeItem(USERID_KEY)
  } catch { /* 忽略 */ }
}

/** 從 JWT payload 解析過期時間（秒） */
function getTokenExpiry(token: string): number | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(atob(parts[1])) as { exp?: number }
    return payload.exp ?? null
  } catch {
    return null
  }
}

/** 計算距離 token 過期的毫秒數 */
function msUntilExpiry(token: string): number | null {
  const exp = getTokenExpiry(token)
  if (exp === null) return null
  return exp * 1000 - Date.now()
}

// ── Provider 元件 ────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const stored = loadStoredAuth()
  const [role, setRole] = useState<AuthRole>(stored.role)
  const [username, setUsername] = useState<string | null>(stored.username)
  const [userId, setUserId] = useState<string | null>(stored.userId)
  const [token, setToken] = useState<string | null>(stored.token)

  const tokenRef = useRef(token)
  tokenRef.current = token

  // 初始化時設定 socket auth token
  useEffect(() => {
    if (stored.token) {
      setAuthToken(stored.token)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 監聽伺服器推送的認證狀態訊息
  useEffect(() => {
    const unsub = onServerMessage((data: unknown) => {
      const msg = data as { type: string; role?: string; username?: string; userId?: string; error?: string }
      if (msg.type === 'auth:status') {
        // 伺服器回報目前身份（連線時推送，P3.4 包含 userId）
        const serverRole = (msg.role as AuthRole) || 'anonymous'
        setRole(serverRole)
        if (msg.username) setUsername(msg.username)
        if (msg.userId) setUserId(msg.userId)
        // 若本地有 token 但伺服器回報為 anonymous，嘗試升級
        if (serverRole === 'anonymous' && tokenRef.current) {
          emitRaw('auth:upgrade', { token: tokenRef.current })
        }
      } else if (msg.type === 'auth:upgraded') {
        // 身份升級成功
        const newRole = (msg.role as AuthRole) || 'member'
        setRole(newRole)
        if (msg.username) setUsername(msg.username)
        if (msg.userId) setUserId(msg.userId)
      } else if (msg.type === 'auth:error') {
        // 認證失敗 — 清除本地 token
        console.warn('[Auth] 認證錯誤:', msg.error)
        clearAuth()
        setToken(null)
        setUsername(null)
        setUserId(null)
        setRole('anonymous')
        setAuthToken(null)
      }
    })
    return unsub
  }, [])

  /** Token 自動刷新計時器 */
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** 排程 access token 自動刷新 */
  const scheduleTokenRefresh = useCallback((accessTkn: string) => {
    // 清除既有計時器
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = null
    }
    const ms = msUntilExpiry(accessTkn)
    if (ms === null) return
    // 在過期前 60 秒刷新
    const delay = Math.max(ms - TOKEN_REFRESH_BEFORE_EXPIRY_SEC * 1000, 1000)
    refreshTimerRef.current = setTimeout(async () => {
      try {
        const storedRefreshToken = localStorage.getItem(REFRESH_TOKEN_KEY)
        if (!storedRefreshToken) {
          // 無 refresh token — 清除登入狀態
          clearAuth()
          setToken(null)
          setUsername(null)
          setUserId(null)
          setRole('anonymous')
          setAuthToken(null)
          return
        }
        const res = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: storedRefreshToken }),
        })
        if (!res.ok) {
          // refresh token 也過期 — 清除登入狀態
          console.warn('[Auth] Refresh token expired, logging out')
          clearAuth()
          setToken(null)
          setUsername(null)
          setUserId(null)
          setRole('anonymous')
          setAuthToken(null)
          reconnectWithAuth()
          return
        }
        const data = await res.json() as { accessToken: string; token: string }
        // 更新 localStorage 和狀態
        const newToken = data.accessToken || data.token
        try {
          localStorage.setItem(TOKEN_KEY, newToken)
          localStorage.setItem(ACCESS_TOKEN_KEY, data.accessToken)
        } catch { /* 忽略 */ }
        setToken(newToken)
        setAuthToken(newToken)
        // 通知伺服器升級身份
        emitRaw('auth:upgrade', { token: newToken })
        // 排程下一次刷新
        scheduleTokenRefresh(data.accessToken)
      } catch {
        console.warn('[Auth] Token refresh failed')
      }
    }, delay)
  }, [])

  // 清理計時器
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    }
  }, [])

  // 初始化時排程刷新
  useEffect(() => {
    const storedAccessToken = localStorage.getItem(ACCESS_TOKEN_KEY)
    if (storedAccessToken) {
      scheduleTokenRefresh(storedAccessToken)
    }
  }, [scheduleTokenRefresh])

  /** 處理登入/註冊成功後的共通邏輯 */
  const handleAuthSuccess = useCallback((responseToken: string, responseUsername: string, responseRole: AuthRole, responseUserId?: string, accessToken?: string, refreshToken?: string) => {
    // 優先使用 accessToken，退回 legacy token
    const effectiveToken = accessToken || responseToken
    saveAuth(effectiveToken, responseUsername, responseRole, responseUserId, accessToken, refreshToken)
    setToken(effectiveToken)
    setUsername(responseUsername)
    setRole(responseRole)
    if (responseUserId) setUserId(responseUserId)
    setAuthToken(effectiveToken)
    // 通知伺服器升級此 socket 的身份
    emitRaw('auth:upgrade', { token: effectiveToken })
    // 排程 access token 自動刷新
    if (accessToken) {
      scheduleTokenRefresh(accessToken)
    }
  }, [scheduleTokenRefresh])

  const login = useCallback(async (loginUsername: string, password: string) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUsername, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        return { success: false, error: data.error || '登入失敗' }
      }
      handleAuthSuccess(data.token, data.username, data.role || 'member', data.userId, data.accessToken, data.refreshToken)
      return {
        success: true,
        mustChangePassword: data.mustChangePassword,
        apiKey: data.apiKey,
      }
    } catch {
      return { success: false, error: '網路錯誤' }
    }
  }, [handleAuthSuccess])

  const loginWithApiKey = useCallback(async (apiKey: string) => {
    try {
      const res = await fetch('/api/auth/login-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      })
      const data = await res.json()
      if (!res.ok) {
        return { success: false, error: data.error || '登入失敗' }
      }
      handleAuthSuccess(data.token, data.username, data.role || 'member', data.userId, data.accessToken, data.refreshToken)
      return { success: true }
    } catch {
      return { success: false, error: '網路錯誤' }
    }
  }, [handleAuthSuccess])

  const register = useCallback(async (regUsername: string, password: string) => {
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: regUsername, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        return { success: false, error: data.error || '註冊失敗' }
      }
      handleAuthSuccess(data.token, data.username, data.role || 'member', data.userId, data.accessToken, data.refreshToken)
      return { success: true, apiKey: data.apiKey }
    } catch {
      return { success: false, error: '網路錯誤' }
    }
  }, [handleAuthSuccess])

  const logout = useCallback(() => {
    clearAuth()
    setToken(null)
    setUsername(null)
    setUserId(null)
    setRole('anonymous')
    setAuthToken(null)
    // 重新連線以回到匿名狀態
    reconnectWithAuth()
  }, [])

  const changePassword = useCallback(async (oldPassword: string, newPassword: string) => {
    const currentToken = tokenRef.current
    if (!currentToken) return { success: false, error: '未登入' }
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentToken}`,
        },
        body: JSON.stringify({ oldPassword, newPassword }),
      })
      const data = await res.json()
      if (!res.ok) {
        return { success: false, error: data.error || '變更密碼失敗' }
      }
      // 更新 token
      if (data.token) {
        saveAuth(data.token, username || '', role)
        setToken(data.token)
        setAuthToken(data.token)
      }
      return { success: true }
    } catch {
      return { success: false, error: '網路錯誤' }
    }
  }, [username, role])

  const getApiKey = useCallback(async () => {
    const currentToken = tokenRef.current
    if (!currentToken) return { success: false, error: '未登入' }
    try {
      const res = await fetch('/api/auth/api-key', {
        headers: { 'Authorization': `Bearer ${currentToken}` },
      })
      const data = await res.json()
      if (!res.ok) return { success: false, error: data.error }
      return { success: true, apiKey: data.apiKey }
    } catch {
      return { success: false, error: '網路錯誤' }
    }
  }, [])

  const regenerateApiKey = useCallback(async () => {
    const currentToken = tokenRef.current
    if (!currentToken) return { success: false, error: '未登入' }
    try {
      const res = await fetch('/api/auth/api-key/regenerate', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${currentToken}` },
      })
      const data = await res.json()
      if (!res.ok) return { success: false, error: data.error }
      return { success: true, apiKey: data.apiKey }
    } catch {
      return { success: false, error: '網路錯誤' }
    }
  }, [])

  const isAuthenticated = role !== 'anonymous' && token !== null

  const value: AuthContextValue = {
    role,
    username,
    userId,
    token,
    isAuthenticated,
    login,
    loginWithApiKey,
    register,
    logout,
    changePassword,
    getApiKey,
    regenerateApiKey,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext)
}

export { AuthContext }
