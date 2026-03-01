import * as dgram from 'dgram';
import * as os from 'os';
import {
	LAN_DISCOVERY_UDP_PORT,
	LAN_DISCOVERY_HEARTBEAT_MS,
	LAN_DISCOVERY_TIMEOUT_MS,
} from './constants.js';

// ── 型別 ────────────────────────────────────────────────────

export interface LanPeer {
	name: string;
	host: string;
	port: number;
	agentCount: number;
	lastSeen: number;
}

interface HeartbeatPayload {
	type: 'pixel-agents-heartbeat';
	name: string;
	port: number;
	agentCount: number;
	version: string;
}

// ── 狀態 ────────────────────────────────────────────────────

let socket: dgram.Socket | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;
const peers = new Map<string, LanPeer>();

/** 自身的 HTTP 伺服器端口（用於過濾自己的心跳） */
let ownPort = 0;
let getNameFn: (() => string) | null = null;
let getAgentCountFn: (() => number) | null = null;

// ── 輔助函式 ────────────────────────────────────────────────

/** 取得所有本機 IPv4 位址（用於過濾自己的心跳） */
function getOwnAddresses(): Set<string> {
	const addrs = new Set<string>();
	addrs.add('127.0.0.1');
	addrs.add('localhost');
	const interfaces = os.networkInterfaces();
	for (const iface of Object.values(interfaces)) {
		if (!iface) continue;
		for (const info of iface) {
			if (info.family === 'IPv4') {
				addrs.add(info.address);
			}
		}
	}
	return addrs;
}

function peerKey(host: string, port: number): string {
	return `${host}:${port}`;
}

// ── 公開 API ────────────────────────────────────────────────

/**
 * 啟動 LAN 自動發現。
 * 在 UDP 端口上廣播心跳並監聽其他實例的心跳。
 */
export function startLanDiscovery(
	port: number,
	getName: () => string,
	getAgentCount: () => number,
): void {
	if (socket) {
		console.log('[LAN Discovery] Already running, skipping start');
		return;
	}

	ownPort = port;
	getNameFn = getName;
	getAgentCountFn = getAgentCount;

	socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

	socket.on('error', (err) => {
		console.error('[LAN Discovery] Socket error:', err.message);
		stopLanDiscovery();
	});

	socket.on('message', (buf, rinfo) => {
		try {
			const data = JSON.parse(buf.toString('utf-8')) as HeartbeatPayload;
			if (data.type !== 'pixel-agents-heartbeat') return;

			// 過濾自己的心跳
			const ownAddrs = getOwnAddresses();
			if (ownAddrs.has(rinfo.address) && data.port === ownPort) return;

			const key = peerKey(rinfo.address, data.port);
			peers.set(key, {
				name: data.name,
				host: rinfo.address,
				port: data.port,
				agentCount: data.agentCount,
				lastSeen: Date.now(),
			});
		} catch {
			// 忽略無法解析的封包
		}
	});

	socket.bind(LAN_DISCOVERY_UDP_PORT, () => {
		socket!.setBroadcast(true);
		console.log(`[LAN Discovery] Listening on UDP port ${LAN_DISCOVERY_UDP_PORT}`);

		// 立即發送一次心跳
		sendHeartbeat();
	});

	// 定期發送心跳
	heartbeatTimer = setInterval(sendHeartbeat, LAN_DISCOVERY_HEARTBEAT_MS);

	// 定期清理過期的 peer
	cleanupTimer = setInterval(cleanupStalePeers, LAN_DISCOVERY_HEARTBEAT_MS);
}

/** 停止 LAN 自動發現，清理所有資源。 */
export function stopLanDiscovery(): void {
	if (heartbeatTimer) {
		clearInterval(heartbeatTimer);
		heartbeatTimer = null;
	}
	if (cleanupTimer) {
		clearInterval(cleanupTimer);
		cleanupTimer = null;
	}
	if (socket) {
		try {
			socket.close();
		} catch {
			// 忽略關閉錯誤
		}
		socket = null;
	}
	peers.clear();
	getNameFn = null;
	getAgentCountFn = null;
	console.log('[LAN Discovery] Stopped');
}

/** 取得目前已發現的 LAN 同伴清單。 */
export function getLanPeers(): LanPeer[] {
	return Array.from(peers.values());
}

/** 檢查 LAN 發現是否正在運行。 */
export function isLanDiscoveryRunning(): boolean {
	return socket !== null;
}

// ── 內部函式 ────────────────────────────────────────────────

function sendHeartbeat(): void {
	if (!socket || !getNameFn || !getAgentCountFn) return;

	const payload: HeartbeatPayload = {
		type: 'pixel-agents-heartbeat',
		name: getNameFn(),
		port: ownPort,
		agentCount: getAgentCountFn(),
		version: '1.0.0',
	};

	const buf = Buffer.from(JSON.stringify(payload), 'utf-8');
	socket.send(buf, 0, buf.length, LAN_DISCOVERY_UDP_PORT, '255.255.255.255', (err) => {
		if (err) {
			console.error('[LAN Discovery] Failed to send heartbeat:', err.message);
		}
	});
}

function cleanupStalePeers(): void {
	const now = Date.now();
	for (const [key, peer] of peers) {
		if (now - peer.lastSeen > LAN_DISCOVERY_TIMEOUT_MS) {
			peers.delete(key);
		}
	}
}
