import type { AgentState, GrowthData, MessageSender } from './types.js';

// ── XP 獎勵常數 ─────────────────────────────────────────────────
const XP_TOOL_CALL = 1;
const XP_BASH_BONUS = 2;
const XP_TASK_BONUS = 5;
const XP_TURN_COMPLETE = 5;
const XP_SESSION_START = 10;

// ── 預設成長資料 ─────────────────────────────────────────────────
export const DEFAULT_GROWTH: GrowthData = {
	xp: 0,
	toolCallCount: 0,
	sessionCount: 0,
	bashCallCount: 0,
	achievements: [],
};

// ── 等級計算 ─────────────────────────────────────────────────────
/** 從 XP 計算等級：Math.floor(sqrt(xp / 10)) + 1 */
export function calculateLevel(xp: number): number {
	return Math.floor(Math.sqrt(xp / 10)) + 1;
}

// ── 成就定義 ─────────────────────────────────────────────────────
const ACHIEVEMENTS: Array<{ id: string; check: (g: GrowthData) => boolean }> = [
	{ id: 'first_tool', check: (g) => g.toolCallCount >= 1 },
	{ id: 'ten_tools', check: (g) => g.toolCallCount >= 10 },
	{ id: 'hundred_tools', check: (g) => g.toolCallCount >= 100 },
	{ id: 'thousand_tools', check: (g) => g.toolCallCount >= 1000 },
	{ id: 'level_5', check: (g) => calculateLevel(g.xp) >= 5 },
	{ id: 'level_10', check: (g) => calculateLevel(g.xp) >= 10 },
	{ id: 'level_25', check: (g) => calculateLevel(g.xp) >= 25 },
	{ id: 'level_50', check: (g) => calculateLevel(g.xp) >= 50 },
	{ id: 'five_sessions', check: (g) => g.sessionCount >= 5 },
	{ id: 'bash_user', check: (g) => g.bashCallCount >= 10 },
];

/** 檢查並頒發新成就，回傳新獲得的成就 ID 清單 */
function checkAchievements(growth: GrowthData): string[] {
	const newAchievements: string[] = [];
	for (const a of ACHIEVEMENTS) {
		if (!growth.achievements.includes(a.id) && a.check(growth)) {
			growth.achievements.push(a.id);
			newAchievements.push(a.id);
		}
	}
	return newAchievements;
}

/** 發送 agentGrowth 訊息至客戶端 */
function emitGrowth(
	agentId: number,
	growth: GrowthData,
	sender: MessageSender | undefined,
	newAchievements: string[],
): void {
	sender?.postMessage({
		type: 'agentGrowth',
		id: agentId,
		xp: growth.xp,
		level: calculateLevel(growth.xp),
		achievements: growth.achievements,
		newAchievements,
	});
}

/** 記錄工具呼叫並發送成長更新 */
export function recordToolCall(
	agentId: number,
	agent: AgentState,
	toolName: string,
	sender: MessageSender | undefined,
): void {
	const growth = agent.growth;
	growth.toolCallCount++;
	growth.xp += XP_TOOL_CALL;

	if (toolName === 'Bash') {
		growth.bashCallCount++;
		growth.xp += XP_BASH_BONUS;
	} else if (toolName === 'Task' || toolName === 'Agent') {
		growth.xp += XP_TASK_BONUS;
	}

	const newAchievements = checkAchievements(growth);
	emitGrowth(agentId, growth, sender, newAchievements);
}

/** 記錄回合完成並發送成長更新 */
export function recordTurnComplete(
	agentId: number,
	agent: AgentState,
	sender: MessageSender | undefined,
): void {
	const growth = agent.growth;
	growth.xp += XP_TURN_COMPLETE;

	const newAchievements = checkAchievements(growth);
	emitGrowth(agentId, growth, sender, newAchievements);
}

/** 記錄會話開始並發送成長更新 */
export function recordSessionStart(
	agentId: number,
	agent: AgentState,
	sender: MessageSender | undefined,
): void {
	const growth = agent.growth;
	growth.sessionCount++;
	growth.xp += XP_SESSION_START;

	const newAchievements = checkAchievements(growth);
	emitGrowth(agentId, growth, sender, newAchievements);
}

/** 從 PersistedAgent 資料還原成長狀態 */
export function restoreGrowth(persisted: {
	xp?: number;
	toolCallCount?: number;
	sessionCount?: number;
	bashCallCount?: number;
	achievements?: string[];
}): GrowthData {
	return {
		xp: persisted.xp ?? 0,
		toolCallCount: persisted.toolCallCount ?? 0,
		sessionCount: persisted.sessionCount ?? 0,
		bashCallCount: persisted.bashCallCount ?? 0,
		achievements: persisted.achievements ? [...persisted.achievements] : [],
	};
}
