// ── Redis Pub/Sub Event Bus ─────────────────────────────────────────
// 跨伺服器事件傳播。Redis 未連線時所有操作為 no-op。
// sourceServerId 用於防止處理自己發布的事件（echo prevention）。

import * as crypto from 'crypto';
import { redis } from './redis.js';
import { logger } from '../logger.js';

/** 本伺服器的唯一識別碼（每次啟動隨機生成） */
const SERVER_ID = crypto.randomBytes(8).toString('hex');

/** Pub/Sub 事件格式 */
interface PubSubEvent {
	type: string;
	payload: unknown;
	sourceServerId: string;
}

type EventHandler = (event: PubSubEvent) => void;

// ── Floor Events ───────────────────────────────────────────────────

const FLOOR_CHANNEL_PREFIX = 'events:floor:';

/**
 * 發布樓層事件至 Redis channel。
 * Redis 未連線時靜默略過。
 */
export async function publishFloorEvent(
	floorId: string,
	event: { type: string; payload: unknown },
): Promise<void> {
	const client = redis.getClient();
	if (!client) return;
	try {
		const msg: PubSubEvent = {
			...event,
			sourceServerId: SERVER_ID,
		};
		await client.publish(
			`${FLOOR_CHANNEL_PREFIX}${floorId}`,
			JSON.stringify(msg),
		);
	} catch (err) {
		logger.warn('Redis publishFloorEvent failed', { floorId, error: String(err) });
	}
}

/**
 * 訂閱樓層事件。handler 不會收到本伺服器發布的事件。
 * Redis 未連線時靜默略過。
 * @returns 取消訂閱的函式，或 null（Redis 不可用時）
 */
export function subscribeFloorEvents(
	floorId: string,
	handler: EventHandler,
): (() => void) | null {
	const sub = redis.getSubClient();
	if (!sub) return null;

	const channel = `${FLOOR_CHANNEL_PREFIX}${floorId}`;

	const listener = (ch: string, message: string) => {
		if (ch !== channel) return;
		try {
			const event = JSON.parse(message) as PubSubEvent;
			if (event.sourceServerId === SERVER_ID) return; // 忽略自己的事件
			handler(event);
		} catch (err) {
			logger.warn('Redis subscribeFloorEvents parse error', { error: String(err) });
		}
	};

	try {
		sub.subscribe(channel).catch((err) => {
			logger.warn('Redis subscribe floor failed', { floorId, error: String(err) });
		});
		sub.on('message', listener);
	} catch (err) {
		logger.warn('Redis subscribeFloorEvents failed', { floorId, error: String(err) });
		return null;
	}

	return () => {
		try {
			sub.unsubscribe(channel).catch(() => { /* 忽略 */ });
			sub.removeListener('message', listener);
		} catch { /* 忽略 */ }
	};
}

// ── Agent Events ───────────────────────────────────────────────────

const AGENT_CHANNEL = 'events:agent';

/**
 * 發布代理事件至 Redis channel。
 */
export async function publishAgentEvent(
	event: { type: string; payload: unknown },
): Promise<void> {
	const client = redis.getClient();
	if (!client) return;
	try {
		const msg: PubSubEvent = {
			...event,
			sourceServerId: SERVER_ID,
		};
		await client.publish(AGENT_CHANNEL, JSON.stringify(msg));
	} catch (err) {
		logger.warn('Redis publishAgentEvent failed', { error: String(err) });
	}
}

/**
 * 訂閱代理事件。handler 不會收到本伺服器發布的事件。
 * @returns 取消訂閱的函式，或 null
 */
export function subscribeAgentEvents(
	handler: EventHandler,
): (() => void) | null {
	const sub = redis.getSubClient();
	if (!sub) return null;

	const listener = (ch: string, message: string) => {
		if (ch !== AGENT_CHANNEL) return;
		try {
			const event = JSON.parse(message) as PubSubEvent;
			if (event.sourceServerId === SERVER_ID) return;
			handler(event);
		} catch (err) {
			logger.warn('Redis subscribeAgentEvents parse error', { error: String(err) });
		}
	};

	try {
		sub.subscribe(AGENT_CHANNEL).catch((err) => {
			logger.warn('Redis subscribe agent failed', { error: String(err) });
		});
		sub.on('message', listener);
	} catch (err) {
		logger.warn('Redis subscribeAgentEvents failed', { error: String(err) });
		return null;
	}

	return () => {
		try {
			sub.unsubscribe(AGENT_CHANNEL).catch(() => { /* 忽略 */ });
			sub.removeListener('message', listener);
		} catch { /* 忽略 */ }
	};
}

// ── Global Events ──────────────────────────────────────────────────

const GLOBAL_CHANNEL = 'events:global';

/**
 * 發布全域事件至 Redis channel。
 */
export async function publishGlobalEvent(
	event: { type: string; payload: unknown },
): Promise<void> {
	const client = redis.getClient();
	if (!client) return;
	try {
		const msg: PubSubEvent = {
			...event,
			sourceServerId: SERVER_ID,
		};
		await client.publish(GLOBAL_CHANNEL, JSON.stringify(msg));
	} catch (err) {
		logger.warn('Redis publishGlobalEvent failed', { error: String(err) });
	}
}

/**
 * 取得本伺服器的唯一識別碼。
 */
export function getServerId(): string {
	return SERVER_ID;
}
