// ── Redis Cache Operations ──────────────────────────────────────────
// 所有操作在 Redis 未連線時為 no-op，不會影響系統正常運作。

import { redis } from './redis.js';
import { logger } from '../logger.js';
import {
	REDIS_AGENT_CACHE_TTL_MS,
	REDIS_JWT_CACHE_TTL_MS,
} from '../constants.js';

// ── Agent State Cache ──────────────────────────────────────────────

const AGENT_KEY_PREFIX = 'agents:';
const AGENT_TTL_SEC = Math.ceil(REDIS_AGENT_CACHE_TTL_MS / 1000);

/**
 * 快取代理狀態至 Redis（HSET + TTL）。
 * Redis 未連線時靜默略過。
 */
export async function cacheAgentState(
	agentId: number | string,
	state: Record<string, string>,
): Promise<void> {
	const client = redis.getClient();
	if (!client) return;
	try {
		const key = `${AGENT_KEY_PREFIX}${agentId}`;
		if (Object.keys(state).length === 0) return;
		await client.hset(key, state);
		await client.expire(key, AGENT_TTL_SEC);
	} catch (err) {
		logger.warn('Redis cacheAgentState failed', { agentId, error: String(err) });
	}
}

/**
 * 從 Redis 讀取代理快取狀態（HGETALL）。
 * Redis 未連線時回傳 null。
 */
export async function getCachedAgentState(
	agentId: number | string,
): Promise<Record<string, string> | null> {
	const client = redis.getClient();
	if (!client) return null;
	try {
		const key = `${AGENT_KEY_PREFIX}${agentId}`;
		const result = await client.hgetall(key);
		if (!result || Object.keys(result).length === 0) return null;
		return result;
	} catch (err) {
		logger.warn('Redis getCachedAgentState failed', { agentId, error: String(err) });
		return null;
	}
}

/**
 * 清除代理快取（DEL）。
 * Redis 未連線時靜默略過。
 */
export async function clearAgentCache(
	agentId: number | string,
): Promise<void> {
	const client = redis.getClient();
	if (!client) return;
	try {
		await client.del(`${AGENT_KEY_PREFIX}${agentId}`);
	} catch (err) {
		logger.warn('Redis clearAgentCache failed', { agentId, error: String(err) });
	}
}

// ── JWT Verification Cache ─────────────────────────────────────────

const JWT_KEY_PREFIX = 'jwt:';
const JWT_TTL_SEC = Math.ceil(REDIS_JWT_CACHE_TTL_MS / 1000);

/**
 * 快取已驗證的 JWT payload（SET + EX）。
 * @param tokenHash - token 的雜湊值（避免在 Redis 中存儲完整 token）
 * @param payload - 已驗證的 payload JSON 字串
 * @param ttlSeconds - 可選自訂 TTL，預設為 REDIS_JWT_CACHE_TTL_MS
 */
export async function cacheJwtPayload(
	tokenHash: string,
	payload: string,
	ttlSeconds?: number,
): Promise<void> {
	const client = redis.getClient();
	if (!client) return;
	try {
		const key = `${JWT_KEY_PREFIX}${tokenHash}`;
		await client.set(key, payload, 'EX', ttlSeconds ?? JWT_TTL_SEC);
	} catch (err) {
		logger.warn('Redis cacheJwtPayload failed', { error: String(err) });
	}
}

/**
 * 從 Redis 讀取快取的 JWT payload。
 * 回傳 null 表示快取未命中或 Redis 不可用。
 */
export async function getCachedJwtPayload(
	tokenHash: string,
): Promise<Record<string, unknown> | null> {
	const client = redis.getClient();
	if (!client) return null;
	try {
		const key = `${JWT_KEY_PREFIX}${tokenHash}`;
		const result = await client.get(key);
		if (!result) return null;
		return JSON.parse(result) as Record<string, unknown>;
	} catch (err) {
		logger.warn('Redis getCachedJwtPayload failed', { error: String(err) });
		return null;
	}
}

// ── Real-time Stats Counter ────────────────────────────────────────

const STATS_TOTAL_KEY = 'stats:tool_calls:total';
const STATS_TOOL_PREFIX = 'stats:tool_calls:';

/**
 * 在 Redis 中遞增工具呼叫計數器（與 SQLite 寫入並行）。
 * Redis 未連線時靜默略過。
 */
export async function incrementToolCallRedis(toolName: string): Promise<void> {
	const client = redis.getClient();
	if (!client) return;
	try {
		const pipeline = client.pipeline();
		pipeline.incr(STATS_TOTAL_KEY);
		pipeline.incr(`${STATS_TOOL_PREFIX}${toolName}`);
		await pipeline.exec();
	} catch (err) {
		logger.warn('Redis incrementToolCallRedis failed', { toolName, error: String(err) });
	}
}

/** Redis 工具統計結果 */
interface RedisToolStats {
	totalCalls: number;
	toolCounts: Record<string, number>;
}

/**
 * 從 Redis 讀取工具統計計數器。
 * Redis 未連線時回傳 null。
 */
export async function getRedisToolStats(): Promise<RedisToolStats | null> {
	const client = redis.getClient();
	if (!client) return null;
	try {
		const total = await client.get(STATS_TOTAL_KEY);
		// 掃描所有工具計數 key
		const toolCounts: Record<string, number> = {};
		let cursor = '0';
		do {
			const [nextCursor, keys] = await client.scan(
				cursor, 'MATCH', `${STATS_TOOL_PREFIX}*`, 'COUNT', 100,
			);
			cursor = nextCursor;
			if (keys.length > 0) {
				const values = await client.mget(...keys);
				for (let i = 0; i < keys.length; i++) {
					const key = keys[i];
					if (!key || key === STATS_TOTAL_KEY) continue;
					const toolName = key.slice(STATS_TOOL_PREFIX.length);
					if (toolName) {
						toolCounts[toolName] = parseInt(values[i] ?? '0', 10);
					}
				}
			}
		} while (cursor !== '0');
		return {
			totalCalls: parseInt(total ?? '0', 10),
			toolCounts,
		};
	} catch (err) {
		logger.warn('Redis getRedisToolStats failed', { error: String(err) });
		return null;
	}
}
