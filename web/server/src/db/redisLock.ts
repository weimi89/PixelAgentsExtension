// ── Redis Distributed Lock ──────────────────────────────────────────
// 簡易 Redis 鎖（SET NX EX 模式）。不需要 Redlock — 單一 Redis 實例即可。
// Redis 未連線時所有操作回傳 null/false（降級至無鎖模式）。

import * as crypto from 'crypto';
import { redis } from './redis.js';
import { logger } from '../logger.js';

const LOCK_KEY_PREFIX = 'lock:';

/**
 * 嘗試取得分散式鎖。
 * @param key - 鎖的名稱（會自動加上前綴）
 * @param ttlMs - 鎖的存活時間（毫秒）
 * @returns 鎖的 token（用於釋放），或 null（取得失敗或 Redis 不可用）
 */
export async function acquireLock(
	key: string,
	ttlMs: number,
): Promise<string | null> {
	const client = redis.getClient();
	if (!client) return null;

	const token = crypto.randomBytes(16).toString('hex');
	const lockKey = `${LOCK_KEY_PREFIX}${key}`;
	const ttlSec = Math.max(1, Math.ceil(ttlMs / 1000));

	try {
		// SET key token NX EX ttl — 僅在 key 不存在時設定
		const result = await client.set(lockKey, token, 'EX', ttlSec, 'NX');
		if (result === 'OK') {
			return token;
		}
		return null; // 鎖已被其他持有者佔用
	} catch (err) {
		logger.warn('Redis acquireLock failed', { key, error: String(err) });
		return null;
	}
}

/**
 * 釋放分散式鎖。
 * 使用 Lua 腳本確保原子性 — 只有持有正確 token 才能刪除。
 * @param key - 鎖的名稱
 * @param token - acquireLock 回傳的 token
 * @returns 是否成功釋放
 */
export async function releaseLock(
	key: string,
	token: string,
): Promise<boolean> {
	const client = redis.getClient();
	if (!client) return false;

	const lockKey = `${LOCK_KEY_PREFIX}${key}`;
	// Lua 腳本：比對 token 後刪除（原子操作）
	const script = `
		if redis.call("get", KEYS[1]) == ARGV[1] then
			return redis.call("del", KEYS[1])
		else
			return 0
		end
	`;

	try {
		const result = await client.eval(script, 1, lockKey, token);
		return result === 1;
	} catch (err) {
		logger.warn('Redis releaseLock failed', { key, error: String(err) });
		return false;
	}
}

/**
 * 在鎖的保護下執行函式。
 * 取得鎖 → 執行 fn → 釋放鎖。
 * 如果無法取得鎖（被佔用或 Redis 不可用），回傳 null。
 * @param key - 鎖的名稱
 * @param ttlMs - 鎖的存活時間（毫秒）
 * @param fn - 在鎖保護下執行的非同步函式
 * @returns fn 的回傳值，或 null（無法取得鎖）
 */
export async function withLock<T>(
	key: string,
	ttlMs: number,
	fn: () => Promise<T>,
): Promise<T | null> {
	const token = await acquireLock(key, ttlMs);
	if (!token) return null;

	try {
		return await fn();
	} finally {
		await releaseLock(key, token);
	}
}
