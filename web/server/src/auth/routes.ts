import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import {
	createUser,
	verifyUser,
	ensureDefaultUser,
	updateUserPassword,
	clearMustChangePassword,
	listUsers,
	getUserById,
	updateUserRole,
	deleteUser,
} from './userStore.js';
import { signToken, signAccessToken, signRefreshToken, verifyToken, verifyRefreshToken } from './jwt.js';
import type { TokenPayload } from './jwt.js';
import { validatePassword } from 'pixel-agents-shared';
import { logAudit } from '../auditLog.js';

const router = Router();

// ── 擴展 Express Request 型別以包含認證資訊 ────────────────────
declare global {
	// eslint-disable-next-line @typescript-eslint/no-namespace
	namespace Express {
		interface Request {
			auth?: TokenPayload;
		}
	}
}

// ── 中介軟體 ──────────────────────────────────────────────────

/** 驗證 JWT token，將 payload 附加至 req.auth */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
	const header = req.headers.authorization;
	if (!header?.startsWith('Bearer ')) {
		res.status(401).json({ error: 'Authentication required' });
		return;
	}
	try {
		const token = header.slice(7);
		req.auth = verifyToken(token);
		next();
	} catch {
		res.status(401).json({ error: 'Invalid or expired token' });
	}
}

/** 驗證使用者角色為 admin */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
	if (req.auth?.role !== 'admin') {
		res.status(403).json({ error: 'Admin access required' });
		return;
	}
	next();
}

// ── 公開路由 ──────────────────────────────────────────────────

router.post('/register', async (req, res) => {
	try {
		const { username, password } = req.body as { username?: string; password?: string };
		if (!username || !password) {
			res.status(400).json({ error: 'Username and password are required' });
			return;
		}
		if (username.length < 2 || username.length > 32) {
			res.status(400).json({ error: 'Username must be 2-32 characters' });
			return;
		}
		const validation = validatePassword(password);
		if (!validation.valid) {
			res.status(400).json({ error: validation.error });
			return;
		}
		const user = await createUser(username, password);
		const token = signToken(user.id, user.username, user.mustChangePassword, user.role);
		const accessToken = signAccessToken(user.id, user.username, user.mustChangePassword, user.role);
		const refreshToken = signRefreshToken(user.id, user.username, user.role);
		logAudit('register', user.id, `username=${username}`, req.ip);
		res.json({ token, accessToken, refreshToken, username: user.username, role: user.role ?? 'admin' });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Registration failed';
		res.status(409).json({ error: message });
	}
});

router.post('/login', async (req, res) => {
	try {
		const { username, password } = req.body as { username?: string; password?: string };
		if (!username || !password) {
			res.status(400).json({ error: 'Username and password are required' });
			return;
		}
		const user = await verifyUser(username, password);
		if (!user) {
			logAudit('login_failed', undefined, `username=${username}`, req.ip);
			res.status(401).json({ error: 'Invalid credentials' });
			return;
		}
		// 簽發存取 token + 刷新 token（同時保留舊式 token 欄位供向後相容）
		const accessToken = signAccessToken(user.id, user.username, user.mustChangePassword, user.role);
		const refreshToken = signRefreshToken(user.id, user.username, user.role);
		const legacyToken = signToken(user.id, user.username, user.mustChangePassword, user.role);
		logAudit('login', user.id, `username=${username}`, req.ip);
		res.json({
			token: legacyToken,
			accessToken,
			refreshToken,
			username: user.username,
			role: user.role ?? 'admin',
			mustChangePassword: user.mustChangePassword ?? false,
		});
	} catch {
		res.status(500).json({ error: 'Login failed' });
	}
});

// ── 需要認證的路由 ────────────────────────────────────────────

router.post('/change-password', requireAuth, async (req, res) => {
	try {
		const { oldPassword, newPassword } = req.body as { oldPassword?: string; newPassword?: string };
		if (!oldPassword || !newPassword) {
			res.status(400).json({ error: 'Old password and new password are required' });
			return;
		}
		const validation = validatePassword(newPassword);
		if (!validation.valid) {
			res.status(400).json({ error: validation.error });
			return;
		}
		// 驗證舊密碼
		const user = await verifyUser(req.auth!.username, oldPassword);
		if (!user) {
			res.status(401).json({ error: 'Current password is incorrect' });
			return;
		}
		// 更新密碼
		const newHash = await bcrypt.hash(newPassword, 10);
		updateUserPassword(user.username, newHash);
		clearMustChangePassword(user.username);
		// 簽發新 token（不含 mustChangePassword 標記）
		const token = signToken(user.id, user.username, false, user.role);
		logAudit('password_change', user.id, `username=${user.username}`, req.ip);
		res.json({ token, message: 'Password changed successfully' });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Password change failed';
		res.status(500).json({ error: message });
	}
});

// ── 需要 Admin 角色的路由 ─────────────────────────────────────

router.get('/users', requireAuth, requireAdmin, (_req, res) => {
	try {
		const users = listUsers();
		res.json({ users });
	} catch {
		res.status(500).json({ error: 'Failed to list users' });
	}
});

router.put('/users/:id/role', requireAuth, requireAdmin, (req, res) => {
	try {
		const id = req.params.id as string;
		const { role } = req.body as { role?: string };
		if (role !== 'admin' && role !== 'viewer') {
			res.status(400).json({ error: 'Role must be "admin" or "viewer"' });
			return;
		}
		const target = getUserById(id);
		if (!target) {
			res.status(404).json({ error: 'User not found' });
			return;
		}
		updateUserRole(id, role);
		logAudit('role_change', req.auth!.userId, `targetUserId=${id} newRole=${role}`, req.ip);
		res.json({ message: 'Role updated', userId: id, role });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to update role';
		res.status(500).json({ error: message });
	}
});

router.delete('/users/:id', requireAuth, requireAdmin, (req, res) => {
	try {
		const id = req.params.id as string;
		// 不能刪除自己
		if (req.auth!.userId === id) {
			res.status(400).json({ error: 'Cannot delete your own account' });
			return;
		}
		const target = getUserById(id);
		if (!target) {
			res.status(404).json({ error: 'User not found' });
			return;
		}
		deleteUser(id);
		logAudit('user_delete', req.auth!.userId, `deletedUserId=${id}`, req.ip);
		res.json({ message: 'User deleted', userId: id });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to delete user';
		res.status(500).json({ error: message });
	}
});

// ── Token 刷新端點 ─────────────────────────────────────────────

router.post('/refresh', (req, res) => {
	try {
		const { refreshToken } = req.body as { refreshToken?: string };
		if (!refreshToken) {
			res.status(400).json({ error: 'Refresh token is required' });
			return;
		}
		const payload = verifyRefreshToken(refreshToken);
		// 查找使用者以取得最新角色（可能已被 admin 變更）
		const user = getUserById(payload.userId);
		if (!user) {
			res.status(401).json({ error: 'User no longer exists' });
			return;
		}
		const newAccessToken = signAccessToken(user.id, user.username, user.mustChangePassword, user.role);
		logAudit('token_refresh', user.id, `username=${user.username}`, req.ip);
		res.json({
			accessToken: newAccessToken,
			// 同時回傳舊式 token 供向後相容
			token: signToken(user.id, user.username, user.mustChangePassword, user.role),
		});
	} catch {
		res.status(401).json({ error: 'Invalid or expired refresh token' });
	}
});

/** 初始化認證路由（確保預設使用者存在） */
export async function initAuthRoutes(): Promise<Router> {
	await ensureDefaultUser();
	return router;
}
