import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import jwt from 'jsonwebtoken';
import {
	LAYOUT_FILE_DIR,
	JWT_SECRET_FILE_NAME,
	AUTH_TOKEN_EXPIRY_DAYS,
	ACCESS_TOKEN_EXPIRY_MINUTES,
	REFRESH_TOKEN_EXPIRY_DAYS,
	REDIS_JWT_CACHE_TTL_MS,
} from '../constants.js';
import { cacheJwtPayload, getCachedJwtPayload } from '../db/redisCache.js';

const userDir = path.join(os.homedir(), LAYOUT_FILE_DIR);

function getSecretFilePath(): string {
	return path.join(userDir, JWT_SECRET_FILE_NAME);
}

/** 取得或自動生成 JWT 密鑰 */
function getSecret(): string {
	const filePath = getSecretFilePath();
	try {
		if (fs.existsSync(filePath)) {
			return fs.readFileSync(filePath, 'utf-8').trim();
		}
	} catch { /* 讀取失敗就重新生成 */ }

	const dir = path.dirname(filePath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
	const secret = crypto.randomBytes(32).toString('hex');
	fs.writeFileSync(filePath, secret, { mode: 0o600 });
	console.log('[Pixel Agents] Generated new JWT secret');
	return secret;
}

// 啟動時快取密鑰
let cachedSecret: string | null = null;

function secret(): string {
	if (!cachedSecret) {
		cachedSecret = getSecret();
	}
	return cachedSecret;
}

export interface TokenPayload {
	userId: string;
	username: string;
	mustChangePassword?: boolean;
	role?: string;
	/** Token 類型：'access' 或 'refresh'。舊版 token 無此欄位視為 access。 */
	tokenType?: 'access' | 'refresh';
}

/**
 * 簽發舊式長效 token（向後相容 — 30 天有效期）。
 * 新的登入流程應改用 signAccessToken + signRefreshToken。
 */
export function signToken(
	userId: string,
	username: string,
	mustChangePassword?: boolean,
	role?: string,
): string {
	const payload: TokenPayload = { userId, username };
	if (mustChangePassword) payload.mustChangePassword = true;
	if (role) payload.role = role;
	return jwt.sign(
		payload satisfies TokenPayload,
		secret(),
		{ expiresIn: `${AUTH_TOKEN_EXPIRY_DAYS}d` },
	);
}

/**
 * 簽發短效存取 token（15 分鐘）。
 */
export function signAccessToken(
	userId: string,
	username: string,
	mustChangePassword?: boolean,
	role?: string,
): string {
	const payload: TokenPayload = { userId, username, tokenType: 'access' };
	if (mustChangePassword) payload.mustChangePassword = true;
	if (role) payload.role = role;
	return jwt.sign(
		payload satisfies TokenPayload,
		secret(),
		{ expiresIn: `${ACCESS_TOKEN_EXPIRY_MINUTES}m` },
	);
}

/**
 * 簽發長效刷新 token（30 天）。
 * 刷新 token 僅用於換取新的存取 token，不應用於 API 存取。
 */
export function signRefreshToken(
	userId: string,
	username: string,
	role?: string,
): string {
	const payload: TokenPayload = { userId, username, tokenType: 'refresh' };
	if (role) payload.role = role;
	return jwt.sign(
		payload satisfies TokenPayload,
		secret(),
		{ expiresIn: `${REFRESH_TOKEN_EXPIRY_DAYS}d` },
	);
}

/** 計算 token 的 SHA-256 雜湊（避免在 Redis 中存儲完整 token） */
function hashToken(token: string): string {
	return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * 驗證 token（同步版本，不查詢 Redis 快取）。
 * 支援舊式（無 tokenType）和新式（access/refresh）token。
 */
export function verifyToken(token: string): TokenPayload {
	const decoded = jwt.verify(token, secret());
	const payload = decoded as TokenPayload;
	if (!payload.userId || !payload.username) {
		throw new Error('Invalid token payload');
	}
	return payload;
}

/**
 * 驗證 token（非同步版本，優先查詢 Redis 快取）。
 * 快取命中時跳過 JWT 簽章驗證，提升效能。
 * Redis 不可用時退回至同步驗證。
 */
export async function verifyTokenCached(token: string): Promise<TokenPayload> {
	const tokenHash = hashToken(token);

	// 1. 嘗試從 Redis 快取讀取
	const cached = await getCachedJwtPayload(tokenHash);
	if (cached) {
		const payload = cached as unknown as TokenPayload;
		if (payload.userId && payload.username) {
			return payload;
		}
	}

	// 2. 快取未命中 — 執行完整驗證
	const payload = verifyToken(token);

	// 3. 寫入快取（非同步，不阻塞）
	const ttlSeconds = Math.ceil(REDIS_JWT_CACHE_TTL_MS / 1000);
	cacheJwtPayload(tokenHash, JSON.stringify(payload), ttlSeconds).catch(() => {
		// 快取寫入失敗不影響正常流程
	});

	return payload;
}

/**
 * 驗證刷新 token — 確保 tokenType 為 'refresh'。
 */
export function verifyRefreshToken(token: string): TokenPayload {
	const payload = verifyToken(token);
	if (payload.tokenType !== 'refresh') {
		throw new Error('Not a refresh token');
	}
	return payload;
}
