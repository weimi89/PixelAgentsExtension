// ── Cluster Manager ─────────────────────────────────────────────────
// 多伺服器叢集管理。Redis 未連線時所有操作為 no-op（單機模式）。
// 透過 Redis 註冊/發現對等伺服器，訂閱代理事件建立「影子代理」。

import { redis } from './db/redis.js';
import {
	subscribeAgentEvents,
	publishAgentEvent,
	subscribeFloorEvents,
	publishFloorEvent,
} from './db/redisPubSub.js';
import { config } from './config.js';
import { logger } from './logger.js';
import {
	CLUSTER_HEARTBEAT_INTERVAL_MS,
	CLUSTER_HEARTBEAT_TTL_MS,
} from './constants.js';
import type { AgentContext, AgentState, FloorId } from './types.js';

// ── 伺服器註冊資訊 ──────────────────────────────────────────────

export interface PeerServerInfo {
	serverId: string;
	host: string;
	port: number;
	startedAt: number;
	lastHeartbeat: number;
	agentCount: number;
}

// ── Redis Key 格式 ──────────────────────────────────────────────

const SERVER_KEY_PREFIX = 'cluster:server:';
const SHADOW_AGENT_ID_OFFSET = -100_000; // 影子代理使用大負數 ID 區間避免衝突

// ── Cluster Manager ─────────────────────────────────────────────

export class ClusterManager {
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	private unsubAgent: (() => void) | null = null;
	private floorUnsubscribers = new Map<string, () => void>();
	private knownPeers = new Map<string, PeerServerInfo>();
	/** 影子代理 ID 生成計數器 */
	private nextShadowId = SHADOW_AGENT_ID_OFFSET;
	/** sourceServerId:remoteAgentId → 本地影子代理 ID 映射 */
	private shadowAgentMap = new Map<string, number>();
	private ctx: AgentContext | null = null;
	private started = false;

	/**
	 * 啟動叢集管理（需要 Redis 已連線）。
	 * 單機模式時此方法為 no-op。
	 */
	async start(ctx: AgentContext): Promise<void> {
		if (!config.clusterEnabled) {
			logger.info('Cluster mode disabled (no REDIS_URL)');
			return;
		}
		const client = redis.getClient();
		if (!client) {
			logger.warn('Cluster mode enabled but Redis not connected, skipping');
			return;
		}

		this.ctx = ctx;
		this.started = true;

		// 註冊本伺服器
		await this.registerSelf();

		// 啟動心跳
		this.heartbeatTimer = setInterval(() => {
			void this.registerSelf();
			void this.discoverPeers();
		}, CLUSTER_HEARTBEAT_INTERVAL_MS);

		// 初始發現
		await this.discoverPeers();

		// 訂閱代理事件（來自其他伺服器）
		this.unsubAgent = subscribeAgentEvents((event) => {
			this.handleRemoteAgentEvent(event);
		});

		logger.info('Cluster manager started', {
			serverId: config.serverId,
			heartbeatMs: CLUSTER_HEARTBEAT_INTERVAL_MS,
		});
	}

	/**
	 * 停止叢集管理，清理所有資源。
	 */
	async stop(): Promise<void> {
		if (!this.started) return;
		this.started = false;

		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}

		if (this.unsubAgent) {
			this.unsubAgent();
			this.unsubAgent = null;
		}

		// 清理樓層訂閱
		for (const unsub of this.floorUnsubscribers.values()) {
			unsub();
		}
		this.floorUnsubscribers.clear();

		// 移除 Redis 註冊
		const client = redis.getClient();
		if (client) {
			try {
				await client.del(`${SERVER_KEY_PREFIX}${config.serverId}`);
			} catch (err) {
				logger.warn('Failed to deregister server from cluster', { error: String(err) });
			}
		}

		// 清理影子代理
		this.cleanupAllShadowAgents();

		logger.info('Cluster manager stopped');
	}

	/**
	 * 取得所有已知的對等伺服器（不含自身）。
	 */
	listPeerServers(): PeerServerInfo[] {
		return Array.from(this.knownPeers.values());
	}

	/**
	 * 取得對等伺服器數量（不含自身）。
	 */
	getPeerServerCount(): number {
		return this.knownPeers.size;
	}

	/**
	 * 發布代理建立事件至叢集。
	 */
	async publishAgentCreated(agentId: number, agentInfo: {
		projectName: string;
		floorId: FloorId;
		isRemote: boolean;
		owner: string | null;
	}): Promise<void> {
		if (!this.started) return;
		await publishAgentEvent({
			type: 'agent:created',
			payload: {
				agentId,
				serverId: config.serverId,
				...agentInfo,
			},
		});
	}

	/**
	 * 發布代理移除事件至叢集。
	 */
	async publishAgentRemoved(agentId: number): Promise<void> {
		if (!this.started) return;
		await publishAgentEvent({
			type: 'agent:removed',
			payload: {
				agentId,
				serverId: config.serverId,
			},
		});
	}

	/**
	 * 發布代理工具狀態變更至叢集（轉發至同樓層的其他伺服器）。
	 */
	async publishFloorAgentEvent(floorId: FloorId, eventType: string, payload: unknown): Promise<void> {
		if (!this.started) return;
		await publishFloorEvent(floorId, {
			type: eventType,
			payload,
		});
	}

	/**
	 * 訂閱指定樓層的跨伺服器事件（當有本地客戶端觀看此樓層時呼叫）。
	 */
	subscribeFloor(floorId: FloorId): void {
		if (!this.started) return;
		if (this.floorUnsubscribers.has(floorId)) return; // 已訂閱

		const unsub = subscribeFloorEvents(floorId, (event) => {
			this.handleRemoteFloorEvent(floorId, event);
		});

		if (unsub) {
			this.floorUnsubscribers.set(floorId, unsub);
			logger.debug('Subscribed to cluster floor events', { floorId });
		}
	}

	/**
	 * 取消訂閱指定樓層（當無本地客戶端觀看此樓層時呼叫）。
	 */
	unsubscribeFloor(floorId: FloorId): void {
		const unsub = this.floorUnsubscribers.get(floorId);
		if (unsub) {
			unsub();
			this.floorUnsubscribers.delete(floorId);
			logger.debug('Unsubscribed from cluster floor events', { floorId });
		}
	}

	/**
	 * 檢查代理是否為影子代理（來自其他伺服器的視覺化複本）。
	 */
	isShadowAgent(agentId: number): boolean {
		return agentId <= SHADOW_AGENT_ID_OFFSET;
	}

	// ── 內部方法 ──────────────────────────────────────────────

	/**
	 * 在 Redis 註冊本伺服器（帶 TTL）。
	 */
	private async registerSelf(): Promise<void> {
		const client = redis.getClient();
		if (!client) return;

		const info: PeerServerInfo = {
			serverId: config.serverId,
			host: os.hostname(),
			port: config.port,
			startedAt: startedAt,
			lastHeartbeat: Date.now(),
			agentCount: this.ctx?.agents.size ?? 0,
		};

		try {
			const key = `${SERVER_KEY_PREFIX}${config.serverId}`;
			await client.set(key, JSON.stringify(info), 'PX', CLUSTER_HEARTBEAT_TTL_MS);
		} catch (err) {
			logger.warn('Failed to register server in cluster', { error: String(err) });
		}
	}

	/**
	 * 掃描 Redis 發現對等伺服器。
	 */
	private async discoverPeers(): Promise<void> {
		const client = redis.getClient();
		if (!client) return;

		try {
			const keys: string[] = [];
			let cursor = '0';
			do {
				const result = await client.scan(cursor, 'MATCH', `${SERVER_KEY_PREFIX}*`, 'COUNT', 100);
				cursor = result[0];
				keys.push(...result[1]);
			} while (cursor !== '0');

			const currentPeerIds = new Set<string>();

			for (const key of keys) {
				const data = await client.get(key);
				if (!data) continue;

				try {
					const info = JSON.parse(data) as PeerServerInfo;
					if (info.serverId === config.serverId) continue; // 跳過自己

					currentPeerIds.add(info.serverId);

					if (!this.knownPeers.has(info.serverId)) {
						logger.info('Peer server discovered', {
							peerId: info.serverId,
							host: info.host,
							port: info.port,
						});
					}
					this.knownPeers.set(info.serverId, info);
				} catch {
					// 忽略解析錯誤
				}
			}

			// 清理已消失的對等伺服器
			for (const [peerId] of this.knownPeers) {
				if (!currentPeerIds.has(peerId)) {
					logger.info('Peer server disappeared', { peerId });
					this.knownPeers.delete(peerId);
					this.cleanupShadowAgentsForServer(peerId);
				}
			}
		} catch (err) {
			logger.warn('Failed to discover peer servers', { error: String(err) });
		}
	}

	/**
	 * 處理來自其他伺服器的代理事件。
	 */
	private handleRemoteAgentEvent(event: { type: string; payload: unknown }): void {
		if (!this.ctx) return;
		const payload = event.payload as Record<string, unknown>;
		const sourceServerId = payload.serverId as string;
		if (!sourceServerId || sourceServerId === config.serverId) return;

		switch (event.type) {
			case 'agent:created': {
				const remoteAgentId = payload.agentId as number;
				const projectName = payload.projectName as string;
				const floorId = (payload.floorId as string) || '1F';
				const isRemote = payload.isRemote as boolean;
				const owner = payload.owner as string | null;

				this.createShadowAgent(sourceServerId, remoteAgentId, {
					projectName,
					floorId,
					isRemote,
					owner,
				});
				break;
			}

			case 'agent:removed': {
				const remoteAgentId = payload.agentId as number;
				this.removeShadowAgent(sourceServerId, remoteAgentId);
				break;
			}
		}
	}

	/**
	 * 處理來自其他伺服器的樓層事件（轉發至本地 Socket.IO room）。
	 */
	private handleRemoteFloorEvent(floorId: FloorId, event: { type: string; payload: unknown }): void {
		if (!this.ctx) return;
		const payload = event.payload as Record<string, unknown>;

		// 直接轉發事件至本地樓層的客戶端
		this.ctx.floorSender(floorId).postMessage(payload);
	}

	/**
	 * 建立影子代理（其他伺服器上代理的本地視覺化複本）。
	 */
	private createShadowAgent(
		sourceServerId: string,
		remoteAgentId: number,
		info: {
			projectName: string;
			floorId: FloorId;
			isRemote: boolean;
			owner: string | null;
		},
	): void {
		if (!this.ctx) return;
		const mapKey = `${sourceServerId}:${remoteAgentId}`;

		// 已存在則跳過
		if (this.shadowAgentMap.has(mapKey)) return;

		const shadowId = this.nextShadowId--;
		const agent: AgentState = {
			id: shadowId,
			process: null,
			projectDir: '',
			jsonlFile: '',
			fileOffset: 0,
			lineBuffer: '',
			activeToolIds: new Set(),
			activeToolStatuses: new Map(),
			activeToolNames: new Map(),
			activeSubagentToolIds: new Map(),
			activeSubagentToolNames: new Map(),
			isWaiting: false,
			permissionSent: false,
			hadToolsInTurn: false,
			model: null,
			tmuxSessionName: null,
			isDetached: false,
			transcriptLog: [],
			floorId: info.floorId,
			isRemote: true,
			owner: info.owner,
			remoteSessionId: null,
			gitBranch: null,
			statusHistory: [],
			teamName: null,
			cliType: 'claude',
			startedAt: Date.now(),
			growth: { xp: 0, toolCallCount: 0, sessionCount: 0, bashCallCount: 0, achievements: [] },
		};

		this.ctx.agents.set(shadowId, agent);
		this.shadowAgentMap.set(mapKey, shadowId);
		this.ctx.incrementFloorCount(info.floorId);

		logger.debug('Shadow agent created', {
			shadowId,
			sourceServerId,
			remoteAgentId,
			projectName: info.projectName,
		});

		this.ctx.floorSender(info.floorId).postMessage({
			type: 'agentCreated',
			id: shadowId,
			projectName: `[${sourceServerId.slice(0, 4)}] ${info.projectName}`,
			floorId: info.floorId,
			startedAt: agent.startedAt,
			isRemote: true,
			owner: info.owner,
			isShadow: true,
		});
		this.ctx.broadcastFloorSummaries();
	}

	/**
	 * 移除影子代理。
	 */
	private removeShadowAgent(sourceServerId: string, remoteAgentId: number): void {
		if (!this.ctx) return;
		const mapKey = `${sourceServerId}:${remoteAgentId}`;
		const shadowId = this.shadowAgentMap.get(mapKey);
		if (shadowId === undefined) return;

		const agent = this.ctx.agents.get(shadowId);
		const floorId = agent?.floorId || '1F';

		this.ctx.agents.delete(shadowId);
		this.shadowAgentMap.delete(mapKey);
		this.ctx.decrementFloorCount(floorId);

		logger.debug('Shadow agent removed', { shadowId, sourceServerId, remoteAgentId });

		this.ctx.floorSender(floorId).postMessage({ type: 'agentClosed', id: shadowId });
		this.ctx.broadcastFloorSummaries();
	}

	/**
	 * 清理指定伺服器的所有影子代理。
	 */
	private cleanupShadowAgentsForServer(serverId: string): void {
		const prefix = `${serverId}:`;
		for (const [mapKey, shadowId] of this.shadowAgentMap) {
			if (mapKey.startsWith(prefix)) {
				const agent = this.ctx?.agents.get(shadowId);
				const floorId = agent?.floorId || '1F';
				this.ctx?.agents.delete(shadowId);
				this.shadowAgentMap.delete(mapKey);
				this.ctx?.decrementFloorCount(floorId);
				this.ctx?.floorSender(floorId).postMessage({ type: 'agentClosed', id: shadowId });
			}
		}
		if (this.shadowAgentMap.size === 0) {
			this.ctx?.broadcastFloorSummaries();
		}
	}

	/**
	 * 清理所有影子代理（關機時）。
	 */
	private cleanupAllShadowAgents(): void {
		for (const [, shadowId] of this.shadowAgentMap) {
			this.ctx?.agents.delete(shadowId);
		}
		this.shadowAgentMap.clear();
	}
}

// ── 模組級別 ──────────────────────────────────────────────────

import * as os from 'os';

const startedAt = Date.now();

/** 全域叢集管理器單例 */
export const cluster = new ClusterManager();
