// ── Redis Connection Manager ────────────────────────────────────────
// Redis 為選配元件 — 未設定 REDIS_URL 時所有功能正常運作（單機模式）。
// 使用 ioredis 管理連線，內建自動重連。

import { Redis } from 'ioredis';
import type { RedisOptions } from 'ioredis';
import { logger } from '../logger.js';

type DisconnectCallback = () => void;
type ReconnectCallback = () => void;

class RedisManager {
	private client: Redis | null = null;
	private sub: Redis | null = null;
	private connected = false;
	private disconnectCallbacks: DisconnectCallback[] = [];
	private reconnectCallbacks: ReconnectCallback[] = [];

	/**
	 * 建立 Redis 連線（主連線 + pub/sub 訂閱連線）。
	 * 使用 lazyConnect 控制連線時機，並監聽連線事件。
	 */
	async connect(url: string): Promise<void> {
		try {
			const options: RedisOptions = {
				lazyConnect: true,
				maxRetriesPerRequest: 3,
				retryStrategy(times: number) {
					// 指數退避，最大 30 秒
					const delay = Math.min(times * 1000, 30_000);
					return delay;
				},
				enableReadyCheck: true,
			};

			this.client = new Redis(url, options);
			this.sub = new Redis(url, options);

			this.setupEventHandlers(this.client, 'main');
			this.setupEventHandlers(this.sub, 'sub');

			await this.client.connect();
			await this.sub.connect();

			this.connected = true;
			logger.info('Redis connected', { url: this.redactUrl(url) });
		} catch (err) {
			logger.warn('Redis connection failed, running without Redis', {
				error: String(err),
			});
			await this.cleanup();
		}
	}

	/** 註冊連線事件處理器 */
	private setupEventHandlers(client: Redis, label: string): void {
		client.on('error', (err: Error) => {
			// ioredis 會自動重連，僅記錄警告
			logger.warn(`Redis ${label} error`, { error: err.message });
		});

		client.on('close', () => {
			if (this.connected) {
				this.connected = false;
				logger.warn(`Redis ${label} disconnected`);
				for (const cb of this.disconnectCallbacks) {
					try { cb(); } catch { /* 忽略回呼錯誤 */ }
				}
			}
		});

		client.on('ready', () => {
			if (!this.connected) {
				this.connected = true;
				logger.info(`Redis ${label} reconnected`);
				for (const cb of this.reconnectCallbacks) {
					try { cb(); } catch { /* 忽略回呼錯誤 */ }
				}
			}
		});
	}

	/** 是否已連線且可用 */
	isConnected(): boolean {
		return this.connected && this.client !== null && this.client.status === 'ready';
	}

	/** 取得主連線（用於一般讀寫操作）。未連線時回傳 null。 */
	getClient(): Redis | null {
		return this.isConnected() ? this.client : null;
	}

	/** 取得訂閱專用連線（用於 pub/sub）。未連線時回傳 null。 */
	getSubClient(): Redis | null {
		if (!this.connected || !this.sub || this.sub.status !== 'ready') return null;
		return this.sub;
	}

	/** 健康檢查 — 發送 PING 確認連線存活 */
	async healthCheck(): Promise<boolean> {
		if (!this.isConnected() || !this.client) return false;
		try {
			const result = await this.client.ping();
			return result === 'PONG';
		} catch {
			return false;
		}
	}

	/** 註冊斷線回呼 */
	onDisconnect(callback: DisconnectCallback): void {
		this.disconnectCallbacks.push(callback);
	}

	/** 註冊重連回呼 */
	onReconnect(callback: ReconnectCallback): void {
		this.reconnectCallbacks.push(callback);
	}

	/** 斷開所有連線並清理資源 */
	async disconnect(): Promise<void> {
		await this.cleanup();
		logger.info('Redis disconnected');
	}

	/** 內部清理 */
	private async cleanup(): Promise<void> {
		this.connected = false;
		if (this.sub) {
			try { this.sub.disconnect(); } catch { /* 忽略 */ }
			this.sub = null;
		}
		if (this.client) {
			try { this.client.disconnect(); } catch { /* 忽略 */ }
			this.client = null;
		}
	}

	/** 遮蔽 URL 中的密碼 */
	private redactUrl(url: string): string {
		try {
			const parsed = new URL(url);
			if (parsed.password) {
				parsed.password = '***';
			}
			return parsed.toString();
		} catch {
			return '(invalid url)';
		}
	}
}

/** 全域 Redis 管理器單例 */
export const redis = new RedisManager();

/**
 * 初始化 Redis 連線。
 * 僅在提供 url 時才嘗試連線，否則靜默略過（單機模式）。
 */
export async function initRedis(url?: string): Promise<void> {
	if (!url) {
		logger.info('Redis URL not configured, running in single-server mode');
		return;
	}
	await redis.connect(url);
}
