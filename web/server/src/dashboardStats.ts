import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LAYOUT_FILE_DIR, STATS_FLUSH_INTERVAL_MS } from './constants.js';
import { db } from './db/database.js';
import { incrementToolCallRedis } from './db/redisCache.js';

const STATS_FILE_NAME = 'dashboard-stats.json';

interface DashboardStatsData {
	totalToolCalls: number;
	toolDistribution: Record<string, number>;
}

// 記憶體快取 — 僅在無 DB 時使用
let stats: DashboardStatsData = { totalToolCalls: 0, toolDistribution: {} };
let dirty = false;
let flushTimer: ReturnType<typeof setInterval> | null = null;

function getStatsPath(): string {
	return path.join(os.homedir(), LAYOUT_FILE_DIR, STATS_FILE_NAME);
}

/** 載入統計（啟動時呼叫一次） */
export function loadDashboardStats(): void {
	// 若 DB 可用，無需從 JSON 載入
	if (db) return;

	try {
		const filePath = getStatsPath();
		if (fs.existsSync(filePath)) {
			stats = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as DashboardStatsData;
		}
	} catch {
		// 忽略讀取錯誤
	}
}

/** 儲存統計至磁碟（僅非 DB 模式使用） */
function saveDashboardStats(): void {
	if (!dirty) return;
	try {
		const filePath = getStatsPath();
		const dir = path.dirname(filePath);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
		fs.writeFileSync(filePath, JSON.stringify(stats, null, 2), 'utf-8');
		dirty = false;
	} catch {
		// 忽略寫入錯誤
	}
}

/** 記錄工具完成（由 transcriptParser 呼叫） */
export function incrementToolCall(toolName: string, agentKey?: string, floorId?: string): void {
	// Redis 即時計數（與 SQLite 並行，不阻塞）
	incrementToolCallRedis(toolName).catch(() => {
		// Redis 寫入失敗不影響 SQLite/記憶體統計
	});

	if (db) {
		db.incrementToolStat(toolName, agentKey, floorId);
		return;
	}
	stats.totalToolCalls++;
	stats.toolDistribution[toolName] = (stats.toolDistribution[toolName] || 0) + 1;
	dirty = true;
}

/** 取得當前統計資料（用於儀表板回應） */
export function getDashboardStats(): DashboardStatsData {
	if (db) {
		const dbStats = db.getToolStats();
		// 合併遷移時保留的歷史統計
		const migratedTotal = db.getSetting('migrated_total_tool_calls');
		const migratedDist = db.getSetting('migrated_tool_distribution');
		if (migratedTotal || migratedDist) {
			const mergedCounts = { ...dbStats.toolCounts };
			if (migratedDist) {
				try {
					const oldDist = JSON.parse(migratedDist) as Record<string, number>;
					for (const [tool, count] of Object.entries(oldDist)) {
						mergedCounts[tool] = (mergedCounts[tool] || 0) + count;
					}
				} catch {
					// 忽略解析錯誤
				}
			}
			const oldTotal = migratedTotal ? Number(migratedTotal) : 0;
			return {
				totalToolCalls: dbStats.totalCalls + oldTotal,
				toolDistribution: mergedCounts,
			};
		}
		return {
			totalToolCalls: dbStats.totalCalls,
			toolDistribution: dbStats.toolCounts,
		};
	}
	return stats;
}

/** 在關機時確保統計已儲存 */
export function flushDashboardStats(): void {
	if (db) return; // DB 模式下直接寫入，無需刷新
	saveDashboardStats();
}

/** 啟動定時刷新計時器（每 STATS_FLUSH_INTERVAL_MS 檢查髒旗標並寫入） */
export function startStatsFlushTimer(): void {
	if (db) return; // DB 模式下無需定時刷新
	if (flushTimer) return;
	flushTimer = setInterval(() => {
		saveDashboardStats();
	}, STATS_FLUSH_INTERVAL_MS);
	flushTimer.unref(); // 不阻止程序退出
}

/** 停止定時刷新計時器 */
export function stopStatsFlushTimer(): void {
	if (flushTimer) {
		clearInterval(flushTimer);
		flushTimer = null;
	}
}
